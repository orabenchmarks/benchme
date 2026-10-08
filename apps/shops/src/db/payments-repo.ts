import type { Pool } from "@benchme/core";
import type { CartLine, Totals } from "@benchme/storefront";
import type { Delivery } from "./checkouts-repo.js";
import type { Db } from "./lock.js";

/**
 * What a payment pays for: the checkout as it stood when the payment's amount was set. The order of
 * the payment that goes through is built and graded from it — never from the live cart, which may
 * have changed since (or been emptied by an earlier order).
 */
export type PaymentSnapshot = {
  lines: CartLine[];
  /** The add-ons charged for, by SKU. */
  addOns: string[];
  shippingId: string | null;
  promo: string | null;
  marketing: boolean;
  /** Whether the workspace had signed up to the store's newsletter. */
  newsletter: boolean;
  delivery: Delivery | null;
  totals: Totals;
  /** The store-local date the information step was accepted on: what a delivery offset ("tomorrow") counts from. */
  informationDate: string | null;
};

export type PaymentKind = "intent" | "session";
export type PaymentStatus = "open" | "paid" | "expired";

export type NewPayment = {
  /** The processor's id: pi_… for an intent, cs_… for a session. */
  ref: string;
  checkoutToken: string;
  store: string;
  kind: PaymentKind;
  amountCents: number;
  snapshot: PaymentSnapshot;
  /** An intent's client secret, handed to the next attempt of its checkout. */
  clientSecret?: string | null;
};

export type PaymentRow = Omit<NewPayment, "clientSecret"> & {
  status: PaymentStatus;
  /** Once paid: the order's payment ref (a session's PaymentIntent, an intent's own id). */
  paidRef: string | null;
  createdAt: string;
  updatedAt: string;
};

type Row = {
  payment_ref: string;
  checkout_token: string;
  store: string;
  kind: PaymentKind;
  amount_cents: number;
  snapshot: PaymentSnapshot;
  status: PaymentStatus;
  paid_ref: string | null;
  created_at: Date;
  updated_at: Date;
};

const COLUMNS = "payment_ref, checkout_token, store, kind, amount_cents, snapshot, status, paid_ref, created_at, updated_at";

const toPayment = (r: Row): PaymentRow => ({
  ref: r.payment_ref,
  checkoutToken: r.checkout_token,
  store: r.store,
  kind: r.kind,
  amountCents: r.amount_cents,
  snapshot: r.snapshot,
  status: r.status,
  paidRef: r.paid_ref,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});

/**
 * shops.payments: every intent and session a checkout created, with what it pays for. Every method is
 * workspace-scoped; the ones a payment step runs under its checkout's lock take that transaction's `db`.
 */
export class PaymentsRepo {
  constructor(private readonly pool: Pool) {}

  /**
   * Records a payment, or brings an open one up to date (an intent's amount follows its checkout). A paid
   * or expired payment keeps what it was for.
   */
  async save(ws: string, p: NewPayment, db: Db = this.pool): Promise<void> {
    await db.query(
      `INSERT INTO shops.payments (workspace_id, payment_ref, checkout_token, store, kind, amount_cents, snapshot, client_secret)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
       ON CONFLICT (workspace_id, payment_ref) DO UPDATE SET
         amount_cents = EXCLUDED.amount_cents,
         snapshot = EXCLUDED.snapshot,
         client_secret = COALESCE(EXCLUDED.client_secret, shops.payments.client_secret),
         updated_at = now()
       WHERE shops.payments.status = 'open'`,
      [ws, p.ref, p.checkoutToken, p.store, p.kind, p.amountCents, JSON.stringify(p.snapshot), p.clientSecret ?? null],
    );
  }

  async get(ws: string, ref: string, db: Db = this.pool): Promise<PaymentRow | null> {
    const r = await db.query<Row>(`SELECT ${COLUMNS} FROM shops.payments WHERE workspace_id = $1 AND payment_ref = $2`, [ws, ref]);
    return r.rows[0] ? toPayment(r.rows[0]) : null;
  }

  /** The payment an order's payment ref paid (a session, found by its PaymentIntent). */
  async paidBy(ws: string, paidRef: string): Promise<PaymentRow | null> {
    const r = await this.pool.query<Row>(`SELECT ${COLUMNS} FROM shops.payments WHERE workspace_id = $1 AND paid_ref = $2 ORDER BY created_at LIMIT 1`, [ws, paidRef]);
    return r.rows[0] ? toPayment(r.rows[0]) : null;
  }

  /** A checkout's intent — the latest it created — with its client secret, or null. */
  async currentIntent(ws: string, token: string, db: Db = this.pool): Promise<{ ref: string; clientSecret: string } | null> {
    const r = await db.query<{ payment_ref: string; client_secret: string | null }>(
      `SELECT payment_ref, client_secret FROM shops.payments
        WHERE workspace_id = $1 AND checkout_token = $2 AND kind = 'intent'
        ORDER BY created_at DESC, payment_ref DESC LIMIT 1`,
      [ws, token],
    );
    const row = r.rows[0];
    return row?.client_secret ? { ref: row.payment_ref, clientSecret: row.client_secret } : null;
  }

  /** A checkout's payments (of one kind, if given), oldest first. */
  async ofCheckout(ws: string, token: string, kind?: PaymentKind, db: Db = this.pool): Promise<PaymentRow[]> {
    const r = await db.query<Row>(
      `SELECT ${COLUMNS} FROM shops.payments WHERE workspace_id = $1 AND checkout_token = $2 AND ($3::text IS NULL OR kind = $3) ORDER BY created_at, payment_ref`,
      [ws, token, kind ?? null],
    );
    return r.rows.map(toPayment);
  }

  /** A store's payments that may still go through (or have, unseen), oldest first. */
  async open(ws: string, store: string): Promise<PaymentRow[]> {
    const r = await this.pool.query<Row>(`SELECT ${COLUMNS} FROM shops.payments WHERE workspace_id = $1 AND store = $2 AND status = 'open' ORDER BY created_at, payment_ref`, [ws, store]);
    return r.rows.map(toPayment);
  }

  /** Its order exists. A session that was paid as it expired is paid all the same. */
  async markPaid(ws: string, ref: string, paidRef: string, db: Db = this.pool): Promise<void> {
    await db.query("UPDATE shops.payments SET status = 'paid', paid_ref = $3, updated_at = now() WHERE workspace_id = $1 AND payment_ref = $2", [ws, ref, paidRef]);
  }

  /** A session the processor no longer takes; a paid one stays paid. */
  async markExpired(ws: string, ref: string, db: Db = this.pool): Promise<void> {
    await db.query("UPDATE shops.payments SET status = 'expired', updated_at = now() WHERE workspace_id = $1 AND payment_ref = $2 AND status = 'open'", [ws, ref]);
  }

  /** Every payment of a workspace, oldest first. */
  async list(ws: string): Promise<PaymentRow[]> {
    const r = await this.pool.query<Row>(`SELECT ${COLUMNS} FROM shops.payments WHERE workspace_id = $1 ORDER BY created_at, payment_ref`, [ws]);
    return r.rows.map(toPayment);
  }
}
