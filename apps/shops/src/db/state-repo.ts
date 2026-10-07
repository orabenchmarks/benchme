import type { Pool } from "@benchme/core";

export type StoreState = { campaign: string | null; scenarioId: string | null; locked: boolean };

type Row = { campaign: string | null; scenario_id: string | null; locked_at: Date | null };

/**
 * shops.store_state: which hidden scenario a workspace's store runs. The campaign
 * code is honoured on any visit until the store's first checkout starts; from then
 * on the scenario is locked — a run that reached checkout without a code stays
 * no_scenario even if it follows a coded link later (Review Focus 1).
 */
export class StateRepo {
  constructor(private readonly pool: Pool) {}

  async get(ws: string, store: string): Promise<StoreState> {
    const r = await this.pool.query<Row>("SELECT campaign, scenario_id, locked_at FROM shops.store_state WHERE workspace_id = $1 AND store = $2", [ws, store]);
    const row = r.rows[0];
    return { campaign: row?.campaign ?? null, scenarioId: row?.scenario_id ?? null, locked: !!row?.locked_at };
  }

  /** Sets the campaign/scenario unless the store is locked; returns whether it took effect. */
  async setCampaign(ws: string, store: string, campaign: string, scenarioId: string | null): Promise<boolean> {
    const r = await this.pool.query(
      `INSERT INTO shops.store_state (workspace_id, store, campaign, scenario_id) VALUES ($1, $2, $3, $4)
       ON CONFLICT (workspace_id, store) DO UPDATE SET campaign = EXCLUDED.campaign, scenario_id = EXCLUDED.scenario_id
       WHERE shops.store_state.locked_at IS NULL
       RETURNING 1`,
      [ws, store, campaign, scenarioId],
    );
    return (r.rowCount ?? 0) > 0;
  }

  /** Freezes the scenario (first checkout started); later calls keep the first lock time. */
  async lock(ws: string, store: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO shops.store_state (workspace_id, store, locked_at) VALUES ($1, $2, now())
       ON CONFLICT (workspace_id, store) DO UPDATE SET locked_at = COALESCE(shops.store_state.locked_at, EXCLUDED.locked_at)`,
      [ws, store],
    );
  }

  /** The email this workspace signed up to the store's newsletter with, or null. */
  async newsletterOf(ws: string, store: string): Promise<string | null> {
    const r = await this.pool.query<{ newsletter: string | null }>("SELECT newsletter FROM shops.store_state WHERE workspace_id = $1 AND store = $2", [ws, store]);
    return r.rows[0]?.newsletter ?? null;
  }

  async setNewsletter(ws: string, store: string, email: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO shops.store_state (workspace_id, store, newsletter) VALUES ($1, $2, $3)
       ON CONFLICT (workspace_id, store) DO UPDATE SET newsletter = EXCLUDED.newsletter`,
      [ws, store, email],
    );
  }
}
