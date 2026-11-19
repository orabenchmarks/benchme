import { DomainError, apiUser, type AuthService } from "@benchme/site-kit";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { CatalogRepo } from "../db/catalog-repo.js";
import type { OrdersRepo } from "../db/orders-repo.js";
import { SESSION_COOKIE } from "../ui/routes.js";
import { orderSchema, ordersQuery, reorderSchema, returnSchema, searchSchema, toOrderFilter, toSearch } from "./inputs.js";

export type ApiDeps = { catalog: CatalogRepo; orders: OrdersRepo; auth: AuthService };

const productsQuery = z.object({ category: z.string().optional(), query: z.string().optional() });
const customersQuery = z.object({ query: z.string().optional() });
const returnsQuery = z.object({ orderNo: z.string().optional(), customerEmail: z.string().optional() });
/** Query strings and forms send "" for a field left blank; blank means "not given". */
export const blankless = (o: unknown): Record<string, unknown> => Object.fromEntries(Object.entries((o ?? {}) as Record<string, unknown>).filter(([, v]) => v !== ""));

/** REST under /api/v1. Reads are open inside the workspace; orders, cancels, reorders and returns need a bearer token or a session. */
export function registerApi(app: FastifyInstance, d: ApiDeps): void {
  const caller = apiUser(d.auth, SESSION_COOKIE);
  const authed = async (req: FastifyRequest, reply: FastifyReply): Promise<boolean> => {
    if (await caller(req)) return true;
    reply.code(401).send({ error: "UNAUTHORIZED", message: "sign in or send Authorization: Bearer <api token>" });
    return false;
  };
  const run = async (reply: FastifyReply, fn: () => Promise<unknown>, code = 200) => {
    try {
      return reply.code(code).send(await fn());
    } catch (err) {
      if (err instanceof DomainError) return reply.code(err.status).send({ error: err.code, message: err.message });
      throw err;
    }
  };
  /** A bad query is the caller's to fix: 400 with zod's own words, not a 500. */
  const parse = <S extends z.ZodTypeAny>(schema: S, data: unknown, reply: FastifyReply): z.output<S> | null => {
    const r = schema.safeParse(blankless(data));
    if (r.success) return r.data;
    reply.code(400).send({ error: "BAD_REQUEST", message: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
    return null;
  };
  const notFound = (reply: FastifyReply) => reply.code(404).send({ error: "NOT_FOUND" });
  type Key = { Params: { key: string } };

  app.get("/api/v1/policies", async (req) => d.catalog.policies(req.workspaceId));
  app.get("/api/v1/products", async (req, reply) => {
    const f = parse(productsQuery, req.query, reply);
    if (!f) return;
    return d.catalog.listProducts(req.workspaceId, f);
  });
  app.get<Key>("/api/v1/products/:key", async (req, reply) => (await d.catalog.getProduct(req.workspaceId, req.params.key)) ?? notFound(reply));
  app.get<Key>("/api/v1/variants/:key", async (req, reply) => (await d.catalog.getVariant(req.workspaceId, req.params.key)) ?? notFound(reply));
  app.get("/api/v1/search", async (req, reply) => {
    const s = parse(searchSchema, req.query, reply);
    if (!s) return;
    return d.catalog.search(req.workspaceId, toSearch(s));
  });

  app.get("/api/v1/customers", async (req, reply) => {
    const f = parse(customersQuery, req.query, reply);
    if (!f) return;
    return d.orders.listCustomers(req.workspaceId, f.query);
  });
  app.get<Key>("/api/v1/customers/:key", async (req, reply) => (await d.orders.getCustomer(req.workspaceId, req.params.key)) ?? notFound(reply));

  app.get("/api/v1/orders", async (req, reply) => {
    const f = parse(ordersQuery, req.query, reply);
    if (!f) return;
    return d.orders.listOrders(req.workspaceId, toOrderFilter(f));
  });
  app.get<Key>("/api/v1/orders/:key", async (req, reply) => (await d.orders.getOrder(req.workspaceId, req.params.key)) ?? notFound(reply));
  app.post("/api/v1/orders", async (req, reply) => {
    if (!(await authed(req, reply))) return;
    const o = parse(orderSchema, req.body, reply);
    if (!o) return;
    return run(reply, () => d.orders.placeOrder(req.workspaceId, o), 201);
  });
  app.post<Key>("/api/v1/orders/:key/cancel", async (req, reply) => {
    if (!(await authed(req, reply))) return;
    return run(reply, () => d.orders.cancelOrder(req.workspaceId, req.params.key));
  });
  app.post<Key>("/api/v1/orders/:key/reorder", async (req, reply) => {
    if (!(await authed(req, reply))) return;
    const r = parse(reorderSchema, req.body, reply);
    if (!r) return;
    return run(reply, () => d.orders.reorder(req.workspaceId, req.params.key, r.addressCode), 201);
  });

  app.get("/api/v1/returns", async (req, reply) => {
    const f = parse(returnsQuery, req.query, reply);
    if (!f) return;
    return d.orders.listReturns(req.workspaceId, f);
  });
  app.post("/api/v1/returns", async (req, reply) => {
    if (!(await authed(req, reply))) return;
    const r = parse(returnSchema, req.body, reply);
    if (!r) return;
    return run(reply, () => d.orders.requestReturn(req.workspaceId, r), 201);
  });
}
