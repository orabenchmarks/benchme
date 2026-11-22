import { DomainError } from "@benchme/site-kit";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { HotelsRepo } from "../db/hotels-repo.js";
import { amenityList, bookingSchema, date, given, nights, searchSchema, toQuery } from "./inputs.js";

export type ApiDeps = { hotels: HotelsRepo };

const hotelsQuery = z.object({ city: z.string().optional(), amenities: amenityList, pets: given(z.enum(["true", "false"]).optional()) });
const bookingsQuery = z.object({ guestEmail: z.string().optional(), hotel: z.string().optional(), status: given(z.enum(["confirmed", "cancelled"]).optional()), cursor: z.string().optional(), limit: given(z.coerce.number().int().min(1).max(200).default(50)) });
const availabilityQuery = z.object({ checkIn: date, nights });

/** REST under /api/v1. Reads are open inside the workspace; booking and cancelling need a bearer token or a session: the site's rules ask it of every write, through every door (site-kit's `ledgered`), so no route here does. */
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

  app.get("/api/v1/cities", async (req) => d.hotels.cities(req.workspaceId));
  app.get("/api/v1/hotels", async (req, reply) => {
    const f = parse(hotelsQuery, req.query, reply);
    if (!f) return;
    return d.hotels.listHotels(req.workspaceId, { ...(f.city ? { city: f.city } : {}), amenities: f.amenities, ...(f.pets === "true" ? { pets: true } : {}) });
  });
  app.get<{ Params: { code: string } }>("/api/v1/hotels/:code", async (req, reply) => (await d.hotels.getHotel(req.workspaceId, req.params.code)) ?? reply.code(404).send({ error: "NOT_FOUND" }));
  app.get("/api/v1/search", async (req, reply) => {
    const s = parse(searchSchema, req.query, reply);
    if (!s) return;
    return d.hotels.search(req.workspaceId, toQuery(s));
  });
  app.get<{ Params: { code: string } }>("/api/v1/rooms/:code/availability", async (req, reply) => {
    const a = parse(availabilityQuery, req.query, reply);
    if (!a) return;
    return run(reply, () => d.hotels.availability(req.workspaceId, req.params.code, a.checkIn, a.nights));
  });
  app.get("/api/v1/bookings", async (req, reply) => {
    const f = parse(bookingsQuery, req.query, reply);
    if (!f) return;
    return d.hotels.listBookings(req.workspaceId, { ...(f.guestEmail ? { guestEmail: f.guestEmail } : {}), ...(f.hotel ? { hotel: f.hotel } : {}), ...(f.status ? { status: f.status } : {}), ...(f.cursor ? { cursor: f.cursor } : {}), limit: f.limit });
  });
  app.get<{ Params: { no: string } }>("/api/v1/bookings/:no", async (req, reply) => (await d.hotels.getBooking(req.workspaceId, req.params.no)) ?? reply.code(404).send({ error: "NOT_FOUND" }));
  app.post("/api/v1/bookings", async (req, reply) => {
    const b = parse(bookingSchema, req.body, reply);
    if (!b) return;
    return run(reply, () => d.hotels.createBooking(req.workspaceId, b), 201);
  });
  app.post<{ Params: { no: string } }>("/api/v1/bookings/:no/cancel", async (req, reply) => {
    return run(reply, () => d.hotels.cancelBooking(req.workspaceId, req.params.no));
  });
}
