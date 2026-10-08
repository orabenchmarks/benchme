import type { Pool } from "@benchme/core";
import type { CardKind, IssuedCard } from "../domain/types.js";

/** A store the door showed a saved card for, with the scenario it ran then. */
export type ShownFor = { store: string; scenarioId: string | null };

/** A workspace's saved card and every store it was shown for. */
export type SavedCardRow = { workspace: string; kind: CardKind; card: IssuedCard; issuedAt: Date; stores: (ShownFor & { shownAt: Date })[] };

type Row = { workspace_id: string; kind: CardKind; card: IssuedCard; issued_at: Date; stores: { store: string; scenario_id: string | null; shown_at: string }[] | null };

/** wallet.saved_cards + wallet.saved_card_stores: the cards the card-on-file door has shown, per workspace. */
export class SavedCardsRepo {
  constructor(private readonly pool: Pool) {}

  /**
   * The workspace's saved card of `kind` — `fresh()` the first time, the very same card on every later call (two
   * first reads at once keep one) — recorded as shown for `stores`.
   */
  async issue(workspace: string, kind: CardKind, fresh: () => IssuedCard, stores: readonly ShownFor[]): Promise<IssuedCard> {
    await this.pool.query("INSERT INTO wallet.saved_cards (workspace_id, kind, card) VALUES ($1, $2, $3) ON CONFLICT (workspace_id, kind) DO NOTHING", [workspace, kind, JSON.stringify(fresh())]);
    await this.pool.query(
      `INSERT INTO wallet.saved_card_stores (workspace_id, kind, store, scenario_id)
       SELECT $1, $2, s.store, s.scenario_id FROM unnest($3::text[], $4::text[]) AS s(store, scenario_id)
       ON CONFLICT (workspace_id, kind, store) DO NOTHING`,
      [workspace, kind, stores.map((s) => s.store), stores.map((s) => s.scenarioId)],
    );
    const r = await this.pool.query<{ card: IssuedCard }>("SELECT card FROM wallet.saved_cards WHERE workspace_id = $1 AND kind = $2", [workspace, kind]);
    return (r.rows[0] as { card: IssuedCard }).card;
  }

  /** The saved cards ending `last4` the door showed this workspace for `store` (with their expiries). */
  async shownFor(workspace: string, store: string, last4: string): Promise<IssuedCard[]> {
    const r = await this.pool.query<{ card: IssuedCard }>(
      `SELECT c.card FROM wallet.saved_cards c JOIN wallet.saved_card_stores s USING (workspace_id, kind)
       WHERE c.workspace_id = $1 AND s.store = $2 AND right(c.card->>'number', 4) = $3`,
      [workspace, store, last4],
    );
    return r.rows.map((x) => x.card);
  }

  /** The workspace's saved cards, oldest first, each with the stores it was shown for. */
  async ofWorkspace(workspace: string): Promise<SavedCardRow[]> {
    const r = await this.pool.query<Row>(
      `SELECT c.workspace_id, c.kind, c.card, c.issued_at,
              json_agg(json_build_object('store', s.store, 'scenario_id', s.scenario_id, 'shown_at', s.shown_at) ORDER BY s.shown_at, s.store)
                FILTER (WHERE s.store IS NOT NULL) AS stores
       FROM wallet.saved_cards c LEFT JOIN wallet.saved_card_stores s USING (workspace_id, kind)
       WHERE c.workspace_id = $1
       GROUP BY c.workspace_id, c.kind, c.card, c.issued_at
       ORDER BY c.issued_at, c.kind`,
      [workspace],
    );
    return r.rows.map((row) => ({
      workspace: row.workspace_id,
      kind: row.kind,
      card: row.card,
      issuedAt: row.issued_at,
      stores: (row.stores ?? []).map((s) => ({ store: s.store, scenarioId: s.scenario_id, shownAt: new Date(s.shown_at) })),
    }));
  }
}
