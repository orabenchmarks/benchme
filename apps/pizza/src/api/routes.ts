import { DomainError } from "@benchme/site-kit";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { PizzaRepo } from "../db/pizza-repo.js";
import { changeSchema, fromSearchQuery, orderSchema, ordersQuery, quoteSchema, searchQuery, slotsQuery } from "./inputs.js";

export type ApiDeps = { pizza: PizzaRepo };

const branchesQuery = z.object({ city: z.string().optional() });
const lineParam = z.coerce.number().int().min(1);

/** REST under /api/v1. Reads (a quote included) are open inside the workspace; placing, changing and cancelling an order need a bearer token or a session: the site's rules ask it of every write, through every door (site-kit's `ledgered`), so no route here does. */
export function registerApi(app: FastifyInstance, d: ApiDeps): void {
  const run = async (reply: FastifyReply, fn: () => Promise<unknown>, code = 200) => {
    try {
      return reply.code(code).send(await fn());
    } catch (err) {
      if (err instanceof DomainError) return reply.code(err.status).send({ error: err.code, message: err.message });
      throw err;
    }
  };
  /** A bad query or body is the caller's to fix: 400 with zod's own words, not a 500. */
  const parse = <S extends z.ZodTypeAny>(schema: S, data: unknown, reply: FastifyReply): z.output<S> | null => {
    const r = schema.safeParse(data);
    if (r.success) return r.data;
    reply.code(400).send({ error: "BAD_REQUEST", message: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
    return null;
  };
  const notFound = (reply: FastifyReply) => reply.code(404).send({ error: "NOT_FOUND" });

  app.get("/api/v1/builder", async (req) => d.pizza.builder(req.workspaceId));
  app.get("/api/v1/branches", async (req, reply) => {
    const f = parse(branchesQuery, req.query, reply);
    if (!f) return;
    return d.pizza.branches(req.workspaceId, f.city);
  });
  app.get<{ Params: { code: string } }>("/api/v1/branches/:code", async (req, reply) => (await d.pizza.branch(req.workspaceId, req.params.code)) ?? notFound(reply));
  app.get<{ Params: { code: string } }>("/api/v1/branches/:code/slots", async (req, reply) => {
    const q = parse(slotsQuery, req.query, reply);
    if (!q) return;
    return run(reply, () => d.pizza.slots(req.workspaceId, { branchCode: req.params.code, date: q.date, ...(q.pizzas ? { pizzas: q.pizzas } : {}), ...(q.from ? { from: q.from } : {}) }));
  });
  app.get("/api/v1/pizzas", async (req) => d.pizza.menu(req.workspaceId));
  app.get<{ Params: { code: string } }>("/api/v1/pizzas/:code", async (req, reply) => (await d.pizza.pizza(req.workspaceId, req.params.code)) ?? notFound(reply));
  app.get("/api/v1/search", async (req, reply) => {
    const s = parse(searchQuery, req.query, reply);
    if (!s) return;
    return d.pizza.search(req.workspaceId, fromSearchQuery(s));
  });
  app.post("/api/v1/quote", async (req, reply) => {
    const b = parse(quoteSchema, req.body, reply);
    if (!b) return;
    return run(reply, () => d.pizza.quote(req.workspaceId, b));
  });
  app.get("/api/v1/orders", async (req, reply) => {
    const f = parse(ordersQuery, req.query, reply);
    if (!f) return;
    return d.pizza.listOrders(req.workspaceId, {
      ...(f.customerEmail ? { customerEmail: f.customerEmail } : {}), ...(f.branch ? { branch: f.branch } : {}), ...(f.status ? { status: f.status } : {}),
      ...(f.date ? { date: f.date } : {}), ...(f.cursor ? { cursor: f.cursor } : {}), limit: f.limit,
    });
  });
  app.get<{ Params: { no: string } }>("/api/v1/orders/:no", async (req, reply) => (await d.pizza.getOrder(req.workspaceId, req.params.no)) ?? notFound(reply));
  app.post("/api/v1/orders", async (req, reply) => {
    const b = parse(orderSchema, req.body, reply);
    if (!b) return;
    return run(reply, () => d.pizza.placeOrder(req.workspaceId, b), 201);
  });
  app.post<{ Params: { no: string; line: string } }>("/api/v1/orders/:no/lines/:line", async (req, reply) => {
    const line = parse(lineParam, req.params.line, reply);
    if (line === null) return;
    const change = parse(changeSchema, req.body ?? {}, reply);
    if (!change) return;
    return run(reply, () => d.pizza.changeLine(req.workspaceId, req.params.no, line, change));
  });
  app.post<{ Params: { no: string } }>("/api/v1/orders/:no/cancel", async (req, reply) => {
    return run(reply, () => d.pizza.cancelOrder(req.workspaceId, req.params.no));
  });
}
