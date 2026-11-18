import { withTx, type Pool, type PoolClient } from "@benchme/core";
import {
  SPORTS_TODAY,
  sportsCancelProblem,
  sportsOrderProblem,
  sportsOrderTotals,
  sportsReorderRequest,
  sportsReturnProblem,
  type SportAddress,
  type SportCustomer,
  type SportOrderStatus,
  type SportReturn,
  type SportsOrderRequest,
  type SportsReturnRequest,
} from "@benchme/scenarios";
import { DomainError } from "@benchme/site-kit";
import { readViews } from "./order-views.js";
import { ORDER_COLS, RETURN_COLS, refuse, toAddress, toCategory, toOrder, toReturn, toVariant, type AddressRow, type CategoryRow, type OrderRow, type OrderView, type ReturnRow, type VariantRow } from "./rows.js";

export type CustomerSummary = SportCustomer & { addresses: number; orders: number };
export type CustomerDetail = SportCustomer & { addresses: SportAddress[] };
export type OrderFilter = { customerEmail?: string; status?: SportOrderStatus; placedFrom?: string; placedTo?: string; cursor?: string; limit: number };
export type ReturnFilter = { orderNo?: string; customerEmail?: string };

/**
 * Customer accounts, their orders and returns. Every write is held to
 * @benchme/scenarios' sports rules — the functions the answer keys are derived
 * with — inside its transaction: placing an order reserves stock, cancelling
 * gives it back, a return never restocks.
 */
export interface OrdersRepo {
  listCustomers(ws: string, query?: string): Promise<CustomerSummary[]>;
  getCustomer(ws: string, email: string): Promise<CustomerDetail | null>;
  listOrders(ws: string, f: OrderFilter): Promise<{ items: OrderView[]; nextCursor: string | null }>;
  getOrder(ws: string, orderNo: string): Promise<OrderView | null>;
  listReturns(ws: string, f: ReturnFilter): Promise<SportReturn[]>;
  placeOrder(ws: string, req: SportsOrderRequest): Promise<OrderView>;
  /** processing → cancelled, stock given back; any other status is refused. */
  cancelOrder(ws: string, orderNo: string): Promise<OrderView>;
  /** A new order with the same SKUs and quantities, to the same address unless another is given. */
  reorder(ws: string, orderNo: string, addressCode?: string): Promise<OrderView>;
  requestReturn(ws: string, req: SportsReturnRequest): Promise<SportReturn>;
}

const next = async (c: PoolClient, ws: string, name: string) =>
  (await c.query<{ value: number }>(
    `INSERT INTO sports.counters (workspace_id, name, value) VALUES ($1, $2, 1)
     ON CONFLICT (workspace_id, name) DO UPDATE SET value = sports.counters.value + 1 RETURNING value`,
    [ws, name],
  )).rows[0]?.value ?? 0;

export class PgOrdersRepo implements OrdersRepo {
  constructor(private readonly pool: Pool) {}

  async listCustomers(ws: string, query?: string): Promise<CustomerSummary[]> {
    const params: unknown[] = [ws];
    let where = "c.workspace_id = $1";
    if (query?.trim()) {
      params.push(`%${query.trim().toLowerCase()}%`);
      where += " AND (lower(c.name) LIKE $2 OR c.email LIKE $2)";
    }
    const r = await this.pool.query<{ email: string; name: string; addresses: string; orders: string }>(
      `SELECT c.email, c.name,
         (SELECT count(*) FROM sports.addresses a WHERE a.workspace_id = c.workspace_id AND a.customer_email = c.email) AS addresses,
         (SELECT count(*) FROM sports.orders o WHERE o.workspace_id = c.workspace_id AND o.customer_email = c.email) AS orders
       FROM sports.customers c WHERE ${where} ORDER BY c.name, c.email`,
      params,
    );
    return r.rows.map((x) => ({ email: x.email, name: x.name, addresses: Number(x.addresses), orders: Number(x.orders) }));
  }

  async getCustomer(ws: string, email: string): Promise<CustomerDetail | null> {
    const c = (await this.pool.query<SportCustomer>("SELECT email, name FROM sports.customers WHERE workspace_id = $1 AND email = $2", [ws, email.trim().toLowerCase()])).rows[0];
    if (!c) return null;
    const a = await this.pool.query<AddressRow>("SELECT * FROM sports.addresses WHERE workspace_id = $1 AND customer_email = $2 ORDER BY is_default DESC, code", [ws, c.email]);
    return { email: c.email, name: c.name, addresses: a.rows.map(toAddress) };
  }

  async listOrders(ws: string, f: OrderFilter) {
    const params: unknown[] = [ws, f.limit + 1];
    let where = "workspace_id = $1";
    const add = (sql: string, v: unknown) => {
      params.push(v);
      where += ` AND ${sql.replace("?", `$${params.length}`)}`;
    };
    if (f.customerEmail) add("customer_email = ?", f.customerEmail.trim().toLowerCase());
    if (f.status) add("status = ?", f.status);
    if (f.placedFrom) add("placed_on >= ?::date", f.placedFrom);
    if (f.placedTo) add("placed_on <= ?::date", f.placedTo);
    if (f.cursor) add("order_no > ?", f.cursor);
    const r = await this.pool.query<OrderRow>(`SELECT ${ORDER_COLS} FROM sports.orders WHERE ${where} ORDER BY order_no LIMIT $2`, params);
    const items = await readViews(this.pool, ws, r.rows.slice(0, f.limit).map(toOrder));
    return { items, nextCursor: r.rows.length > f.limit ? (items[items.length - 1]?.orderNo ?? null) : null };
  }

  async getOrder(ws: string, orderNo: string): Promise<OrderView | null> {
    const r = await this.pool.query<OrderRow>(`SELECT ${ORDER_COLS} FROM sports.orders WHERE workspace_id = $1 AND order_no = $2`, [ws, orderNo]);
    return r.rows[0] ? ((await readViews(this.pool, ws, [toOrder(r.rows[0])]))[0] ?? null) : null;
  }

  async listReturns(ws: string, f: ReturnFilter): Promise<SportReturn[]> {
    const params: unknown[] = [ws];
    let where = "workspace_id = $1";
    if (f.orderNo) {
      params.push(f.orderNo);
      where += ` AND order_no = $${params.length}`;
    }
    if (f.customerEmail) {
      params.push(f.customerEmail.trim().toLowerCase());
      where += ` AND order_no IN (SELECT order_no FROM sports.orders WHERE workspace_id = $1 AND customer_email = $${params.length})`;
    }
    const r = await this.pool.query<ReturnRow>(`SELECT ${RETURN_COLS} FROM sports.returns WHERE ${where} ORDER BY return_no`, params);
    return r.rows.map(toReturn);
  }

  async placeOrder(ws: string, req: SportsOrderRequest): Promise<OrderView> {
    const orderNo = await withTx(this.pool, (c) => this.insertOrder(c, ws, req));
    // Read back after the commit: getOrder uses the pool, which cannot see the open transaction.
    return (await this.getOrder(ws, orderNo)) as OrderView;
  }

  async cancelOrder(ws: string, orderNo: string): Promise<OrderView> {
    await withTx(this.pool, async (c) => {
      const row = (await c.query<OrderRow>(`SELECT ${ORDER_COLS} FROM sports.orders WHERE workspace_id = $1 AND order_no = $2 FOR UPDATE`, [ws, orderNo])).rows[0];
      if (!row) throw new DomainError("UNKNOWN_ORDER", `no order ${orderNo}`, 404);
      const problem = sportsCancelProblem(toOrder(row));
      if (problem) refuse(problem);
      await c.query("UPDATE sports.orders SET status = 'cancelled', cancelled_on = $3 WHERE workspace_id = $1 AND order_no = $2", [ws, orderNo, SPORTS_TODAY]);
      await c.query(
        `UPDATE sports.variants v SET stock = v.stock + l.qty FROM sports.order_lines l
         WHERE l.workspace_id = $1 AND l.order_no = $2 AND v.workspace_id = l.workspace_id AND v.sku = l.sku`,
        [ws, orderNo],
      );
    });
    return (await this.getOrder(ws, orderNo)) as OrderView;
  }

  async reorder(ws: string, orderNo: string, addressCode?: string): Promise<OrderView> {
    const source = await this.getOrder(ws, orderNo);
    if (!source) throw new DomainError("UNKNOWN_ORDER", `no order ${orderNo}`, 404);
    return this.placeOrder(ws, sportsReorderRequest(source, source.lines.map((l) => ({ orderNo, sku: l.sku, qty: l.qty, unitPriceCents: l.unitPriceCents })), addressCode));
  }

  async requestReturn(ws: string, req: SportsReturnRequest): Promise<SportReturn> {
    const ask = { ...req, reason: req.reason.trim().toLowerCase() };
    const returnNo = await withTx(this.pool, async (c) => {
      // Locking the line serialises returns of it, so two writers can never return more units than were bought.
      const line = (await c.query<{ sku: string; qty: number; unit_price_cents: number }>("SELECT sku, qty, unit_price_cents FROM sports.order_lines WHERE workspace_id = $1 AND order_no = $2 AND sku = $3 FOR UPDATE", [ws, ask.orderNo, ask.sku])).rows[0];
      const order = (await c.query<OrderRow>(`SELECT ${ORDER_COLS} FROM sports.orders WHERE workspace_id = $1 AND order_no = $2`, [ws, ask.orderNo])).rows[0];
      const category = (await c.query<CategoryRow>(
        `SELECT c.key, c.name, c.return_window_days FROM sports.categories c
         JOIN sports.products p ON p.workspace_id = c.workspace_id AND p.category = c.key
         JOIN sports.variants v ON v.workspace_id = p.workspace_id AND v.product_code = p.code
         WHERE v.workspace_id = $1 AND v.sku = $2`,
        [ws, ask.sku],
      )).rows[0];
      const returns = (await c.query<ReturnRow>(`SELECT ${RETURN_COLS} FROM sports.returns WHERE workspace_id = $1 AND order_no = $2 AND sku = $3`, [ws, ask.orderNo, ask.sku])).rows.map(toReturn);
      const problem = sportsReturnProblem(ask, {
        order: order ? toOrder(order) : null,
        line: line ? { orderNo: ask.orderNo, sku: line.sku, qty: line.qty, unitPriceCents: line.unit_price_cents } : null,
        category: category ? toCategory(category) : null,
        returns,
      });
      if (problem || !line) return refuse(problem ?? { code: "NOT_IN_ORDER", message: `order ${ask.orderNo} has no line for ${ask.sku}` });
      const no = `RET-${8000 + (await next(c, ws, "return"))}`;
      await c.query(
        "INSERT INTO sports.returns (workspace_id, return_no, order_no, sku, qty, reason, requested_on, refund_cents) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        [ws, no, ask.orderNo, ask.sku, ask.qty, ask.reason, SPORTS_TODAY, ask.qty * line.unit_price_cents],
      );
      return no;
    });
    return toReturn((await this.pool.query<ReturnRow>(`SELECT ${RETURN_COLS} FROM sports.returns WHERE workspace_id = $1 AND return_no = $2`, [ws, returnNo])).rows[0] as ReturnRow);
  }

  /** The order write: lock the variants (in SKU order, so two writers never deadlock), check the rules, reserve the stock. */
  private async insertOrder(c: PoolClient, ws: string, input: SportsOrderRequest): Promise<string> {
    const req = { ...input, customerEmail: input.customerEmail.trim().toLowerCase(), addressCode: input.addressCode.trim() };
    const skus = [...new Set(req.lines.map((l) => l.sku))].sort();
    const variants = new Map((await c.query<VariantRow>("SELECT * FROM sports.variants WHERE workspace_id = $1 AND sku = ANY($2::text[]) ORDER BY sku FOR UPDATE", [ws, skus])).rows.map((r) => [r.sku, toVariant(r)]));
    const customer = (await c.query<SportCustomer>("SELECT email, name FROM sports.customers WHERE workspace_id = $1 AND email = $2", [ws, req.customerEmail])).rows[0] ?? null;
    const address = (await c.query<AddressRow>("SELECT * FROM sports.addresses WHERE workspace_id = $1 AND code = $2", [ws, req.addressCode])).rows[0];
    const problem = sportsOrderProblem(req, { customer, address: address ? toAddress(address) : null, variant: (sku) => variants.get(sku) });
    if (problem) refuse(problem);
    const ship = (await c.query<{ fee_cents: number; free_from_cents: number }>("SELECT fee_cents, free_from_cents FROM sports.shipping_policy WHERE workspace_id = $1", [ws])).rows[0];
    const lines = req.lines.map((l) => ({ ...l, unitPriceCents: variants.get(l.sku)?.priceCents ?? 0 }));
    const totals = sportsOrderTotals({ feeCents: ship?.fee_cents ?? 0, freeFromCents: ship?.free_from_cents ?? 0 }, lines);
    const no = `ORD-${60000 + (await next(c, ws, "order"))}`;
    await c.query(
      `INSERT INTO sports.orders (workspace_id, order_no, customer_email, address_code, status, placed_on, subtotal_cents, shipping_cents, total_cents)
       VALUES ($1, $2, $3, $4, 'processing', $5, $6, $7, $8)`,
      [ws, no, req.customerEmail, req.addressCode, SPORTS_TODAY, totals.subtotalCents, totals.shippingCents, totals.totalCents],
    );
    for (const [i, l] of lines.entries()) {
      await c.query("INSERT INTO sports.order_lines (workspace_id, order_no, line_no, sku, qty, unit_price_cents) VALUES ($1, $2, $3, $4, $5, $6)", [ws, no, i + 1, l.sku, l.qty, l.unitPriceCents]);
      await c.query("UPDATE sports.variants SET stock = stock - $3 WHERE workspace_id = $1 AND sku = $2", [ws, l.sku, l.qty]);
    }
    return no;
  }
}
