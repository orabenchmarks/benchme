import type { ScenarioRows } from "./scenario.js";

/**
 * Ground truths derived by CODE from generated rows — never transcribed. The
 * corpus build calls these to write answers.json; the apps' own queries must
 * agree with them (a test asserts it per query).
 */
export function stockOf(rows: ScenarioRows, sku: string, locationCode?: string): number {
  return rows.warehouse.stock
    .filter((s) => s.sku === sku && (locationCode === undefined || s.locationCode === locationCode))
    .reduce((sum, s) => sum + s.qty, 0);
}

export function openOrdersFor(rows: ScenarioRows, customerCode: string): string[] {
  return rows.warehouse.orders
    .filter((o) => o.customerCode === customerCode && o.status === "open")
    .map((o) => o.orderNo)
    .sort();
}

export function orderTotalCents(rows: ScenarioRows, orderNo: string): number {
  const price = new Map(rows.warehouse.products.map((p) => [p.sku, p.unitPriceCents]));
  return rows.warehouse.orderLines
    .filter((l) => l.orderNo === orderNo)
    .reduce((sum, l) => sum + l.qty * (price.get(l.sku) ?? 0), 0);
}

export function lowStock(rows: ScenarioRows, threshold: number): string[] {
  const totals = new Map<string, number>();
  for (const s of rows.warehouse.stock) totals.set(s.sku, (totals.get(s.sku) ?? 0) + s.qty);
  return [...totals.entries()]
    .filter(([, qty]) => qty < threshold)
    .map(([sku]) => sku)
    .sort();
}
