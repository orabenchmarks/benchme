import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, migrate, type Pool } from "./pg.js";

/**
 * Concurrent migrate() calls against ONE database — what parallel test files
 * (and several replicas booting at once) do. Without serialization the
 * check-then-insert on core.schema_migrations races: both see "not applied",
 * both run the file, and the loser dies on a duplicate key (in the migration
 * row, or in pg_type for a CREATE TABLE both ran). CI hit exactly that.
 */
describe.skipIf(!process.env.DATABASE_URL)("migrate (real Postgres)", () => {
  let pool: Pool;
  let dir: string;
  const app = `race_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  beforeAll(async () => {
    pool = createPool(process.env.DATABASE_URL as string, 20);
    dir = await mkdtemp(join(tmpdir(), "benchme-migrate-"));
    await writeFile(join(dir, "001_a.sql"), `CREATE TABLE ${app}_items (id INT PRIMARY KEY);`);
    await writeFile(join(dir, "002_b.sql"), `INSERT INTO ${app}_items (id) VALUES (1);`);
  });

  afterAll(async () => {
    await pool.query(`DROP TABLE IF EXISTS ${app}_items`);
    await pool.query("DELETE FROM core.schema_migrations WHERE app = $1", [app]);
    await pool.end();
    await rm(dir, { recursive: true, force: true });
  });

  it("applies each file exactly once when many callers race, and none of them throws", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => migrate(pool, app, dir)));
    expect(results.flat().sort()).toEqual(["001_a.sql", "002_b.sql"]);
    const rows = await pool.query(`SELECT count(*)::int AS n FROM ${app}_items`);
    expect(rows.rows[0].n).toBe(1);
    const recorded = await pool.query("SELECT name FROM core.schema_migrations WHERE app = $1 ORDER BY name", [app]);
    expect(recorded.rows.map((r) => r.name)).toEqual(["001_a.sql", "002_b.sql"]);
  });
});
