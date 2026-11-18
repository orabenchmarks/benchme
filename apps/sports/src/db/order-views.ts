import type { Pool, PoolClient } from "@benchme/core";
import type { SportOrder, SportReturn } from "@benchme/scenarios";
import { LINE_SELECT, RETURN_COLS, toAddress, toReturn, type AddressRow, type LineRow, type LineView, type OrderView, type ReturnRow } from "./rows.js";

const groupBy = <T>(items: T[], keyOf: (x: T) => string) => {
  const out = new Map<string, T[]>();
  for (const x of items) out.set(keyOf(x), [...(out.get(keyOf(x)) ?? []), x]);
  return out;
};

/** Orders as the site shows them: four reads for any number of orders (lines with their products, returns, addresses, customer names). */
export async function readViews(c: Pool | PoolClient, ws: string, orders: SportOrder[]): Promise<OrderView[]> {
  if (orders.length === 0) return [];
  const nos = orders.map((o) => o.orderNo);
  const lines = groupBy((await c.query<LineRow>(`${LINE_SELECT} WHERE l.workspace_id = $1 AND l.order_no = ANY($2::text[]) ORDER BY l.order_no, l.line_no`, [ws, nos])).rows, (l) => l.order_no);
  const returns = groupBy((await c.query<ReturnRow>(`SELECT ${RETURN_COLS} FROM sports.returns WHERE workspace_id = $1 AND order_no = ANY($2::text[]) ORDER BY return_no`, [ws, nos])).rows.map(toReturn), (r) => r.orderNo);
  const addresses = new Map((await c.query<AddressRow>("SELECT * FROM sports.addresses WHERE workspace_id = $1 AND code = ANY($2::text[])", [ws, [...new Set(orders.map((o) => o.addressCode))]])).rows.map((a) => [a.code, toAddress(a)]));
  const names = new Map((await c.query<{ email: string; name: string }>("SELECT email, name FROM sports.customers WHERE workspace_id = $1 AND email = ANY($2::text[])", [ws, [...new Set(orders.map((o) => o.customerEmail))]])).rows.map((x) => [x.email, x.name]));
  return orders.map((o) => {
    const mine: SportReturn[] = returns.get(o.orderNo) ?? [];
    const view: LineView[] = (lines.get(o.orderNo) ?? []).map((l) => ({
      sku: l.sku,
      productCode: l.product_code,
      productName: l.product_name,
      size: l.size,
      colour: l.colour,
      qty: l.qty,
      unitPriceCents: l.unit_price_cents,
      returnedQty: mine.filter((r) => r.sku === l.sku).reduce((s, r) => s + r.qty, 0),
    }));
    const a = addresses.get(o.addressCode);
    return {
      ...o,
      customerName: names.get(o.customerEmail) ?? o.customerEmail,
      address: { code: o.addressCode, label: a?.label ?? "", line1: a?.line1 ?? "", city: a?.city ?? "", postcode: a?.postcode ?? "", isDefault: a?.isDefault ?? false },
      lineCount: view.length,
      lines: view,
      returns: mine,
    };
  });
}
