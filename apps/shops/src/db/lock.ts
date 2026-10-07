import { withTx, type Pool, type PoolClient } from "@benchme/core";

/** Runs a query: the pool, or the client of a transaction in progress. */
export type Db = Pick<Pool, "query">;

/**
 * Runs `fn` in a transaction holding a Postgres advisory lock on (`space`, `key`): callers with the
 * same pair run one at a time, whichever process they are in. Every query of `fn` goes through the
 * client it is given — taking another connection of the pool while holding this one could wait
 * forever on a pool that callers like it have exhausted. Nothing slow belongs inside: never a call to
 * the payment processor, which would hold the connection while it answers (a payment step takes its
 * checkout's claim instead: claims.ts).
 */
export async function withLock<T>(pool: Pool, space: string, key: string, fn: (db: PoolClient) => Promise<T>): Promise<T> {
  return withTx(pool, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [space, key]);
    return fn(client);
  });
}
