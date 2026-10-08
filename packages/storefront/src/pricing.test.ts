import { describe, expect, it } from "vitest";
import { computeTotals } from "./pricing.js";
import { demoStore } from "./test-store.js";

const base = { store: demoStore, addOns: [], shippingId: "standard", state: "CA", promo: null } as const;

describe("computeTotals", () => {
  it("adds shipping, then taxes merchandise + add-ons + fees", () => {
    const t = computeTotals({ ...base, lines: [{ sku: "B1", options: { size: "m" }, qty: 1 }] });
    expect(t.subtotalCents).toBe(6499);
    expect(t.shippingCents).toBe(999);
    expect(t.taxCents).toBe(471); // 7.25 % of 6499
    expect(t.totalCents).toBe(6499 + 999 + 471);
  });
  it("makes standard shipping free over the threshold", () => {
    const t = computeTotals({ ...base, lines: [{ sku: "B1", options: { size: "m" }, qty: 2 }] });
    expect(t.shippingCents).toBe(0);
  });
  it("prices add-ons, including recurring ones, and taxes them", () => {
    const t = computeTotals({ ...base, lines: [{ sku: "B1", options: {}, qty: 1 }], addOns: ["VASE", "CLUB"] });
    expect(t.addOns.map((a) => a.sku)).toEqual(["VASE", "CLUB"]);
    expect(t.taxCents).toBe(Math.floor(((6499 + 1500 + 2499) * 725 + 5000) / 10000));
  });
  it("applies a promo code only above its minimum, case-insensitively", () => {
    expect(computeTotals({ ...base, lines: [{ sku: "C1", options: {}, qty: 1 }], promo: "WELCOME10" }).discountCents).toBe(0);
    expect(computeTotals({ ...base, lines: [{ sku: "B1", options: {}, qty: 1 }], promo: " welcome10 " }).discountCents).toBe(650);
    expect(computeTotals({ ...base, lines: [{ sku: "B1", options: {}, qty: 1 }], promo: "NOPE" }).discountCents).toBe(0);
  });
  it("includes extra fees and a shipping delta in the total", () => {
    const t = computeTotals({ ...base, lines: [{ sku: "B1", options: {}, qty: 1 }], extraFees: [{ label: "Fixture fee", cents: 1299 }], shippingDeltaCents: 600 });
    expect(t.fees).toEqual([{ label: "Fixture fee", cents: 1299 }]);
    expect(t.shippingCents).toBe(999 + 600);
    expect(t.totalCents).toBe(t.subtotalCents + 1299 + 999 + 600 + t.taxCents);
  });
  it("charges the same-day fee when asked and no tax without a state", () => {
    const t = computeTotals({ ...base, state: null, lines: [{ sku: "B1", options: {}, qty: 1 }], sameDay: true });
    expect(t.fees).toContainEqual({ label: "Same-day delivery", cents: 1500 });
    expect(t.taxCents).toBe(0);
  });
  it("is zero for an empty cart without shipping", () => {
    const t = computeTotals({ ...base, shippingId: null, lines: [] });
    expect(t.totalCents).toBe(0);
  });
});
