import type { Pool } from "@benchme/core";
import { newOrderNumber, parseOrderNumber, type CartLine, type OutcomeClass, type Totals } from "@benchme/storefront";
import type { Delivery } from "./checkouts-repo.js";
import { withLock, type Db } from "./lock.js";

/** What was paid for besides the lines — kept on the order for the audit and the integrity tools. */
export type OrderDetails = { shippingId: string | null; addOns: string[]; promo: string | null; marketing: boolean; delivery: Delivery | null };

export type NewOrder = {
  orderNo: string;
  store: string;
  checkoutToken: string;
  paymentRef: string;
  /** What was paid for: the lines and totals of the payment's snapshot. */
  lines: CartLine[];
  totals: Totals;
  outcomeClass: OutcomeClass;
  scenarioId: string | null;
  email: string;
  details: OrderDetails;
  /** What the processor charged (its amount, not a recomputation). */
  chargedCents?: number | null;
};

export type OrderRow = Omit<NewOrder, "chargedCents"> & { chargedCents: number | null; paidAt: string };

type Row = {
  order_no: string;
  store: string;
  checkout_token: string;
  payment_ref: string;
  lines: CartLine[];
  totals: Totals;
  outcome_class: OutcomeClass;
  scenario_id: string | null;
  email: string;
  details: OrderDetails;
  charged_cents: number | null;
  paid_at: Date;
};

const toOrder = (r: Row): OrderRow => ({
  orderNo: r.order_no,
  store: r.store,
  checkoutToken: r.checkout_token,
  paymentRef: r.payment_ref,
  lines: r.lines,
  totals: r.totals,
  outcomeClass: r.outcome_class,
  scenarioId: r.scenario_id,
  email: r.email,
  details: r.details,
  chargedCents: r.charged_cents ?? null,
  paidAt: r.paid_at.toISOString(),
});

/** paid_at: when the row is written — under placeOnce's lock, so the store's orders list in the order they were counted. */
const INSERT = `INSERT INTO shops.orders (workspace_id, order_no, store, checkout_token, payment_ref, lines, totals, outcome_class, scenario_id, email, details, charged_cents, paid_at)
  VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10, $11::jsonb, $12, clock_timestamp())`;
const insertParams = (ws: string, orderNo: string, o: NewOrder) => [
  ws,
  orderNo,
  o.store,
  o.checkoutToken,
  o.paymentRef,
  JSON.stringify(o.lines),
  JSON.stringify(o.totals),
  o.outcomeClass,
  o.scenarioId,
  o.email,
  JSON.stringify(o.details),
  o.chargedCents ?? null,
];

/** The lock order placement takes: one workspace's store at a time. */
const ORDERS_LOCK = (ws: string) => `shops.orders:${ws}`;

/** How many order numbers to draw before giving up on a payment (a clash is ~1 in 900,000 per pair). */
const NUMBER_ATTEMPTS = 5;

/** The order number is taken by ANOTHER payment's order: the primary key, not the payment-ref index, refused it. */
const isTakenOrderNo = (err: unknown): boolean => {
  const e = err as { code?: string; constraint?: string };
  return e.code === "23505" && e.constraint === "orders_pkey";
};

/** Same store prefix and outcome suffix — the parts that carry meaning — with new digits. */
const withFreshDigits = (orderNo: string): string | null => {
  const p = parseOrderNumber(orderNo);
  return p ? newOrderNumber(p.prefix, p.suffix) : null;
};

async function orderOfPayment(db: Db, ws: string, paymentRef: string): Promise<string | null> {
  const r = await db.query<{ order_no: string }>("SELECT order_no FROM shops.orders WHERE workspace_id = $1 AND payment_ref = $2", [ws, paymentRef]);
  return r.rows[0]?.order_no ?? null;
}

/** shops.orders: a row exists only for a paid order. Every method is workspace-scoped. */
export class OrdersRepo {
  constructor(private readonly pool: Pool) {}

  /**
   * Inserts once per payment ref; returns the existing order on a repeat (Review
   * Focus 2) — including two completions racing, which the unique (workspace,
   * payment_ref) index settles. Should the number itself clash with another
   * payment's order, it is redrawn, so the caller must use the returned number.
   */
  async createOnce(ws: string, o: NewOrder): Promise<{ orderNo: string; created: boolean }> {
    let orderNo = o.orderNo;
    for (let attempt = 1; attempt <= NUMBER_ATTEMPTS; attempt++) {
      try {
        const ins = await this.pool.query<{ order_no: string }>(`${INSERT} ON CONFLICT (workspace_id, payment_ref) DO NOTHING RETURNING order_no`, insertParams(ws, orderNo, o));
        if (ins.rows[0]) return { orderNo: ins.rows[0].order_no, created: true };
        const existing = await this.pool.query<{ order_no: string }>("SELECT order_no FROM shops.orders WHERE workspace_id = $1 AND payment_ref = $2", [ws, o.paymentRef]);
        if (existing.rows[0]) return { orderNo: existing.rows[0].order_no, created: false };
        // The conflicting order vanished in between (its workspace was deleted): try again.
      } catch (err) {
        const fresh = attempt < NUMBER_ATTEMPTS && isTakenOrderNo(err) ? withFreshDigits(orderNo) : null;
        if (!fresh) throw err;
        orderNo = fresh;
      }
    }
    throw new Error(`could not record an order for payment ${o.paymentRef} after ${NUMBER_ATTEMPTS} attempts`);
  }

  /**
   * The order of a payment, placed once and classified in turn. Under a lock on the workspace's store,
   * in one transaction: the order this payment already made (the return URL hit twice, a completion
   * racing the reconcile step — Review Focus 2), else `build` — given the store's paid orders before
   * this one — inserted. Two payments of a store completing at once are counted one after the other,
   * so only one of them can see no earlier order (Review Focus 3). A number already taken by another
   * payment's order is drawn again with the same prefix and suffix, so use the returned number.
   * `firstOfCheckout`: the order was created and no earlier order paid its checkout (its cart is the
   * one to empty).
   */
  async placeOnce(
    ws: string,
    store: string,
    paymentRef: string,
    build: (prior: { paidOrders: number }) => NewOrder,
  ): Promise<{ orderNo: string; created: boolean; firstOfCheckout: boolean }> {
    return withLock(this.pool, ORDERS_LOCK(ws), store, async (db) => {
      const existing = await orderOfPayment(db, ws, paymentRef);
      if (existing) return { orderNo: existing, created: false, firstOfCheckout: false };
      const count = await db.query<{ n: string }>("SELECT count(*)::text AS n FROM shops.orders WHERE workspace_id = $1 AND store = $2", [ws, store]);
      const o = { ...build({ paidOrders: Number(count.rows[0]?.n ?? 0) }), paymentRef };
      const before = await db.query("SELECT 1 FROM shops.orders WHERE workspace_id = $1 AND checkout_token = $2 LIMIT 1", [ws, o.checkoutToken]);
      let orderNo = o.orderNo;
      for (let attempt = 1; attempt <= NUMBER_ATTEMPTS; attempt++) {
        // ON CONFLICT DO NOTHING on either key keeps the transaction alive: a taken number is drawn again below.
        const ins = await db.query<{ order_no: string }>(`${INSERT} ON CONFLICT DO NOTHING RETURNING order_no`, insertParams(ws, orderNo, o));
        if (ins.rows[0]) return { orderNo: ins.rows[0].order_no, created: true, firstOfCheckout: !before.rowCount };
        const same = await orderOfPayment(db, ws, paymentRef);
        if (same) return { orderNo: same, created: false, firstOfCheckout: false };
        const fresh = withFreshDigits(orderNo);
        if (!fresh) break;
        orderNo = fresh;
      }
      throw new Error(`could not record an order for payment ${paymentRef} after ${NUMBER_ATTEMPTS} attempts`);
    });
  }

  async get(ws: string, orderNo: string): Promise<OrderRow | null> {
    const r = await this.pool.query<Row>("SELECT * FROM shops.orders WHERE workspace_id = $1 AND order_no = $2", [ws, orderNo]);
    return r.rows[0] ? toOrder(r.rows[0]) : null;
  }

  /** Paid orders of one store in this workspace — what makes a second one `duplicate`. */
  async countPaid(ws: string, store: string): Promise<number> {
    const r = await this.pool.query<{ n: string }>("SELECT count(*)::text AS n FROM shops.orders WHERE workspace_id = $1 AND store = $2", [ws, store]);
    return Number(r.rows[0]?.n ?? 0);
  }

  async list(ws: string): Promise<OrderRow[]> {
    const r = await this.pool.query<Row>("SELECT * FROM shops.orders WHERE workspace_id = $1 ORDER BY paid_at, order_no", [ws]);
    return r.rows.map(toOrder);
  }
}
