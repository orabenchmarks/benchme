import type { Pool } from "@benchme/core";
import { withLock } from "./lock.js";

export type ShopEvent = { store: string; kind: string; data: unknown; at: string };

/** A payment attempt as Stripe recorded it (payments/attempts.ts): its idempotency key and fake mode's word for it. */
export type RecordedAttempt = { attempt: string; result: string };

/**
 * shops.events: what happened in a workspace's stores, in order — checkout_started,
 * campaign_ignored, notice_shown, price_updated, paylantern_viewed, payment_attempt, ... The audit and
 * the integrity tools read them through the internal state API.
 */
export class EventsRepo {
  constructor(private readonly pool: Pool) {}

  async record(ws: string, store: string, kind: string, data: Record<string, unknown> = {}): Promise<void> {
    await this.pool.query("INSERT INTO shops.events (workspace_id, store, kind, data) VALUES ($1, $2, $3, $4::jsonb)", [ws, store, kind, JSON.stringify(data)]);
  }

  async list(ws: string): Promise<ShopEvent[]> {
    const r = await this.pool.query<{ store: string; kind: string; data: unknown; at: Date }>("SELECT store, kind, data, at FROM shops.events WHERE workspace_id = $1 ORDER BY seq", [ws]);
    return r.rows.map((x) => ({ store: x.store, kind: x.kind, data: x.data, at: x.at.toISOString() }));
  }

  /**
   * Records a payment's attempts as Stripe has them — payment_attempt events { token, ref, result, attempt } —
   * each (ref, attempt, result) once, in the order given: what an earlier reading recorded is skipped, so the
   * completion, the reconcile step and the browser's report can each read Stripe and record what they find.
   * Readings of one payment take turns (a short transaction under a lock on it: nothing slow inside).
   * Returns how many were new.
   */
  async recordAttempts(ws: string, store: string, at: { token: string; ref: string }, attempts: readonly RecordedAttempt[]): Promise<number> {
    if (!attempts.length) return 0;
    return withLock(this.pool, `shops.attempts:${ws}`, `${store}:${at.ref}`, async (db) => {
      const r = await db.query<{ attempt: string; result: string }>(
        `SELECT data->>'attempt' AS attempt, data->>'result' AS result FROM shops.events
          WHERE workspace_id = $1 AND store = $2 AND kind = 'payment_attempt' AND data->>'ref' = $3 AND data ? 'attempt'`,
        [ws, store, at.ref],
      );
      const seen = new Set(r.rows.map((x) => `${x.attempt} ${x.result}`));
      let added = 0;
      for (const a of attempts) {
        if (seen.has(`${a.attempt} ${a.result}`)) continue;
        seen.add(`${a.attempt} ${a.result}`);
        await db.query("INSERT INTO shops.events (workspace_id, store, kind, data) VALUES ($1, $2, 'payment_attempt', $3::jsonb)", [
          ws,
          store,
          JSON.stringify({ token: at.token, ref: at.ref, result: a.result, attempt: a.attempt }),
        ]);
        added++;
      }
      return added;
    });
  }

  /** Whether a payment's attempt `attempt` (with `result`, when given) is on record. */
  async attemptOnRecord(ws: string, store: string, ref: string, attempt: string, result?: string): Promise<boolean> {
    const r = await this.pool.query(
      `SELECT 1 FROM shops.events
        WHERE workspace_id = $1 AND store = $2 AND kind = 'payment_attempt' AND data->>'ref' = $3 AND data->>'attempt' = $4
          AND ($5::text IS NULL OR data->>'result' = $5) LIMIT 1`,
      [ws, store, ref, attempt, result ?? null],
    );
    return (r.rowCount ?? 0) > 0;
  }
}
