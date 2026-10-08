import { describe, expect, it } from "vitest";
import { addLine, lineKey, removeLine, setQty, unitPrice } from "./cart.js";
import { demoStore } from "./test-store.js";

describe("cart", () => {
  it("merges identical lines and keys option order-independently", () => {
    const a = addLine([], { sku: "B1", options: { size: "m", color: "red" }, qty: 1 });
    const b = addLine(a, { sku: "B1", options: { color: "red", size: "m" }, qty: 2 });
    expect(b).toHaveLength(1);
    expect(b[0]!.qty).toBe(3);
    expect(lineKey({ sku: "B1", options: { size: "m", color: "red" } })).toBe(lineKey({ sku: "B1", options: { color: "red", size: "m" } }));
  });
  it("keeps subscription and one-time lines apart", () => {
    const a = addLine([], { sku: "C1", options: {}, qty: 1, mode: "once" });
    expect(addLine(a, { sku: "C1", options: {}, qty: 1, mode: "subscribe", interval: "4 weeks" })).toHaveLength(2);
  });
  it("caps quantity and removes at zero", () => {
    const a = addLine([], { sku: "B1", options: {}, qty: 50 }, 10);
    expect(a[0]!.qty).toBe(10);
    const k = lineKey(a[0]!);
    expect(setQty(a, k, 0)).toEqual([]);
    expect(removeLine(a, k)).toEqual([]);
  });
  it("prices options and subscriptions", () => {
    expect(unitPrice(demoStore, { sku: "B1", options: { size: "l" }, qty: 1 })).toBe(6499 + 2000);
    expect(unitPrice(demoStore, { sku: "C1", options: {}, qty: 1, mode: "subscribe", interval: "4 weeks" })).toBe(1870); // 2200 − 15 %
  });
  it("refuses an unknown SKU", () => {
    expect(() => unitPrice(demoStore, { sku: "NOPE", options: {}, qty: 1 })).toThrow(/unknown sku/);
  });
});
