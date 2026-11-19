import { addDays } from "../../stays.js";
import type { SportAddress, SportCategory, SportCustomer, SportOrder, SportOrderLine, SportProduct, SportReturn, SportShippingPolicy, SportVariant } from "./types.js";

/**
 * The sports site's rules, as pure functions over rows. apps/sports enforces
 * them inside every write's transaction and answers every search with them,
 * and the intent corpus derives its answer keys with them, so the site and the
 * keys cannot disagree about what can be ordered, cancelled or returned.
 */

/**
 * The site's calendar date. Fixed, never the real today, so a seed means the
 * same orders forever: an order placed through the site is dated this day, and
 * a return is accepted while this day is within the line's return window.
 */
export const SPORTS_TODAY = "2027-06-15";
/** Seeded orders are placed from this day up to SPORTS_TODAY. */
export const SPORTS_HISTORY_FROM = "2027-01-04";
export const SPORTS_MAX_QTY = 10;
export const SPORTS_MAX_LINES = 8;
export const SPORTS_RETURN_REASONS = ["too small", "too large", "defective", "not as described", "no longer needed"] as const;

export type SportsProblem = { code: string; message: string };
export type SportsLineRequest = { sku: string; qty: number };
export type SportsOrderRequest = { customerEmail: string; addressCode: string; lines: SportsLineRequest[] };
export type SportsReturnRequest = { orderNo: string; sku: string; qty: number; reason: string };
export type SportsSearch = { query?: string; category?: string; size?: string; colour?: string; maxPriceCents?: number; maxWeightGrams?: number; inStock?: boolean };
/** One variant a search found, with its product's name, brand and category. */
export type SportsOffer = { sku: string; productCode: string; productName: string; brand: string; category: string; size: string; colour: string; weightGrams: number; priceCents: number; stock: number };
export type SportsTotals = { subtotalCents: number; shippingCents: number; totalCents: number };

const norm = (s: string) => s.trim().toLowerCase();
const qtyOk = (n: number) => Number.isInteger(n) && n >= 1 && n <= SPORTS_MAX_QTY;

/** The fee, or nothing once the subtotal reaches the free-shipping threshold. An empty order ships nothing. */
export function sportsShippingCents(policy: SportShippingPolicy, subtotalCents: number): number {
  return subtotalCents === 0 || subtotalCents >= policy.freeFromCents ? 0 : policy.feeCents;
}

export function sportsOrderTotals(policy: SportShippingPolicy, lines: readonly { qty: number; unitPriceCents: number }[]): SportsTotals {
  const subtotalCents = lines.reduce((sum, l) => sum + l.qty * l.unitPriceCents, 0);
  const shippingCents = sportsShippingCents(policy, subtotalCents);
  return { subtotalCents, shippingCents, totalCents: subtotalCents + shippingCents };
}

/**
 * Variants matching every given filter, cheapest first (then by SKU). `query`
 * words must all appear in the product's name, brand, category or material;
 * category, size and colour match whole values, ignoring case; `inStock` keeps
 * only variants with at least one unit free.
 */
export function searchSportsVariants(rows: { products: readonly SportProduct[]; variants: readonly SportVariant[] }, q: SportsSearch): SportsOffer[] {
  const product = new Map(rows.products.map((p) => [p.code, p]));
  const words = norm(q.query ?? "").split(/\s+/).filter(Boolean);
  const out: SportsOffer[] = [];
  for (const v of rows.variants) {
    const p = product.get(v.productCode);
    if (!p) continue;
    if (q.category && norm(q.category) !== p.category) continue;
    if (q.size && norm(q.size) !== norm(v.size)) continue;
    if (q.colour && norm(q.colour) !== norm(v.colour)) continue;
    if (q.maxPriceCents !== undefined && v.priceCents > q.maxPriceCents) continue;
    if (q.maxWeightGrams !== undefined && v.weightGrams > q.maxWeightGrams) continue;
    if (q.inStock && v.stock < 1) continue;
    const text = norm(`${p.name} ${p.brand} ${p.category} ${p.material}`);
    if (!words.every((w) => text.includes(w))) continue;
    out.push({ sku: v.sku, productCode: p.code, productName: p.name, brand: p.brand, category: p.category, size: v.size, colour: v.colour, weightGrams: v.weightGrams, priceCents: v.priceCents, stock: v.stock });
  }
  return out.sort((x, y) => x.priceCents - y.priceCents || x.sku.localeCompare(y.sku));
}

/**
 * Why an order cannot be placed: the customer, the address (one of THEIR saved
 * addresses), the lines (1–8 distinct known SKUs, 1–10 of each), then stock —
 * every line must have its quantity free. The rule every order write is held to.
 */
export function sportsOrderProblem(
  req: SportsOrderRequest,
  ctx: { customer: SportCustomer | null; address: SportAddress | null; variant: (sku: string) => SportVariant | undefined },
): SportsProblem | null {
  if (!ctx.customer) return { code: "UNKNOWN_CUSTOMER", message: `no customer account ${req.customerEmail}` };
  if (!ctx.address || ctx.address.customerEmail !== ctx.customer.email) return { code: "NOT_THEIR_ADDRESS", message: `${req.addressCode} is not one of ${ctx.customer.email}'s saved addresses` };
  if (req.lines.length === 0) return { code: "NO_LINES", message: "an order needs at least one line" };
  if (req.lines.length > SPORTS_MAX_LINES) return { code: "TOO_MANY_LINES", message: `an order has at most ${SPORTS_MAX_LINES} lines` };
  const seen = new Set<string>();
  for (const l of req.lines) {
    if (!qtyOk(l.qty)) return { code: "BAD_QTY", message: `a line orders 1 to ${SPORTS_MAX_QTY} units, not ${l.qty}` };
    if (seen.has(l.sku)) return { code: "DUPLICATE_SKU", message: `${l.sku} is on the order twice; order it once with the total quantity` };
    seen.add(l.sku);
    if (!ctx.variant(l.sku)) return { code: "UNKNOWN_SKU", message: `no variant ${l.sku}` };
  }
  for (const l of req.lines) {
    const v = ctx.variant(l.sku) as SportVariant;
    if (v.stock < l.qty) return { code: "OUT_OF_STOCK", message: v.stock === 0 ? `${l.sku} is out of stock` : `only ${v.stock} of ${l.sku} in stock, ${l.qty} asked` };
  }
  return null;
}

/** Only an order still processing (not shipped) can be cancelled. */
export function sportsCancelProblem(order: SportOrder): SportsProblem | null {
  if (order.status === "cancelled") return { code: "ALREADY_CANCELLED", message: `order ${order.orderNo} is already cancelled` };
  if (order.status !== "processing") return { code: "NOT_CANCELLABLE", message: `order ${order.orderNo} is ${order.status}; only an order that is still processing can be cancelled` };
  return null;
}

/** The last day a line can be returned: its order's delivery date plus its category's window. */
export function sportsReturnDeadline(deliveredOn: string, returnWindowDays: number): string {
  return addDays(deliveredOn, returnWindowDays);
}

export function sportsReturnedQty(returns: readonly SportReturn[], orderNo: string, sku: string): number {
  return returns.filter((r) => r.orderNo === orderNo && r.sku === sku).reduce((sum, r) => sum + r.qty, 0);
}

/**
 * Why a return cannot be requested: the order and line, the quantity and
 * reason, that the order was delivered, that `today` is no later than the
 * line's last return day, and that the quantity is at most what was bought
 * minus what was already returned.
 */
export function sportsReturnProblem(
  req: SportsReturnRequest,
  ctx: { order: SportOrder | null; line: SportOrderLine | null; category: SportCategory | null; returns: readonly SportReturn[]; today?: string },
): SportsProblem | null {
  const { order, line } = ctx;
  if (!order) return { code: "UNKNOWN_ORDER", message: `no order ${req.orderNo}` };
  if (!line || !ctx.category) return { code: "NOT_IN_ORDER", message: `order ${order.orderNo} has no line for ${req.sku}` };
  if (!qtyOk(req.qty)) return { code: "BAD_QTY", message: `a return is 1 to ${SPORTS_MAX_QTY} units, not ${req.qty}` };
  if (!(SPORTS_RETURN_REASONS as readonly string[]).includes(req.reason)) return { code: "BAD_REASON", message: `the reason must be one of: ${SPORTS_RETURN_REASONS.join(", ")}` };
  if (order.status !== "delivered" || !order.deliveredOn) return { code: "NOT_DELIVERED", message: `order ${order.orderNo} is ${order.status}; only a delivered order can be returned` };
  const lastDay = sportsReturnDeadline(order.deliveredOn, ctx.category.returnWindowDays);
  if ((ctx.today ?? SPORTS_TODAY) > lastDay) return { code: "RETURN_WINDOW_CLOSED", message: `${ctx.category.name} items can be returned for ${ctx.category.returnWindowDays} days after delivery; the last day for order ${order.orderNo} was ${lastDay}` };
  const left = line.qty - sportsReturnedQty(ctx.returns, order.orderNo, line.sku);
  if (req.qty > left) return { code: "RETURN_QTY", message: `${left} of ${line.sku} from order ${order.orderNo} can still be returned (bought ${line.qty})` };
  return null;
}

/** What a reorder asks for: the same SKUs and quantities, to the same address unless another is given. */
export function sportsReorderRequest(order: SportOrder, lines: readonly SportOrderLine[], addressCode?: string): SportsOrderRequest {
  return { customerEmail: order.customerEmail, addressCode: addressCode ?? order.addressCode, lines: lines.filter((l) => l.orderNo === order.orderNo).map((l) => ({ sku: l.sku, qty: l.qty })) };
}
