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

/** Materialise a scenario's pizza rows under one workspace, atomically. Idempotent: a re-seed replaces. */
export async function seedPizza(pool: Pool, ws: string, rows: ScenarioRows): Promise<void> {
  const p = rows.pizza;
  await withTx(pool, async (c) => {
    for (const t of ["order_lines", "orders", "stockouts", "branches", "pizzas", "toppings", "sizes", "counters", "sessions", "verification_codes", "users"]) {
      await c.query(`DELETE FROM pizza.${t} WHERE workspace_id = $1`, [ws]);
    }
    await bulk(c, "pizza.sizes", ["workspace_id", "key", "name", "inches", "serves", "base_cents"], p.sizes.map((s) => [ws, s.key, s.name, s.inches, s.serves, s.baseCents]));
    await bulk(
      c,
      "pizza.toppings",
      ["workspace_id", "key", "name", "vegetarian", "vegan", "allergens", "small_cents", "medium_cents", "large_cents", "xlarge_cents"],
      p.toppings.map((t) => [ws, t.key, t.name, t.vegetarian, t.vegan, t.allergens, t.pricesCents.small, t.pricesCents.medium, t.pricesCents.large, t.pricesCents.xlarge]),
    );
    await bulk(c, "pizza.pizzas", ["workspace_id", "code", "name", "description", "crust", "sauce", "cheese", "toppings"], p.pizzas.map((x) => [ws, x.code, x.name, x.description, x.crust, x.sauce, x.cheese, x.toppings]));
    await bulk(
      c,
      "pizza.branches",
      ["workspace_id", "code", "name", "city", "address", "delivers", "delivery_fee_cents", "free_delivery_from_cents", "slot_capacity"],
      p.branches.map((b) => [ws, b.code, b.name, b.city, b.address, b.delivers, b.deliveryFeeCents, b.freeDeliveryFromCents, b.slotCapacity]),
    );
    await bulk(c, "pizza.stockouts", ["workspace_id", "branch_code", "topping_key"], p.stockouts.map((s) => [ws, s.branchCode, s.toppingKey]));
    await bulk(
      c,
      "pizza.orders",
      ["workspace_id", "order_no", "branch_code", "customer_name", "customer_email", "fulfilment", "address", "slot_date", "slot_time", "status", "subtotal_cents", "delivery_fee_cents", "total_cents", "created_at"],
      p.orders.map((o) => [ws, o.orderNo, o.branchCode, o.customerName, o.customerEmail, o.fulfilment, o.address, o.slotDate, o.slotTime, o.status, o.subtotalCents, o.deliveryFeeCents, o.totalCents, o.createdAt]),
    );
    await bulk(
      c,
      "pizza.order_lines",
      ["workspace_id", "order_no", "line", "pizza_code", "size", "crust", "sauce", "cheese", "toppings", "quantity", "unit_cents", "line_cents"],
      p.orders.flatMap((o) => o.lines.map((i) => [ws, o.orderNo, i.line, i.pizzaCode, i.size, i.crust, i.sauce, i.cheese, i.toppings, i.quantity, i.unitCents, i.lineCents])),
    );
  });
}
