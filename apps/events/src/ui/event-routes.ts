import { DomainError } from "@benchme/site-kit";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { changeSchema, eventSchema, organiserSchema, registerSchema } from "../api/inputs.js";
import { changeEventForm, newEventForm, valuesOf, type EventValues } from "./pages/event-form.js";
import { eventDetail, eventsList, type EventFilters } from "./pages/events.js";
import { flat, form, query, type UiKit } from "./shell.js";

const fieldsOf = (issues: { path: (string | number)[] }[]) => issues.map((i) => i.path.join(".")).join(", ");

/** The events list, an event's page, and every write on an event: create, change, cancel, register. */
export function registerEventUi(app: FastifyInstance, k: UiKit): void {
  const { d } = k;
  type P = { Params: { code: string } };

  const eventPage = async (req: FastifyRequest, reply: FastifyReply, code: string, opts: { code?: number; flash?: string } = {}) => {
    const e = await d.events.getEvent(req.workspaceId, code);
    if (!e) return k.page(req, reply, "Not found", () => "<h1>No such event</h1>", { code: 404 });
    const room = await d.offices.getRoom(req.workspaceId, e.roomCode);
    const office = await d.offices.getOffice(req.workspaceId, e.officeCode);
    return k.page(req, reply, e.title, (c) => eventDetail(req.prefix, e, room, office, !!c.user), opts);
  };
  const newPage = async (req: FastifyRequest, reply: FastifyReply, v: EventValues, opts: { code?: number; flash?: string } = {}) => {
    const offices = await d.offices.listOffices(req.workspaceId);
    return k.page(req, reply, "New event", (c) => newEventForm(req.prefix, offices, v, !!c.user), opts);
  };
  const changePage = async (req: FastifyRequest, reply: FastifyReply, code: string, v: EventValues | null, opts: { code?: number; flash?: string } = {}) => {
    const e = await d.events.getEvent(req.workspaceId, code);
    if (!e) return k.page(req, reply, "Not found", () => "<h1>No such event</h1>", { code: 404 });
    const offices = await d.offices.listOffices(req.workspaceId);
    return k.page(req, reply, `Change ${e.code}`, (c) => changeEventForm(req.prefix, e, offices, v ?? valuesOf(e), !!c.user), opts);
  };
  /** A refused write re-renders its page with the reason; anything else is a 500. */
  const refused = (err: unknown) => {
    if (err instanceof DomainError) return { code: err.status, flash: err.message };
    throw err;
  };

  app.get("/events", async (req, reply) => {
    const f = flat(query(req)) as EventFilters & { cursor?: string };
    const offices = await d.offices.listOffices(req.workspaceId);
    const filter = Object.fromEntries(Object.entries({ office: f.office, date: f.date, from: f.from, to: f.to, q: f.q, organiser: f.organiser, guest: f.guest, registrant: f.registrant, cursor: f.cursor }).filter(([, v]) => v));
    try {
      const list = await d.events.listEvents(req.workspaceId, { ...filter, ...(f.hasPlaces === "true" ? { hasPlaces: true } : {}), limit: 50 });
      return k.page(req, reply, "Events", () => eventsList(req.prefix, offices, list.items, list.nextCursor, f));
    } catch (err) {
      return k.page(req, reply, "Events", () => eventsList(req.prefix, offices, [], null, f), refused(err));
    }
  });

  app.get("/events/new", async (req, reply) => newPage(req, reply, flat(query(req)) as EventValues));

  app.post("/events", async (req, reply) => {
    if (!(await k.requireUser(req, reply))) return;
    const f = form(req) as EventValues;
    const parsed = eventSchema.safeParse(f);
    if (!parsed.success) return newPage(req, reply, f, { code: 400, flash: `Check the event: ${fieldsOf(parsed.error.issues)}` });
    try {
      const e = await d.events.createEvent(req.workspaceId, parsed.data);
      return reply.redirect(`${req.prefix}/events/${e.code}`, 303);
    } catch (err) {
      return newPage(req, reply, f, refused(err));
    }
  });

  app.get<P>("/events/:code", async (req, reply) => eventPage(req, reply, req.params.code));

  app.get<P>("/events/:code/change", async (req, reply) => changePage(req, reply, req.params.code, null));

  app.post<P>("/events/:code/change", async (req, reply) => {
    if (!(await k.requireUser(req, reply))) return;
    const f = form(req) as EventValues;
    const parsed = changeSchema.safeParse(f);
    if (!parsed.success) return changePage(req, reply, req.params.code, f, { code: 400, flash: `Check the change: ${fieldsOf(parsed.error.issues)}` });
    try {
      await d.events.changeEvent(req.workspaceId, req.params.code, parsed.data);
      return reply.redirect(`${req.prefix}/events/${req.params.code}`, 303);
    } catch (err) {
      return changePage(req, reply, req.params.code, f, refused(err));
    }
  });

  app.post<P>("/events/:code/cancel", async (req, reply) => {
    if (!(await k.requireUser(req, reply))) return;
    const parsed = organiserSchema.safeParse(form(req));
    if (!parsed.success) return eventPage(req, reply, req.params.code, { code: 400, flash: "Give the organiser's email to cancel the event." });
    try {
      await d.events.cancelEvent(req.workspaceId, req.params.code, parsed.data.organiserEmail);
      return reply.redirect(`${req.prefix}/events/${req.params.code}`, 303);
    } catch (err) {
      return eventPage(req, reply, req.params.code, refused(err));
    }
  });

  app.post<P>("/events/:code/register", async (req, reply) => {
    if (!(await k.requireUser(req, reply))) return;
    const parsed = registerSchema.safeParse(form(req));
    if (!parsed.success) return eventPage(req, reply, req.params.code, { code: 400, flash: `Check the registration: ${fieldsOf(parsed.error.issues)}` });
    try {
      const r = await d.registrations.register(req.workspaceId, req.params.code, parsed.data);
      return reply.redirect(`${req.prefix}/registrations/${r.regNo}`, 303);
    } catch (err) {
      return eventPage(req, reply, req.params.code, refused(err));
    }
  });
}
