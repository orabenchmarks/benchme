import { DomainError, registerAuthRoutes, requireSession, sessionUser, shell, webmcpScript, type AuthService, type ShellCtx, type ToolRegistry } from "@benchme/site-kit";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { blankless, bookingSchema, searchSchema, toNewBooking, toQuery } from "../api/inputs.js";
import type { CinemaRepo } from "../db/cinema-repo.js";
import type { ToolContext } from "../mcp/tools.js";
import * as booking from "./pages-booking.js";
import * as browse from "./pages-browse.js";

export const SESSION_COOKIE = "cn_session";
export const SITE_NAME = "Orrowen Cinemas";
export type UiDeps = { cinema: CinemaRepo; auth: AuthService; tools: ToolRegistry<ToolContext> };

type Q = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const flat = (req: FastifyRequest, from: "query" | "body" = "query"): browse.Filters => Object.fromEntries(Object.entries(((from === "query" ? req.query : req.body) ?? {}) as Q).map(([k, v]) => [k, one(v)]));
const NAV = [
  { href: "/", label: "Showtimes" },
  { href: "/films", label: "Films" },
  { href: "/bookings", label: "Bookings" },
];

export function registerUi(app: FastifyInstance, d: UiDeps): void {
  const user = sessionUser(d.auth, SESSION_COOKIE);
  const ctx = async (req: FastifyRequest, flash?: string): Promise<ShellCtx> => ({
    site: SITE_NAME,
    accent: "#8a1c2c",
    prefix: req.prefix,
    nav: NAV,
    user: await user(req),
    flash,
    scripts: [webmcpScript(d.tools, req.prefix)],
  });
  const html = (reply: FastifyReply, body: string, code = 200) => reply.code(code).type("text/html; charset=utf-8").send(body);
  const notFound = async (req: FastifyRequest, reply: FastifyReply, what: string) => html(reply, shell(await ctx(req), "Not found", `<h1>No such ${what}</h1>`), 404);
  const authDeps = { auth: d.auth, cookie: SESSION_COOKIE, shellCtx: ctx };
  const requireUser = requireSession(authDeps);
  registerAuthRoutes(app, authDeps);

  const showtimePage = async (req: FastifyRequest, code: string, form: browse.Filters = {}, flash?: string) => {
    const c = await ctx(req, flash);
    const s = await d.cinema.getShowtime(req.workspaceId, code);
    if (!s) return { status: 404, body: shell(c, "Not found", "<h1>No such showtime</h1>") };
    return { status: 200, body: shell(c, `${s.filmTitle} ${s.date} ${s.time}`, booking.showtimeDetail(req.prefix, s, !!c.user, form)) };
  };

  app.get("/", async (req, reply) => html(reply, shell(await ctx(req), "Find a showtime", browse.home(req.prefix, await d.cinema.listCinemas(req.workspaceId)))));

  app.get("/showtimes", async (req, reply) => {
    const f = flat(req);
    const cinemas = await d.cinema.listCinemas(req.workspaceId);
    const parsed = searchSchema.safeParse(blankless(f));
    if (!parsed.success) return html(reply, shell(await ctx(req, `Check the search: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`), "Find a showtime", browse.home(req.prefix, cinemas, f)), 400);
    const offers = await d.cinema.search(req.workspaceId, toQuery(parsed.data));
    return html(reply, shell(await ctx(req), "Showtimes", browse.searchResults(req.prefix, cinemas, f, offers)));
  });

  app.get<{ Params: { code: string } }>("/showtimes/:code", async (req, reply) => {
    const page = await showtimePage(req, req.params.code);
    return html(reply, page.body, page.status);
  });

  app.get("/films", async (req, reply) => {
    const f = flat(req);
    const cities = [...new Set((await d.cinema.listCinemas(req.workspaceId)).map((c) => c.city))].sort();
    return html(reply, shell(await ctx(req), "Films", browse.filmsList(req.prefix, await d.cinema.listFilms(req.workspaceId, { genre: f.genre || undefined, city: f.city || undefined }), f, cities)));
  });

  app.get<{ Params: { code: string } }>("/films/:code", async (req, reply) => {
    const film = await d.cinema.getFilm(req.workspaceId, req.params.code);
    return film ? html(reply, shell(await ctx(req), film.title, browse.filmDetail(req.prefix, film))) : notFound(req, reply, "film");
  });

  app.get<{ Params: { code: string } }>("/cinemas/:code", async (req, reply) => {
    const c = await d.cinema.getCinema(req.workspaceId, req.params.code);
    return c ? html(reply, shell(await ctx(req), c.name, browse.cinemaDetail(req.prefix, c))) : notFound(req, reply, "cinema");
  });

  app.post("/bookings", async (req, reply) => {
    const c = await requireUser(req, reply);
    if (!c) return;
    const f = flat(req, "body");
    const code = f.showtimeCode ?? "";
    const parsed = bookingSchema.safeParse(blankless(f));
    if (!parsed.success) {
      const page = await showtimePage(req, code, f, `Check the booking: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`);
      return html(reply, page.body, page.status === 404 ? 404 : 400);
    }
    try {
      const b = await d.cinema.createBooking(req.workspaceId, toNewBooking(parsed.data));
      return reply.redirect(`${req.prefix}/bookings/${b.bookingNo}`, 303);
    } catch (err) {
      if (!(err instanceof DomainError)) throw err;
      const page = await showtimePage(req, code, f, err.message);
      return html(reply, page.body, err.status);
    }
  });

  app.get("/bookings", async (req, reply) => {
    const f = flat(req);
    const page = await d.cinema.listBookings(req.workspaceId, { customerEmail: f.customerEmail || undefined, showtime: f.showtime || undefined, cursor: f.cursor || undefined, limit: 25 });
    return html(reply, shell(await ctx(req), "Bookings", booking.bookingsList(req.prefix, page.items, page.nextCursor, { customerEmail: f.customerEmail, showtime: f.showtime })));
  });

  const bookingPage = async (req: FastifyRequest, no: string, flash?: string) => {
    const c = await ctx(req, flash);
    const b = await d.cinema.getBooking(req.workspaceId, no);
    if (!b) return { status: 404, body: shell(c, "Not found", "<h1>No such booking</h1>") };
    const s = await d.cinema.getShowtime(req.workspaceId, b.showtimeCode);
    return { status: 200, body: shell(c, b.bookingNo, booking.bookingDetail(req.prefix, b, { film: s?.filmTitle ?? b.filmCode, cinema: s?.cinemaName ?? b.cinemaCode }, !!c.user)) };
  };

  app.get<{ Params: { no: string } }>("/bookings/:no", async (req, reply) => {
    const page = await bookingPage(req, req.params.no);
    return html(reply, page.body, page.status);
  });

  app.post<{ Params: { no: string } }>("/bookings/:no/cancel", async (req, reply) => {
    const c = await requireUser(req, reply);
    if (!c) return;
    try {
      await d.cinema.cancelBooking(req.workspaceId, req.params.no);
      return reply.redirect(`${req.prefix}/bookings/${req.params.no}`, 303);
    } catch (err) {
      if (!(err instanceof DomainError)) throw err;
      const page = await bookingPage(req, req.params.no, err.message);
      return html(reply, page.body, err.status);
    }
  });
}
