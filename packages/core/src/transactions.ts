import { AsyncLocalStorage } from "node:async_hooks";
import type pg from "pg";

/**
 * Many statements in one database transaction, without a client passed to
 * every call. Hand `pool` to the repositories instead of the real pool:
 * outside `run` it is the pool as it is; inside `run` every query is part of
 * the run's transaction, and a repository's own `withTx` (or any
 * `connect()` … `BEGIN` … `COMMIT`) becomes a savepoint inside it. So what a
 * repository writes, and whatever else runs before `run` returns (a ledger
 * entry), is committed together, or not at all.
 */
export interface Transactions {
  /** The pool to build repositories with. */
  readonly pool: pg.Pool;
  /** Runs `fn` in one transaction: committed when it returns, rolled back when it throws. A run inside a run joins it. */
  run<T>(fn: () => Promise<T>): Promise<T>;
}

type Unit = { client: pg.PoolClient; savepoints: number };

/** What `client.query` was asked, as a verb, when it is one that opens or closes a transaction. */
const verbOf = (text: unknown): "BEGIN" | "COMMIT" | "ROLLBACK" | null => {
  if (typeof text !== "string") return null;
  const verb = text.trim().replace(/;$/, "").toUpperCase();
  return verb === "BEGIN" || verb === "COMMIT" || verb === "ROLLBACK" ? verb : null;
};

const bound = (target: object, prop: PropertyKey): unknown => {
  const value: unknown = Reflect.get(target, prop, target);
  return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
};

/**
 * A client for a repository's own transaction inside a run: the run's client,
 * its BEGIN / COMMIT / ROLLBACK turned into a savepoint, its release a no-op
 * (the run gives the connection back). Savepoints nest, as transactions on
 * one connection must: a repository that ran two of its own at once on one
 * request would see the second's RELEASE fail, never a silent mix.
 */
function nestedClient(unit: Unit): pg.PoolClient {
  const name = `bm_sp_${++unit.savepoints}`;
  const { client } = unit;
  const query = (text: unknown, ...rest: unknown[]): unknown => {
    const verb = verbOf(text);
    if (verb === "BEGIN") return client.query(`SAVEPOINT ${name}`);
    if (verb === "COMMIT") return client.query(`RELEASE SAVEPOINT ${name}`);
    if (verb === "ROLLBACK") return client.query(`ROLLBACK TO SAVEPOINT ${name}`);
    return (client.query as (...a: unknown[]) => unknown)(text, ...rest);
  };
  return new Proxy(client, {
    get(target, prop) {
      if (prop === "query") return query;
      if (prop === "release") return () => undefined;
      return bound(target, prop);
    },
  });
}

export function transactions(pool: pg.Pool): Transactions {
  const current = new AsyncLocalStorage<Unit>();
  const scoped = new Proxy(pool, {
    get(target, prop) {
      const unit = current.getStore();
      if (unit && prop === "query") return (...args: unknown[]) => (unit.client.query as (...a: unknown[]) => unknown)(...args);
      if (unit && prop === "connect") return async () => nestedClient(unit);
      return bound(target, prop);
    },
  });
  return {
    pool: scoped,
    async run<T>(fn: () => Promise<T>): Promise<T> {
      if (current.getStore()) return fn();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await current.run({ client, savepoints: 0 }, fn);
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
  };
}
