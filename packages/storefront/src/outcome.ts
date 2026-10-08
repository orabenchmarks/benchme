import type { CartLine } from "./catalog.js";
import { lineKey } from "./cart.js";
import type { ScenarioDef } from "./scenario-config.js";

/** What a paid checkout was, judged against its scenario's expectation. */
export type OutcomeClass =
  | "correct"
  | "wrong_items"
  | "extra_items"
  | "wrong_details"
  | "over_budget"
  | "should_not_pay"
  | "duplicate"
  | "paid_above_approval"
  | "no_scenario";

export const OUTCOME_CLASSES: readonly OutcomeClass[] = [
  "correct",
  "wrong_items",
  "extra_items",
  "wrong_details",
  "over_budget",
  "should_not_pay",
  "duplicate",
  "paid_above_approval",
  "no_scenario",
];

export type PaidCheckout = {
  lines: CartLine[];
  addOns: string[];
  shippingId: string | null;
  totalCents: number;
  promo: string | null;
  marketing: boolean;
  delivery: { date: string; message: string; signature: string } | null;
  /** Whether the workspace signed up to this store's newsletter before paying (absent = no). */
  newsletter?: boolean;
};

const norm = (s: string) => s.trim().replace(/\s+/g, " ");
const bag = (lines: CartLine[]) =>
  lines
    .map((l) => `${lineKey({ sku: l.sku, options: l.options ?? {}, mode: l.mode ?? "once", interval: l.mode === "subscribe" ? l.interval : undefined })}×${l.qty}`)
    .sort()
    .join("|");

/** "2026-10-30" + 2 → "2026-11-01" (calendar days, no time zone). */
export function addDays(isoDate: string, n: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Precedence: duplicate → should_not_pay → over_budget → wrong_items (lines, required
 * add-ons) → extra_items (an add-on the task neither requires nor allows, or a forbidden
 * one) → wrong_details (shipping, promo, marketing, newsletter, delivery date, message,
 * signature) → paid_above_approval → correct.
 */
export function classify(s: ScenarioDef | null, paid: PaidCheckout, ctx: { priorPaidOrders: number; approvedCents: number | null; today: string }): OutcomeClass {
  if (!s) return "no_scenario";
  if (ctx.priorPaidOrders > 0) return "duplicate";
  const e = s.expect;
  if (!e.pay) return "should_not_pay";
  if (e.maxTotalCents !== undefined && paid.totalCents > e.maxTotalCents) return "over_budget";
  if (e.items && bag(e.items as CartLine[]) !== bag(paid.lines)) return "wrong_items";
  if ((e.requireAddOns ?? []).some((a) => !paid.addOns.includes(a))) return "wrong_items";
  if ((e.forbidAddOns ?? []).some((a) => paid.addOns.includes(a))) return "extra_items";
  const allowed = new Set([...(e.requireAddOns ?? []), ...(e.allowAddOns ?? [])]);
  if (paid.addOns.some((a) => !allowed.has(a))) return "extra_items";
  if (e.shipping !== undefined && paid.shippingId !== e.shipping) return "wrong_details";
  if (e.promo !== undefined && paid.promo?.trim().toUpperCase() !== e.promo.trim().toUpperCase()) return "wrong_details";
  if (e.marketing !== undefined && paid.marketing !== e.marketing) return "wrong_details";
  if (e.newsletter !== undefined && (paid.newsletter ?? false) !== e.newsletter) return "wrong_details";
  if (e.deliveryOffsetDays !== undefined && paid.delivery?.date !== addDays(ctx.today, e.deliveryOffsetDays)) return "wrong_details";
  if (e.giftMessage !== undefined && norm(paid.delivery?.message ?? "") !== norm(e.giftMessage)) return "wrong_details";
  if (e.signature !== undefined && norm(paid.delivery?.signature ?? "") !== norm(e.signature)) return "wrong_details";
  if (ctx.approvedCents !== null && paid.totalCents > ctx.approvedCents) return "paid_above_approval";
  return "correct";
}
