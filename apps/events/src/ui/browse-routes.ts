import { isDate } from "@benchme/scenarios";
import { DomainError } from "@benchme/site-kit";
import type { FastifyInstance } from "fastify";
import { freeRoomSchema } from "../api/inputs.js";
import type { EventView } from "../db/rows.js";
import * as browse from "./pages/browse.js";
import { peopleList, personPage } from "./pages/people.js";
import { flat, one, query, type UiKit } from "./shell.js";

const ALL = 200;

/** Offices, rooms and their days, the free-room search, and the directory. */
export function registerBrowseUi(app: FastifyInstance, k: UiKit): void {
  const { d } = k;
  const searchOf = (f: Record<string, string | string[] | undefined>): browse.RoomSearch => {
    const e = f.equipment;
    return { ...flat(f), equipment: e === undefined ? [] : Array.isArray(e) ? e : [e] };
  };

  app.get("/", async (req, reply) => k.page(req, reply, "Find a free room", async () => browse.home(req.prefix, await d.offices.listOffices(req.workspaceId), searchOf(query(req)))));

  app.get("/free-rooms", async (req, reply) => {
    const f = query(req);
    const offices = await d.offices.listOffices(req.workspaceId);
    const parsed = freeRoomSchema.safeParse(f);
    if (!parsed.success) {
      const flash = `Check the search: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`;
      return k.page(req, reply, "Find a free room", () => browse.home(req.prefix, offices, searchOf(f)), { code: 400, flash });
    }
    try {
      const rooms = await d.offices.freeRooms(req.workspaceId, { ...parsed.data, accessible: parsed.data.accessible === "true" });
      const office = (await d.offices.getOffice(req.workspaceId, parsed.data.office))!;
      const s = searchOf(f);
      return k.page(req, reply, `Free rooms at the ${office.name}`, () => browse.freeRooms(req.prefix, office, { ...s, date: parsed.data.date, startTime: parsed.data.startTime, endTime: parsed.data.endTime, people: String(parsed.data.people) }, rooms));
    } catch (err) {
      if (!(err instanceof DomainError)) throw err;
      return k.page(req, reply, "Find a free room", () => browse.home(req.prefix, offices, searchOf(f)), { code: err.status, flash: err.message });
    }
  });

  app.get<{ Params: { code: string } }>("/offices/:code", async (req, reply) => {
    const o = await d.offices.getOffice(req.workspaceId, req.params.code);
    if (!o) return k.page(req, reply, "Not found", () => "<h1>No such office</h1>", { code: 404 });
    const date = one(query(req).date);
    let byRoom: Map<string, EventView[]> | null = null;
    if (date && isDate(date)) {
      const day = await d.events.listEvents(req.workspaceId, { office: o.code, date, status: "scheduled", limit: ALL });
      byRoom = new Map(o.rooms.map((r) => [r.code, day.items.filter((e) => e.roomCode === r.code)]));
    }
    return k.page(req, reply, o.name, () => browse.officeDetail(req.prefix, o, date, byRoom));
  });

  app.get<{ Params: { code: string } }>("/rooms/:code", async (req, reply) => {
    const r = await d.offices.getRoom(req.workspaceId, req.params.code);
    if (!r) return k.page(req, reply, "Not found", () => "<h1>No such room</h1>", { code: 404 });
    const o = (await d.offices.getOffice(req.workspaceId, r.officeCode))!;
    const date = one(query(req).date);
    const events = date && isDate(date) ? (await d.events.listEvents(req.workspaceId, { room: r.code, date, status: "scheduled", limit: ALL })).items : null;
    return k.page(req, reply, r.name, () => browse.roomDetail(req.prefix, r, o, date, events));
  });

  app.get("/people", async (req, reply) => {
    const f = flat(query(req));
    const filter = Object.fromEntries(Object.entries({ office: f.office, team: f.team, name: f.name }).filter(([, v]) => v));
    const offices = await d.offices.listOffices(req.workspaceId);
    return k.page(req, reply, "People", async () => peopleList(req.prefix, offices, await d.offices.listPeople(req.workspaceId, filter), f));
  });

  app.get<{ Params: { email: string } }>("/people/:email", async (req, reply) => {
    const ws = req.workspaceId;
    const email = req.params.email.trim().toLowerCase();
    const person = await d.offices.getPerson(ws, email);
    const office = person ? ((await d.offices.getOffice(ws, person.officeCode)) ?? undefined) : undefined;
    const schedule = {
      organising: (await d.events.listEvents(ws, { organiser: email, limit: ALL })).items,
      invited: (await d.events.listEvents(ws, { guest: email, limit: ALL })).items,
      registrations: (await d.registrations.listRegistrations(ws, { email, limit: ALL })).items,
    };
    return k.page(req, reply, person?.name ?? email, () => personPage(req.prefix, email, person, office, schedule));
  });
}
