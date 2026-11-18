import { pizzaConfigProblem, pizzaDiet, pizzaUnitCents, type PizzaConfig } from "@benchme/scenarios";
import { DomainError } from "@benchme/site-kit";
import type { MenuView, PizzaRepo } from "../db/pizza-repo.js";
import type { BuildPrice, BuildValues } from "./pages/build.js";

/** A query string or form body as Fastify parses it: a repeated field is an array. */
export type Form = Record<string, string | string[] | undefined>;
export const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
export const many = (v: string | string[] | undefined) => (v === undefined ? [] : (Array.isArray(v) ? v : v.split(","))).map((x) => x.trim().toLowerCase()).filter(Boolean);

/**
 * The builder form's values: what was sent, else the menu pizza's options,
 * else a pizza from scratch. Once the form has been sent (`edited`), an
 * unticked topping box means no topping, not the menu pizza's.
 */
export function buildValues(f: Form, pizza: MenuView | null): BuildValues {
  const sent = one(f.edited) === "1" || f.toppings !== undefined;
  return {
    pizzaCode: pizza?.code ?? "",
    size: one(f.size) || "medium",
    crust: one(f.crust) || pizza?.crust || "classic",
    sauce: one(f.sauce) || pizza?.sauce || "tomato",
    cheese: one(f.cheese) || pizza?.cheese || "regular",
    toppings: sent ? many(f.toppings) : (pizza?.toppings ?? []),
    quantity: one(f.quantity) || "1",
    branchCode: one(f.branchCode) ?? "",
    fulfilment: one(f.fulfilment) || "pickup",
    address: one(f.address) ?? "",
    slotDate: one(f.slotDate) ?? "",
    slotTime: one(f.slotTime) || "18:00",
    customerName: one(f.customerName) ?? "",
    customerEmail: one(f.customerEmail) ?? "",
  };
}

export const configOf = (v: BuildValues): PizzaConfig => ({ size: v.size, crust: v.crust, sauce: v.sauce, cheese: v.cheese, toppings: [...v.toppings].sort() });
export const lineOf = (v: BuildValues) => ({ ...(v.pizzaCode ? { pizzaCode: v.pizzaCode } : {}), ...configOf(v), quantity: Number(v.quantity) });
/** The one-line order the builder form places. */
export const orderBodyOf = (v: BuildValues) => ({
  branchCode: v.branchCode, fulfilment: v.fulfilment, ...(v.address.trim() ? { address: v.address } : {}), slotDate: v.slotDate, slotTime: v.slotTime,
  customerName: v.customerName, customerEmail: v.customerEmail, lines: [lineOf(v)],
});

/** The price box: the site's own quote at the chosen branch, or one pizza's price before a branch is chosen. */
export async function priceOf(repo: PizzaRepo, ws: string, v: BuildValues): Promise<BuildPrice> {
  const b = await repo.builder(ws);
  const config = configOf(v);
  const problem = pizzaConfigProblem(b, config);
  if (problem) return { problem: problem.message };
  const diet = pizzaDiet(b, config);
  if (!v.branchCode) return { unitCents: pizzaUnitCents(b, config), diet };
  try {
    const quantity = Number(v.quantity) >= 1 ? Number(v.quantity) : 1;
    return { quote: await repo.quote(ws, { branchCode: v.branchCode, fulfilment: v.fulfilment === "delivery" ? "delivery" : "pickup", lines: [{ ...lineOf(v), quantity }] }), diet };
  } catch (err) {
    if (err instanceof DomainError) return { problem: err.message };
    throw err;
  }
}
