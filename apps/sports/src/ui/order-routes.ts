import { DomainError, shell } from "@benchme/site-kit";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { orderSchema, ordersQuery, returnSchema, toOrderFilter } from "../api/inputs.js";
import { orderDetail } from "./order-detail.js";
import * as pages from "./order-pages.js";
import { flat, type PageKit } from "./kit.js";
import type { UiDeps } from "./routes.js";

type No = { Params: { no: string } };
const issues = (e: { issues: { path: (string | number)[] }[] }) => e.issues.map((i) => i.path.join(".")).join(", ");

/** The order form's line rows (sku1/qty1 …, or one sku/qty from a product page) as order lines; a blank quantity is 1. */
export function formLines(f: Record<string, string | undefined>): { sku: string; qty: string }[] {
  const keys = [["sku", "qty"], ...Array.from({ length: pages.FORM_LINES }, (_, i) => [`sku${i + 1}`, `qty${i + 1}`])] as const;
  return keys.filter(([s]) => f[s]?.trim()).map(([s, q]) => ({ sku: (f[s] as string).trim(), qty: f[q] ?? "1" }));
}

/** Customers, orders, the order form, and an order page with its follow-up actions (cancel, reorder, return). */
export function registerOrderUi(app: FastifyInstance, d: UiDeps, k: PageKit): void {
  const formPage = async (req: FastifyRequest, f: Record<string, string | undefined>, flash?: string) => {
    const c = await k.ctx(req, flash);
    const customer = f.customerEmail ? await d.orders.getCustomer(req.workspaceId, f.customerEmail) : null;
    return shell(c, "New order", c.user ? pages.orderForm(req.prefix, f, customer) : `<h1>New order</h1><p class="muted">Sign in to place an order.</p>`);
  };
  const orderPage = async (req: FastifyRequest, no: string, flash?: string) => {
    const c = await k.ctx(req, flash);
    const o = await d.orders.getOrder(req.workspaceId, no);
    if (!o) return { status: 404, body: shell(c, "Not found", "<h1>No such order</h1>") };
    const addresses = (await d.orders.getCustomer(req.workspaceId, o.customerEmail))?.addresses ?? [];
    const reasons = (await d.catalog.policies(req.workspaceId)).returnReasons;
    return { status: 200, body: shell(c, o.orderNo, orderDetail(req.prefix, o, !!c.user, addresses, reasons)) };
  };

  app.get("/customers", async (req, reply) => {
    const query = flat(req.query).query;
    return k.html(reply, shell(await k.ctx(req), "Customers", pages.customersList(req.prefix, await d.orders.listCustomers(req.workspaceId, query), query)));
  });

  app.get<{ Params: { email: string } }>("/customers/:email", async (req, reply) => {
    const c = await d.orders.getCustomer(req.workspaceId, req.params.email);
    if (!c) return k.html(reply, shell(await k.ctx(req), "Not found", "<h1>No such customer</h1>"), 404);
    const orders = await d.orders.listOrders(req.workspaceId, { customerEmail: c.email, limit: 200 });
    return k.html(reply, shell(await k.ctx(req), c.name, pages.customerDetail(req.prefix, c, orders.items)));
  });

  app.get("/orders", async (req, reply) => {
    const f = flat(req.query);
    const parsed = ordersQuery.safeParse({ ...f, limit: 25 });
    if (!parsed.success) return k.html(reply, shell(await k.ctx(req, `Check the filters: ${issues(parsed.error)}`), "Orders", pages.ordersList(req.prefix, [], null, f)), 400);
    const page = await d.orders.listOrders(req.workspaceId, toOrderFilter(parsed.data));
    return k.html(reply, shell(await k.ctx(req), "Orders", pages.ordersList(req.prefix, page.items, page.nextCursor, { ...f, cursor: undefined })));
  });

  app.get("/orders/new", async (req, reply) => {
    const f = flat(req.query);
    return k.html(reply, await formPage(req, { ...f, ...(f.sku && !f.sku1 ? { sku1: f.sku } : {}) }));
  });

  app.post("/orders", async (req, reply) => {
    if (!(await k.requireUser(req, reply))) return;
    const f = flat(req.body);
    const parsed = orderSchema.safeParse({ customerEmail: f.customerEmail, addressCode: f.addressCode, lines: formLines(f) });
    if (!parsed.success) return k.html(reply, await formPage(req, f, `Check the order: ${issues(parsed.error)}`), 400);
    try {
      const o = await d.orders.placeOrder(req.workspaceId, parsed.data);
      return reply.redirect(`${req.prefix}/orders/${o.orderNo}`, 303);
    } catch (err) {
      if (!(err instanceof DomainError)) throw err;
      return k.html(reply, await formPage(req, f, err.message), err.status);
    }
  });

  app.get<No>("/orders/:no", async (req, reply) => {
    const page = await orderPage(req, req.params.no);
    return k.html(reply, page.body, page.status);
  });

  /** A follow-up action on an order page: 303 to the page it lands on, or the order page again with the reason. */
  const action = (path: string, act: (req: FastifyRequest<No>, f: Record<string, string | undefined>) => Promise<string>) =>
    app.post<No>(`/orders/:no/${path}`, async (req, reply: FastifyReply) => {
      if (!(await k.requireUser(req, reply))) return;
      try {
        return reply.redirect(`${req.prefix}/orders/${await act(req, flat(req.body))}`, 303);
      } catch (err) {
        if (!(err instanceof DomainError)) throw err;
        const page = await orderPage(req, req.params.no, err.message);
        return k.html(reply, page.body, page.status === 404 ? 404 : err.status);
      }
    });
  action("cancel", async (req) => (await d.orders.cancelOrder(req.workspaceId, req.params.no)).orderNo);
  action("reorder", async (req, f) => (await d.orders.reorder(req.workspaceId, req.params.no, f.addressCode)).orderNo);
  action("returns", async (req, f) => {
    const parsed = returnSchema.safeParse({ orderNo: req.params.no, sku: f.sku, qty: f.qty, reason: f.reason });
    if (!parsed.success) throw new DomainError("BAD_REQUEST", `Check the return: ${issues(parsed.error)}`, 400);
    return (await d.orders.requestReturn(req.workspaceId, parsed.data)).orderNo;
  });
}
