import type { Pool } from "pg";

/**
 * A workspace is one isolated, deterministically seeded dataset shared by every
 * app: created per run from (scenario, seed), scoped by workspace_id on every
 * tenant row, finalized and reaped independently.
 */
export type Workspace = {
  id: string;
  scenario: string;
  seed: number;
  createdAt: Date;
  expiresAt: Date;
  finalizedAt: Date | null;
  /** Set for shared workspaces ("shared-<scenario>-<seed>"); null for per-run ones. */
  alias: string | null;
};

export type NewWorkspace = Pick<Workspace, "id" | "scenario" | "seed" | "expiresAt"> & { alias?: string | null };

export interface WorkspaceRepo {
  create(input: NewWorkspace): Promise<Workspace>;
  get(id: string): Promise<Workspace | null>;
  getByAlias(alias: string): Promise<Workspace | null>;
  finalize(id: string, at: Date): Promise<Workspace | null>;
  listExpired(now: Date, limit: number): Promise<string[]>;
  delete(id: string): Promise<boolean>;
}

type Row = { id: string; scenario: string; seed: number; created_at: Date; expires_at: Date; finalized_at: Date | null; alias: string | null };

function toWorkspace(r: Row): Workspace {
  return { id: r.id, scenario: r.scenario, seed: r.seed, createdAt: r.created_at, expiresAt: r.expires_at, finalizedAt: r.finalized_at, alias: r.alias ?? null };
}

/** core.workspaces — the parent of every tenant row (ON DELETE CASCADE from every app schema). */
export class PgWorkspaceRepo implements WorkspaceRepo {
  constructor(private readonly pool: Pool) {}

  async create(input: NewWorkspace): Promise<Workspace> {
    const r = await this.pool.query<Row>(
      `INSERT INTO core.workspaces (id, scenario, seed, expires_at, alias) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [input.id, input.scenario, input.seed, input.expiresAt, input.alias ?? null],
    );
    return toWorkspace(r.rows[0] as Row);
  }

  async get(id: string): Promise<Workspace | null> {
    const r = await this.pool.query<Row>("SELECT * FROM core.workspaces WHERE id = $1", [id]);
    return r.rows[0] ? toWorkspace(r.rows[0]) : null;
  }

  async getByAlias(alias: string): Promise<Workspace | null> {
    const r = await this.pool.query<Row>("SELECT * FROM core.workspaces WHERE alias = $1", [alias]);
    return r.rows[0] ? toWorkspace(r.rows[0]) : null;
  }

  async finalize(id: string, at: Date): Promise<Workspace | null> {
    const r = await this.pool.query<Row>(
      "UPDATE core.workspaces SET finalized_at = COALESCE(finalized_at, $2) WHERE id = $1 RETURNING *",
      [id, at],
    );
    return r.rows[0] ? toWorkspace(r.rows[0]) : null;
  }

  async listExpired(now: Date, limit: number): Promise<string[]> {
    const r = await this.pool.query<{ id: string }>(
      "SELECT id FROM core.workspaces WHERE expires_at < $1 ORDER BY expires_at LIMIT $2",
      [now, limit],
    );
    return r.rows.map((x) => x.id);
  }

  async delete(id: string): Promise<boolean> {
    const r = await this.pool.query("DELETE FROM core.workspaces WHERE id = $1", [id]);
    return (r.rowCount ?? 0) > 0;
  }
}
