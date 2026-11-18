import { PIZZA_ALLERGENS, PIZZA_STATUSES, isDate, type PizzaAllergen, type PizzaMenuQuery, type PizzaOrderStatus } from "@benchme/scenarios";
import { z } from "zod";

/**
 * The input shapes REST, MCP and the pages share, so every door accepts the
 * same thing. Money a person types is dollars (`maxPrice`); money the site
 * returns is cents (`priceCents`, `totalCents`). The shapes only check form;
 * what the chain can make, and when, is the rules' to refuse (422 / 409).
 */
export const date = z.string().refine(isDate, "a date as YYYY-MM-DD");
export const time = z.string().regex(/^\d{2}:\d{2}$/, "a time as HH:MM");
// Fresh schema instances per field: a shared one becomes a "$ref" in the tools' JSON Schema, which some agent clients cannot follow.
const key = () => z.string().trim().min(1);
const keys = () => z.array(z.string()).max(20);
/** "a,b", ["a", "b"] or one repeated query param — whichever the door sends. */
export const keyList = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => (v === undefined ? [] : (Array.isArray(v) ? v : v.split(",")).map((a) => a.trim().toLowerCase()).filter(Boolean)));
const allergenList = keyList.refine((v) => v.every((a) => (PIZZA_ALLERGENS as readonly string[]).includes(a)), `allergens are ${PIZZA_ALLERGENS.join(", ")}`);
const flag = z.enum(["true", "false"]).optional();
export const statusEnum = z.enum(PIZZA_STATUSES as unknown as [PizzaOrderStatus, ...PizzaOrderStatus[]]);
const quantity = () => z.coerce.number().int().min(1).max(99);

export const lineInput = {
  pizzaCode: key().optional().describe("a menu pizza (PZ-…) to start from; leave out to build from scratch"),
  size: key().describe("small | medium | large | xlarge"),
  crust: key().optional(),
  sauce: key().optional(),
  cheese: key().optional(),
  toppings: keys().optional().describe("topping keys; replaces the menu pizza's toppings when given"),
  quantity: quantity().default(1),
};
export const lineSchema = z.object(lineInput);

export const quoteInput = {
  branchCode: key(),
  fulfilment: z.enum(["pickup", "delivery"]).default("pickup"),
  lines: z.array(lineSchema).min(1).max(20),
};
export const quoteSchema = z.object(quoteInput);

export const orderInput = {
  ...quoteInput,
  address: z.string().optional().describe("the delivery address; needed for delivery"),
  slotDate: date,
  slotTime: time.describe("a slot start, HH:MM, 12:00 to 21:30 every 30 minutes"),
  customerName: z.string().min(1),
  customerEmail: z.string().email(),
};
export const orderSchema = z.object(orderInput);

export const changeInput = {
  size: key().optional(),
  crust: key().optional(),
  sauce: key().optional(),
  cheese: key().optional(),
  toppings: keys().optional().describe("the line's whole topping set, replacing what it has"),
  addToppings: keys().optional(),
  removeToppings: keys().optional(),
  quantity: quantity().optional(),
};
export const changeSchema = z.object(changeInput);

export const searchQuery = z.object({
  size: key(),
  branch: z.string().optional(),
  vegetarian: flag,
  vegan: flag,
  without: allergenList,
  maxPrice: z.coerce.number().positive().optional(),
  toppings: keyList,
});
export type SearchQuery = z.infer<typeof searchQuery>;

/** A search's flags and dollar cap as the rules take them. */
export const toMenuQuery = (s: { size: string; branch?: string | undefined; vegetarian?: boolean | undefined; vegan?: boolean | undefined; without?: string[]; maxPrice?: number | undefined; toppings?: string[] }): PizzaMenuQuery => ({
  size: s.size,
  ...(s.branch ? { branchCode: s.branch } : {}),
  ...(s.vegetarian ? { vegetarian: true } : {}),
  ...(s.vegan ? { vegan: true } : {}),
  without: (s.without ?? []) as PizzaAllergen[],
  toppings: s.toppings ?? [],
  ...(s.maxPrice !== undefined ? { maxPriceCents: Math.round(s.maxPrice * 100) } : {}),
});
export const fromSearchQuery = (s: SearchQuery) => toMenuQuery({ ...s, vegetarian: s.vegetarian === "true", vegan: s.vegan === "true" });

export const slotsQuery = z.object({ date, pizzas: z.coerce.number().int().min(1).max(99).optional(), from: time.optional() });
export const ordersQuery = z.object({
  customerEmail: z.string().optional(),
  branch: z.string().optional(),
  status: statusEnum.optional(),
  date: date.optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
