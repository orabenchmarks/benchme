import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AuthError, type AuthService } from "../auth/auth-service.js";
import type { CatalogRepo } from "../db/catalog-repo.js";
import { DomainError, type OrdersRepo } from "../db/orders-repo.js";
import { layout, type LayoutCtx } from "./layout.js";
import * as pages from "./pages.js";

export const SESSION_COOKIE = "wh_session";

export type UiDeps = { catalog: CatalogRepo; orders: OrdersRepo; auth: AuthService };

type Q = Record<string, string | undefined>;
const q = (req: FastifyRequest): Q => (req.query ?? {}) as Q;
const form = (req: FastifyRequest): Q => (req.body ?? {}) as Q;

/** Server-rendered UI. Reads are public inside the workspace; writes need a session. */
export function registerUi(app: FastifyInstance, d: UiDeps): void {
  const ctx = async (req: FastifyRequest, flash?: string): Promise<LayoutCtx> => ({
    prefix: req.prefix,
    user: await d.auth.userForSession(req.workspaceId, req.cookies[SESSION_COOKIE]),
    flash,
  });
  const html = (reply: FastifyReply, body: string) => reply.type("text/html; charset=utf-8").send(body);
  const requireUser = async (req: FastifyRequest, reply: FastifyReply) => {
    const c = await ctx(req);
    if (!c.user) {
      reply.redirect(`${req.prefix}/login`, 302);
      return null;
    }
    return c;
  };
  const cookieOpts = (req: FastifyRequest, expires: Date) => ({ path: `${req.prefix || ""}/`, httpOnly: true, sameSite: "lax" as const, expires });

  app.get("/", async (req, reply) => {
    const ws = req.workspaceId;
    const [products, openOrders, pending] = await Promise.all([
      d.catalog.listProducts(ws, { limit: 1000 }).then((p) => p.items.length),
      d.orders.listOrders(ws, { status: "open", limit: 1000 }).then((p) => p.items.length),
      d.orders.listTransfers(ws, "pending").then((t) => t.length),
    ]);
    return html(reply, layout(await ctx(req), "Dashboard", pages.dashboard(req.prefix, { products, openOrders, pendingTransfers: pending })));
  });

  app.get("/products", async (req, reply) => {
    const { query, category, cursor } = q(req);
    const page = await d.catalog.listProducts(req.workspaceId, { ...(query ? { query } : {}), ...(category ? { category } : {}), ...(cursor ? { cursor } : {}), limit: 25 });
    return html(reply, layout(await ctx(req), "Products", pages.productsList(req.prefix, page.items, page.nextCursor, { ...(query ? { query } : {}), ...(category ? { category } : {}) })));
  });

  app.get<{ Params: { sku: string } }>("/products/:sku", async (req, reply) => {
    const product = await d.catalog.getProduct(req.workspaceId, req.params.sku);
    if (!product) return reply.code(404).send(layout(await ctx(req), "Not found", "<h1>No such product</h1>"));
    const [stock, locations] = await Promise.all([d.catalog.getStock(req.workspaceId, product.sku), d.catalog.listLocations(req.workspaceId)]);
    return html(reply, layout(await ctx(req), product.name, pages.productDetail(req.prefix, product, stock, locations)));
  });

  app.get("/orders", async (req, reply) => {
    const { status, cursor } = q(req);
    const page = await d.orders.listOrders(req.workspaceId, { ...(status ? { status } : {}), ...(cursor ? { cursor } : {}), limit: 25 });
    return html(reply, layout(await ctx(req), "Orders", pages.ordersList(req.prefix, page.items, page.nextCursor, status)));
  });

  app.get("/orders/new", async (req, reply) => {
    const c = await requireUser(req, reply);
    if (!c) return;
    return html(reply, layout(c, "New order", pages.orderForm(req.prefix, await d.catalog.listCustomers(req.workspaceId))));
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
      if (err instanceof DomainError) return html(reply, layout({ ...c, flash: err.message }, "New order", pages.orderForm(req.prefix, await d.catalog.listCustomers(req.workspaceId))));
      throw err;
    }
  });

  app.get<{ Params: { no: string } }>("/orders/:no", async (req, reply) => {
    const c = await ctx(req);
    const o = await d.orders.getOrder(req.workspaceId, req.params.no);
    if (!o) return reply.code(404).send(layout(c, "Not found", "<h1>No such order</h1>"));
    return html(reply, layout(c, o.orderNo, pages.orderDetail(req.prefix, o, !!c.user)));
  });

  app.post<{ Params: { no: string } }>("/orders/:no/cancel", async (req, reply) => {
    const c = await requireUser(req, reply);
    if (!c) return;
    try {
      await d.orders.cancelOrder(req.workspaceId, req.params.no);
      return reply.redirect(`${req.prefix}/orders/${req.params.no}`, 303);
    } catch (err) {
      if (err instanceof DomainError) return reply.code(err.status).send(layout({ ...c, flash: err.message }, "Order", "<p>Could not cancel.</p>"));
      throw err;
    }
  });

  app.get("/transfers", async (req, reply) => html(reply, layout(await ctx(req), "Transfers", pages.transfersList(req.prefix, await d.orders.listTransfers(req.workspaceId)))));

  app.get("/transfers/new", async (req, reply) => {
    const c = await requireUser(req, reply);
    if (!c) return;
    return html(reply, layout(c, "New transfer", pages.transferForm(req.prefix, await d.catalog.listLocations(req.workspaceId), q(req).sku ?? "")));
  });

  app.post("/transfers", async (req, reply) => {
    const c = await requireUser(req, reply);
    if (!c) return;
    const f = form(req);
    try {
      await d.orders.createTransfer(req.workspaceId, { sku: f.sku ?? "", fromCode: f.from ?? "", toCode: f.to ?? "", qty: Number(f.qty) });
      return reply.redirect(`${req.prefix}/transfers`, 303);
    } catch (err) {
      if (err instanceof DomainError) return html(reply, layout({ ...c, flash: err.message }, "New transfer", pages.transferForm(req.prefix, await d.catalog.listLocations(req.workspaceId), f.sku ?? "")));
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
      if (err instanceof DomainError) return reply.code(err.status).send(layout({ ...c, flash: err.message }, "Transfers", "<p>Could not complete.</p>"));
      throw err;
    }
  });

  app.get("/customers", async (req, reply) => html(reply, layout(await ctx(req), "Customers", pages.customersList(req.prefix, await d.catalog.listCustomers(req.workspaceId)))));
  app.get<{ Params: { code: string } }>("/customers/:code", async (req, reply) => {
    const c = await ctx(req);
    const customer = await d.catalog.getCustomer(req.workspaceId, req.params.code);
    if (!customer) return reply.code(404).send(layout(c, "Not found", "<h1>No such customer</h1>"));
    const orders = await d.orders.listOrders(req.workspaceId, { customer: customer.code, limit: 200 });
    return html(reply, layout(c, customer.name, pages.customerDetail(req.prefix, customer, orders.items)));
  });

  // --- auth ---
  app.get("/signup", async (req, reply) => html(reply, layout(await ctx(req), "Sign up", pages.signupForm(req.prefix))));
  app.post("/signup", async (req, reply) => {
    const f = form(req);
    try {
      await d.auth.signup(req.workspaceId, f.email ?? "", f.password ?? "", f.name ?? "");
      return html(reply, layout(await ctx(req), "Verify", pages.verifyForm(req.prefix, (f.email ?? "").trim().toLowerCase())));
    } catch (err) {
      if (err instanceof AuthError) return reply.code(err.status).type("text/html").send(layout(await ctx(req), "Sign up", pages.signupForm(req.prefix, err.message)));
      throw err;
    }
  });
  app.get("/verify", async (req, reply) => html(reply, layout(await ctx(req), "Verify", pages.verifyForm(req.prefix, q(req).email ?? ""))));
  app.post("/verify", async (req, reply) => {
    const f = form(req);
    try {
      await d.auth.verify(req.workspaceId, f.email ?? "", f.code ?? "");
      return html(reply, layout({ ...(await ctx(req)), flash: "Email verified. You can sign in now." }, "Sign in", pages.loginForm(req.prefix)));
    } catch (err) {
      if (err instanceof AuthError) return reply.code(err.status).type("text/html").send(layout(await ctx(req), "Verify", pages.verifyForm(req.prefix, f.email ?? "", err.message)));
      throw err;
    }
  });
  app.get("/login", async (req, reply) => html(reply, layout(await ctx(req), "Sign in", pages.loginForm(req.prefix))));
  app.post("/login", async (req, reply) => {
    const f = form(req);
    try {
      const s = await d.auth.login(req.workspaceId, f.email ?? "", f.password ?? "");
      reply.setCookie(SESSION_COOKIE, s.token, cookieOpts(req, s.expiresAt));
      return reply.redirect(`${req.prefix}/`, 303);
    } catch (err) {
      if (err instanceof AuthError) return reply.code(err.status).type("text/html").send(layout(await ctx(req), "Sign in", pages.loginForm(req.prefix, err.message)));
      throw err;
    }
  });
  app.post("/logout", async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) await d.auth.logout(req.workspaceId, token);
    reply.clearCookie(SESSION_COOKIE, { path: `${req.prefix || ""}/` });
    return reply.redirect(`${req.prefix}/`, 303);
  });
  app.get("/account", async (req, reply) => {
    const c = await requireUser(req, reply);
    if (!c || !c.user) return;
    const full = await d.auth.userForSession(req.workspaceId, req.cookies[SESSION_COOKIE]);
    return html(reply, layout(c, "Account", pages.accountPage(req.prefix, { email: c.user.email, displayName: c.user.displayName, apiToken: full?.apiToken ?? null })));
  });
  app.post("/account/token", async (req, reply) => {
    const c = await requireUser(req, reply);
    if (!c || !c.user) return;
    await d.auth.issueApiToken(req.workspaceId, c.user.email);
    return reply.redirect(`${req.prefix}/account`, 303);
  });
}
