import { createPool, migrate, newWorkspaceId, transactions, withTx, type Pool, type Transactions } from "@benchme/core";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CallerScope, type Caller } from "../doors/caller.js";
import { NoCarrier } from "../doors/session-carrier.js";
import { DomainError } from "../domain-error.js";
import type { NewLedgerEntry } from "./entry.js";
import { PgLedger, type Ledger } from "./ledger.js";
import { ledgered } from "./ledgered.js";
import { read, write, type LedgerRules } from "./rules.js";
import { ledgerSql } from "./schema.js";

const DB = process.env.DATABASE_URL;
const SCHEMA = "sitekit_atomic_test";
let pool: Pool;
let ws: string;

/** A site's rules in miniature, on a real table: paint a thing, or paint it and then find the colour refused. */
interface ThingsRepo {
  getThing(ws: string, id: string): Promise<{ id: string; colour: string } | null>;
  paint(ws: string, id: string, colour: string): Promise<{ id: string; colour: string }>;
}
class PgThings implements ThingsRepo {
  constructor(private readonly pool: Pool) {}
  async getThing(w: string, id: string) {
    return (await this.pool.query<{ id: string; colour: string }>(`SELECT id, colour FROM ${SCHEMA}.things WHERE workspace_id = $1 AND id = $2`, [w, id])).rows[0] ?? null;
  }
  async paint(w: string, id: string, colour: string) {
    // As the sites write: the repository's own transaction, then a read back on the pool.
    await withTx(this.pool, async (c) => {
      await c.query(`UPDATE ${SCHEMA}.things SET colour = $3 WHERE workspace_id = $1 AND id = $2`, [w, id, colour]);
      // A rule that refuses only once the write is under way.
      if (colour === "invisible") throw new DomainError("NO_SUCH_COLOUR", "pick a colour that exists", 422);
    });
    return (await this.getThing(w, id)) as { id: string; colour: string };
  }
}
const RULES: LedgerRules<ThingsRepo> = { getThing: read("thing", ([id]) => id), paint: write("thing", "paint", ([id]) => id) };

/** A ledger that keeps its entry, then fails: what a crash between the entry and the commit looks like. */
class FailsAfterRecording implements Ledger {
  constructor(private readonly inner: Ledger) {}
  async record(w: string, e: NewLedgerEntry): Promise<void> {
    await this.inner.record(w, e);
    if (e.outcome === "ok") throw new Error("lost the connection after the entry");
  }
  list(w: string, after: number, limit: number) {
    return this.inner.list(w, after, limit);
  }
}

const caller: Caller = { door: "rest", observer: false, actor: async () => "ilsa@example.com", session: new NoCarrier() };
const colour = async () => (await pool.query<{ colour: string }>(`SELECT colour FROM ${SCHEMA}.things WHERE workspace_id = $1 AND id = 'T-1'`, [ws])).rows[0]?.colour;
const entries = async () => (await pool.query<{ action: string; outcome: string; code: string | null }>(`SELECT action, outcome, code FROM ${SCHEMA}.ledger WHERE workspace_id = $1 ORDER BY seq`, [ws])).rows;

/** The site as a composition root builds it: one `transactions`, its pool for the repository AND the ledger. */
function site(make: (db: Transactions) => Ledger = (db) => new PgLedger(db, SCHEMA)) {
  const db = transactions(pool);
  const callers = new CallerScope();
  const things = ledgered<ThingsRepo>(new PgThings(db.pool), RULES, { ledger: make(db), callers, transactions: db });
  return <T>(fn: (repo: ThingsRepo) => Promise<T>) => callers.run(caller, () => fn(things));
}

beforeAll(async () => {
  if (!DB) return;
  pool = createPool(DB, 4);
  await migrate(pool, "core", join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "apps", "gateway", "migrations"));
  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
  await pool.query(ledgerSql(SCHEMA));
  await pool.query(`CREATE TABLE IF NOT EXISTS ${SCHEMA}.things (workspace_id TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE, id TEXT NOT NULL, colour TEXT NOT NULL, PRIMARY KEY (workspace_id, id))`);
});
afterAll(async () => {
  await pool?.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await pool?.end();
});

describe.skipIf(!DB)("a ledgered write and its entry (real Postgres)", () => {
  const fresh = async () => {
    ws = newWorkspaceId();
    await pool.query("INSERT INTO core.workspaces (id, scenario, seed, expires_at) VALUES ($1, 'test', 1, now() + interval '1 hour')", [ws]);
    await pool.query(`INSERT INTO ${SCHEMA}.things (workspace_id, id, colour) VALUES ($1, 'T-1', 'red')`, [ws]);
  };

  it("are both kept when the write is made", async () => {
    await fresh();
    expect(await site()((r) => r.paint(ws, "T-1", "blue"))).toEqual({ id: "T-1", colour: "blue" });
    expect([await colour(), await entries()]).toEqual(["blue", [{ action: "paint", outcome: "ok", code: null }]]);
  });

  it("are neither kept when the entry cannot be: the write is undone with it", async () => {
    await fresh();
    // The database refuses the entry itself.
    await pool.query(`ALTER TABLE ${SCHEMA}.ledger ADD CONSTRAINT no_paint CHECK (action <> 'paint') NOT VALID`);
    try {
      await expect(site()((r) => r.paint(ws, "T-1", "blue"))).rejects.toThrow(/no_paint/);
    } finally {
      await pool.query(`ALTER TABLE ${SCHEMA}.ledger DROP CONSTRAINT no_paint`);
    }
    expect([await colour(), await entries()]).toEqual(["red", []]);
  });

  it("are neither kept when something fails after the entry was written", async () => {
    await fresh();
    await expect(site((db) => new FailsAfterRecording(new PgLedger(db, SCHEMA)))((r) => r.paint(ws, "T-1", "blue"))).rejects.toThrow(/lost the connection/);
    expect([await colour(), await entries()]).toEqual(["red", []]);
  });

  it("leave a refusal that came part-way through the write changing nothing, and keep the refusal", async () => {
    await fresh();
    await expect(site()((r) => r.paint(ws, "T-1", "invisible"))).rejects.toMatchObject({ code: "NO_SUCH_COLOUR" });
    expect([await colour(), await entries()]).toEqual(["red", [{ action: "paint", outcome: "refused", code: "NO_SUCH_COLOUR" }]]);
  });

  it("are kept for a read without holding a transaction open around it", async () => {
    await fresh();
    let opened = 0;
    const counting = { run: async <T>(fn: () => Promise<T>) => (opened++, fn()) };
    const callers = new CallerScope();
    const db = transactions(pool);
    const things = ledgered<ThingsRepo>(new PgThings(db.pool), RULES, { ledger: new PgLedger(db, SCHEMA), callers, transactions: counting });
    await callers.run(caller, () => things.getThing(ws, "T-1"));
    await callers.run(caller, () => things.paint(ws, "T-1", "green"));
    expect(opened).toBe(1);
    expect((await entries()).map((e) => e.action)).toEqual(["read", "paint"]);
  });
});
