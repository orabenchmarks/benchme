import type { Pool } from "@benchme/core";
import { ACTIVE_STATUSES, type Binding, type IssuedCard, type SpendRequestRow, type Status, type StatusDetails } from "../domain/types.js";

type Row = {
  id: string;
  session_id: string;
  status: Status;
  credential_type: string;
  payment_details: string;
  amount: number;
  currency: string;
  merchant_name: string | null;
  merchant_url: string | null;
  context: string;
  line_items: SpendRequestRow["lineItems"];
  totals: SpendRequestRow["totals"];
  metadata: SpendRequestRow["metadata"];
  recurring: SpendRequestRow["recurring"];
  test: boolean;
  idempotency_key: string | null;
  status_details: StatusDetails;
  binding: Binding | null;
  card: IssuedCard | null;
  denial_reason: string | null;
  approval_requested_at: Date | null;
  decided_at: Date | null;
  approved_at: Date | null;
  canceled_at: Date | null;
  expires_at: Date;
  created_at: Date;
  updated_at: Date;
};

const toRow = (r: Row): SpendRequestRow => ({
  id: r.id,
  sessionId: r.session_id,
  status: r.status,
  credentialType: r.credential_type,
  paymentDetails: r.payment_details,
  amount: r.amount,
  currency: r.currency,
  merchantName: r.merchant_name,
  merchantUrl: r.merchant_url,
  context: r.context,
  lineItems: r.line_items,
  totals: r.totals,
  metadata: r.metadata,
  recurring: r.recurring,
  test: r.test,
  idempotencyKey: r.idempotency_key,
  statusDetails: r.status_details,
  binding: r.binding,
  card: r.card,
  denialReason: r.denial_reason,
  approvalRequestedAt: r.approval_requested_at,
  decidedAt: r.decided_at,
  approvedAt: r.approved_at,
  canceledAt: r.canceled_at,
  expiresAt: r.expires_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export type NewRequest = Omit<SpendRequestRow, "statusDetails" | "binding" | "card" | "denialReason" | "decidedAt" | "approvedAt" | "canceledAt" | "updatedAt">;

/** The columns a transition may set, by their row names. */
export type RequestPatch = Partial<Omit<SpendRequestRow, "id" | "sessionId" | "createdAt" | "idempotencyKey">>;

const COLUMNS: Record<keyof RequestPatch, string> = {
  status: "status",
  credentialType: "credential_type",
  paymentDetails: "payment_details",
  amount: "amount",
  currency: "currency",
  merchantName: "merchant_name",
  merchantUrl: "merchant_url",
  context: "context",
  lineItems: "line_items",
  totals: "totals",
  metadata: "metadata",
  recurring: "recurring",
  test: "test",
  statusDetails: "status_details",
  binding: "binding",
  card: "card",
  denialReason: "denial_reason",
  approvalRequestedAt: "approval_requested_at",
  decidedAt: "decided_at",
  approvedAt: "approved_at",
  canceledAt: "canceled_at",
  expiresAt: "expires_at",
  updatedAt: "updated_at",
};
const JSON_COLUMNS = new Set(["line_items", "totals", "metadata", "recurring", "status_details", "binding", "card"]);
const sqlValue = (column: string, v: unknown) => (JSON_COLUMNS.has(column) && v !== null && v !== undefined ? JSON.stringify(v) : v);

/** wallet.spend_requests. Every change is conditional on the status it expects, so concurrent calls never both win. */
export class RequestsRepo {
  constructor(private readonly pool: Pool) {}

  /** Inserts the request — or, for an idempotency key the session already used, answers the request it made then. */
  async insert(n: NewRequest): Promise<{ row: SpendRequestRow; created: boolean }> {
    const r = await this.pool.query<Row>(
      `INSERT INTO wallet.spend_requests (id, session_id, status, credential_type, payment_details, amount, currency, merchant_name, merchant_url, context,
         line_items, totals, metadata, recurring, test, idempotency_key, approval_requested_at, expires_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $19)
       ON CONFLICT (session_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
       RETURNING *`,
      [
        n.id, n.sessionId, n.status, n.credentialType, n.paymentDetails, n.amount, n.currency, n.merchantName, n.merchantUrl, n.context,
        sqlValue("line_items", n.lineItems), sqlValue("totals", n.totals), sqlValue("metadata", n.metadata), sqlValue("recurring", n.recurring),
        n.test, n.idempotencyKey, n.approvalRequestedAt, n.expiresAt, n.createdAt,
      ],
    );
    if (r.rows[0]) return { row: toRow(r.rows[0]), created: true };
    const existing = await this.pool.query<Row>("SELECT * FROM wallet.spend_requests WHERE session_id = $1 AND idempotency_key = $2", [n.sessionId, n.idempotencyKey]);
    return { row: toRow(existing.rows[0] as Row), created: false };
  }

  async get(id: string): Promise<SpendRequestRow | null> {
    const r = await this.pool.query<Row>("SELECT * FROM wallet.spend_requests WHERE id = $1", [id]);
    return r.rows[0] ? toRow(r.rows[0]) : null;
  }

  /** A session's requests, newest first: the active ones, or with `history` every one. */
  async ofSession(sessionId: string, history: boolean): Promise<SpendRequestRow[]> {
    const r = await this.pool.query<Row>(
      `SELECT * FROM wallet.spend_requests WHERE session_id = $1 ${history ? "" : "AND status = ANY($2)"} ORDER BY created_at DESC, id`,
      history ? [sessionId] : [sessionId, ACTIVE_STATUSES],
    );
    return r.rows.map(toRow);
  }

  async counts(sessionId: string, since: Date): Promise<{ lastHour: number; active: number }> {
    const r = await this.pool.query<{ last_hour: string; active: string }>(
      `SELECT count(*) FILTER (WHERE created_at >= $2) AS last_hour, count(*) FILTER (WHERE status = ANY($3)) AS active
       FROM wallet.spend_requests WHERE session_id = $1`,
      [sessionId, since, ["created", "pending_approval", "approved"]],
    );
    return { lastHour: Number(r.rows[0]?.last_hour ?? 0), active: Number(r.rows[0]?.active ?? 0) };
  }

  /** Applies `patch` if the request is still in one of `from`; null when it has moved on. */
  async change(id: string, from: readonly Status[], patch: RequestPatch): Promise<SpendRequestRow | null> {
    const entries = Object.entries(patch).filter(([, v]) => v !== undefined) as [keyof RequestPatch, unknown][];
    const sets = entries.map(([k], i) => `${COLUMNS[k]} = $${i + 3}`);
    const values = entries.map(([k, v]) => sqlValue(COLUMNS[k], v));
    const r = await this.pool.query<Row>(
      `UPDATE wallet.spend_requests SET ${[...sets, ...(patch.updatedAt ? [] : ["updated_at = now()"])].join(", ")} WHERE id = $1 AND status = ANY($2) RETURNING *`,
      [id, from, ...values],
    );
    return r.rows[0] ? toRow(r.rows[0]) : null;
  }

  /** Requests bound to a workspace's store (any store when `store` is null), oldest first. */
  async bound(workspace: string, store: string | null): Promise<SpendRequestRow[]> {
    const r = await this.pool.query<Row>(
      `SELECT * FROM wallet.spend_requests WHERE binding->>'workspace' = $1 AND ($2::text IS NULL OR binding->>'store' = $2) ORDER BY created_at, id`,
      [workspace, store],
    );
    return r.rows.map(toRow);
  }

  /**
   * Approved requests no checkout was found for when they were decided (binding fallback), not canceled, approved at
   * or after `since`, for exactly `amount` cents with an issued card ending `last4`: what a store's payment may
   * claim (DESIGN §6.3). Oldest approval first.
   */
  async claimable(amount: number, last4: string, since: Date): Promise<SpendRequestRow[]> {
    const r = await this.pool.query<Row>(
      `SELECT * FROM wallet.spend_requests
       WHERE binding->>'rule' = 'fallback' AND approved_at IS NOT NULL AND approved_at >= $3 AND canceled_at IS NULL
         AND amount = $1 AND right(card->>'number', 4) = $2
       ORDER BY approved_at, id`,
      [amount, last4, since],
    );
    return r.rows.map(toRow);
  }

  /** Binds a fallback request to a store's payment — only while it is still unbound (a concurrent claim wins once); null otherwise. */
  async claim(id: string, binding: Binding): Promise<SpendRequestRow | null> {
    const r = await this.pool.query<Row>(
      `UPDATE wallet.spend_requests SET binding = $2, updated_at = now() WHERE id = $1 AND binding->>'rule' = 'fallback' RETURNING *`,
      [id, JSON.stringify(binding)],
    );
    return r.rows[0] ? toRow(r.rows[0]) : null;
  }

  /** Every request created at or after `since`, oldest first (at most `limit`). */
  async since(since: Date, limit: number): Promise<SpendRequestRow[]> {
    const r = await this.pool.query<Row>("SELECT * FROM wallet.spend_requests WHERE created_at >= $1 ORDER BY created_at, id LIMIT $2", [since, limit]);
    return r.rows.map(toRow);
  }
}
