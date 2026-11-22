import { flightDateInWindow, type FlightAirport } from "@benchme/scenarios";
import { registerAuthRoutes, sessionUser, shell, webmcpScript, type AuthService, type ShellCtx, type ToolRegistry } from "@benchme/site-kit";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { dropEmpty, searchSchema, searchTrip } from "../api/inputs.js";
import type { FlightsRepo } from "../db/flights-repo.js";
import type { ToolContext } from "../mcp/tools.js";
import { registerBookingUi } from "./booking-routes.js";
import * as flightPages from "./flight-pages.js";
import * as pages from "./pages.js";

export const SESSION_COOKIE = "fl_session";
export type UiDeps = { flights: FlightsRepo; auth: AuthService; tools: ToolRegistry<ToolContext> };
export type Page = { status: number; body: string };
/** What the page routes share: the shell, the session guard, and the flight page a refused booking falls back to. */
export type UiKit = {
  ctx: (req: FastifyRequest, flash?: string) => Promise<ShellCtx>;
  html: (reply: FastifyReply, page: Page) => FastifyReply;
  airports: (req: FastifyRequest) => Promise<Map<string, FlightAirport>>;
  flightPage: (req: FastifyRequest, flightNo: string, form: flightPages.BookingForm, flash?: string) => Promise<Page>;
};

type Q = Record<string, string | string[] | undefined>;
const q = (req: FastifyRequest): Q => (req.query ?? {}) as Q;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const NAV = [
  { href: "/", label: "Search" },
  { href: "/flights", label: "Schedule" },
  { href: "/bookings", label: "Bookings" },
];

export function registerUi(app: FastifyInstance, d: UiDeps): void {
  const user = sessionUser(d.auth, SESSION_COOKIE);
  const ctx = async (req: FastifyRequest, flash?: string): Promise<ShellCtx> => ({
    site: "Tallowmere Flights",
    accent: "#1d4f91",
    prefix: req.prefix,
    nav: NAV,
    user: await user(req),
    flash,
    scripts: [webmcpScript(d.tools, req.prefix)],
  });
  const authDeps = { auth: d.auth, cookie: SESSION_COOKIE, shellCtx: ctx };
  registerAuthRoutes(app, authDeps);
  const airports = async (req: FastifyRequest) => new Map((await d.flights.airports(req.workspaceId)).map((a) => [a.code, a]));
  const kit: UiKit = {
    ctx,
    html: (reply, page) => reply.code(page.status).type("text/html; charset=utf-8").send(page.body),
    airports,
    async flightPage(req, flightNo, form, flash) {
      const c = await ctx(req, flash);
      const f = await d.flights.getFlight(req.workspaceId, flightNo);
      if (!f) return { status: 404, body: shell(c, "Not found", "<h1>No such flight</h1>") };
      const seats = form.date && flightDateInWindow(form.date) ? await d.flights.seats(req.workspaceId, f.flightNo, form.date) : null;
      return { status: 200, body: shell(c, `Flight ${f.flightNo}`, flightPages.flightDetail(req.prefix, f, await airports(req), seats, form, !!c.user)) };
    },
  };
  const page = (status: number, body: string): Page => ({ status, body });
  const homePage = async (req: FastifyRequest, form: Q, flash?: string) =>
    shell(await ctx(req, flash), "Find a flight", pages.home(req.prefix, await d.flights.airports(req.workspaceId), await d.flights.carriers(req.workspaceId), form));

  app.get("/", async (req, reply) => kit.html(reply, page(200, await homePage(req, q(req)))));

  app.get("/search", async (req, reply) => {
    const f = q(req);
    const parsed = searchSchema.safeParse(dropEmpty(f));
    if (!parsed.success) return kit.html(reply, page(400, await homePage(req, f, `Check the search: ${parsed.error.issues.map((i) => `${i.path.join(".")} (${i.message})`).join(", ")}`)));
    const trip = await searchTrip(d.flights, req.workspaceId, parsed.data);
    return kit.html(reply, page(200, shell(await ctx(req), `Flights from ${parsed.data.origin} to ${parsed.data.destination}`, pages.searchResults(req.prefix, parsed.data, trip, await airports(req)))));
  });

  app.get("/flights", async (req, reply) => {
    const f = { origin: one(q(req).origin) || undefined, destination: one(q(req).destination) || undefined };
    const list = await d.flights.listFlights(req.workspaceId, { ...(f.origin ? { origin: f.origin } : {}), ...(f.destination ? { destination: f.destination } : {}) });
    return kit.html(reply, page(200, shell(await ctx(req), "Schedule", flightPages.flightsList(req.prefix, list, await airports(req), f))));
  });

  app.get<{ Params: { no: string } }>("/flights/:no", async (req, reply) => {
    const f = q(req);
    return kit.html(reply, await kit.flightPage(req, req.params.no, { date: one(f.date), cabin: one(f.cabin) }));
  });

  registerBookingUi(app, d, kit);
}
