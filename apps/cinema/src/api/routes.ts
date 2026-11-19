import { DomainError, apiUser, type AuthService } from "@benchme/site-kit";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { CinemaRepo } from "../db/cinema-repo.js";
import { SESSION_COOKIE } from "../ui/routes.js";
import { blankless, bookingSchema, searchSchema, toNewBooking, toQuery } from "./inputs.js";

export type ApiDeps = { cinema: CinemaRepo; auth: AuthService };

const filmsQuery = z.object({ genre: z.string().optional(), city: z.string().optional() });
const bookingsQuery = z.object({
  customerEmail: z.string().optional(),
  showtime: z.string().optional(),
  film: z.string().optional(),
  status: z.enum(["confirmed", "cancelled"]).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

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
  /** A bad query is the caller's to fix: 400 with zod's own words, not a 500. */
  const parse = <S extends z.ZodTypeAny>(schema: S, data: unknown, reply: FastifyReply): z.output<S> | null => {
    const r = schema.safeParse(data);
    if (r.success) return r.data;
    reply.code(400).send({ error: "BAD_REQUEST", message: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
    return null;
  };
  const notFound = (reply: FastifyReply) => reply.code(404).send({ error: "NOT_FOUND" });
  /** A query string as the schemas read it: a param left blank ("?date=") is one not given. */
  const query = (req: FastifyRequest) => blankless((req.query ?? {}) as Record<string, unknown>);

  app.get("/api/v1/cinemas", async (req) => d.cinema.listCinemas(req.workspaceId));
  app.get<{ Params: { code: string } }>("/api/v1/cinemas/:code", async (req, reply) => (await d.cinema.getCinema(req.workspaceId, req.params.code)) ?? notFound(reply));
  app.get("/api/v1/films", async (req, reply) => {
    const f = parse(filmsQuery, req.query, reply);
    if (!f) return;
    return d.cinema.listFilms(req.workspaceId, f);
  });
  app.get<{ Params: { code: string } }>("/api/v1/films/:code", async (req, reply) => (await d.cinema.getFilm(req.workspaceId, req.params.code)) ?? notFound(reply));
  app.get("/api/v1/showtimes", async (req, reply) => {
    const s = parse(searchSchema, query(req), reply);
    if (!s) return;
    return d.cinema.search(req.workspaceId, toQuery(s));
  });
  app.get<{ Params: { code: string } }>("/api/v1/showtimes/:code", async (req, reply) => (await d.cinema.getShowtime(req.workspaceId, req.params.code)) ?? notFound(reply));
  app.get("/api/v1/bookings", async (req, reply) => {
    const f = parse(bookingsQuery, query(req), reply);
    if (!f) return;
    return d.cinema.listBookings(req.workspaceId, f);
  });
  app.get<{ Params: { no: string } }>("/api/v1/bookings/:no", async (req, reply) => (await d.cinema.getBooking(req.workspaceId, req.params.no)) ?? notFound(reply));
  app.post("/api/v1/bookings", async (req, reply) => {
    if (!(await authed(req, reply))) return;
    const b = parse(bookingSchema, req.body, reply);
    if (!b) return;
    return run(reply, () => d.cinema.createBooking(req.workspaceId, toNewBooking(b)), 201);
  });
  app.post<{ Params: { no: string } }>("/api/v1/bookings/:no/cancel", async (req, reply) => {
    if (!(await authed(req, reply))) return;
    return run(reply, () => d.cinema.cancelBooking(req.workspaceId, req.params.no));
  });
}
