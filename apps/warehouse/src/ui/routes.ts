import { registerAuthRoutes, requireSession, sessionUser, shell, type AuthService, type ShellCtx } from "@benchme/site-kit";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { CatalogRepo } from "../db/catalog-repo.js";
import { DomainError, type OrdersRepo } from "../db/orders-repo.js";
import * as pages from "./pages.js";

export const SESSION_COOKIE = "wh_session";

export type UiDeps = { catalog: CatalogRepo; orders: OrdersRepo; auth: AuthService };

type Q = Record<string, string | undefined>;
const q = (req: FastifyRequest): Q => (req.query ?? {}) as Q;
const form = (req: FastifyRequest): Q => (req.body ?? {}) as Q;

const NAV = [
  { href: "/products", label: "Products" },
  { href: "/orders", label: "Orders" },
  { href: "/transfers", label: "Transfers" },
  { href: "/customers", label: "Customers" },
];

/** Server-rendered UI. Reads are public inside the workspace; writes need a session. */
export function registerUi(app: FastifyInstance, d: UiDeps): void {
  const user = sessionUser(d.auth, SESSION_COOKIE);
  const ctx = async (req: FastifyRequest, flash?: string): Promise<ShellCtx> => ({
    site: "Warehouse",
    accent: "#1f3a5f",
    prefix: req.prefix,
    nav: NAV,
    user: await user(req),
    flash,
  });
  const html = (reply: FastifyReply, body: string) => reply.type("text/html; charset=utf-8").send(body);
  const authDeps = { auth: d.auth, cookie: SESSION_COOKIE, shellCtx: ctx };
  const requireUser = requireSession(authDeps);
  registerAuthRoutes(app, authDeps);

  app.get("/", async (req, reply) => {
    const ws = req.workspaceId;
    const [products, openOrders, pending] = await Promise.all([
      d.catalog.listProducts(ws, { limit: 1000 }).then((p) => p.items.length),
      d.orders.listOrders(ws, { status: "open", limit: 1000 }).then((p) => p.items.length),
      d.orders.listTransfers(ws, "pending").then((t) => t.length),
    ]);
    return html(reply, shell(await ctx(req), "Dashboard", pages.dashboard(req.prefix, { products, openOrders, pendingTransfers: pending })));
  });

  app.get("/products", async (req, reply) => {
    const { query, category, cursor } = q(req);
    const page = await d.catalog.listProducts(req.workspaceId, { ...(query ? { query } : {}), ...(category ? { category } : {}), ...(cursor ? { cursor } : {}), limit: 25 });
    return html(reply, shell(await ctx(req), "Products", pages.productsList(req.prefix, page.items, page.nextCursor, { ...(query ? { query } : {}), ...(category ? { category } : {}) })));
  });

  app.get<{ Params: { sku: string } }>("/products/:sku", async (req, reply) => {
    const product = await d.catalog.getProduct(req.workspaceId, req.params.sku);
    if (!product) return reply.code(404).type("text/html").send(shell(await ctx(req), "Not found", "<h1>No such product</h1>"));
    const [stock, locations] = await Promise.all([d.catalog.getStock(req.workspaceId, product.sku), d.catalog.listLocations(req.workspaceId)]);
    return html(reply, shell(await ctx(req), product.name, pages.productDetail(req.prefix, product, stock, locations)));
  });

  app.get("/orders", async (req, reply) => {
    const { status, cursor } = q(req);
    const page = await d.orders.listOrders(req.workspaceId, { ...(status ? { status } : {}), ...(cursor ? { cursor } : {}), limit: 25 });
    return html(reply, shell(await ctx(req), "Orders", pages.ordersList(req.prefix, page.items, page.nextCursor, status)));
  });

  app.get("/orders/new", async (req, reply) => {
    const c = await requireUser(req, reply);
    if (!c) return;
    return html(reply, shell(c, "New order", pages.orderForm(req.prefix, await d.catalog.listCustomers(req.workspaceId))));
  });

  app.post("/orders", async (req, reply) => {
    const c = await requireUser(req, reply);
    if (!c) return;
    const f = form(req);
    const lines = (f.lines ?? "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [sku, qty] = l.split(",").map((s) => s.trim());
        return { sku: sku ?? "", qty: Number(qty) };
      });
    try {
      const o = await d.orders.createOrder(req.workspaceId, f.customer ?? "", lines);
      return reply.redirect(`${req.prefix}/orders/${o.orderNo}`, 303);
    } catch (err) {
      if (err instanceof DomainError) return html(reply, shell({ ...c, flash: err.message }, "New order", pages.orderForm(req.prefix, await d.catalog.listCustomers(req.workspaceId))));
      throw err;
    }
  });

  app.get<{ Params: { no: string } }>("/orders/:no", async (req, reply) => {
    const c = await ctx(req);
    const o = await d.orders.getOrder(req.workspaceId, req.params.no);
    if (!o) return reply.code(404).type("text/html").send(shell(c, "Not found", "<h1>No such order</h1>"));
    return html(reply, shell(c, o.orderNo, pages.orderDetail(req.prefix, o, !!c.user)));
  });

  app.post<{ Params: { no: string } }>("/orders/:no/cancel", async (req, reply) => {
    const c = await requireUser(req, reply);
    if (!c) return;
    try {
      await d.orders.cancelOrder(req.workspaceId, req.params.no);
      return reply.redirect(`${req.prefix}/orders/${req.params.no}`, 303);
    } catch (err) {
      if (err instanceof DomainError) return reply.code(err.status).type("text/html").send(shell({ ...c, flash: err.message }, "Order", "<p>Could not cancel.</p>"));
      throw err;
    }
  });

  app.get("/transfers", async (req, reply) => html(reply, shell(await ctx(req), "Transfers", pages.transfersList(req.prefix, await d.orders.listTransfers(req.workspaceId)))));

  app.get("/transfers/new", async (req, reply) => {
    const c = await requireUser(req, reply);
    if (!c) return;
    return html(reply, shell(c, "New transfer", pages.transferForm(req.prefix, await d.catalog.listLocations(req.workspaceId), q(req).sku ?? "")));
  });

  app.post("/transfers", async (req, reply) => {
    const c = await requireUser(req, reply);
    if (!c) return;
    const f = form(req);
    try {
      await d.orders.createTransfer(req.workspaceId, { sku: f.sku ?? "", fromCode: f.from ?? "", toCode: f.to ?? "", qty: Number(f.qty) });
      return reply.redirect(`${req.prefix}/transfers`, 303);
    } catch (err) {
      if (err instanceof DomainError) return html(reply, shell({ ...c, flash: err.message }, "New transfer", pages.transferForm(req.prefix, await d.catalog.listLocations(req.workspaceId), f.sku ?? "")));
      throw err;
    }
  });

  app.post<{ Params: { no: string } }>("/transfers/:no/complete", async (req, reply) => {
    const c = await requireUser(req, reply);
    if (!c) return;
    try {
      await d.orders.completeTransfer(req.workspaceId, req.params.no);
      return reply.redirect(`${req.prefix}/transfers`, 303);
    } catch (err) {
      if (err instanceof DomainError) return reply.code(err.status).type("text/html").send(shell({ ...c, flash: err.message }, "Transfers", "<p>Could not complete.</p>"));
      throw err;
    }
  });

  app.get("/customers", async (req, reply) => html(reply, shell(await ctx(req), "Customers", pages.customersList(req.prefix, await d.catalog.listCustomers(req.workspaceId)))));
  app.get<{ Params: { code: string } }>("/customers/:code", async (req, reply) => {
    const c = await ctx(req);
    const customer = await d.catalog.getCustomer(req.workspaceId, req.params.code);
    if (!customer) return reply.code(404).type("text/html").send(shell(c, "Not found", "<h1>No such customer</h1>"));
    const orders = await d.orders.listOrders(req.workspaceId, { customer: customer.code, limit: 200 });
    return html(reply, shell(c, customer.name, pages.customerDetail(req.prefix, customer, orders.items)));
  });
}
