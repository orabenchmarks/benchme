import { describe, expect, it } from "vitest";
import { lowStock, openOrdersFor, orderTotalCents, stockOf } from "../answers.js";
import { ACME_V1_SIZES, acmeV1 } from "./index.js";
import { scenarios } from "../index.js";
import type { ScenarioRows } from "../scenario.js";

describe("acme-v1", () => {
  it("is byte-identical for the same seed and different for another", () => {
    const a = JSON.stringify(acmeV1.generate(4242));
    const b = JSON.stringify(acmeV1.generate(4242));
    const c = JSON.stringify(acmeV1.generate(4243));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("has the declared sizes and referentially consistent rows", () => {
    const r = acmeV1.generate(7);
    const w = r.warehouse;
    expect(w.products).toHaveLength(ACME_V1_SIZES.products);
    expect(w.customers).toHaveLength(ACME_V1_SIZES.customers);
    expect(w.orders).toHaveLength(ACME_V1_SIZES.orders);
    expect(w.transfers).toHaveLength(ACME_V1_SIZES.transfers);
    expect(w.locations).toHaveLength(4);
    const skus = new Set(w.products.map((p) => p.sku));
    const codes = new Set(w.locations.map((l) => l.code));
    const custs = new Set(w.customers.map((c) => c.code));
    const orderNos = new Set(w.orders.map((o) => o.orderNo));
    expect(skus.size).toBe(w.products.length);
    for (const s of w.stock) {
      expect(skus.has(s.sku)).toBe(true);
      expect(codes.has(s.locationCode)).toBe(true);
      expect(s.qty).toBeGreaterThanOrEqual(0);
    }
    for (const l of w.orderLines) {
      expect(skus.has(l.sku)).toBe(true);
      expect(orderNos.has(l.orderNo)).toBe(true);
    }
    for (const o of w.orders) expect(custs.has(o.customerCode)).toBe(true);
    for (const t of w.transfers) {
      expect(t.fromCode).not.toBe(t.toCode);
      expect(t.qty).toBeGreaterThan(0);
    }
    // every order has at least one line
    const withLines = new Set(w.orderLines.map((l) => l.orderNo));
    expect(withLines.size).toBe(w.orders.length);
  });

  it("is registered in the default registry", () => {
    expect(scenarios.get("acme-v1")).toBe(acmeV1);
    expect(() => scenarios.get("nope")).toThrow(/unknown scenario/);
  });
});

/** A tiny hand-built fixture: each answer varies ONE field so a wrong key cannot pass. */
const fixture: ScenarioRows = {
  company: { name: "X", founded: 2000, headquarters: "Y", employees: 1, fiscalYearRevenueCents: 0 },
  warehouse: {
    products: [
      { sku: "A", name: "a", category: "c", unitPriceCents: 100 },
      { sku: "B", name: "b", category: "c", unitPriceCents: 250 },
    ],
    locations: [
      { code: "L1", name: "", city: "" },
      { code: "L2", name: "", city: "" },
    ],
    stock: [
      { sku: "A", locationCode: "L1", qty: 5 },
      { sku: "A", locationCode: "L2", qty: 7 },
      { sku: "B", locationCode: "L1", qty: 30 },
    ],
    customers: [{ code: "C1", name: "", tier: "gold", city: "" }],
    orders: [
      { orderNo: "O1", customerCode: "C1", status: "open", placedAt: "2026-01-01T00:00:00Z" },
      { orderNo: "O2", customerCode: "C1", status: "shipped", placedAt: "2026-01-02T00:00:00Z" },
      { orderNo: "O3", customerCode: "C2", status: "open", placedAt: "2026-01-03T00:00:00Z" },
    ],
    orderLines: [
      { orderNo: "O1", sku: "A", qty: 2 },
      { orderNo: "O1", sku: "B", qty: 1 },
      { orderNo: "O2", sku: "B", qty: 4 },
    ],
    transfers: [],
  },
};

describe("answers", () => {
  it("stockOf sums across locations and filters by location", () => {
    expect(stockOf(fixture, "A")).toBe(12);
    expect(stockOf(fixture, "A", "L2")).toBe(7);
    expect(stockOf(fixture, "Z")).toBe(0);
  });
  it("openOrdersFor filters by customer AND status", () => {
    expect(openOrdersFor(fixture, "C1")).toEqual(["O1"]);
    expect(openOrdersFor(fixture, "C2")).toEqual(["O3"]);
  });
  it("orderTotalCents multiplies qty by unit price per line", () => {
    expect(orderTotalCents(fixture, "O1")).toBe(2 * 100 + 1 * 250);
    expect(orderTotalCents(fixture, "O2")).toBe(1000);
  });
  it("lowStock compares the per-sku total against the threshold", () => {
    expect(lowStock(fixture, 13)).toEqual(["A"]);
    expect(lowStock(fixture, 31)).toEqual(["A", "B"]);
  });
});
