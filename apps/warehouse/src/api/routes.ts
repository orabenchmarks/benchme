import { DomainError, apiUser, type AuthService } from "@benchme/site-kit";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { CatalogRepo } from "../db/catalog-repo.js";
import type { OrdersRepo } from "../db/orders-repo.js";
import { SESSION_COOKIE } from "../ui/routes.js";

export type ApiDeps = { catalog: CatalogRepo; orders: OrdersRepo; auth: AuthService };

const listQuery = z.object({ query: z.string().optional(), category: z.string().optional(), cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(200).default(50) });
const ordersQuery = z.object({ status: z.enum(["open", "shipped", "cancelled"]).optional(), customer: z.string().optional(), cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(200).default(50) });
const orderBody = z.object({ customer: z.string().min(1), lines: z.array(z.object({ sku: z.string().min(1), qty: z.number().int().positive() })).min(1) });
const transferBody = z.object({ sku: z.string().min(1), from: z.string().min(1), to: z.string().min(1), qty: z.number().int().positive() });

/** REST under /api/v1. Reads are open inside the workspace; writes need a bearer token or a session. */
export function registerApi(app: FastifyInstance, d: ApiDeps): void {
  const caller = apiUser(d.auth, SESSION_COOKIE);
  const authed = async (req: FastifyRequest, reply: FastifyReply): Promise<boolean> => {
    const user = await caller(req);
    if (!user) {
      reply.code(401).send({ error: "UNAUTHORIZED", message: "sign in or send Authorization: Bearer <api token>" });
      return false;
    }
    return true;
  };
  const domain = (reply: FastifyReply, err: unknown) => {
    if (err instanceof DomainError) return reply.code(err.status).send({ error: err.code, message: err.message });
    throw err;
  };

  app.get("/api/v1/products", async (req) => {
    const qq = listQuery.parse(req.query);
    return d.catalog.listProducts(req.workspaceId, { ...(qq.query ? { query: qq.query } : {}), ...(qq.category ? { category: qq.category } : {}), ...(qq.cursor ? { cursor: qq.cursor } : {}), limit: qq.limit });
  });
  app.get<{ Params: { sku: string } }>("/api/v1/products/:sku", async (req, reply) => {
    const p = await d.catalog.getProduct(req.workspaceId, req.params.sku);
    return p ?? reply.code(404).send({ error: "NOT_FOUND" });
  });
  app.get("/api/v1/locations", async (req) => d.catalog.listLocations(req.workspaceId));
  app.get("/api/v1/stock", async (req, reply) => {
    const qq = z.object({ sku: z.string().min(1), location: z.string().optional() }).parse(req.query);
    const rows = await d.catalog.getStock(req.workspaceId, qq.sku, qq.location);
    if (!(await d.catalog.getProduct(req.workspaceId, qq.sku))) return reply.code(404).send({ error: "NOT_FOUND" });
    return { sku: qq.sku, total: rows.reduce((s, r) => s + r.qty, 0), byLocation: rows };
  });
  app.get("/api/v1/stock/low", async (req) => d.catalog.lowStock(req.workspaceId, z.object({ threshold: z.coerce.number().int().min(0).default(20) }).parse(req.query).threshold));
  app.get("/api/v1/customers", async (req) => d.catalog.listCustomers(req.workspaceId));
  app.get<{ Params: { code: string } }>("/api/v1/customers/:code", async (req, reply) => (await d.catalog.getCustomer(req.workspaceId, req.params.code)) ?? reply.code(404).send({ error: "NOT_FOUND" }));

  app.get("/api/v1/orders", async (req) => {
    const qq = ordersQuery.parse(req.query);
    return d.orders.listOrders(req.workspaceId, { ...(qq.status ? { status: qq.status } : {}), ...(qq.customer ? { customer: qq.customer } : {}), ...(qq.cursor ? { cursor: qq.cursor } : {}), limit: qq.limit });
  });
  app.get<{ Params: { no: string } }>("/api/v1/orders/:no", async (req, reply) => (await d.orders.getOrder(req.workspaceId, req.params.no)) ?? reply.code(404).send({ error: "NOT_FOUND" }));
  app.post("/api/v1/orders", async (req, reply) => {
    if (!(await authed(req, reply))) return;
    const b = orderBody.parse(req.body);
    try {
      return reply.code(201).send(await d.orders.createOrder(req.workspaceId, b.customer, b.lines));
    } catch (err) {
      return domain(reply, err);
    }
  });
  app.post<{ Params: { no: string } }>("/api/v1/orders/:no/cancel", async (req, reply) => {
    if (!(await authed(req, reply))) return;
    try {
      return await d.orders.cancelOrder(req.workspaceId, req.params.no);
    } catch (err) {
      return domain(reply, err);
    }
  });

  app.get("/api/v1/transfers", async (req) => d.orders.listTransfers(req.workspaceId, z.object({ status: z.string().optional() }).parse(req.query).status));
  app.get<{ Params: { no: string } }>("/api/v1/transfers/:no", async (req, reply) => (await d.orders.getTransfer(req.workspaceId, req.params.no)) ?? reply.code(404).send({ error: "NOT_FOUND" }));
  app.post("/api/v1/transfers", async (req, reply) => {
    if (!(await authed(req, reply))) return;
    const b = transferBody.parse(req.body);
    try {
      return reply.code(201).send(await d.orders.createTransfer(req.workspaceId, { sku: b.sku, fromCode: b.from, toCode: b.to, qty: b.qty }));
    } catch (err) {
      return domain(reply, err);
    }
  });
  app.post<{ Params: { no: string } }>("/api/v1/transfers/:no/complete", async (req, reply) => {
    if (!(await authed(req, reply))) return;
    try {
      return await d.orders.completeTransfer(req.workspaceId, req.params.no);
    } catch (err) {
      return domain(reply, err);
    }
  });
}
