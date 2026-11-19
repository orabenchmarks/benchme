import { DomainError, apiUser, type AuthService } from "@benchme/site-kit";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { EventsRepo } from "../db/events-repo.js";
import type { OfficesRepo } from "../db/offices-repo.js";
import type { RegistrationsRepo } from "../db/registrations-repo.js";
import { SESSION_COOKIE } from "../ui/shell.js";
import { changeSchema, date, equipmentList, eventSchema, freeRoomSchema, given, organiserSchema, registerSchema, registrationMode } from "./inputs.js";

export type ApiDeps = { offices: OfficesRepo; events: EventsRepo; registrations: RegistrationsRepo; auth: AuthService };

const flag = given(z.enum(["true", "false"]).optional());
const roomsQuery = z.object({ office: z.string().optional(), minCapacity: given(z.coerce.number().int().min(1).optional()), equipment: equipmentList, accessible: flag });
const peopleQuery = z.object({ office: z.string().optional(), team: z.string().optional(), name: z.string().optional() });
const page = { cursor: z.string().optional(), limit: given(z.coerce.number().int().min(1).max(200).default(50)) };
const eventsQuery = z.object({
  office: z.string().optional(), room: z.string().optional(), date: given(date.optional()), from: given(date.optional()), to: given(date.optional()), organiser: z.string().optional(), guest: z.string().optional(),
  registrant: z.string().optional(), q: z.string().optional(), registration: given(registrationMode.optional()), status: given(z.enum(["scheduled", "cancelled"]).optional()), hasPlaces: flag, ...page,
});
const registrationsQuery = z.object({ email: z.string().optional(), event: z.string().optional(), status: given(z.enum(["registered", "cancelled"]).optional()), ...page });
/** Drops the keys a query left out, so a filter object never carries `undefined`. */
const defined = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== "")) as T;

/** REST under /api/v1. Reads are open inside the workspace; every write needs a bearer token or a session. */
export function registerApi(app: FastifyInstance, d: ApiDeps): void {
  const caller = apiUser(d.auth, SESSION_COOKIE);
  const authed = async (req: FastifyRequest, reply: FastifyReply): Promise<boolean> => {
    if (await caller(req)) return true;
    reply.code(401).send({ error: "UNAUTHORIZED", message: "sign in or send Authorization: Bearer <api token>" });
    return false;
  };
  const run = async (reply: FastifyReply, fn: () => Promise<unknown>, code = 200) => {
    try {
      return reply.code(code).send(await fn());
    } catch (err) {
      if (err instanceof DomainError) return reply.code(err.status).send({ error: err.code, message: err.message });
      throw err;
    }
  };
  /** A bad query is the caller's to fix: 400 with zod's own words, not a 500. */
  const parse = <S extends z.ZodTypeAny>(schema: S, data: unknown, reply: FastifyReply): z.output<S> | null => {
    const r = schema.safeParse(data ?? {});
    if (r.success) return r.data;
    reply.code(400).send({ error: "BAD_REQUEST", message: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
    return null;
  };
  const notFound = (reply: FastifyReply) => reply.code(404).send({ error: "NOT_FOUND" });
  type P = { Params: { code: string } };

  app.get("/api/v1/offices", async (req) => d.offices.listOffices(req.workspaceId));
  app.get<P>("/api/v1/offices/:code", async (req, reply) => (await d.offices.getOffice(req.workspaceId, req.params.code)) ?? notFound(reply));
  app.get("/api/v1/rooms", async (req, reply) => {
    const f = parse(roomsQuery, req.query, reply);
    if (!f) return;
    return run(reply, () => d.offices.listRooms(req.workspaceId, defined({ office: f.office, minCapacity: f.minCapacity, equipment: f.equipment, accessible: f.accessible === "true" || undefined })));
  });
  app.get<P>("/api/v1/rooms/:code", async (req, reply) => (await d.offices.getRoom(req.workspaceId, req.params.code)) ?? notFound(reply));
  app.get("/api/v1/free-rooms", async (req, reply) => {
    const q = parse(freeRoomSchema, req.query, reply);
    if (!q) return;
    return run(reply, () => d.offices.freeRooms(req.workspaceId, { ...q, accessible: q.accessible === "true" }));
  });
  app.get("/api/v1/people", async (req, reply) => {
    const f = parse(peopleQuery, req.query, reply);
    if (!f) return;
    return run(reply, () => d.offices.listPeople(req.workspaceId, defined(f)));
  });
  app.get<{ Params: { email: string } }>("/api/v1/people/:email", async (req, reply) => (await d.offices.getPerson(req.workspaceId, req.params.email)) ?? notFound(reply));

  app.get("/api/v1/events", async (req, reply) => {
    const f = parse(eventsQuery, req.query, reply);
    if (!f) return;
    const { hasPlaces, limit, ...rest } = f;
    return run(reply, () => d.events.listEvents(req.workspaceId, { ...defined(rest), ...(hasPlaces === "true" ? { hasPlaces: true } : {}), limit }));
  });
  app.get<P>("/api/v1/events/:code", async (req, reply) => (await d.events.getEvent(req.workspaceId, req.params.code)) ?? notFound(reply));
  app.post("/api/v1/events", async (req, reply) => {
    if (!(await authed(req, reply))) return;
    const e = parse(eventSchema, req.body, reply);
    if (!e) return;
    return run(reply, () => d.events.createEvent(req.workspaceId, e), 201);
  });
  app.post<P>("/api/v1/events/:code/change", async (req, reply) => {
    if (!(await authed(req, reply))) return;
    const ch = parse(changeSchema, req.body, reply);
    if (!ch) return;
    return run(reply, () => d.events.changeEvent(req.workspaceId, req.params.code, defined(ch)));
  });
  app.post<P>("/api/v1/events/:code/cancel", async (req, reply) => {
    if (!(await authed(req, reply))) return;
    const b = parse(organiserSchema, req.body, reply);
    if (!b) return;
    return run(reply, () => d.events.cancelEvent(req.workspaceId, req.params.code, b.organiserEmail));
  });
  app.post<P>("/api/v1/events/:code/register", async (req, reply) => {
    if (!(await authed(req, reply))) return;
    const who = parse(registerSchema, req.body, reply);
    if (!who) return;
    return run(reply, () => d.registrations.register(req.workspaceId, req.params.code, who), 201);
  });

  app.get("/api/v1/registrations", async (req, reply) => {
    const f = parse(registrationsQuery, req.query, reply);
    if (!f) return;
    const { limit, ...rest } = f;
    return d.registrations.listRegistrations(req.workspaceId, { ...defined(rest), limit });
  });
  app.get<P>("/api/v1/registrations/:code", async (req, reply) => (await d.registrations.getRegistration(req.workspaceId, req.params.code)) ?? notFound(reply));
  app.post<P>("/api/v1/registrations/:code/cancel", async (req, reply) => {
    if (!(await authed(req, reply))) return;
    return run(reply, () => d.registrations.cancelRegistration(req.workspaceId, req.params.code));
  });
}
