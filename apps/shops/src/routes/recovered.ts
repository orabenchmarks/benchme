/**
 * A payment that went through without its return page loading (a tab closed after the card form confirmed, a hosted
 * page never left) is recorded as its order by the next step the shopper takes (routes/pay.ts, the reconcile step).
 * That shopper must see the order — never a cart silently emptied of what it paid for:
 *
 * - a page or a form post is redirected to the order's confirmation, which says what happened (?recovered=1);
 * - a script's answer (JSON) carries the order instead: `recovered` { orderNo, message, url } — and, from a step that
 *   would start a payment, as a 409 { error: "RECOVERED", message, orderNo, redirect } that pay.js follows; the cart
 *   drawer shows the notice with a link to the order.
 */
import type { FastifyRequest } from "fastify";

/** What the shopper is told, on the order's confirmation and in the cart drawer. */
export const RECOVERED_NOTICE = "Your earlier payment went through — here is your order.";

/** The query of a confirmation reached that way. */
export const RECOVERED_QUERY = "recovered=1";

/** Such an order as an answer carries it: its number, the notice, and its confirmation page (which shows the notice). */
export type Recovered = { orderNo: string; message: string; url: string };

export function recoveredOrder(prefix: string, orderNo: string): Recovered {
  return { orderNo, message: RECOVERED_NOTICE, url: `${prefix}/orders/${encodeURIComponent(orderNo)}?${RECOVERED_QUERY}` };
}

const noted = new WeakMap<FastifyRequest, Recovered>();

/** The reconcile step hands the order it recorded to the route that answers with it (the drawer's cart.json). */
export function noteRecovered(req: FastifyRequest, r: Recovered): void {
  noted.set(req, r);
}

/** The order this request's reconcile step recorded and its answer must carry, or null. */
export function recoveredFor(req: FastifyRequest): Recovered | null {
  return noted.get(req) ?? null;
}
