import { DomainError } from "@benchme/site-kit";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { DiningRepo } from "../db/dining-repo.js";
import { area, changeSchema, date, filled, menuList, partySize, reservationSchema, searchSchema, toQuery } from "./inputs.js";

export type ApiDeps = { dining: DiningRepo };

const restaurantsQuery = z.object({ city: z.string().optional(), cuisine: z.string().optional(), menus: menuList, area: area.optional() });
const reservationsQuery = z.object({
  guestEmail: z.string().optional(),
  restaurant: z.string().optional(),
  date: date.optional(),
  status: z.enum(["confirmed", "cancelled"]).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
const availabilityQuery = z.object({ date, partySize: partySize.default(2) });

/** REST under /api/v1. Reads are open inside the workspace; reserving, changing and cancelling need a bearer token or a session: the site's rules ask it of every write, through every door (site-kit's `ledgered`), so no route here does. */
export function registerApi(app: FastifyInstance, d: ApiDeps): void {
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
    const r = schema.safeParse(data);
    if (r.success) return r.data;
    reply.code(400).send({ error: "BAD_REQUEST", message: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
    return null;
  };
  const notFound = (reply: FastifyReply) => reply.code(404).send({ error: "NOT_FOUND" });
  /** A query string without its blank fields: `?area=` is no area filter, as on the pages. Bodies are parsed as sent — a change's `note: ""` clears the note. */
  const query = (req: FastifyRequest) => filled((req.query ?? {}) as Record<string, unknown>);

  app.get("/api/v1/cities", async (req) => d.dining.cities(req.workspaceId));
  app.get("/api/v1/restaurants", async (req, reply) => {
    const f = parse(restaurantsQuery, query(req), reply);
    if (!f) return;
    return d.dining.listRestaurants(req.workspaceId, { ...(f.city ? { city: f.city } : {}), ...(f.cuisine ? { cuisine: f.cuisine } : {}), menus: f.menus, ...(f.area ? { area: f.area } : {}) });
  });
  app.get<{ Params: { code: string } }>("/api/v1/restaurants/:code", async (req, reply) => (await d.dining.getRestaurant(req.workspaceId, req.params.code)) ?? notFound(reply));
  app.get<{ Params: { code: string } }>("/api/v1/restaurants/:code/availability", async (req, reply) => {
    const a = parse(availabilityQuery, query(req), reply);
    if (!a) return;
    return run(reply, () => d.dining.availability(req.workspaceId, req.params.code, a.date, a.partySize));
  });
  app.get("/api/v1/search", async (req, reply) => {
    const s = parse(searchSchema, query(req), reply);
    if (!s) return;
    return d.dining.search(req.workspaceId, toQuery(s));
  });
  app.get("/api/v1/reservations", async (req, reply) => {
    const f = parse(reservationsQuery, query(req), reply);
    if (!f) return;
    return d.dining.listReservations(req.workspaceId, {
      ...(f.guestEmail ? { guestEmail: f.guestEmail } : {}),
      ...(f.restaurant ? { restaurant: f.restaurant } : {}),
      ...(f.date ? { date: f.date } : {}),
      ...(f.status ? { status: f.status } : {}),
      ...(f.cursor ? { cursor: f.cursor } : {}),
      limit: f.limit,
    });
  });
  app.get<{ Params: { no: string } }>("/api/v1/reservations/:no", async (req, reply) => (await d.dining.getReservation(req.workspaceId, req.params.no)) ?? notFound(reply));
  app.post("/api/v1/reservations", async (req, reply) => {
    const b = parse(reservationSchema, req.body, reply);
    if (!b) return;
    return run(reply, () => d.dining.createReservation(req.workspaceId, b), 201);
  });
  app.post<{ Params: { no: string } }>("/api/v1/reservations/:no/change", async (req, reply) => {
    const c = parse(changeSchema, req.body ?? {}, reply);
    if (!c) return;
    return run(reply, () => d.dining.changeReservation(req.workspaceId, req.params.no, c));
  });
  app.post<{ Params: { no: string } }>("/api/v1/reservations/:no/cancel", async (req, reply) => {
    return run(reply, () => d.dining.cancelReservation(req.workspaceId, req.params.no));
  });
}
