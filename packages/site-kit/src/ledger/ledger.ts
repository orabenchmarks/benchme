import type { Transactions } from "@benchme/core";
import type { LedgerEntry, NewLedgerEntry } from "./entry.js";

/** A site's change ledger: appended to by the site's rules, read by the verifier alone. */
export interface Ledger {
  record(ws: string, entry: NewLedgerEntry): Promise<void>;
  /** Entries after `afterSeq`, oldest first, at most `limit`. */
  list(ws: string, afterSeq: number, limit: number): Promise<LedgerEntry[]>;
}

type Row = {
  seq: string; at: Date; kind: LedgerEntry["kind"]; entity_type: string; entity_id: string | null; subject_type: string | null; subject_id: string | null;
  action: string; door: LedgerEntry["door"]; actor: string | null; outcome: LedgerEntry["outcome"]; code: string | null;
};

const SCHEMA = /^[a-z_][a-z0-9_]*$/;

/**
 * The same `ledger` table under any app schema (each site's own migration
 * creates it), so every site keeps its own and none share rows. The time is
 * the database's own clock at the insert, one clock for every site.
 *
 * It takes the site's `transactions`, not a pool, so an entry is always
 * written on the connection of the write it records: handed the raw pool, a
 * ledger would commit an entry on its own while its write could still fail.
 */
export class PgLedger implements Ledger {
  private readonly pool: Transactions["pool"];
  constructor(
    db: Pick<Transactions, "pool">,
    private readonly schema: string,
    /** The app's name on every entry; a site's schema carries its name. */
    private readonly app: string = schema,
  ) {
    if (!SCHEMA.test(schema)) throw new Error(`invalid schema name: ${schema}`);
    this.pool = db.pool;
  }

  async record(ws: string, e: NewLedgerEntry): Promise<void> {
    await this.pool.query(
      `INSERT INTO ${this.schema}.ledger (workspace_id, kind, entity_type, entity_id, subject_type, subject_id, action, door, actor, outcome, code) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [ws, e.kind, e.entity.type, e.entity.id, e.subject?.type ?? null, e.subject?.id ?? null, e.action, e.door, e.actor, e.outcome, e.code],
    );
  }

  async list(ws: string, afterSeq: number, limit: number): Promise<LedgerEntry[]> {
    const r = await this.pool.query<Row>(
      `SELECT seq, at, kind, entity_type, entity_id, subject_type, subject_id, action, door, actor, outcome, code FROM ${this.schema}.ledger WHERE workspace_id = $1 AND seq > $2 ORDER BY seq LIMIT $3`,
      [ws, afterSeq, limit],
    );
    return r.rows.map((x) => ({
      seq: Number(x.seq), at: x.at.toISOString(), app: this.app, kind: x.kind, entity: { type: x.entity_type, id: x.entity_id },
      subject: x.subject_type && x.subject_id ? { type: x.subject_type, id: x.subject_id } : null,
      action: x.action, door: x.door, actor: x.actor, outcome: x.outcome, code: x.code,
    }));
  }
}

/** A ledger in memory, for tests of what records into one. `now` is the clock its entries are stamped with. */
export class MemoryLedger implements Ledger {
  private readonly byWorkspace = new Map<string, LedgerEntry[]>();
  private seq = 0;

  constructor(
    private readonly app: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async record(ws: string, e: NewLedgerEntry): Promise<void> {
    const entries = this.byWorkspace.get(ws) ?? [];
    entries.push({ ...e, entity: { ...e.entity }, subject: e.subject ? { ...e.subject } : null, seq: ++this.seq, at: this.now().toISOString(), app: this.app });
    this.byWorkspace.set(ws, entries);
  }

  async list(ws: string, afterSeq = 0, limit = Number.MAX_SAFE_INTEGER): Promise<LedgerEntry[]> {
    return (this.byWorkspace.get(ws) ?? []).filter((e) => e.seq > afterSeq).slice(0, limit);
  }
}
