import type { CartLine, StoreDef } from "./catalog.js";
import { lineKey, unitPrice } from "./cart.js";
import { applyBp, sumCents } from "./money.js";
import { taxCents } from "./tax.js";

export type PricingInput = {
  store: StoreDef;
  lines: CartLine[];
  addOns: readonly string[];
  shippingId: string | null;
  state: string | null;
  promo: string | null;
  deliveryDate?: string | null;
  sameDay?: boolean;
  extraFees?: { label: string; cents: number }[];
  shippingDeltaCents?: number;
};

export type Totals = {
  lines: { key: string; name: string; qty: number; unitCents: number; totalCents: number }[];
  subtotalCents: number;
  addOns: { sku: string; name: string; cents: number }[];
  discountCents: number;
  shippingCents: number;
  fees: { label: string; cents: number }[];
  taxCents: number;
  totalCents: number;
};

/**
 * The one total every surface shows and charges: merchandise − discount + add-ons + fees
 * (taxed), plus shipping (untaxed), plus tax.
 */
export function computeTotals(i: PricingInput): Totals {
  const lines = i.lines.map((l) => {
    const p = i.store.products.find((x) => x.sku === l.sku);
    const unit = unitPrice(i.store, l);
    return { key: lineKey(l), name: p?.name ?? l.sku, qty: l.qty, unitCents: unit, totalCents: unit * l.qty };
  });
  const subtotalCents = sumCents(lines.map((l) => l.totalCents));
  const addOns = i.addOns.flatMap((sku) => {
    const a = i.store.addOns.find((x) => x.sku === sku);
    return a ? [{ sku: a.sku, name: a.name, cents: a.priceCents }] : [];
  });
  const promo = i.promo ? i.store.promoCodes[i.promo.trim().toUpperCase()] : undefined;
  const discountCents = promo && subtotalCents >= (promo.minSubtotalCents ?? 0) ? Math.min(subtotalCents, (promo.offCents ?? 0) + applyBp(subtotalCents, promo.pctBp ?? 0)) : 0;
  const method = i.store.shipping.find((s) => s.id === i.shippingId);
  const free = method?.freeOverCents !== undefined && subtotalCents >= method.freeOverCents;
  const shippingCents = (method ? (free ? 0 : method.priceCents) : 0) + (i.shippingDeltaCents ?? 0);
  const fees = [...(i.sameDay && i.store.delivery ? [{ label: "Same-day delivery", cents: i.store.delivery.sameDayFeeCents }] : []), ...(i.extraFees ?? [])];
  const taxable = subtotalCents - discountCents + sumCents(addOns.map((a) => a.cents)) + sumCents(fees.map((f) => f.cents));
  const tax = i.state ? taxCents(Math.max(taxable, 0), i.state) : 0;
  const totalCents = Math.max(taxable, 0) + shippingCents + tax;
  return { lines, subtotalCents, addOns, discountCents, shippingCents, fees, taxCents: tax, totalCents };
}
