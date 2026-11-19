import { MAX_NIGHTS } from "@benchme/scenarios";
import { DomainError, registerAuthRoutes, requireSession, sessionUser, shell, webmcpScript, type AuthService, type ShellCtx, type ToolRegistry } from "@benchme/site-kit";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { bookingSchema, nights, searchSchema, toQuery } from "../api/inputs.js";
import type { HotelsRepo } from "../db/hotels-repo.js";
import type { ToolContext } from "../mcp/tools.js";
import * as pages from "./pages.js";

export const SESSION_COOKIE = "ht_session";
export type UiDeps = { hotels: HotelsRepo; auth: AuthService; tools: ToolRegistry<ToolContext> };

type Q = Record<string, string | string[] | undefined>;
const q = (req: FastifyRequest): Q => (req.query ?? {}) as Q;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const stayOf = (f: Q): pages.StayParams => ({ checkIn: one(f.checkIn), nights: one(f.nights), adults: one(f.adults), kids: one(f.kids), pets: one(f.pets) });
const NAV = [
  { href: "/", label: "Search" },
  { href: "/hotels", label: "Hotels" },
  { href: "/bookings", label: "Bookings" },
];

export function registerUi(app: FastifyInstance, d: UiDeps): void {
  const user = sessionUser(d.auth, SESSION_COOKIE);
  const ctx = async (req: FastifyRequest, flash?: string): Promise<ShellCtx> => ({
    site: "Larchmere Stays",
    accent: "#0f6b5c",
    prefix: req.prefix,
    nav: NAV,
    user: await user(req),
    flash,
    scripts: [webmcpScript(d.tools, req.prefix)],
  });
  const html = (reply: FastifyReply, body: string, code = 200) => reply.code(code).type("text/html; charset=utf-8").send(body);
  const authDeps = { auth: d.auth, cookie: SESSION_COOKIE, shellCtx: ctx };
  const requireUser = requireSession(authDeps);
  registerAuthRoutes(app, authDeps);

  const hotelPage = async (req: FastifyRequest, code: string, stay: pages.StayParams, flash?: string) => {
    const c = await ctx(req, flash);
    const h = await d.hotels.getHotel(req.workspaceId, code);
    if (!h) return { status: 404, body: shell(c, "Not found", "<h1>No such hotel</h1>") };
    // The stay's length is held to the schema REST and MCP hold it to before anything is computed from it: a blank field asks nothing, a bad one is refused on the page.
    const asked = stay.checkIn && stay.nights ? nights.safeParse(stay.nights) : null;
    let left: Map<string, number> | null = null;
    if (asked?.success) {
      try {
        left = new Map(await Promise.all(h.rooms.map(async (r) => [r.code, (await d.hotels.availability(req.workspaceId, r.code, stay.checkIn as string, asked.data)).roomsLeft] as const)));
      } catch {
        left = null;
      }
    }
    const refused = asked !== null && !asked.success;
    const shown = refused ? { ...c, flash: c.flash ?? `Check the stay: a stay is 1 to ${MAX_NIGHTS} nights` } : c;
    return { status: refused ? 400 : 200, body: shell(shown, h.name, pages.hotelDetail(req.prefix, h, stay, left, !!c.user)) };
  };

  app.get("/", async (req, reply) => html(reply, shell(await ctx(req), "Find a stay", pages.home(req.prefix, await d.hotels.cities(req.workspaceId)))));

  app.get("/search", async (req, reply) => {
    const f = q(req);
    const parsed = searchSchema.safeParse(f);
    const cities = await d.hotels.cities(req.workspaceId);
    if (!parsed.success) {
      const flat = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, one(v)]));
      return html(reply, shell(await ctx(req, `Check the search: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`), "Find a stay", pages.home(req.prefix, cities, flat)), 400);
    }
    const offers = await d.hotels.search(req.workspaceId, toQuery(parsed.data));
    return html(reply, shell(await ctx(req), `Stays in ${parsed.data.city}`, pages.searchResults(req.prefix, parsed.data, stayOf(f), offers)));
  });

  app.get("/hotels", async (req, reply) => {
    const city = one(q(req).city);
    return html(reply, shell(await ctx(req), "Hotels", pages.hotelsList(req.prefix, await d.hotels.listHotels(req.workspaceId, city ? { city } : {}), city)));
  });

  app.get<{ Params: { code: string } }>("/hotels/:code", async (req, reply) => {
    const page = await hotelPage(req, req.params.code, stayOf(q(req)));
    return html(reply, page.body, page.status);
  });

  app.post("/bookings", async (req, reply) => {
    const c = await requireUser(req, reply);
    if (!c) return;
    const f = (req.body ?? {}) as Record<string, string | undefined>;
    const hotelCode = f.hotelCode ?? "";
    const parsed = bookingSchema.safeParse({ ...f, lateCheckout: f.lateCheckout === "1" });
    const stay = stayOf(f);
    if (!parsed.success) {
      const page = await hotelPage(req, hotelCode, stay, `Check the booking: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`);
      return html(reply, page.body, 400);
    }
    try {
      const b = await d.hotels.createBooking(req.workspaceId, parsed.data);
      return reply.redirect(`${req.prefix}/bookings/${b.bookingNo}`, 303);
    } catch (err) {
      if (!(err instanceof DomainError)) throw err;
      const page = await hotelPage(req, hotelCode, stay, err.message);
      return html(reply, page.body, err.status);
    }
  });

  app.get("/bookings", async (req, reply) => {
    const f = q(req);
    const guestEmail = one(f.guestEmail);
    const hotel = one(f.hotel);
    const cursor = one(f.cursor);
    const page = await d.hotels.listBookings(req.workspaceId, { ...(guestEmail ? { guestEmail } : {}), ...(hotel ? { hotel } : {}), ...(cursor ? { cursor } : {}), limit: 25 });
    return html(reply, shell(await ctx(req), "Bookings", pages.bookingsList(req.prefix, page.items, page.nextCursor, { guestEmail, hotel })));
  });

  const bookingPage = async (req: FastifyRequest, no: string, flash?: string) => {
    const c = await ctx(req, flash);
    const b = await d.hotels.getBooking(req.workspaceId, no);
    if (!b) return { status: 404, body: shell(c, "Not found", "<h1>No such booking</h1>") };
    const h = await d.hotels.getHotel(req.workspaceId, b.hotelCode);
    return { status: 200, body: shell(c, b.bookingNo, pages.bookingDetail(req.prefix, b, h?.name ?? b.hotelCode, !!c.user)) };
  };

  app.get<{ Params: { no: string } }>("/bookings/:no", async (req, reply) => {
    const page = await bookingPage(req, req.params.no);
    return html(reply, page.body, page.status);
  });

  app.post<{ Params: { no: string } }>("/bookings/:no/cancel", async (req, reply) => {
    const c = await requireUser(req, reply);
    if (!c) return;
    try {
      await d.hotels.cancelBooking(req.workspaceId, req.params.no);
      return reply.redirect(`${req.prefix}/bookings/${req.params.no}`, 303);
    } catch (err) {
      if (!(err instanceof DomainError)) throw err;
      const page = await bookingPage(req, req.params.no, err.message);
      return html(reply, page.body, err.status);
    }
  });
}
