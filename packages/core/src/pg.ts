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

/**
 * Apply every `*.sql` file in `dir` (sorted by name) exactly once, recorded in
 * `core.schema_migrations(app, name)`. Each file runs in its own transaction.
 */
export async function migrate(pool: pg.Pool, app: string, dir: string): Promise<string[]> {
  await pool.query("CREATE SCHEMA IF NOT EXISTS core");
  await pool.query(
    `CREATE TABLE IF NOT EXISTS core.schema_migrations (
       app TEXT NOT NULL, name TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
       PRIMARY KEY (app, name))`,
  );
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const applied: string[] = [];
  for (const name of files) {
    const done = await pool.query("SELECT 1 FROM core.schema_migrations WHERE app = $1 AND name = $2", [app, name]);
    if (done.rowCount) continue;
    const sql = await readFile(join(dir, name), "utf8");
    await withTx(pool, async (c) => {
      await c.query(sql);
      await c.query("INSERT INTO core.schema_migrations (app, name) VALUES ($1, $2)", [app, name]);
    });
    applied.push(name);
  }
  return applied;
}
