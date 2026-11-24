import { DomainError, registerAuthRoutes, sessionUser, shell, webmcpBridge, type AuthService, type ShellCtx, type ToolRegistry } from "@benchme/site-kit";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { filled, searchSchema, toQuery, viewingSchema } from "../api/inputs.js";
import type { HomesRepo } from "../db/homes-repo.js";
import type { ToolContext } from "../mcp/tools.js";
import * as agents from "./pages/agents.js";
import * as listings from "./pages/listings.js";
import * as viewings from "./pages/viewings.js";

export const SESSION_COOKIE = "hm_session";
export type UiDeps = { homes: HomesRepo; auth: AuthService; tools: ToolRegistry<ToolContext> };

type Q = Record<string, string | string[] | undefined>;
const q = (req: FastifyRequest): Q => (req.query ?? {}) as Q;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const NAV = [
  { href: "/", label: "Search" },
  { href: "/listings", label: "Listings" },
  { href: "/agents", label: "Agents" },
  { href: "/viewings", label: "Viewings" },
];

export function registerUi(app: FastifyInstance, d: UiDeps): void {
  const user = sessionUser(d.auth, SESSION_COOKIE);
  const ctx = async (req: FastifyRequest, flash?: string): Promise<ShellCtx> => ({
    site: "Corvane Homes",
    accent: "#8a4b2a",
    prefix: req.prefix,
    nav: NAV,
    user: await user(req),
    flash,
    scripts: [webmcpBridge(req, d.tools)],
  });
  const html = (reply: FastifyReply, body: string, code = 200) => reply.code(code).type("text/html; charset=utf-8").send(body);
  const authDeps = { auth: d.auth, cookie: SESSION_COOKIE, shellCtx: ctx };
  registerAuthRoutes(app, authDeps);
  const ws = (req: FastifyRequest) => req.workspaceId;

  app.get("/", async (req, reply) => html(reply, shell(await ctx(req), "Find a home", listings.home(req.prefix, await d.homes.cities(ws(req))))));

  app.get("/listings", async (req, reply) => {
    const f = q(req);
    const parsed = searchSchema.safeParse(filled(f));
    if (!parsed.success) {
      const flash = `Check the search: ${parsed.error.issues.map((i) => `${i.path.join(".")} (${i.message})`).join(", ")}`;
      return html(reply, shell(await ctx(req, flash), "Find a home", listings.home(req.prefix, await d.homes.cities(ws(req)), f)), 400);
    }
    const title = parsed.data.city ? `Listings in ${parsed.data.city}` : "Listings";
    return html(reply, shell(await ctx(req), title, listings.listingsList(req.prefix, await d.homes.search(ws(req), toQuery(parsed.data)), title)));
  });

  const listingPage = async (req: FastifyRequest, code: string, flash?: string) => {
    const c = await ctx(req, flash);
    const l = await d.homes.getListing(ws(req), code);
    if (!l) return { status: 404, body: shell(c, "Not found", "<h1>No such listing</h1>") };
    return { status: 200, body: shell(c, l.address, listings.listingDetail(req.prefix, l, await d.homes.slots(ws(req), code, {}), !!c.user)) };
  };

  app.get<{ Params: { code: string } }>("/listings/:code", async (req, reply) => {
    const page = await listingPage(req, req.params.code);
    return html(reply, page.body, page.status);
  });

  app.post("/viewings", async (req, reply) => {
    const f = (req.body ?? {}) as Record<string, string | undefined>;
    const slot = f.slot ?? "";
    const parsed = viewingSchema.safeParse({ ...filled(f), ...(slot ? { date: slot.slice(0, 10), time: slot.slice(11) } : {}) });
    if (!parsed.success) {
      const page = await listingPage(req, f.listingCode ?? "", `Check the request: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`);
      return html(reply, page.body, 400);
    }
    try {
      const v = await d.homes.requestViewing(ws(req), parsed.data);
      return reply.redirect(`${req.prefix}/viewings/${v.viewingNo}`, 303);
    } catch (err) {
      if (!(err instanceof DomainError)) throw err;
      const page = await listingPage(req, parsed.data.listingCode, err.message);
      return html(reply, page.body, err.status);
    }
  });

  app.get("/viewings", async (req, reply) => {
    const f = { email: one(q(req).email), listing: one(q(req).listing), status: one(q(req).status) };
    const cursor = one(q(req).cursor);
    const status = f.status === "requested" || f.status === "cancelled" ? f.status : undefined;
    const page = await d.homes.listViewings(ws(req), { ...(f.email ? { email: f.email } : {}), ...(f.listing ? { listing: f.listing } : {}), ...(status ? { status } : {}), ...(cursor ? { cursor } : {}), limit: 25 });
    return html(reply, shell(await ctx(req), "Viewings", viewings.viewingsList(req.prefix, page.items, page.nextCursor, f)));
  });

  const viewingPage = async (req: FastifyRequest, no: string, flash?: string) => {
    const c = await ctx(req, flash);
    const v = await d.homes.getViewing(ws(req), no);
    if (!v) return { status: 404, body: shell(c, "Not found", "<h1>No such viewing</h1>") };
    return { status: 200, body: shell(c, v.viewingNo, viewings.viewingDetail(req.prefix, v, await d.homes.getListing(ws(req), v.listingCode), !!c.user)) };
  };

  app.get<{ Params: { no: string } }>("/viewings/:no", async (req, reply) => {
    const page = await viewingPage(req, req.params.no);
    return html(reply, page.body, page.status);
  });

  app.post<{ Params: { no: string } }>("/viewings/:no/cancel", async (req, reply) => {
    try {
      await d.homes.cancelViewing(ws(req), req.params.no);
      return reply.redirect(`${req.prefix}/viewings/${req.params.no}`, 303);
    } catch (err) {
      if (!(err instanceof DomainError)) throw err;
      const page = await viewingPage(req, req.params.no, err.message);
      return html(reply, page.body, err.status);
    }
  });

  app.get("/agents", async (req, reply) => html(reply, shell(await ctx(req), "Agents", agents.agentsList(req.prefix, await d.homes.listAgents(ws(req))))));
  app.get<{ Params: { code: string } }>("/agents/:code", async (req, reply) => {
    const a = await d.homes.getAgent(ws(req), req.params.code);
    if (!a) return html(reply, shell(await ctx(req), "Not found", "<h1>No such agent</h1>"), 404);
    return html(reply, shell(await ctx(req), a.name, agents.agentDetail(req.prefix, a)));
  });
}
