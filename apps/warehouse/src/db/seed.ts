import { withTx, type Pool } from "@benchme/core";
import type { ScenarioRows } from "@benchme/scenarios";

/** Multi-row INSERT helper: values as a flat parameter list, chunked to stay under pg's 65k-parameter cap. */
async function bulk(client: { query: (sql: string, params: unknown[]) => Promise<unknown> }, table: string, columns: string[], rows: unknown[][]) {
  if (rows.length === 0) return;
  const perRow = columns.length;
  const chunk = Math.floor(60_000 / perRow);
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    const placeholders = slice.map((_, r) => `(${columns.map((__, c) => `$${r * perRow + c + 1}`).join(",")})`).join(",");
    await client.query(`INSERT INTO ${table} (${columns.join(",")}) VALUES ${placeholders}`, slice.flat());
  }
}

/** Materialise a scenario's warehouse rows under one workspace, atomically. Idempotent: a re-seed replaces. */
export async function seedWarehouse(pool: Pool, ws: string, rows: ScenarioRows): Promise<void> {
  const w = rows.warehouse;
  await withTx(pool, async (c) => {
    for (const t of ["transfers", "order_lines", "orders", "stock", "customers", "locations", "products", "counters", "sessions", "verification_codes", "users"]) {
      await c.query(`DELETE FROM warehouse.${t} WHERE workspace_id = $1`, [ws]);
    }
    await bulk(c, "warehouse.products", ["workspace_id", "sku", "name", "category", "unit_price_cents"], w.products.map((p) => [ws, p.sku, p.name, p.category, p.unitPriceCents]));
    await bulk(c, "warehouse.locations", ["workspace_id", "code", "name", "city"], w.locations.map((l) => [ws, l.code, l.name, l.city]));
    await bulk(c, "warehouse.stock", ["workspace_id", "sku", "location_code", "qty"], w.stock.map((s) => [ws, s.sku, s.locationCode, s.qty]));
    await bulk(c, "warehouse.customers", ["workspace_id", "code", "name", "tier", "city"], w.customers.map((x) => [ws, x.code, x.name, x.tier, x.city]));
    await bulk(c, "warehouse.orders", ["workspace_id", "order_no", "customer_code", "status", "placed_at"], w.orders.map((o) => [ws, o.orderNo, o.customerCode, o.status, o.placedAt]));
    await bulk(c, "warehouse.order_lines", ["workspace_id", "order_no", "sku", "qty"], w.orderLines.map((l) => [ws, l.orderNo, l.sku, l.qty]));
    await bulk(c, "warehouse.transfers", ["workspace_id", "transfer_no", "sku", "from_code", "to_code", "qty", "status"], w.transfers.map((t) => [ws, t.transferNo, t.sku, t.fromCode, t.toCode, t.qty, t.status]));
  });
}
