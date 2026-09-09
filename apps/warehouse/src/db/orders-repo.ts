import { withTx, type Pool } from "@benchme/core";
import { DomainError } from "@benchme/site-kit";

export type OrderRow = { orderNo: string; customerCode: string; status: "open" | "shipped" | "cancelled"; placedAt: string };
export type OrderLineRow = { sku: string; qty: number; unitPriceCents: number };
export type OrderDetail = OrderRow & { lines: OrderLineRow[]; totalCents: number };
export type TransferRow = { transferNo: string; sku: string; fromCode: string; toCode: string; qty: number; status: "pending" | "completed" | "cancelled" };

export { DomainError };

/** Orders and transfers: the write side, with the business preconditions tasks will probe. */
export interface OrdersRepo {
  listOrders(ws: string, q: { status?: string; customer?: string; cursor?: string; limit: number }): Promise<{ items: OrderRow[]; nextCursor: string | null }>;
  getOrder(ws: string, orderNo: string): Promise<OrderDetail | null>;
  createOrder(ws: string, customerCode: string, lines: { sku: string; qty: number }[]): Promise<OrderDetail>;
  cancelOrder(ws: string, orderNo: string): Promise<OrderDetail>;
  listTransfers(ws: string, status?: string): Promise<TransferRow[]>;
  getTransfer(ws: string, transferNo: string): Promise<TransferRow | null>;
  /** Reserves stock at the source immediately (qty must be available there). */
  createTransfer(ws: string, input: { sku: string; fromCode: string; toCode: string; qty: number }): Promise<TransferRow>;
  /** Moves the reserved qty into the destination; idempotent for an already-completed transfer. */
  completeTransfer(ws: string, transferNo: string): Promise<TransferRow>;
}

type ORow = { order_no: string; customer_code: string; status: OrderRow["status"]; placed_at: Date };
const toOrder = (r: ORow): OrderRow => ({ orderNo: r.order_no, customerCode: r.customer_code, status: r.status, placedAt: r.placed_at.toISOString() });
type TRow = { transfer_no: string; sku: string; from_code: string; to_code: string; qty: number; status: TransferRow["status"] };
const toTransfer = (r: TRow): TransferRow => ({ transferNo: r.transfer_no, sku: r.sku, fromCode: r.from_code, toCode: r.to_code, qty: r.qty, status: r.status });

export class PgOrdersRepo implements OrdersRepo {
  constructor(private readonly pool: Pool) {}

  async listOrders(ws: string, q: { status?: string; customer?: string; cursor?: string; limit: number }) {
    const params: unknown[] = [ws, q.limit + 1];
    let where = "workspace_id = $1";
    if (q.status) {
      params.push(q.status);
      where += ` AND status = $${params.length}`;
    }
    if (q.customer) {
      params.push(q.customer);
      where += ` AND customer_code = $${params.length}`;
    }
    if (q.cursor) {
      params.push(q.cursor);
      where += ` AND order_no > $${params.length}`;
    }
    const r = await this.pool.query<ORow>(`SELECT * FROM warehouse.orders WHERE ${where} ORDER BY order_no LIMIT $2`, params);
    const items = r.rows.slice(0, q.limit).map(toOrder);
    return { items, nextCursor: r.rows.length > q.limit ? (items[items.length - 1]?.orderNo ?? null) : null };
  }

  async getOrder(ws: string, orderNo: string): Promise<OrderDetail | null> {
    const o = await this.pool.query<ORow>("SELECT * FROM warehouse.orders WHERE workspace_id = $1 AND order_no = $2", [ws, orderNo]);
    if (!o.rows[0]) return null;
    const l = await this.pool.query<{ sku: string; qty: number; unit_price_cents: number }>(
      `SELECT l.sku, l.qty, p.unit_price_cents FROM warehouse.order_lines l
         JOIN warehouse.products p ON p.workspace_id = l.workspace_id AND p.sku = l.sku
        WHERE l.workspace_id = $1 AND l.order_no = $2 ORDER BY l.sku`,
      [ws, orderNo],
    );
    const lines = l.rows.map((x) => ({ sku: x.sku, qty: x.qty, unitPriceCents: x.unit_price_cents }));
    return { ...toOrder(o.rows[0]), lines, totalCents: lines.reduce((s, x) => s + x.qty * x.unitPriceCents, 0) };
  }

  async createOrder(ws: string, customerCode: string, lines: { sku: string; qty: number }[]): Promise<OrderDetail> {
    if (lines.length === 0) throw new DomainError("EMPTY_ORDER", "an order needs at least one line");
    const orderNo = await withTx(this.pool, async (c) => {
      const cust = await c.query("SELECT 1 FROM warehouse.customers WHERE workspace_id = $1 AND code = $2", [ws, customerCode]);
      if (!cust.rowCount) throw new DomainError("UNKNOWN_CUSTOMER", `no customer ${customerCode}`);
      for (const line of lines) {
        const p = await c.query("SELECT 1 FROM warehouse.products WHERE workspace_id = $1 AND sku = $2", [ws, line.sku]);
        if (!p.rowCount) throw new DomainError("UNKNOWN_SKU", `no product ${line.sku}`);
      }
      const n = await c.query<{ value: number }>(
        `INSERT INTO warehouse.counters (workspace_id, name, value) VALUES ($1, 'order', 1)
         ON CONFLICT (workspace_id, name) DO UPDATE SET value = warehouse.counters.value + 1 RETURNING value`,
        [ws],
      );
      const orderNo = `SO-${String(30000 + (n.rows[0]?.value ?? 0))}`;
      await c.query("INSERT INTO warehouse.orders (workspace_id, order_no, customer_code, status, placed_at) VALUES ($1, $2, $3, 'open', now())", [ws, orderNo, customerCode]);
      for (const line of lines) {
        await c.query(
          `INSERT INTO warehouse.order_lines (workspace_id, order_no, sku, qty) VALUES ($1, $2, $3, $4)
           ON CONFLICT (workspace_id, order_no, sku) DO UPDATE SET qty = warehouse.order_lines.qty + EXCLUDED.qty`,
          [ws, orderNo, line.sku, line.qty],
        );
      }
      return orderNo;
    });
    return (await this.getOrder(ws, orderNo)) as OrderDetail;
  }

  async cancelOrder(ws: string, orderNo: string): Promise<OrderDetail> {
    const cur = await this.getOrder(ws, orderNo);
    if (!cur) throw new DomainError("UNKNOWN_ORDER", `no order ${orderNo}`, 404);
    if (cur.status === "shipped") throw new DomainError("ALREADY_SHIPPED", `order ${orderNo} has shipped and cannot be cancelled`, 409);
    await this.pool.query("UPDATE warehouse.orders SET status = 'cancelled' WHERE workspace_id = $1 AND order_no = $2", [ws, orderNo]);
    return (await this.getOrder(ws, orderNo)) as OrderDetail;
  }

  async listTransfers(ws: string, status?: string): Promise<TransferRow[]> {
    const params: unknown[] = [ws];
    let where = "workspace_id = $1";
    if (status) {
      params.push(status);
      where += " AND status = $2";
    }
    const r = await this.pool.query<TRow>(`SELECT * FROM warehouse.transfers WHERE ${where} ORDER BY transfer_no`, params);
    return r.rows.map(toTransfer);
  }

  async getTransfer(ws: string, transferNo: string): Promise<TransferRow | null> {
    const r = await this.pool.query<TRow>("SELECT * FROM warehouse.transfers WHERE workspace_id = $1 AND transfer_no = $2", [ws, transferNo]);
    return r.rows[0] ? toTransfer(r.rows[0]) : null;
  }

  async createTransfer(ws: string, input: { sku: string; fromCode: string; toCode: string; qty: number }): Promise<TransferRow> {
    if (input.fromCode === input.toCode) throw new DomainError("SAME_LOCATION", "source and destination must differ");
    if (input.qty <= 0) throw new DomainError("BAD_QTY", "qty must be positive");
    const transferNo = await withTx(this.pool, async (c) => {
      const dest = await c.query("SELECT 1 FROM warehouse.locations WHERE workspace_id = $1 AND code = $2", [ws, input.toCode]);
      if (!dest.rowCount) throw new DomainError("UNKNOWN_LOCATION", `no location ${input.toCode}`);
      const src = await c.query<{ qty: number }>(
        "SELECT qty FROM warehouse.stock WHERE workspace_id = $1 AND sku = $2 AND location_code = $3 FOR UPDATE",
        [ws, input.sku, input.fromCode],
      );
      const available = src.rows[0]?.qty ?? 0;
      if (available < input.qty) {
        throw new DomainError("INSUFFICIENT_STOCK", `only ${available} of ${input.sku} at ${input.fromCode}; ${input.qty} requested`);
      }
      await c.query("UPDATE warehouse.stock SET qty = qty - $4 WHERE workspace_id = $1 AND sku = $2 AND location_code = $3", [ws, input.sku, input.fromCode, input.qty]);
      const n = await c.query<{ value: number }>(
        `INSERT INTO warehouse.counters (workspace_id, name, value) VALUES ($1, 'transfer', 1)
         ON CONFLICT (workspace_id, name) DO UPDATE SET value = warehouse.counters.value + 1 RETURNING value`,
        [ws],
      );
      const transferNo = `TR-${String(900 + (n.rows[0]?.value ?? 0))}`;
      await c.query(
        "INSERT INTO warehouse.transfers (workspace_id, transfer_no, sku, from_code, to_code, qty, status) VALUES ($1, $2, $3, $4, $5, $6, 'pending')",
        [ws, transferNo, input.sku, input.fromCode, input.toCode, input.qty],
      );
      return transferNo;
    });
    return (await this.getTransfer(ws, transferNo)) as TransferRow;
  }

  async completeTransfer(ws: string, transferNo: string): Promise<TransferRow> {
    return withTx(this.pool, async (c) => {
      const t = await c.query<TRow>("SELECT * FROM warehouse.transfers WHERE workspace_id = $1 AND transfer_no = $2 FOR UPDATE", [ws, transferNo]);
      const row = t.rows[0];
      if (!row) throw new DomainError("UNKNOWN_TRANSFER", `no transfer ${transferNo}`, 404);
      if (row.status === "completed") return toTransfer(row);
      if (row.status === "cancelled") throw new DomainError("CANCELLED", `transfer ${transferNo} was cancelled`, 409);
      await c.query(
        `INSERT INTO warehouse.stock (workspace_id, sku, location_code, qty) VALUES ($1, $2, $3, $4)
         ON CONFLICT (workspace_id, sku, location_code) DO UPDATE SET qty = warehouse.stock.qty + EXCLUDED.qty`,
        [ws, row.sku, row.to_code, row.qty],
      );
      await c.query("UPDATE warehouse.transfers SET status = 'completed' WHERE workspace_id = $1 AND transfer_no = $2", [ws, transferNo]);
      return toTransfer({ ...row, status: "completed" });
    });
  }
}
