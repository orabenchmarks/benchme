import { DomainError, apiUser, type AuthService } from "@benchme/site-kit";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { FlightsRepo } from "../db/flights-repo.js";
import { SESSION_COOKIE } from "../ui/routes.js";
import { bookingSchema, date, dropEmpty, searchSchema, searchTrip } from "./inputs.js";

export type ApiDeps = { flights: FlightsRepo; auth: AuthService };

const flightsQuery = z.object({ origin: z.string().optional(), destination: z.string().optional(), carrier: z.string().optional() });
const bookingsQuery = z.object({
  contactEmail: z.string().optional(),
  flightNo: z.string().optional(),
  date: date.optional(),
  status: z.enum(["confirmed", "cancelled"]).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
const seatsQuery = z.object({ date });

/** REST under /api/v1. Reads are open inside the workspace; booking and cancelling need a bearer token or a session. */
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
  /** A bad query is the caller's to fix: 400 with zod's own words, not a 500. Empty fields count as not given. */
  const parse = <S extends z.ZodTypeAny>(schema: S, data: unknown, reply: FastifyReply): z.output<S> | null => {
    const r = schema.safeParse(dropEmpty(data));
    if (r.success) return r.data;
    reply.code(400).send({ error: "BAD_REQUEST", message: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
    return null;
  };
  const notFound = (reply: FastifyReply) => reply.code(404).send({ error: "NOT_FOUND" });

  app.get("/api/v1/airports", async (req) => d.flights.airports(req.workspaceId));
  app.get("/api/v1/carriers", async (req) => d.flights.carriers(req.workspaceId));
  app.get("/api/v1/flights", async (req, reply) => {
    const f = parse(flightsQuery, req.query, reply);
    if (!f) return;
    return d.flights.listFlights(req.workspaceId, f);
  });
  app.get<{ Params: { no: string } }>("/api/v1/flights/:no", async (req, reply) => (await d.flights.getFlight(req.workspaceId, req.params.no)) ?? notFound(reply));
  app.get<{ Params: { no: string } }>("/api/v1/flights/:no/seats", async (req, reply) => {
    const q = parse(seatsQuery, req.query, reply);
    if (!q) return;
    return run(reply, () => d.flights.seats(req.workspaceId, req.params.no, q.date));
  });
  app.get("/api/v1/search", async (req, reply) => {
    const s = parse(searchSchema, req.query, reply);
    if (!s) return;
    return searchTrip(d.flights, req.workspaceId, s);
  });
  app.get("/api/v1/bookings", async (req, reply) => {
    const f = parse(bookingsQuery, req.query, reply);
    if (!f) return;
    return d.flights.listBookings(req.workspaceId, f);
  });
  app.get<{ Params: { no: string } }>("/api/v1/bookings/:no", async (req, reply) => (await d.flights.getBooking(req.workspaceId, req.params.no)) ?? notFound(reply));
  app.post("/api/v1/bookings", async (req, reply) => {
    if (!(await authed(req, reply))) return;
    const b = parse(bookingSchema, req.body, reply);
    if (!b) return;
    return run(reply, () => d.flights.createBooking(req.workspaceId, b), 201);
  });
  app.post<{ Params: { no: string } }>("/api/v1/bookings/:no/cancel", async (req, reply) => {
    if (!(await authed(req, reply))) return;
    return run(reply, () => d.flights.cancelBooking(req.workspaceId, req.params.no));
  });
}
