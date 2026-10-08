import type { Pool } from "@benchme/core";

export type WalletEvent = { seq: number; session: string | null; request: string | null; workspace: string | null; kind: string; data: unknown; at: string };

/**
 * What an event is: a call link-cli made, a status change, an agent's report, a read of the card-on-file door, a
 * decision put off because the stores could not be asked (binding_unavailable: infrastructure, never the run's), or a
 * store's payment checked against the spend controls (charge: accepted or declined, and which card paid).
 */
export type EventKind = "http" | "status" | "observation" | "card_on_file" | "binding_unavailable" | "charge";

type Row = { seq: string; session_id: string | null; request_id: string | null; workspace_id: string | null; kind: string; data: unknown; at: Date };
const toEvent = (r: Row): WalletEvent => ({ seq: Number(r.seq), session: r.session_id, request: r.request_id, workspace: r.workspace_id, kind: r.kind, data: r.data, at: r.at.toISOString() });

/** wallet.events: every request, response and status change, and every read of the card-on-file door, in order (DESIGN §6.5). */
export class EventsRepo {
  constructor(private readonly pool: Pool) {}

  async record(e: { session?: string | null; request?: string | null; workspace?: string | null; kind: EventKind; data: unknown }): Promise<void> {
    await this.pool.query("INSERT INTO wallet.events (session_id, request_id, workspace_id, kind, data) VALUES ($1, $2, $3, $4, $5)", [
      e.session ?? null,
      e.request ?? null,
      e.workspace ?? null,
      e.kind,
      JSON.stringify(e.data ?? {}),
    ]);
  }

  /** The events of these requests, of the sessions that made them and of these workspaces, in order. */
  async of(sessions: readonly string[], requests: readonly string[], workspaces: readonly string[] = []): Promise<WalletEvent[]> {
    if (!sessions.length && !requests.length && !workspaces.length) return [];
    const r = await this.pool.query<Row>(
      `SELECT seq, session_id, request_id, workspace_id, kind, data, at FROM wallet.events
       WHERE session_id = ANY($1) OR request_id = ANY($2) OR workspace_id = ANY($3) ORDER BY seq`,
      [sessions, requests, workspaces],
    );
    return r.rows.map(toEvent);
  }
}
