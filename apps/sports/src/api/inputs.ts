import { isDate, type SportsSearch } from "@benchme/scenarios";
import { z } from "zod";

/**
 * The input shapes REST, MCP and the pages share, so every door accepts the
 * same thing. Money a person types is dollars (`maxPrice`); money the site
 * returns is cents (`priceCents`, `totalCents`). Weight is grams. Shapes are
 * checked here (400); quantities, reasons, stock and windows are the rules'
 * to refuse (404 / 409 / 422).
 */
export const date = z.string().refine(isDate, "a date as YYYY-MM-DD");
/** A checkbox, a query string or JSON: "true", "1", "on" or true. */
export const flag = z.union([z.boolean(), z.enum(["true", "false", "1", "0", "on", "off"])]).transform((v) => v === true || v === "true" || v === "1" || v === "on");
export const STATUSES = ["processing", "shipped", "delivered", "cancelled"] as const;

export const searchInput = {
  query: z.string().optional(),
  category: z.string().optional(),
  size: z.string().optional(),
  colour: z.string().optional(),
  maxPrice: z.coerce.number().positive().optional(),
  maxWeight: z.coerce.number().int().positive().optional(),
  inStock: flag.optional(),
};
export const searchSchema = z.object(searchInput);
export type SearchInput = z.infer<typeof searchSchema>;

/** A search's dollar cap as the cents the rows carry; blank filters dropped. */
export const toSearch = (s: SearchInput): SportsSearch => ({
  ...(s.query?.trim() ? { query: s.query } : {}),
  ...(s.category?.trim() ? { category: s.category } : {}),
  ...(s.size?.trim() ? { size: s.size } : {}),
  ...(s.colour?.trim() ? { colour: s.colour } : {}),
  ...(s.maxPrice !== undefined ? { maxPriceCents: Math.round(s.maxPrice * 100) } : {}),
  ...(s.maxWeight !== undefined ? { maxWeightGrams: s.maxWeight } : {}),
  ...(s.inStock ? { inStock: true } : {}),
});

export const lineInput = z.object({ sku: z.string().min(1), qty: z.coerce.number().int() });
export const orderSchema = z.object({ customerEmail: z.string().email(), addressCode: z.string().min(1), lines: z.array(lineInput).max(50) });
export const reorderSchema = z.object({ addressCode: z.string().min(1).optional() });
export const returnSchema = z.object({ orderNo: z.string().min(1), sku: z.string().min(1), qty: z.coerce.number().int(), reason: z.string().min(1) });
export const ordersQuery = z.object({
  customerEmail: z.string().optional(),
  status: z.enum(STATUSES).optional(),
  placedFrom: date.optional(),
  placedTo: date.optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type OrdersQuery = z.infer<typeof ordersQuery>;
/** The repo filter: blank fields dropped. */
export const toOrderFilter = (f: OrdersQuery) => ({
  ...(f.customerEmail?.trim() ? { customerEmail: f.customerEmail } : {}),
  ...(f.status ? { status: f.status } : {}),
  ...(f.placedFrom ? { placedFrom: f.placedFrom } : {}),
  ...(f.placedTo ? { placedTo: f.placedTo } : {}),
  ...(f.cursor ? { cursor: f.cursor } : {}),
  limit: f.limit,
});
