import type { Pool } from "@benchme/core";

export type WalletEvent = { seq: number; session: string | null; request: string | null; kind: string; data: unknown; at: string };

type Row = { seq: string; session_id: string | null; request_id: string | null; kind: string; data: unknown; at: Date };
const toEvent = (r: Row): WalletEvent => ({ seq: Number(r.seq), session: r.session_id, request: r.request_id, kind: r.kind, data: r.data, at: r.at.toISOString() });

/** wallet.events: every request, response and status change, in order (DESIGN §6.5). */
export class EventsRepo {
  constructor(private readonly pool: Pool) {}

  async record(e: { session?: string | null; request?: string | null; kind: "http" | "status" | "observation"; data: unknown }): Promise<void> {
    await this.pool.query("INSERT INTO wallet.events (session_id, request_id, kind, data) VALUES ($1, $2, $3, $4)", [e.session ?? null, e.request ?? null, e.kind, JSON.stringify(e.data ?? {})]);
  }

  /** The events of these requests and of the sessions that made them, in order. */
  async of(sessions: readonly string[], requests: readonly string[]): Promise<WalletEvent[]> {
    if (!sessions.length && !requests.length) return [];
    const r = await this.pool.query<Row>(
      "SELECT seq, session_id, request_id, kind, data, at FROM wallet.events WHERE session_id = ANY($1) OR request_id = ANY($2) ORDER BY seq",
      [sessions, requests],
    );
    return r.rows.map(toEvent);
  }
}
