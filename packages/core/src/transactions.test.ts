import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, withTx, type Pool } from "./pg.js";
import { transactions } from "./transactions.js";

const DB = process.env.DATABASE_URL;
let pool: Pool;
/** A second connection's view: what is committed, and nothing else. */
let outside: Pool;

const rows = async (p: Pool = outside) => (await p.query<{ v: string }>("SELECT v FROM core_tx_test.t ORDER BY v")).rows.map((r) => r.v);

beforeAll(async () => {
  if (!DB) return;
  pool = createPool(DB, 4);
  outside = createPool(DB, 1);
  await pool.query("CREATE SCHEMA IF NOT EXISTS core_tx_test; CREATE TABLE IF NOT EXISTS core_tx_test.t (v TEXT PRIMARY KEY)");
});
afterAll(async () => {
  await pool?.query("DROP SCHEMA IF EXISTS core_tx_test CASCADE");
  await pool?.end();
  await outside?.end();
});

describe.skipIf(!DB)("transactions (real Postgres)", () => {
  it("leaves the pool as it is outside a run: each query commits on its own", async () => {
    await pool.query("TRUNCATE core_tx_test.t");
    const db = transactions(pool);
    await db.pool.query("INSERT INTO core_tx_test.t VALUES ('alone')");
    expect(await rows()).toEqual(["alone"]);
  });

  it("puts every query of a run in one transaction, which nobody else sees until it commits", async () => {
    await pool.query("TRUNCATE core_tx_test.t");
    const db = transactions(pool);
    let seenDuring: string[] = [];
    await db.run(async () => {
      await db.pool.query("INSERT INTO core_tx_test.t VALUES ('a')");
      await db.pool.query("INSERT INTO core_tx_test.t VALUES ('b')");
      expect(await rows(db.pool)).toEqual(["a", "b"]);
      seenDuring = await rows();
    });
    expect(seenDuring).toEqual([]);
    expect(await rows()).toEqual(["a", "b"]);
  });

  it("rolls back everything the run did when it throws, a repository's own committed transaction included", async () => {
    await pool.query("TRUNCATE core_tx_test.t");
    const db = transactions(pool);
    await expect(
      db.run(async () => {
        await db.pool.query("INSERT INTO core_tx_test.t VALUES ('first')");
        // What a repository does: its own transaction, committed, on a client it asked the pool for.
        await withTx(db.pool, async (c) => {
          await c.query("INSERT INTO core_tx_test.t VALUES ('inner')");
        });
        throw new Error("after the repository returned");
      }),
    ).rejects.toThrow("after the repository returned");
    expect(await rows()).toEqual([]);
  });

  it("makes a repository's own transaction a savepoint: its rollback undoes its part and leaves the run usable", async () => {
    await pool.query("TRUNCATE core_tx_test.t");
    const db = transactions(pool);
    await db.run(async () => {
      await db.pool.query("INSERT INTO core_tx_test.t VALUES ('kept')");
      await expect(
        withTx(db.pool, async (c) => {
          await c.query("INSERT INTO core_tx_test.t VALUES ('undone')");
          // A statement that fails aborts a transaction; inside a savepoint, only the savepoint's part.
          await c.query("INSERT INTO core_tx_test.t VALUES ('kept')");
        }),
      ).rejects.toThrow(/duplicate key/);
      await db.pool.query("INSERT INTO core_tx_test.t VALUES ('after')");
    });
    expect(await rows()).toEqual(["after", "kept"]);
  });

  it("joins a run started inside a run, and commits once, at the end of the outer", async () => {
    await pool.query("TRUNCATE core_tx_test.t");
    const db = transactions(pool);
    await expect(
      db.run(async () => {
        await db.run(async () => db.pool.query("INSERT INTO core_tx_test.t VALUES ('inner run')"));
        expect(await rows()).toEqual([]);
        throw new Error("outer fails");
      }),
    ).rejects.toThrow("outer fails");
    expect(await rows()).toEqual([]);
  });

  it("keeps two runs at once apart: each has its own connection and transaction", async () => {
    await pool.query("TRUNCATE core_tx_test.t");
    const db = transactions(pool);
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const slow = db.run(async () => {
      await db.pool.query("INSERT INTO core_tx_test.t VALUES ('slow')");
      await held;
      throw new Error("slow fails");
    });
    await db.run(async () => db.pool.query("INSERT INTO core_tx_test.t VALUES ('fast')"));
    release();
    await expect(slow).rejects.toThrow("slow fails");
    expect(await rows()).toEqual(["fast"]);
  });
});
