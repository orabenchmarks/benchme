/**
 * Orders: the confirmation page a paid checkout lands on, and the confirmation email.
 *
 *   GET /orders/:orderNo   "Thank you, <first name>" (greetingName: a florist's sender, never its recipient), the order
 *                          number, items, totals, delivery or shipping, "A confirmation was sent to <email>" — for this
 *                          workspace's orders at this store only. ?recovered=1 (where a step that recorded the order of a
 *                          payment whose return page never loaded sends the shopper, routes/recovered.ts): the notice
 *                          that says so above it, and a way back to the cart when the cart still holds something
 *
 * The email goes out once per order (routes/pay.ts claims it on the checkout before sending), from the
 * store's own sender (deps.mailerFor), as plain text: what was bought, what was paid, where and when it
 * goes, and how to reach the store. The page and the email show the order as its payment paid for it —
 * the items and totals of that payment's snapshot, and the processor's charge as what was paid — not the
 * checkout as it stands now.
 */
import { formatUsd, parseOrderNumber, type StoreDef } from "@benchme/storefront";
import type { FastifyInstance } from "fastify";
import type { Checkout, OrderRow } from "../db/index.js";
import { assetHref, optionsLabel, productHref } from "../render/components.js";
import { longDate, type SummaryView } from "../render/checkout-views.js";
import type { StoreCtx } from "../render/layout.js";
import { confirmationPage } from "../render/pages/confirmation.js";
import { STORE_TZ } from "../stores/index.js";
import type { RouteDeps } from "./index.js";
import { RECOVERED_NOTICE } from "./recovered.js";
import { pageCtx, sendHtml } from "./storefront.js";

/** An order's lines with their names and option labels, as the page, the summary and the email show them. */
export function orderItems(store: StoreDef, order: OrderRow): { name: string; optionsLabel: string; qty: number; totalCents: number; image: string; slug: string | null }[] {
  return order.lines.map((l, i) => {
    const p = store.products.find((x) => x.sku === l.sku);
    return { name: p?.name ?? l.sku, optionsLabel: optionsLabel(p, l), qty: l.qty, totalCents: order.totals.lines[i]?.totalCents ?? 0, image: p?.images[0] ?? "", slug: p?.slug ?? null };
  });
}

/** What the shopper paid for an order: the processor's charge (its items and totals are what that payment paid for). */
export const paidCents = (order: OrderRow): number => order.chargedCents ?? order.totals.totalCents;

/** The order date in the stores' time zone: "October 7, 2026". */
export const orderDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { timeZone: STORE_TZ, year: "numeric", month: "long", day: "numeric" });

/** The order summary sidebar of the confirmation page: the order as paid. */
export function orderSummaryView(ctx: Pick<StoreCtx, "prefix">, store: StoreDef, order: OrderRow): SummaryView {
  const method = store.shipping.find((m) => m.id === order.details.shippingId);
  return {
    items: orderItems(store, order).map((i) => ({
      name: i.name,
      optionsLabel: i.optionsLabel,
      qty: i.qty,
      totalCents: i.totalCents,
      image: i.image ? assetHref(ctx, i.image) : "",
      url: i.slug ? productHref(ctx, { slug: i.slug }) : "",
    })),
    totals: order.totals,
    promo: order.details.promo,
    promoNote: null,
    shippingLabel: method?.label ?? null,
    taxKnown: true,
    shippingWord: store.delivery ? "Delivery" : "Shipping",
    recurring: Object.fromEntries(store.addOns.flatMap((a) => (a.recurring ? [[a.sku, a.recurring]] : []))),
  };
}

/**
 * Whom the confirmation greets, by first name: at a florist the sender named in Contact (its address is the
 * recipient's, never greeted as the buyer), elsewhere the address's first name; null when there is no name.
 */
export function greetingName(store: StoreDef, checkout: Checkout | null): string | null {
  const name = store.delivery ? checkout?.contact?.name : checkout?.address?.firstName;
  return name?.trim().split(/\s+/)[0] || null;
}

/** The confirmation email: subject "Your <Brand> order <orderNo>", a plain-text receipt. */
export function confirmationEmail(store: StoreDef, order: OrderRow, checkout: Checkout | null): { to: string; subject: string; body: string } {
  const t = order.totals;
  const a = checkout?.address ?? null;
  const method = store.shipping.find((m) => m.id === order.details.shippingId);
  const word = store.delivery ? "Delivery" : "Shipping";
  const lines: string[] = [];
  const name = greetingName(store, checkout);
  lines.push(name ? `Hi ${name},` : store.delivery ? "Hello," : "Hi there,", "");
  lines.push(`Thank you for your order from ${store.brand.name}. Your payment went through and your order is confirmed.`, "");
  lines.push(`Order number: ${order.orderNo}`, `Order date: ${orderDate(order.paidAt)}`, "");
  lines.push("Items");
  for (const i of orderItems(store, order)) lines.push(`  ${i.name}${i.optionsLabel ? ` (${i.optionsLabel})` : ""} × ${i.qty}    ${formatUsd(i.totalCents)}`);
  if (t.addOns.length) {
    lines.push("", "Add-ons");
    for (const x of t.addOns) {
      const renews = store.addOns.find((y) => y.sku === x.sku)?.recurring;
      lines.push(`  ${x.name}    ${formatUsd(x.cents)}${renews ? ` per ${renews}` : ""}`);
    }
  }
  lines.push("", `Subtotal: ${formatUsd(t.subtotalCents)}`);
  if (t.discountCents > 0) lines.push(`Discount${order.details.promo ? ` (${order.details.promo})` : ""}: −${formatUsd(t.discountCents)}`);
  lines.push(`${word}${method ? ` (${method.label})` : ""}: ${t.shippingCents === 0 ? "Free" : formatUsd(t.shippingCents)}`);
  for (const f of t.fees) lines.push(`${f.label}: ${formatUsd(f.cents)}`);
  lines.push(`Sales tax: ${formatUsd(t.taxCents)}`, `Total paid: ${formatUsd(paidCents(order))}`, "");
  if (a) {
    lines.push(store.delivery ? "Delivering to" : "Shipping to", `  ${a.firstName} ${a.lastName}`, `  ${a.line1}`);
    if (a.line2) lines.push(`  ${a.line2}`);
    lines.push(`  ${a.city}, ${a.state} ${a.zip}`, "  United States", "");
  }
  const d = order.details.delivery;
  if (d) {
    lines.push(`Delivery date: ${longDate(d.date)}${d.sameDay ? " (same day)" : ""}`);
    if (method) lines.push(`Delivery method: ${method.label}`);
    if (d.message) lines.push(`Card message: "${d.message}"`);
    if (d.signature) lines.push(`Signed: ${d.signature}`);
    lines.push("");
  } else if (method) {
    const [x, y] = method.days;
    lines.push(`Shipping method: ${method.label} (${x === y ? `${x} business day${x === 1 ? "" : "s"}` : `${x}–${y} business days`})`, "");
  }
  lines.push(`Questions about your order? Reply to this email, write to ${store.brand.supportEmail} or call ${store.brand.supportPhone}.`, "");
  lines.push(store.brand.name, `${store.brand.name} is a fictional store operated for research. Orders are not fulfilled.`);
  return { to: order.email, subject: `Your ${store.brand.name} order ${order.orderNo}`, body: lines.join("\n") };
}

export function registerOrderRoutes(scope: FastifyInstance, deps: RouteDeps): void {
  scope.get<{ Params: { orderNo: string }; Querystring: { recovered?: unknown } }>("/orders/:orderNo", async (req, reply) => {
    const store = req.store;
    const no = req.params.orderNo;
    const order = store && parseOrderNumber(no) ? await deps.repos.orders.get(req.workspaceId, no) : null;
    if (!store || !order || order.store !== req.site) return reply.callNotFound();
    const checkout = await deps.repos.checkouts.get(req.workspaceId, order.checkoutToken);
    const ctx = (await pageCtx(req, deps)) as StoreCtx;
    const recovered = req.query.recovered === "1" ? { message: RECOVERED_NOTICE, cartHasItems: ctx.cartCount > 0 } : null;
    return sendHtml(reply, confirmationPage(ctx, { order, checkout, summary: orderSummaryView(ctx, store, order), greeting: greetingName(store, checkout), recovered }));
  });
}
