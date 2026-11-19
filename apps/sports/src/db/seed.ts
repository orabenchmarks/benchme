import { withTx, type Pool } from "@benchme/core";
import type { ScenarioRows } from "@benchme/scenarios";

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

/** Materialise a scenario's sports rows under one workspace, atomically. Idempotent: a re-seed replaces. */
export async function seedSports(pool: Pool, ws: string, rows: ScenarioRows): Promise<void> {
  const s = rows.sports;
  await withTx(pool, async (c) => {
    for (const t of ["returns", "order_lines", "orders", "addresses", "customers", "variants", "products", "categories", "shipping_policy", "counters", "sessions", "verification_codes", "users"]) {
      await c.query(`DELETE FROM sports.${t} WHERE workspace_id = $1`, [ws]);
    }
    if (s.categories.length === 0) return;
    await bulk(c, "sports.categories", ["workspace_id", "key", "name", "return_window_days"], s.categories.map((x) => [ws, x.key, x.name, x.returnWindowDays]));
    await c.query("INSERT INTO sports.shipping_policy (workspace_id, fee_cents, free_from_cents) VALUES ($1, $2, $3)", [ws, s.shipping.feeCents, s.shipping.freeFromCents]);
    await bulk(c, "sports.products", ["workspace_id", "code", "name", "brand", "category", "material", "description"], s.products.map((p) => [ws, p.code, p.name, p.brand, p.category, p.material, p.description]));
    await bulk(
      c,
      "sports.variants",
      ["workspace_id", "sku", "product_code", "size", "colour", "weight_grams", "price_cents", "stock"],
      s.variants.map((v) => [ws, v.sku, v.productCode, v.size, v.colour, v.weightGrams, v.priceCents, v.stock]),
    );
    await bulk(c, "sports.customers", ["workspace_id", "email", "name"], s.customers.map((x) => [ws, x.email, x.name]));
    await bulk(
      c,
      "sports.addresses",
      ["workspace_id", "code", "customer_email", "label", "line1", "city", "postcode", "is_default"],
      s.addresses.map((a) => [ws, a.code, a.customerEmail, a.label, a.line1, a.city, a.postcode, a.isDefault]),
    );
    await bulk(
      c,
      "sports.orders",
      ["workspace_id", "order_no", "customer_email", "address_code", "status", "placed_on", "shipped_on", "delivered_on", "cancelled_on", "tracking_no", "subtotal_cents", "shipping_cents", "total_cents"],
      s.orders.map((o) => [ws, o.orderNo, o.customerEmail, o.addressCode, o.status, o.placedOn, o.shippedOn, o.deliveredOn, o.cancelledOn, o.trackingNo, o.subtotalCents, o.shippingCents, o.totalCents]),
    );
    const position = new Map<string, number>();
    await bulk(
      c,
      "sports.order_lines",
      ["workspace_id", "order_no", "line_no", "sku", "qty", "unit_price_cents"],
      s.lines.map((l) => {
        const n = (position.get(l.orderNo) ?? 0) + 1;
        position.set(l.orderNo, n);
        return [ws, l.orderNo, n, l.sku, l.qty, l.unitPriceCents];
      }),
    );
    await bulk(
      c,
      "sports.returns",
      ["workspace_id", "return_no", "order_no", "sku", "qty", "reason", "requested_on", "refund_cents"],
      s.returns.map((r) => [ws, r.returnNo, r.orderNo, r.sku, r.qty, r.reason, r.requestedOn, r.refundCents]),
    );
  });
}
