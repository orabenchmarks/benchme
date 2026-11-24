import { PIZZA_STATUSES, isDate, type PizzaOrderStatus } from "@benchme/scenarios";
import { registerAuthRoutes, sessionUser, shell, webmcpBridge, type AuthService, type ShellCtx, type ToolRegistry } from "@benchme/site-kit";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { fromSearchQuery, searchQuery } from "../api/inputs.js";
import type { PizzaRepo } from "../db/pizza-repo.js";
import type { ToolContext } from "../mcp/tools.js";
import { buildValues, one, priceOf, type Form } from "./build-model.js";
import { registerOrderWrites, type Page } from "./order-routes.js";
import { branchDetail } from "./pages/branches.js";
import { builder } from "./pages/build.js";
import * as menu from "./pages/menu.js";
import { orderDetail, ordersList } from "./pages/orders.js";

export const SESSION_COOKIE = "pz_session";
export type UiDeps = { pizza: PizzaRepo; auth: AuthService; tools: ToolRegistry<ToolContext> };

const q = (req: FastifyRequest): Form => (req.query ?? {}) as Form;
const NAV = [
  { href: "/", label: "Find" },
  { href: "/pizzas", label: "Menu" },
  { href: "/build", label: "Build" },
  { href: "/orders", label: "Orders" },
];

export function registerUi(app: FastifyInstance, d: UiDeps): void {
  const user = sessionUser(d.auth, SESSION_COOKIE);
  const ctx = async (req: FastifyRequest, flash?: string): Promise<ShellCtx> => ({
    site: "Marlivo Pizza",
    accent: "#b23a1e",
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

  /** The builder with what the form holds (a query or a refused order's body), its price, and an optional reason on top. */
  const buildPage = async (req: FastifyRequest, f: Form, flash?: string): Promise<Page> => {
    const c = await ctx(req, flash);
    const code = one(f.pizza) || one(f.pizzaCode);
    const pizza = code ? await d.pizza.pizza(ws(req), code) : null;
    if (code && !pizza) return { status: 404, body: shell(c, "Not found", "<h1>No such menu pizza</h1>") };
    const v = buildValues(f, pizza);
    const [b, branches, price] = await Promise.all([d.pizza.builder(ws(req)), d.pizza.branches(ws(req)), priceOf(d.pizza, ws(req), v)]);
    return { status: 200, body: shell(c, "Build a pizza", builder(req.prefix, b, branches, pizza, v, price, !!c.user)) };
  };
  const orderPage = async (req: FastifyRequest, no: string, flash?: string): Promise<Page> => {
    const c = await ctx(req, flash);
    const o = await d.pizza.getOrder(ws(req), no);
    if (!o) return { status: 404, body: shell(c, "Not found", "<h1>No such order</h1>") };
    const [b, branch] = await Promise.all([d.pizza.builder(ws(req)), d.pizza.branch(ws(req), o.branchCode)]);
    return { status: 200, body: shell(c, o.orderNo, orderDetail(req.prefix, b, o, branch?.name ?? o.branchCode, !!c.user)) };
  };

  app.get("/", async (req, reply) => {
    const [b, branches] = await Promise.all([d.pizza.builder(ws(req)), d.pizza.branches(ws(req))]);
    return html(reply, shell(await ctx(req), "Find a pizza", menu.home(req.prefix, b, branches)));
  });

  app.get("/search", async (req, reply) => {
    const f = q(req);
    const [b, branches] = await Promise.all([d.pizza.builder(ws(req)), d.pizza.branches(ws(req))]);
    const parsed = searchQuery.safeParse(f);
    if (!parsed.success) return html(reply, shell(await ctx(req, `Check the search: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`), "Find a pizza", menu.home(req.prefix, b, branches, f)), 400);
    const offers = await d.pizza.search(ws(req), fromSearchQuery(parsed.data));
    return html(reply, shell(await ctx(req), "Pizzas", menu.searchResults(req.prefix, b, branches, f, offers)));
  });

  app.get("/pizzas", async (req, reply) => {
    const [b, items] = await Promise.all([d.pizza.builder(ws(req)), d.pizza.menu(ws(req))]);
    return html(reply, shell(await ctx(req), "Menu", menu.menuList(req.prefix, b, items)));
  });

  app.get<{ Params: { code: string } }>("/pizzas/:code", async (req, reply) => {
    const [b, m, branches] = await Promise.all([d.pizza.builder(ws(req)), d.pizza.pizza(ws(req), req.params.code), d.pizza.branches(ws(req))]);
    if (!m) return html(reply, shell(await ctx(req), "Not found", "<h1>No such menu pizza</h1>"), 404);
    return html(reply, shell(await ctx(req), m.name, menu.pizzaDetail(req.prefix, b, m, branches)));
  });

  app.get<{ Params: { code: string } }>("/branches/:code", async (req, reply) => {
    const f = q(req);
    const date = one(f.date);
    const pizzas = Number(one(f.pizzas));
    const [b, x] = await Promise.all([d.pizza.builder(ws(req)), d.pizza.branch(ws(req), req.params.code)]);
    if (!x) return html(reply, shell(await ctx(req), "Not found", "<h1>No such branch</h1>"), 404);
    const valid = !!date && isDate(date);
    const slots = valid ? await d.pizza.slots(ws(req), { branchCode: x.code, date, ...(Number.isInteger(pizzas) && pizzas >= 1 ? { pizzas } : {}) }) : null;
    const flash = date && !valid ? `Check the date: ${date} is not a date (YYYY-MM-DD)` : undefined;
    return html(reply, shell(await ctx(req, flash), x.name, branchDetail(req.prefix, b, x, { date, pizzas: one(f.pizzas) }, slots)), flash ? 400 : 200);
  });

  app.get("/build", async (req, reply) => {
    const page = await buildPage(req, q(req));
    return html(reply, page.body, page.status);
  });

  app.get("/orders", async (req, reply) => {
    const f = q(req);
    const [customerEmail, branch, status, cursor] = [one(f.customerEmail), one(f.branch), one(f.status), one(f.cursor)];
    const known = PIZZA_STATUSES.find((s): s is PizzaOrderStatus => s === status);
    const page = await d.pizza.listOrders(ws(req), { ...(customerEmail ? { customerEmail } : {}), ...(branch ? { branch } : {}), ...(known ? { status: known } : {}), ...(cursor ? { cursor } : {}), limit: 25 });
    return html(reply, shell(await ctx(req), "Orders", ordersList(req.prefix, page.items, page.nextCursor, { customerEmail, branch, status: known })));
  });

  app.get<{ Params: { no: string } }>("/orders/:no", async (req, reply) => {
    const page = await orderPage(req, req.params.no);
    return html(reply, page.body, page.status);
  });

  registerOrderWrites(app, { pizza: d.pizza, html, buildPage, orderPage });
}
