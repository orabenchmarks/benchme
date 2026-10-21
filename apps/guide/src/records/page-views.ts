import type { Pool } from "@benchme/core";

/**
 * What a page was, as the recorder writes it: the route's own label, never re-derived from the path afterwards. The
 * guide serves home | product | journal; the site network serves entry (its start page) | vendor (a product's own
 * site) | site (a recommendation site); either may answer not_found | no_edition.
 */
export type ServedPage = "home" | "product" | "journal" | "entry" | "vendor" | "site" | "not_found" | "no_edition";

export type ArticleRef = { readonly slug: string; readonly stance: string; readonly index: number; readonly product: string };
/** A recommendation site's page: which site, and the hop of the edition's chain it was served at (1-based). */
export type SiteRef = { readonly key: string; readonly hop: number };
export type EditionRef = { readonly scenario: string; readonly seed: number; readonly category: string; readonly arm: string; readonly target: string };

export type NewPageView = {
  readonly workspaceId: string;
  readonly method: string;
  readonly path: string;
  readonly query: string | null;
  readonly status: number;
  readonly page: ServedPage;
  readonly product: string | null;
  readonly article: ArticleRef | null;
  readonly site: SiteRef | null;
  readonly edition: EditionRef | null;
  readonly userAgent: string | null;
  readonly referer: string | null;
};

export type PageView = NewPageView & { readonly seq: number; readonly at: string };

export interface PageViews {
  record(view: NewPageView): Promise<void>;
  /** Every view of one workspace, in the order served. */
  ofWorkspace(workspaceId: string): Promise<PageView[]>;
  /** Views after `seq`, in order, at most `limit` — for a bulk export. */
  since(seq: number, limit: number): Promise<PageView[]>;
}

type Row = {
  seq: string;
  workspace_id: string;
  at: Date;
  method: string;
  path: string;
  query: string | null;
  status: number;
  page: ServedPage;
  product: string | null;
  article: ArticleRef | null;
  site: SiteRef | null;
  edition: EditionRef | null;
  user_agent: string | null;
  referer: string | null;
};

const toView = (r: Row): PageView => ({
  seq: Number(r.seq),
  at: r.at.toISOString(),
  workspaceId: r.workspace_id,
  method: r.method,
  path: r.path,
  query: r.query,
  status: r.status,
  page: r.page,
  product: r.product,
  article: r.article,
  site: r.site,
  edition: r.edition,
  userAgent: r.user_agent,
  referer: r.referer,
});

export class PgPageViews implements PageViews {
  constructor(private readonly pool: Pool) {}

  async record(v: NewPageView): Promise<void> {
    await this.pool.query(
      `INSERT INTO guide.page_views (workspace_id, method, path, query, status, page, product, article, site, edition, user_agent, referer)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [v.workspaceId, v.method, v.path, v.query, v.status, v.page, v.product, v.article, v.site, v.edition, v.userAgent, v.referer],
    );
  }

  async ofWorkspace(workspaceId: string): Promise<PageView[]> {
    const r = await this.pool.query<Row>("SELECT * FROM guide.page_views WHERE workspace_id = $1 ORDER BY seq", [workspaceId]);
    return r.rows.map(toView);
  }

  async since(seq: number, limit: number): Promise<PageView[]> {
    const r = await this.pool.query<Row>("SELECT * FROM guide.page_views WHERE seq > $1 ORDER BY seq LIMIT $2", [seq, limit]);
    return r.rows.map(toView);
  }
}
