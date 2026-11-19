import { withTx, type Pool, type PoolClient } from "@benchme/core";
import {
  PIZZA_CHEESES, PIZZA_CRUSTS, PIZZA_MAX_LINES, PIZZA_MAX_QUANTITY, PIZZA_MAX_TOPPINGS, PIZZA_SAUCES, PIZZA_SIZE_KEYS, PIZZA_SLOT_TIMES, PIZZA_WINDOW,
  pizzaChangeLine, pizzaConfigProblem, pizzaDiet, pizzaLockProblem, pizzaMenuSearch, pizzaOutOfStock, pizzaPlaceOrder, pizzaQuote, pizzaSlots, pizzaUnitCents,
  type PizzaBranch, type PizzaDiet, type PizzaLineChange, type PizzaMenuItem, type PizzaMenuOffer, type PizzaMenuQuery, type PizzaOrder, type PizzaOrderInput, type PizzaOrderStatus,
  type PizzaProblem, type PizzaQuote, type PizzaQuoteInput, type PizzaRows, type PizzaSizeKey, type PizzaSlot, type PizzaSlotQuery,
} from "@benchme/scenarios";
import { DomainError } from "@benchme/site-kit";
import { ORDER_COLS, toBranch, toLine, toOrder, toPizza, toSize, toStockout, toTopping, type BranchRow, type LineRow, type OrderLineView, type OrderRow, type OrderView, type PizzaRow, type SizeRow, type StockoutRow, type ToppingRow } from "./rows.js";

export type { OrderLineView, OrderView } from "./rows.js";
export type BranchView = PizzaBranch & { outOfStock: string[] };
export type MenuView = PizzaMenuItem & PizzaDiet & { pricesCents: Partial<Record<PizzaSizeKey, number>>; unavailableAt: string[] };
export type Builder = Pick<PizzaRows, "sizes" | "toppings"> & {
  crusts: typeof PIZZA_CRUSTS; sauces: typeof PIZZA_SAUCES; cheeses: typeof PIZZA_CHEESES; maxToppings: number; maxQuantity: number; maxLines: number; slotTimes: readonly string[]; window: typeof PIZZA_WINDOW;
};
export type OrderFilter = { customerEmail?: string; branch?: string; status?: PizzaOrderStatus; date?: string; cursor?: string; limit: number };
export type NewOrder = PizzaOrderInput & { customerName: string; customerEmail: string };
type Catalog = Omit<PizzaRows, "orders">;

/**
 * Sizes, toppings, the menu, branches, stock and orders. Every rule (options,
 * stock, slot room, the window, totals, what can still be changed) is
 * @benchme/scenarios' pizza rules — the same functions the answer keys are
 * derived with — applied here inside the write's transaction.
 */
export interface PizzaRepo {
  builder(ws: string): Promise<Builder>;
  branches(ws: string, city?: string): Promise<BranchView[]>;
  branch(ws: string, code: string): Promise<BranchView | null>;
  slots(ws: string, q: PizzaSlotQuery): Promise<PizzaSlot[]>;
  menu(ws: string): Promise<MenuView[]>;
  pizza(ws: string, code: string): Promise<MenuView | null>;
  search(ws: string, q: PizzaMenuQuery): Promise<PizzaMenuOffer[]>;
  quote(ws: string, input: PizzaQuoteInput): Promise<PizzaQuote>;
  listOrders(ws: string, f: OrderFilter): Promise<{ items: OrderView[]; nextCursor: string | null }>;
  getOrder(ws: string, orderNo: string): Promise<OrderView | null>;
  placeOrder(ws: string, input: NewOrder): Promise<OrderView>;
  /** Only while the order is received. */
  changeLine(ws: string, orderNo: string, line: number, change: PizzaLineChange): Promise<OrderView>;
  /** received → cancelled; nothing else can be cancelled. */
  cancelOrder(ws: string, orderNo: string): Promise<OrderView>;
}

/** Full slots, missing stock and a locked order are conflicts (409); a missing branch, pizza, order or line is 404; everything else a caller can fix is 422. */
const STATUS: Record<string, number> = { SLOT_FULL: 409, TOPPING_OUT: 409, ORDER_LOCKED: 409, ALREADY_CANCELLED: 409, UNKNOWN_BRANCH: 404, UNKNOWN_PIZZA: 404, UNKNOWN_LINE: 404, UNKNOWN_ORDER: 404 };
const refuse = (p: PizzaProblem): never => {
  throw new DomainError(p.code, p.message, STATUS[p.code] ?? 422);
};
type Q = Pool | PoolClient;

export class PgPizzaRepo implements PizzaRepo {
  constructor(private readonly pool: Pool) {}

  async builder(ws: string): Promise<Builder> {
    const { sizes, toppings } = await this.catalog(this.pool, ws);
    return { sizes, toppings, crusts: PIZZA_CRUSTS, sauces: PIZZA_SAUCES, cheeses: PIZZA_CHEESES, maxToppings: PIZZA_MAX_TOPPINGS, maxQuantity: PIZZA_MAX_QUANTITY, maxLines: PIZZA_MAX_LINES, slotTimes: PIZZA_SLOT_TIMES, window: PIZZA_WINDOW };
  }

  async branches(ws: string, city?: string): Promise<BranchView[]> {
    const c = await this.catalog(this.pool, ws);
    return c.branches.filter((b) => !city || b.city.toLowerCase() === city.trim().toLowerCase()).map((b) => this.branchView(c, b));
  }

  async branch(ws: string, code: string): Promise<BranchView | null> {
    const c = await this.catalog(this.pool, ws);
    const b = c.branches.find((x) => x.code === code.trim().toUpperCase());
    return b ? this.branchView(c, b) : null;
  }

  async slots(ws: string, q: PizzaSlotQuery): Promise<PizzaSlot[]> {
    const c = await this.catalog(this.pool, ws);
    const branch = c.branches.find((b) => b.code === q.branchCode.trim().toUpperCase());
    if (!branch) refuse({ code: "UNKNOWN_BRANCH", message: `no branch ${q.branchCode}` });
    return pizzaSlots({ branches: c.branches, orders: await this.dayOrders(this.pool, ws, branch?.code ?? "", q.date) }, q);
  }

  async menu(ws: string): Promise<MenuView[]> {
    const c = await this.catalog(this.pool, ws);
    return c.pizzas.map((p) => this.menuView(c, p));
  }

  async pizza(ws: string, code: string): Promise<MenuView | null> {
    const c = await this.catalog(this.pool, ws);
    const p = c.pizzas.find((x) => x.code === code.trim().toUpperCase());
    return p ? this.menuView(c, p) : null;
  }

  async search(ws: string, q: PizzaMenuQuery): Promise<PizzaMenuOffer[]> {
    return pizzaMenuSearch(await this.catalog(this.pool, ws), q);
  }

  async quote(ws: string, input: PizzaQuoteInput): Promise<PizzaQuote> {
    const r = pizzaQuote(await this.catalog(this.pool, ws), input);
    return "problem" in r ? refuse(r.problem) : r.quote;
  }

  async listOrders(ws: string, f: OrderFilter) {
    const params: unknown[] = [ws, f.limit + 1];
    let where = "workspace_id = $1";
    const add = (sql: string, v: unknown) => {
      params.push(v);
      where += ` AND ${sql.replace("?", `$${params.length}`)}`;
    };
    if (f.customerEmail) add("lower(customer_email) = ?", f.customerEmail.trim().toLowerCase());
    if (f.branch) add("branch_code = ?", f.branch.trim().toUpperCase());
    if (f.status) add("status = ?", f.status);
    if (f.date) add("to_char(slot_date, 'YYYY-MM-DD') = ?", f.date);
    if (f.cursor) add("order_no > ?", f.cursor);
    const r = await this.pool.query<OrderRow>(`SELECT ${ORDER_COLS} FROM pizza.orders WHERE ${where} ORDER BY order_no LIMIT $2`, params);
    const page = r.rows.slice(0, f.limit);
    const lines = await this.linesOf(this.pool, ws, page.map((o) => o.order_no));
    const out = page.map((o) => toOrder(o, lines.get(o.order_no) ?? []));
    return { items: out, nextCursor: r.rows.length > f.limit ? (out[out.length - 1]?.orderNo ?? null) : null };
  }

  async getOrder(ws: string, orderNo: string): Promise<OrderView | null> {
    return this.orderIn(this.pool, ws, orderNo.trim().toUpperCase());
  }

  async placeOrder(ws: string, input: NewOrder): Promise<OrderView> {
    const customerName = input.customerName.trim();
    const customerEmail = input.customerEmail.trim().toLowerCase();
    if (!customerName) refuse({ code: "NO_CUSTOMER_NAME", message: "an order needs the customer's name" });
    const orderNo = await withTx(this.pool, async (c) => {
      // Locking the branch serialises its orders, so two writers can never both take a slot's last pizzas.
      const branchCode = await this.lockBranch(c, ws, input.branchCode);
      const world = { ...(await this.catalog(c, ws)), orders: await this.dayOrders(c, ws, branchCode, input.slotDate) };
      const r = pizzaPlaceOrder(world, input);
      if ("problem" in r) return refuse(r.problem);
      const n = await c.query<{ value: number }>(
        `INSERT INTO pizza.counters (workspace_id, name, value) VALUES ($1, 'order', 1)
         ON CONFLICT (workspace_id, name) DO UPDATE SET value = pizza.counters.value + 1 RETURNING value`,
        [ws],
      );
      const no = `PO-${50000 + (n.rows[0]?.value ?? 0)}`;
      const q = r.quote;
      await c.query(
        `INSERT INTO pizza.orders (workspace_id, order_no, branch_code, customer_name, customer_email, fulfilment, address, slot_date, slot_time, status, subtotal_cents, delivery_fee_cents, total_cents)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'received', $10, $11, $12)`,
        [ws, no, q.branchCode, customerName, customerEmail, q.fulfilment, q.fulfilment === "delivery" ? (input.address ?? "").trim() : null, input.slotDate, input.slotTime, q.subtotalCents, q.deliveryFeeCents, q.totalCents],
      );
      await this.writeLines(c, ws, no, q.lines);
      return no;
    });
    // Read back after the commit: the pool cannot see the open transaction.
    return (await this.getOrder(ws, orderNo)) as OrderView;
  }

  async changeLine(ws: string, orderNo: string, line: number, change: PizzaLineChange): Promise<OrderView> {
    const no = orderNo.trim().toUpperCase();
    await withTx(this.pool, async (c) => {
      const head = (await c.query<{ branch_code: string }>("SELECT branch_code FROM pizza.orders WHERE workspace_id = $1 AND order_no = $2", [ws, no])).rows[0];
      if (!head) return refuse({ code: "UNKNOWN_ORDER", message: `no order ${no}` });
      await this.lockBranch(c, ws, head.branch_code);
      const order = (await this.orderIn(c, ws, no)) as OrderView;
      const world = { ...(await this.catalog(c, ws)), orders: await this.dayOrders(c, ws, order.branchCode, order.slotDate) };
      const r = pizzaChangeLine(world, order, line, change);
      if ("problem" in r) return refuse(r.problem);
      // The order was read above without its row locked, and a cancel takes no branch lock: this write is the one that holds the rule, so a cancel landing in between wins.
      const w = await c.query("UPDATE pizza.orders SET subtotal_cents = $3, delivery_fee_cents = $4, total_cents = $5, updated_at = now() WHERE workspace_id = $1 AND order_no = $2 AND status = 'received'", [
        ws, no, r.order.subtotalCents, r.order.deliveryFeeCents, r.order.totalCents,
      ]);
      if (!w.rowCount) {
        const now = await this.orderIn(c, ws, no);
        if (!now) return refuse({ code: "UNKNOWN_ORDER", message: `no order ${no}` });
        return refuse(pizzaLockProblem(now) ?? { code: "ORDER_LOCKED", message: `order ${no} cannot be changed` });
      }
      await c.query("DELETE FROM pizza.order_lines WHERE workspace_id = $1 AND order_no = $2", [ws, no]);
      await this.writeLines(c, ws, no, r.order.lines);
    });
    return (await this.getOrder(ws, no)) as OrderView;
  }

  async cancelOrder(ws: string, orderNo: string): Promise<OrderView> {
    const no = orderNo.trim().toUpperCase();
    const r = await this.pool.query("UPDATE pizza.orders SET status = 'cancelled', cancelled_at = now() WHERE workspace_id = $1 AND order_no = $2 AND status = 'received'", [ws, no]);
    if (!r.rowCount) {
      const o = await this.getOrder(ws, no);
      if (!o) refuse({ code: "UNKNOWN_ORDER", message: `no order ${no}` });
      refuse(pizzaLockProblem(o as OrderView) ?? { code: "ORDER_LOCKED", message: `order ${no} cannot be cancelled` });
    }
    return (await this.getOrder(ws, no)) as OrderView;
  }

  private branchView(c: Catalog, b: PizzaBranch): BranchView {
    return { ...b, outOfStock: c.stockouts.filter((s) => s.branchCode === b.code).map((s) => s.toppingKey).sort() };
  }

  private menuView(c: Catalog, p: PizzaMenuItem): MenuView {
    const prices: Partial<Record<PizzaSizeKey, number>> = {};
    for (const size of PIZZA_SIZE_KEYS) {
      const config = { size, crust: p.crust, sauce: p.sauce, cheese: p.cheese, toppings: p.toppings };
      if (!pizzaConfigProblem(c, config)) prices[size] = pizzaUnitCents(c, config);
    }
    const unavailableAt = c.branches.filter((b) => pizzaOutOfStock(c.stockouts, b.code, p.toppings).length > 0).map((b) => b.code);
    return { ...p, ...pizzaDiet(c, p), pricesCents: prices, unavailableAt };
  }

  private async lockBranch(c: PoolClient, ws: string, code: string): Promise<string> {
    const r = await c.query<{ code: string }>("SELECT code FROM pizza.branches WHERE workspace_id = $1 AND code = $2 FOR UPDATE", [ws, code.trim().toUpperCase()]);
    return r.rows[0]?.code ?? refuse({ code: "UNKNOWN_BRANCH", message: `no branch ${code}` });
  }

  private async catalog(c: Q, ws: string): Promise<Catalog> {
    // One after another: a transaction's client takes one query at a time.
    const sizes = await c.query<SizeRow>("SELECT * FROM pizza.sizes WHERE workspace_id = $1 ORDER BY base_cents", [ws]);
    const toppings = await c.query<ToppingRow>("SELECT * FROM pizza.toppings WHERE workspace_id = $1 ORDER BY key", [ws]);
    const pizzas = await c.query<PizzaRow>("SELECT * FROM pizza.pizzas WHERE workspace_id = $1 ORDER BY code", [ws]);
    const branches = await c.query<BranchRow>("SELECT * FROM pizza.branches WHERE workspace_id = $1 ORDER BY code", [ws]);
    const stockouts = await c.query<StockoutRow>("SELECT * FROM pizza.stockouts WHERE workspace_id = $1 ORDER BY branch_code, topping_key", [ws]);
    return { sizes: sizes.rows.map(toSize), toppings: toppings.rows.map(toTopping), pizzas: pizzas.rows.map(toPizza), branches: branches.rows.map(toBranch), stockouts: stockouts.rows.map(toStockout) };
  }

  /** Every order of a branch on one date, with its lines: what a slot's room is counted from. */
  private async dayOrders(c: Q, ws: string, branchCode: string, date: string): Promise<PizzaOrder[]> {
    const r = await c.query<OrderRow>(`SELECT ${ORDER_COLS} FROM pizza.orders WHERE workspace_id = $1 AND branch_code = $2 AND to_char(slot_date, 'YYYY-MM-DD') = $3`, [ws, branchCode, date]);
    const lines = await this.linesOf(c, ws, r.rows.map((o) => o.order_no));
    return r.rows.map((o) => toOrder(o, lines.get(o.order_no) ?? []));
  }

  private async orderIn(c: Q, ws: string, no: string): Promise<OrderView | null> {
    const r = await c.query<OrderRow>(`SELECT ${ORDER_COLS} FROM pizza.orders WHERE workspace_id = $1 AND order_no = $2`, [ws, no]);
    if (!r.rows[0]) return null;
    return toOrder(r.rows[0], (await this.linesOf(c, ws, [no])).get(no) ?? []);
  }

  private async linesOf(c: Q, ws: string, orderNos: string[]): Promise<Map<string, OrderLineView[]>> {
    const out = new Map<string, OrderLineView[]>();
    if (orderNos.length === 0) return out;
    const r = await c.query<LineRow>("SELECT * FROM pizza.order_lines WHERE workspace_id = $1 AND order_no = ANY($2::text[]) ORDER BY order_no, line", [ws, orderNos]);
    for (const row of r.rows) out.set(row.order_no, [...(out.get(row.order_no) ?? []), toLine(row)]);
    return out;
  }

  private async writeLines(c: PoolClient, ws: string, no: string, lines: PizzaOrder["lines"]): Promise<void> {
    for (const i of lines) {
      await c.query(
        `INSERT INTO pizza.order_lines (workspace_id, order_no, line, pizza_code, size, crust, sauce, cheese, toppings, quantity, unit_cents, line_cents)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [ws, no, i.line, i.pizzaCode, i.size, i.crust, i.sauce, i.cheese, i.toppings, i.quantity, i.unitCents, i.lineCents],
      );
    }
  }
}
