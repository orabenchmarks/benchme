import { describe, expect, it } from "vitest";
import { acmeV1 } from "./acme-v1/index.js";
import { lowStock } from "./answers.js";

describe("lowStock", () => {
  const rows = acmeV1.generate(4242);
  const stocked = new Set(rows.warehouse.stock.map((s) => s.sku));
  const unstocked = rows.warehouse.products.filter((p) => !stocked.has(p.sku)).map((p) => p.sku);

  it("counts a product with no stock rows as 0 units, so it is below any positive threshold", () => {
    expect(unstocked.length).toBeGreaterThan(0); // the seed has such products (ADH-1118, FAS-1048 for seed 4242)
    for (const sku of unstocked) expect(lowStock(rows, 1)).toContain(sku);
    for (const sku of unstocked) expect(lowStock(rows, 0)).not.toContain(sku);
  });

  it("sums stock across locations and sorts", () => {
    const low = lowStock(rows, 100);
    expect(low).toEqual([...low].sort());
    for (const sku of low) expect(rows.warehouse.stock.filter((s) => s.sku === sku).reduce((a, s) => a + s.qty, 0)).toBeLessThan(100);
    const high = rows.warehouse.stock.map((s) => s.sku).find((sku) => rows.warehouse.stock.filter((s) => s.sku === sku).reduce((a, s) => a + s.qty, 0) >= 100);
    expect(low).not.toContain(high);
  });
});
