import { DomainError, type ShellCtx } from "@benchme/site-kit";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { changeSchema, orderSchema } from "../api/inputs.js";
import type { PizzaRepo } from "../db/pizza-repo.js";
import { buildValues, many, one, orderBodyOf, type Form } from "./build-model.js";

export type Page = { status: number; body: string };
export type OrderWriteDeps = {
  pizza: PizzaRepo;
  requireUser: (req: FastifyRequest, reply: FastifyReply) => Promise<ShellCtx | null>;
  html: (reply: FastifyReply, body: string, code?: number) => FastifyReply;
  buildPage: (req: FastifyRequest, f: Form, flash?: string) => Promise<Page>;
  orderPage: (req: FastifyRequest, no: string, flash?: string) => Promise<Page>;
};

const fieldsOf = (issues: { path: (string | number)[] }[]) => [...new Set(issues.map((i) => i.path.filter((x) => typeof x === "string").at(-1) ?? ""))].filter(Boolean).join(", ");

/** The page writes: place an order from the builder, change one of its lines, cancel it. A refusal re-renders the page it came from with the reason. */
export function registerOrderWrites(app: FastifyInstance, d: OrderWriteDeps): void {
  const show = (reply: FastifyReply, page: Page, status = page.status) => d.html(reply, page.body, page.status === 200 ? status : page.status);

  app.post("/orders", async (req, reply) => {
    if (!(await d.requireUser(req, reply))) return;
    const f = (req.body ?? {}) as Form;
    const code = one(f.pizzaCode);
    const pizza = code ? await d.pizza.pizza(req.workspaceId, code) : null;
    const parsed = orderSchema.safeParse(orderBodyOf(buildValues(f, pizza)));
    if (!parsed.success) return show(reply, await d.buildPage(req, f, `Check the order: ${fieldsOf(parsed.error.issues)}`), 400);
    try {
      const o = await d.pizza.placeOrder(req.workspaceId, parsed.data);
      return reply.redirect(`${req.prefix}/orders/${o.orderNo}`, 303);
    } catch (err) {
      if (!(err instanceof DomainError)) throw err;
      return show(reply, await d.buildPage(req, f, err.message), err.status);
    }
  });

  app.post<{ Params: { no: string; line: string } }>("/orders/:no/lines/:line", async (req, reply) => {
    if (!(await d.requireUser(req, reply))) return;
    const f = (req.body ?? {}) as Form;
    const parsed = changeSchema.safeParse({ size: one(f.size), crust: one(f.crust), sauce: one(f.sauce), cheese: one(f.cheese), toppings: many(f.toppings), quantity: one(f.quantity) });
    const line = Number(req.params.line);
    if (!parsed.success || !Number.isInteger(line)) return show(reply, await d.orderPage(req, req.params.no, `Check the change: ${parsed.success ? "line" : fieldsOf(parsed.error.issues)}`), 400);
    try {
      await d.pizza.changeLine(req.workspaceId, req.params.no, line, parsed.data);
      return reply.redirect(`${req.prefix}/orders/${req.params.no}`, 303);
    } catch (err) {
      if (!(err instanceof DomainError)) throw err;
      return show(reply, await d.orderPage(req, req.params.no, err.message), err.status);
    }
  });

  app.post<{ Params: { no: string } }>("/orders/:no/cancel", async (req, reply) => {
    if (!(await d.requireUser(req, reply))) return;
    try {
      await d.pizza.cancelOrder(req.workspaceId, req.params.no);
      return reply.redirect(`${req.prefix}/orders/${req.params.no}`, 303);
    } catch (err) {
      if (!(err instanceof DomainError)) throw err;
      return show(reply, await d.orderPage(req, req.params.no, err.message), err.status);
    }
  });
}
