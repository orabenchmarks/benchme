import { isDate } from "@benchme/scenarios";
import { registerAuthRoutes, requireSession, sessionUser, shell, webmcpScript, type AuthService, type ShellCtx, type ToolRegistry } from "@benchme/site-kit";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { filled, searchSchema, toQuery } from "../api/inputs.js";
import type { DiningRepo } from "../db/dining-repo.js";
import type { ToolContext } from "../mcp/tools.js";
import { ACCENT, NAV, SESSION_COOKIE, SITE, formOf, html, one } from "./kit.js";
import * as pages from "./pages.js";
import { registerReservationRoutes, type Page } from "./reservation-routes.js";
import { dayParamsOf, restaurantDetail, type DayParams } from "./restaurant-page.js";

export { SESSION_COOKIE };
export type UiDeps = { dining: DiningRepo; auth: AuthService; tools: ToolRegistry<ToolContext> };

export function registerUi(app: FastifyInstance, d: UiDeps): void {
  const user = sessionUser(d.auth, SESSION_COOKIE);
  const ctx = async (req: FastifyRequest, flash?: string): Promise<ShellCtx> => ({
    site: SITE,
    accent: ACCENT,
    prefix: req.prefix,
    nav: NAV,
    user: await user(req),
    flash,
    scripts: [webmcpScript(d.tools, req.prefix)],
  });
  const authDeps = { auth: d.auth, cookie: SESSION_COOKIE, shellCtx: ctx };
  registerAuthRoutes(app, authDeps);

  const restaurantPage = async (req: FastifyRequest, code: string, params: DayParams, flash?: string): Promise<Page> => {
    const c = await ctx(req, flash);
    const r = await d.dining.getRestaurant(req.workspaceId, code);
    if (!r) return { status: 404, body: shell(c, "Not found", "<h1>No such restaurant</h1>") };
    const party = Number(params.partySize ?? "2");
    const day = params.date && isDate(params.date) && Number.isInteger(party) && party >= 1 && party <= 50 ? await d.dining.availability(req.workspaceId, code, params.date, party) : null;
    return { status: 200, body: shell(c, r.name, restaurantDetail(req.prefix, r, params, day, !!c.user)) };
  };

  app.get("/", async (req, reply) => html(reply, shell(await ctx(req), "Find a table", pages.home(req.prefix, await d.dining.cities(req.workspaceId)))));

  app.get("/search", async (req, reply) => {
    const f = formOf(req);
    const parsed = searchSchema.safeParse(filled(f));
    if (!parsed.success) {
      const flash = `Check the search: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`;
      return html(reply, shell(await ctx(req, flash), "Find a table", pages.home(req.prefix, await d.dining.cities(req.workspaceId), f)), 400);
    }
    const offers = await d.dining.search(req.workspaceId, toQuery(parsed.data));
    return html(reply, shell(await ctx(req), `Tables in ${parsed.data.city}`, pages.searchResults(req.prefix, parsed.data, offers)));
  });

  app.get("/restaurants", async (req, reply) => {
    const city = one(formOf(req).city);
    return html(reply, shell(await ctx(req), "Restaurants", pages.restaurantsList(req.prefix, await d.dining.listRestaurants(req.workspaceId, city ? { city } : {}), city)));
  });

  app.get<{ Params: { code: string } }>("/restaurants/:code", async (req, reply) => {
    const page = await restaurantPage(req, req.params.code, dayParamsOf(formOf(req)));
    return html(reply, page.body, page.status);
  });

  registerReservationRoutes(app, { dining: d.dining, ctx, requireUser: requireSession(authDeps), restaurantPage });
}
