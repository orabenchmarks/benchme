import type { Pool } from "@benchme/core";

export type ProductRow = { sku: string; name: string; category: string; unitPriceCents: number };
export type LocationRow = { code: string; name: string; city: string };
export type StockRow = { sku: string; locationCode: string; qty: number };
export type CustomerRow = { code: string; name: string; tier: string; city: string };
export type Page<T> = { items: T[]; nextCursor: string | null };

/** Read side of the catalogue: products, locations, stock, customers. Every method is workspace-scoped. */
export interface CatalogRepo {
  listProducts(ws: string, q: { query?: string; category?: string; cursor?: string; limit: number }): Promise<Page<ProductRow>>;
  getProduct(ws: string, sku: string): Promise<ProductRow | null>;
  listLocations(ws: string): Promise<LocationRow[]>;
  getStock(ws: string, sku: string, locationCode?: string): Promise<StockRow[]>;
  lowStock(ws: string, threshold: number): Promise<{ sku: string; total: number }[]>;
  listCustomers(ws: string): Promise<CustomerRow[]>;
  getCustomer(ws: string, code: string): Promise<CustomerRow | null>;
}

type PRow = { sku: string; name: string; category: string; unit_price_cents: number };
const toProduct = (r: PRow): ProductRow => ({ sku: r.sku, name: r.name, category: r.category, unitPriceCents: r.unit_price_cents });

export class PgCatalogRepo implements CatalogRepo {
  constructor(private readonly pool: Pool) {}

  async listProducts(ws: string, q: { query?: string; category?: string; cursor?: string; limit: number }): Promise<Page<ProductRow>> {
    const params: unknown[] = [ws, q.limit + 1];
    let where = "workspace_id = $1";
    if (q.category) {
      params.push(q.category);
      where += ` AND category = $${params.length}`;
    }
    if (q.query) {
      params.push(`%${q.query.toLowerCase()}%`);
      where += ` AND (lower(name) LIKE $${params.length} OR lower(sku) LIKE $${params.length})`;
    }
    if (q.cursor) {
      params.push(q.cursor);
      where += ` AND sku > $${params.length}`;
    }
    const r = await this.pool.query<PRow>(`SELECT * FROM warehouse.products WHERE ${where} ORDER BY sku LIMIT $2`, params);
    const items = r.rows.slice(0, q.limit).map(toProduct);
    const nextCursor = r.rows.length > q.limit ? (items[items.length - 1]?.sku ?? null) : null;
    return { items, nextCursor };
  }

  async getProduct(ws: string, sku: string): Promise<ProductRow | null> {
    const r = await this.pool.query<PRow>("SELECT * FROM warehouse.products WHERE workspace_id = $1 AND sku = $2", [ws, sku]);
    return r.rows[0] ? toProduct(r.rows[0]) : null;
  }

  async listLocations(ws: string): Promise<LocationRow[]> {
    const r = await this.pool.query<LocationRow>("SELECT code, name, city FROM warehouse.locations WHERE workspace_id = $1 ORDER BY code", [ws]);
    return r.rows;
  }

  async getStock(ws: string, sku: string, locationCode?: string): Promise<StockRow[]> {
    const params: unknown[] = [ws, sku];
    let where = "workspace_id = $1 AND sku = $2";
    if (locationCode) {
      params.push(locationCode);
      where += " AND location_code = $3";
    }
    const r = await this.pool.query<{ sku: string; location_code: string; qty: number }>(
      `SELECT sku, location_code, qty FROM warehouse.stock WHERE ${where} ORDER BY location_code`,
      params,
    );
    return r.rows.map((x) => ({ sku: x.sku, locationCode: x.location_code, qty: x.qty }));
  }

  async lowStock(ws: string, threshold: number): Promise<{ sku: string; total: number }[]> {
    const r = await this.pool.query<{ sku: string; total: string }>(
      // Every product counts, including one with no stock rows (total 0) — the
      // same definition as @benchme/scenarios' lowStock, which grades the tasks.
      `SELECT p.sku, COALESCE(SUM(s.qty), 0)::text AS total
         FROM warehouse.products p
         LEFT JOIN warehouse.stock s ON s.workspace_id = p.workspace_id AND s.sku = p.sku
        WHERE p.workspace_id = $1
        GROUP BY p.sku
       HAVING COALESCE(SUM(s.qty), 0) < $2
        ORDER BY p.sku`,
      [ws, threshold],
    );
    return r.rows.map((x) => ({ sku: x.sku, total: Number(x.total) }));
  }

  async listCustomers(ws: string): Promise<CustomerRow[]> {
    const r = await this.pool.query<CustomerRow>("SELECT code, name, tier, city FROM warehouse.customers WHERE workspace_id = $1 ORDER BY code", [ws]);
    return r.rows;
  }

  async getCustomer(ws: string, code: string): Promise<CustomerRow | null> {
    const r = await this.pool.query<CustomerRow>("SELECT code, name, tier, city FROM warehouse.customers WHERE workspace_id = $1 AND code = $2", [ws, code]);
    return r.rows[0] ?? null;
  }
}
