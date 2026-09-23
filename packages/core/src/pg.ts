import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";

export type { Pool, PoolClient } from "pg";

export function createPool(connectionString: string, max = 10): pg.Pool {
  return new pg.Pool({ connectionString, max });
}

/** Run fn inside a transaction; commit on return, roll back on throw. */
export async function withTx<T>(pool: pg.Pool, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** pg_advisory_lock key serializing every migrate() on a database ("bnchmigr"). */
const MIGRATE_LOCK_KEY = 0x626e_6368_6d69_6772n;

/**
 * Apply every `*.sql` file in `dir` (sorted by name) exactly once, recorded in
 * `core.schema_migrations(app, name)`. Each file runs in its own transaction.
 *
 * Serialized across callers by a session-level advisory lock held on ONE
 * dedicated connection for the whole run: without it, concurrent callers
 * (parallel test files, several replicas booting at once) all read "not
 * applied", all run the file, and the losers die on a duplicate key — in
 * schema_migrations, or in pg_catalog for a CREATE both ran.
 */
export async function migrate(pool: pg.Pool, app: string, dir: string): Promise<string[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATE_LOCK_KEY.toString()]);
    try {
      await client.query("CREATE SCHEMA IF NOT EXISTS core");
      await client.query(
        `CREATE TABLE IF NOT EXISTS core.schema_migrations (
           app TEXT NOT NULL, name TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
           PRIMARY KEY (app, name))`,
      );
      const applied: string[] = [];
      for (const name of files) {
        const done = await client.query("SELECT 1 FROM core.schema_migrations WHERE app = $1 AND name = $2", [app, name]);
        if (done.rowCount) continue;
        const sql = await readFile(join(dir, name), "utf8");
        await client.query("BEGIN");
        try {
          await client.query(sql);
          await client.query("INSERT INTO core.schema_migrations (app, name) VALUES ($1, $2)", [app, name]);
          await client.query("COMMIT");
        } catch (err) {
          await client.query("ROLLBACK").catch(() => undefined);
          throw err;
        }
        applied.push(name);
      }
      return applied;
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [MIGRATE_LOCK_KEY.toString()]).catch(() => undefined);
    }
  } finally {
    client.release();
  }
}
