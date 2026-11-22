import { ledgerPath, type LedgerEntry } from "@benchme/site-kit";
import type { WorkspaceStateReader } from "../oracles/state-reader.js";

/** A time on the tests' own morning, 1 March 2027, 10:<minute>: nowhere near the day the tests run. */
export const T = (minute: number, ms = 0): string => new Date(Date.UTC(2027, 2, 1, 10, minute, 0, ms)).toISOString();

/** A ledger entry: by default Ilsa cancelling order SO-7 through MCP, made, at 10:02. A test varies one field. */
export function entry(over: Partial<LedgerEntry> = {}): LedgerEntry {
  return { seq: 1, at: T(2), app: "sports", kind: "write", entity: { type: "order", id: "SO-7" }, subject: null, action: "cancel", door: "mcp", actor: "ilsa@example.com", outcome: "ok", code: null, ...over };
}

/**
 * The sites as the verifier reads them, for tests (as core's testing.ts is):
 * rows by "app path", and each app's ledger behind its own route, paged as
 * the sites page it. An app never given a ledger answers its route with
 * nothing (a 404), as an app without one does.
 */
export class FakeSites implements WorkspaceStateReader {
  private readonly rows = new Map<string, unknown>();
  private readonly ledgers = new Map<string, LedgerEntry[]>();
  /** Apps that refuse every connection. */
  readonly down = new Set<string>();
  /** How many ledger pages were served. */
  ledgerReads = 0;

  seed(app: string, path: string, data: unknown): this {
    this.rows.set(`${app} ${path}`, data);
    return this;
  }

  /** An app's ledger, in order: each entry is the default one, on this app, with what the test changes. */
  ledger(app: string, entries: Partial<LedgerEntry>[]): this {
    this.ledgers.set(app, entries.map((e, i) => entry({ app, seq: i + 1, ...e })));
    return this;
  }

  async get(workspaceId: string, app: string, path: string): Promise<unknown> {
    if (this.down.has(app)) throw new Error("connection refused");
    if (!path.startsWith(ledgerPath(workspaceId))) return this.rows.get(`${app} ${path}`) ?? null;
    const all = this.ledgers.get(app);
    if (!all) return null;
    this.ledgerReads++;
    const q = new URLSearchParams(path.split("?")[1] ?? "");
    const after = all.filter((e) => e.seq > Number(q.get("cursor") ?? 0));
    const items = after.slice(0, Number(q.get("limit") ?? 500));
    return { items, nextCursor: after.length > items.length ? String(items[items.length - 1]?.seq) : null };
  }
}
