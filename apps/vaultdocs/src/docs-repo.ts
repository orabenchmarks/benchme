import { withTx, type Pool } from "@benchme/core";
import type { ScenarioRows } from "@benchme/scenarios";

export type DocSummary = { id: string; title: string; kind: string; tags: string[]; updatedAt: string };
export type Doc = DocSummary & { body: string };
export type SearchHit = DocSummary & { snippet: string; rank: number };

export interface DocsRepo {
  list(ws: string, kind?: string): Promise<DocSummary[]>;
  get(ws: string, id: string): Promise<Doc | null>;
  /** Full-text search (Postgres tsvector) with a highlighted snippet; empty query → []. */
  search(ws: string, query: string, limit: number): Promise<SearchHit[]>;
  seed(ws: string, rows: ScenarioRows): Promise<void>;
}

type Row = { id: string; title: string; kind: string; tags: string[]; updated_at: Date; body?: string; snippet?: string; rank?: number };
const summary = (r: Row): DocSummary => ({ id: r.id, title: r.title, kind: r.kind, tags: r.tags, updatedAt: r.updated_at.toISOString() });

export class PgDocsRepo implements DocsRepo {
  constructor(private readonly pool: Pool) {}

  async list(ws: string, kind?: string): Promise<DocSummary[]> {
    const params: unknown[] = [ws];
    let where = "workspace_id = $1";
    if (kind) {
      params.push(kind);
      where += " AND kind = $2";
    }
    const r = await this.pool.query<Row>(`SELECT id, title, kind, tags, updated_at FROM vaultdocs.documents WHERE ${where} ORDER BY id`, params);
    return r.rows.map(summary);
  }

  async get(ws: string, id: string): Promise<Doc | null> {
    const r = await this.pool.query<Row>("SELECT id, title, kind, tags, updated_at, body FROM vaultdocs.documents WHERE workspace_id = $1 AND id = $2", [ws, id]);
    const row = r.rows[0];
    return row ? { ...summary(row), body: row.body as string } : null;
  }

  async search(ws: string, query: string, limit: number): Promise<SearchHit[]> {
    const q = query.trim();
    if (!q) return [];
    const r = await this.pool.query<Row>(
      `SELECT id, title, kind, tags, updated_at,
              ts_rank(search, websearch_to_tsquery('english', $2)) AS rank,
              ts_headline('english', body, websearch_to_tsquery('english', $2), 'MaxWords=25, MinWords=10') AS snippet
         FROM vaultdocs.documents
        WHERE workspace_id = $1 AND search @@ websearch_to_tsquery('english', $2)
        ORDER BY rank DESC, id LIMIT $3`,
      [ws, q, limit],
    );
    return r.rows.map((row) => ({ ...summary(row), snippet: row.snippet as string, rank: Number(row.rank) }));
  }

  async seed(ws: string, rows: ScenarioRows): Promise<void> {
    await withTx(this.pool, async (c) => {
      await c.query("DELETE FROM vaultdocs.documents WHERE workspace_id = $1", [ws]);
      for (const d of rows.vault.documents) {
        await c.query("INSERT INTO vaultdocs.documents (workspace_id, id, title, kind, body, tags, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7)", [ws, d.id, d.title, d.kind, d.body, d.tags, d.updatedAt]);
      }
    });
  }
}
