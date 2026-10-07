import type { Pool } from "@benchme/core";
import { randomUUID } from "node:crypto";

/** Another process held a checkout's payment claim for longer than a step may wait: the shopper can try again. */
export class ClaimBusyError extends Error {
  constructor(readonly token: string) {
    super(`another payment step of checkout ${token} is still running`);
    this.name = "ClaimBusyError";
  }
}

export type ClaimOptions = {
  /** How long a claim lasts unless renewed: a holder that died gives it up after this. Renewed every third of it. */
  leaseMs?: number;
  /** How long a step waits for another process's claim before giving up (ClaimBusyError). */
  waitMs?: number;
  /** How often a waiting step looks again. */
  pollMs?: number;
};

/** The checkout flag the claim lives in: { owner, until }. */
const FLAG = "paymentClaim";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One payment step of a checkout at a time — finding or creating its intent, opening its hosted session — without
 * holding a connection of the pool while the step waits on the processor. The claim is a lease in the checkout's
 * flags (paymentClaim: { owner, until }), taken, renewed and given back by single statements: claim, call the
 * processor, write, give back. Steps of this process queue in memory first (no polling); a step of another process
 * polls until the claim is given back or its lease lapses (a holder that died), at most `waitMs`. A lease outlived
 * by a slow step is renewed while the step runs.
 */
export class PaymentClaims {
  private readonly queues = new Map<string, Promise<void>>();
  private readonly leaseMs: number;
  private readonly waitMs: number;
  private readonly pollMs: number;

  constructor(
    private readonly pool: Pool,
    opts: ClaimOptions = {},
  ) {
    this.leaseMs = opts.leaseMs ?? 30_000;
    this.waitMs = opts.waitMs ?? 45_000;
    this.pollMs = opts.pollMs ?? 100;
  }

  /** Runs `fn` holding the claim on checkout `token`'s payments in workspace `ws`. */
  async run<T>(ws: string, token: string, fn: () => Promise<T>): Promise<T> {
    const key = `${ws}/${token}`;
    const before = this.queues.get(key) ?? Promise.resolve();
    let done!: () => void;
    const turn = new Promise<void>((r) => (done = r));
    const queued = before.then(() => turn);
    this.queues.set(key, queued);
    try {
      await before;
      return await this.holding(ws, token, fn);
    } finally {
      done();
      if (this.queues.get(key) === queued) this.queues.delete(key);
    }
  }

  private async holding<T>(ws: string, token: string, fn: () => Promise<T>): Promise<T> {
    const owner = randomUUID();
    await this.take(ws, token, owner);
    const renew = setInterval(() => void this.renew(ws, token, owner).catch(() => undefined), Math.max(20, Math.floor(this.leaseMs / 3)));
    renew.unref();
    try {
      return await fn();
    } finally {
      clearInterval(renew);
      // Not given back (the database is gone): the lease lapses on its own.
      await this.pool.query(`UPDATE shops.checkouts SET flags = flags - '${FLAG}' WHERE workspace_id = $1 AND token = $2 AND flags->'${FLAG}'->>'owner' = $3`, [ws, token, owner]).catch(() => undefined);
    }
  }

  private async take(ws: string, token: string, owner: string): Promise<void> {
    const until = Date.now() + this.waitMs;
    for (;;) {
      const r = await this.pool.query(
        `UPDATE shops.checkouts
            SET flags = flags || jsonb_build_object('${FLAG}', jsonb_build_object('owner', $3::text, 'until', clock_timestamp() + $4::int * interval '1 millisecond'))
          WHERE workspace_id = $1 AND token = $2
            AND (NOT (flags ? '${FLAG}') OR (flags->'${FLAG}'->>'until')::timestamptz < clock_timestamp())
          RETURNING 1`,
        [ws, token, owner, this.leaseMs],
      );
      if (r.rowCount) return;
      const known = await this.pool.query("SELECT 1 FROM shops.checkouts WHERE workspace_id = $1 AND token = $2", [ws, token]);
      if (!known.rowCount) throw new Error(`no checkout ${token} to claim`);
      if (Date.now() >= until) throw new ClaimBusyError(token);
      await sleep(this.pollMs * (0.5 + Math.random()));
    }
  }

  private async renew(ws: string, token: string, owner: string): Promise<void> {
    await this.pool.query(
      `UPDATE shops.checkouts SET flags = jsonb_set(flags, '{${FLAG},until}', to_jsonb(clock_timestamp() + $4::int * interval '1 millisecond'))
        WHERE workspace_id = $1 AND token = $2 AND flags->'${FLAG}'->>'owner' = $3`,
      [ws, token, owner, this.leaseMs],
    );
  }
}
