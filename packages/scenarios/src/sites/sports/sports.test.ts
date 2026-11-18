import { describe, expect, it } from "vitest";
import { webmcpV1 } from "../../webmcp-v1/index.js";
import { CITY_LIST } from "../../acme-v1/names.js";
import { SPORTS_SIZES, sportsRows } from "./generate.js";
import {
  SPORTS_HISTORY_FROM,
  SPORTS_TODAY,
  searchSportsVariants,
  sportsCancelProblem,
  sportsOrderProblem,
  sportsOrderTotals,
  sportsReorderRequest,
  sportsReturnDeadline,
  sportsReturnProblem,
  sportsReturnedQty,
  sportsShippingCents,
} from "./rules.js";
import type { SportAddress, SportCategory, SportOrder, SportOrderLine, SportProduct, SportVariant } from "./types.js";

describe("webmcp-v1 sports rows", () => {
  const rows = sportsRows(4242);
  const product = new Map(rows.products.map((p) => [p.code, p]));
  const variant = new Map(rows.variants.map((v) => [v.sku, v]));
  const category = new Map(rows.categories.map((c) => [c.key, c]));
  const order = new Map(rows.orders.map((o) => [o.orderNo, o]));
  const linesOf = (no: string) => rows.lines.filter((l) => l.orderNo === no);

  it("is byte-identical for the same seed, and the same rows webmcpV1.generate carries", () => {
    expect(JSON.stringify(sportsRows(4242))).toBe(JSON.stringify(rows));
    expect(JSON.stringify(sportsRows(4243))).not.toBe(JSON.stringify(rows));
    expect(webmcpV1.generate(4242).sports).toEqual(rows);
  });

  it("keeps natural keys unique and every reference resolvable", () => {
    for (const [items, key] of [
      [rows.products, "code"],
      [rows.variants, "sku"],
      [rows.customers, "email"],
      [rows.addresses, "code"],
      [rows.orders, "orderNo"],
      [rows.returns, "returnNo"],
    ] as const) expect(new Set(items.map((x) => (x as Record<string, unknown>)[key])).size).toBe(items.length);
    expect(new Set(rows.products.map((p) => p.name)).size).toBe(rows.products.length);
    expect(new Set(rows.categories.map((c) => c.returnWindowDays)).size).toBe(rows.categories.length);
    for (const p of rows.products) expect(category.has(p.category)).toBe(true);
    for (const v of rows.variants) expect(product.has(v.productCode)).toBe(true);
    const emails = new Set(rows.customers.map((c) => c.email));
    for (const a of rows.addresses) {
      expect(emails.has(a.customerEmail)).toBe(true);
      expect(CITY_LIST).toContain(a.city);
    }
    for (const c of rows.customers) expect(rows.addresses.filter((a) => a.customerEmail === c.email && a.isDefault)).toHaveLength(1);
    for (const l of rows.lines) {
      expect(order.has(l.orderNo)).toBe(true);
      expect(variant.get(l.sku)?.priceCents).toBe(l.unitPriceCents);
    }
    for (const r of rows.returns) expect(linesOf(r.orderNo).some((l) => l.sku === r.sku)).toBe(true);
    expect(rows.categories.length + rows.products.length + rows.variants.length + rows.customers.length + rows.addresses.length + rows.orders.length + rows.lines.length + rows.returns.length).toBeLessThanOrEqual(450);
  });

  it("holds every seeded order, its dates and totals, and every seeded return to the rules", () => {
    for (const o of rows.orders) {
      const address = rows.addresses.find((a) => a.code === o.addressCode) as SportAddress;
      expect(address.customerEmail).toBe(o.customerEmail);
      const lines = linesOf(o.orderNo);
      expect(lines.length).toBeGreaterThan(0);
      expect(new Set(lines.map((l) => l.sku)).size).toBe(lines.length);
      expect({ subtotalCents: o.subtotalCents, shippingCents: o.shippingCents, totalCents: o.totalCents }).toEqual(sportsOrderTotals(rows.shipping, lines));
      expect(o.placedOn >= SPORTS_HISTORY_FROM && o.placedOn <= SPORTS_TODAY).toBe(true);
      expect(o.shippedOn !== null).toBe(o.status === "shipped" || o.status === "delivered");
      expect(o.trackingNo !== null).toBe(o.shippedOn !== null);
      expect(o.deliveredOn !== null).toBe(o.status === "delivered");
      expect(o.cancelledOn !== null).toBe(o.status === "cancelled");
      if (o.shippedOn) expect(o.shippedOn > o.placedOn).toBe(true);
      if (o.deliveredOn) expect(o.deliveredOn > (o.shippedOn as string) && o.deliveredOn <= SPORTS_TODAY).toBe(true);
    }
    for (const r of rows.returns) {
      const o = order.get(r.orderNo) as SportOrder;
      const line = linesOf(r.orderNo).find((l) => l.sku === r.sku) as SportOrderLine;
      const cat = category.get((product.get((variant.get(r.sku) as SportVariant).productCode) as SportProduct).category) as SportCategory;
      expect(o.status).toBe("delivered");
      expect(r.requestedOn <= sportsReturnDeadline(o.deliveredOn as string, cat.returnWindowDays) && r.requestedOn <= SPORTS_TODAY).toBe(true);
      expect(r.refundCents).toBe(r.qty * line.unitPriceCents);
      expect(sportsReturnedQty(rows.returns, r.orderNo, r.sku)).toBeLessThanOrEqual(line.qty);
    }
  });

  it("leaves variants out of stock on purpose, sets the weight-cap traps, and seeds the order states tasks need", () => {
    expect(rows.variants.filter((v) => v.stock === 0).length).toBeGreaterThanOrEqual(SPORTS_SIZES.stockTraps * 2);
    // A trap: within a weight cap the cheapest variant of a size and colour is sold out, and a cheaper in-stock one is over the cap.
    const traps = new Set<string>();
    for (const v of rows.variants.filter((x) => x.size !== "one size")) {
      const all = searchSportsVariants(rows, { size: v.size, colour: v.colour });
      const cap = Math.ceil(v.weightGrams / 10) * 10;
      const within = all.filter((x) => x.weightGrams <= cap);
      const best = within.find((x) => x.stock > 0);
      if (best?.sku === v.sku && within[0]?.stock === 0 && all.some((x) => x.weightGrams > cap && x.stock > 0 && x.priceCents < v.priceCents)) traps.add(`${v.size}|${v.colour}`);
    }
    expect(traps.size).toBeGreaterThanOrEqual(SPORTS_SIZES.stockTraps);
    const ordersOf = (email: string) => rows.orders.filter((o) => o.customerEmail === email);
    const busy = rows.customers.filter((c) => ordersOf(c.email).filter((o) => o.status === "processing").length >= 2 && ordersOf(c.email).some((o) => o.status === "shipped"));
    expect(busy.length).toBeGreaterThanOrEqual(SPORTS_SIZES.busyCustomers);
    const latestNotDelivered = rows.customers.filter((c) => {
      const mine = [...ordersOf(c.email)].sort((a, b) => a.placedOn.localeCompare(b.placedOn));
      return mine.some((o) => o.status === "delivered") && mine.at(-1)?.status !== "delivered";
    });
    expect(latestNotDelivered.length).toBeGreaterThanOrEqual(SPORTS_SIZES.notDeliveredLatest);
    expect(rows.orders.some((o) => o.status === "cancelled")).toBe(true);
    expect(rows.returns.length).toBe(SPORTS_SIZES.seededReturns);
  });
});

describe("sports rules", () => {
  const shipping = { feeCents: 595, freeFromCents: 10000 };
  const customer = { email: "a@example.org", name: "A" };
  const address: SportAddress = { code: "AD-1", customerEmail: "a@example.org", label: "home", line1: "1 X Road", city: "Velmora", postcode: "10000", isDefault: true };
  const other: SportAddress = { ...address, code: "AD-2", customerEmail: "b@example.org" };
  const shoe: SportVariant = { sku: "S-1", productCode: "P-1", size: "42", colour: "black", weightGrams: 300, priceCents: 4000, stock: 2 };
  const sold: SportVariant = { ...shoe, sku: "S-2", stock: 0 };
  const variant = (sku: string) => [shoe, sold].find((v) => v.sku === sku);
  const req = { customerEmail: "a@example.org", addressCode: "AD-1", lines: [{ sku: "S-1", qty: 2 }] };
  const ctx = { customer, address, variant };

  it("charges the fee below the free-shipping threshold and nothing from it", () => {
    expect(sportsShippingCents(shipping, 9999)).toBe(595);
    expect(sportsShippingCents(shipping, 10000)).toBe(0);
    expect(sportsOrderTotals(shipping, [{ qty: 2, unitPriceCents: 4000 }, { qty: 1, unitPriceCents: 1500 }])).toEqual({ subtotalCents: 9500, shippingCents: 595, totalCents: 10095 });
  });

  it("refuses each order rule on its own", () => {
    expect(sportsOrderProblem(req, ctx)).toBeNull();
    expect(sportsOrderProblem(req, { ...ctx, customer: null })?.code).toBe("UNKNOWN_CUSTOMER");
    expect(sportsOrderProblem(req, { ...ctx, address: other })?.code).toBe("NOT_THEIR_ADDRESS");
    expect(sportsOrderProblem(req, { ...ctx, address: null })?.code).toBe("NOT_THEIR_ADDRESS");
    expect(sportsOrderProblem({ ...req, lines: [] }, ctx)?.code).toBe("NO_LINES");
    expect(sportsOrderProblem({ ...req, lines: Array.from({ length: 9 }, (_, i) => ({ sku: `S-${i}`, qty: 1 })) }, ctx)?.code).toBe("TOO_MANY_LINES");
    expect(sportsOrderProblem({ ...req, lines: [{ sku: "S-1", qty: 0 }] }, ctx)?.code).toBe("BAD_QTY");
    expect(sportsOrderProblem({ ...req, lines: [{ sku: "S-1", qty: 1 }, { sku: "S-1", qty: 1 }] }, ctx)?.code).toBe("DUPLICATE_SKU");
    expect(sportsOrderProblem({ ...req, lines: [{ sku: "S-9", qty: 1 }] }, ctx)?.code).toBe("UNKNOWN_SKU");
    expect(sportsOrderProblem({ ...req, lines: [{ sku: "S-1", qty: 3 }] }, ctx)?.code).toBe("OUT_OF_STOCK");
    expect(sportsOrderProblem({ ...req, lines: [{ sku: "S-2", qty: 1 }] }, ctx)?.code).toBe("OUT_OF_STOCK");
  });

  const placed: SportOrder = {
    orderNo: "ORD-1", customerEmail: "a@example.org", addressCode: "AD-1", status: "delivered", placedOn: "2027-05-01", shippedOn: "2027-05-02",
    deliveredOn: "2027-05-05", cancelledOn: null, trackingNo: "TS1", subtotalCents: 8000, shippingCents: 595, totalCents: 8595,
  };
  const line: SportOrderLine = { orderNo: "ORD-1", sku: "S-1", qty: 3, unitPriceCents: 4000 };
  const cat: SportCategory = { key: "running", name: "Running", returnWindowDays: 45 };
  const ret = { orderNo: "ORD-1", sku: "S-1", qty: 2, reason: "too small" };
  const rctx = { order: placed, line, category: cat, returns: [], today: "2027-06-15" };

  it("cancels only a processing order", () => {
    expect(sportsCancelProblem({ ...placed, status: "processing" })).toBeNull();
    expect(sportsCancelProblem({ ...placed, status: "shipped" })?.code).toBe("NOT_CANCELLABLE");
    expect(sportsCancelProblem(placed)?.code).toBe("NOT_CANCELLABLE");
    expect(sportsCancelProblem({ ...placed, status: "cancelled" })?.code).toBe("ALREADY_CANCELLED");
  });

  it("counts the return window from delivery, inclusive, and refuses each return rule on its own", () => {
    expect(sportsReturnDeadline("2027-05-05", 45)).toBe("2027-06-19");
    expect(sportsReturnProblem(ret, rctx)).toBeNull();
    expect(sportsReturnProblem(ret, { ...rctx, today: "2027-06-19" })).toBeNull();
    expect(sportsReturnProblem(ret, { ...rctx, today: "2027-06-20" })?.code).toBe("RETURN_WINDOW_CLOSED");
    expect(sportsReturnProblem(ret, { ...rctx, order: null })?.code).toBe("UNKNOWN_ORDER");
    expect(sportsReturnProblem(ret, { ...rctx, line: null })?.code).toBe("NOT_IN_ORDER");
    expect(sportsReturnProblem({ ...ret, qty: 0 }, rctx)?.code).toBe("BAD_QTY");
    expect(sportsReturnProblem({ ...ret, reason: "bored" }, rctx)?.code).toBe("BAD_REASON");
    expect(sportsReturnProblem(ret, { ...rctx, order: { ...placed, status: "shipped", deliveredOn: null } })?.code).toBe("NOT_DELIVERED");
    const earlier = [{ returnNo: "RET-1", orderNo: "ORD-1", sku: "S-1", qty: 2, reason: "too small", requestedOn: "2027-05-10", refundCents: 8000 }];
    expect(sportsReturnProblem({ ...ret, qty: 1 }, { ...rctx, returns: earlier })).toBeNull();
    expect(sportsReturnProblem(ret, { ...rctx, returns: earlier })?.code).toBe("RETURN_QTY");
  });

  it("reorders the same lines to the same address unless told otherwise", () => {
    const lines = [line, { ...line, sku: "S-3", qty: 1 }, { ...line, orderNo: "ORD-2", sku: "S-4" }];
    expect(sportsReorderRequest(placed, lines)).toEqual({ customerEmail: "a@example.org", addressCode: "AD-1", lines: [{ sku: "S-1", qty: 3 }, { sku: "S-3", qty: 1 }] });
    expect(sportsReorderRequest(placed, lines, "AD-7").addressCode).toBe("AD-7");
  });

  it("searches by words, category, size, colour, price, weight and stock, cheapest first", () => {
    const products: SportProduct[] = [
      { code: "P-1", name: "Alpha Trail Shoe", brand: "Kalo", category: "running", material: "mesh", description: "" },
      { code: "P-2", name: "Beta Hiking Boot", brand: "Vidor", category: "hiking", material: "leather", description: "" },
    ];
    const variants: SportVariant[] = [
      { ...shoe, sku: "A-42", productCode: "P-1", priceCents: 9000, weightGrams: 280 },
      { ...shoe, sku: "A-43", productCode: "P-1", size: "43", priceCents: 9000, weightGrams: 290 },
      { ...shoe, sku: "B-42", productCode: "P-2", priceCents: 7000, weightGrams: 520, stock: 0 },
    ];
    const r = { products, variants };
    expect(searchSportsVariants(r, { size: "42" }).map((o) => o.sku)).toEqual(["B-42", "A-42"]);
    expect(searchSportsVariants(r, { size: "42", inStock: true }).map((o) => o.sku)).toEqual(["A-42"]);
    expect(searchSportsVariants(r, { maxWeightGrams: 285 }).map((o) => o.sku)).toEqual(["A-42"]);
    expect(searchSportsVariants(r, { maxPriceCents: 8000 }).map((o) => o.sku)).toEqual(["B-42"]);
    expect(searchSportsVariants(r, { query: "trail SHOE" }).map((o) => o.sku)).toEqual(["A-42", "A-43"]);
    expect(searchSportsVariants(r, { category: "Hiking", colour: "BLACK" }).map((o) => o.sku)).toEqual(["B-42"]);
    expect(searchSportsVariants(r, { colour: "red" })).toEqual([]);
  });
});
