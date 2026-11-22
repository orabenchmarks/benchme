import { createPool, migrate, newWorkspaceId, transactions, type Pool } from "@benchme/core";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NewLedgerEntry } from "./entry.js";
import { PgLedger } from "./ledger.js";
import { ledgerSql } from "./schema.js";

const DB = process.env.DATABASE_URL;
const SCHEMA = "sitekit_ledger_test";
let pool: Pool;
let ws: string;

const entry = (over: Partial<NewLedgerEntry> = {}): NewLedgerEntry => ({ kind: "write", entity: { type: "order", id: "SO-1" }, subject: null, action: "create", door: "mcp", actor: "ilsa@example.com", outcome: "ok", code: null, ...over });

beforeAll(async () => {
  if (!DB) return;
  pool = createPool(DB, 2);
  await migrate(pool, "core", join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "apps", "gateway", "migrations"));
  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
  await pool.query(ledgerSql(SCHEMA));
  ws = newWorkspaceId();
  await pool.query("INSERT INTO core.workspaces (id, scenario, seed, expires_at) VALUES ($1, 'test', 1, now() + interval '1 hour')", [ws]);
});
afterAll(async () => {
  await pool?.end();
});

describe.skipIf(!DB)("PgLedger (real Postgres)", () => {
  it("keeps what it is handed, in order, under the app's name, stamped with the time it happened", async () => {
    const ledger = new PgLedger(transactions(pool), SCHEMA, "shop");
    const before = Date.now();
    await ledger.record(ws, entry());
    await ledger.record(ws, entry({ kind: "read", entity: { type: "order", id: null }, action: "read", door: "page", actor: null, outcome: "refused", code: "NOT_FOUND" }));
    await ledger.record(ws, entry({ entity: { type: "return", id: null }, subject: { type: "order", id: "SO-1" }, outcome: "refused", code: "RETURN_WINDOW_CLOSED" }));
    const after = Date.now();
    const rows = await ledger.list(ws, 0, 100);
    expect(rows.map(({ seq: _seq, at: _at, ...rest }) => rest)).toEqual([
      { app: "shop", ...entry() },
      { app: "shop", kind: "read", entity: { type: "order", id: null }, subject: null, action: "read", door: "page", actor: null, outcome: "refused", code: "NOT_FOUND" },
      { app: "shop", ...entry({ entity: { type: "return", id: null }, subject: { type: "order", id: "SO-1" }, outcome: "refused", code: "RETURN_WINDOW_CLOSED" }) },
    ]);
    expect(rows[1]!.seq).toBeGreaterThan(rows[0]!.seq);
    // The database's clock, allowed a second either side of this process's.
    for (const r of rows) {
      expect(Date.parse(r.at)).toBeGreaterThanOrEqual(before - 1000);
      expect(Date.parse(r.at)).toBeLessThanOrEqual(after + 1000);
    }
    expect(Date.parse(rows[1]!.at)).toBeGreaterThanOrEqual(Date.parse(rows[0]!.at));
  });

  it("lists the entries after a cursor, a page at a time, and only the workspace's own", async () => {
    const ledger = new PgLedger(transactions(pool), SCHEMA);
    const all = await ledger.list(ws, 0, 100);
    expect(await ledger.list(ws, all[0]!.seq, 100)).toEqual(all.slice(1));
    expect(await ledger.list(ws, 0, 1)).toEqual(all.slice(0, 1));
    expect(await ledger.list(newWorkspaceId(), 0, 100)).toEqual([]);
  });

  it("refuses a door or an outcome the ledger does not know", async () => {
    const ledger = new PgLedger(transactions(pool), SCHEMA);
    await expect(ledger.record(ws, entry({ door: "side-window" as never }))).rejects.toThrow(/door/);
    await expect(ledger.record(ws, entry({ outcome: "maybe" as never }))).rejects.toThrow(/outcome/);
  });

  it("goes with its workspace", async () => {
    const gone = newWorkspaceId();
    await pool.query("INSERT INTO core.workspaces (id, scenario, seed, expires_at) VALUES ($1, 'test', 1, now() + interval '1 hour')", [gone]);
    const ledger = new PgLedger(transactions(pool), SCHEMA);
    await ledger.record(gone, entry());
    await pool.query("DELETE FROM core.workspaces WHERE id = $1", [gone]);
    expect(await ledger.list(gone, 0, 100)).toEqual([]);
  });
});
