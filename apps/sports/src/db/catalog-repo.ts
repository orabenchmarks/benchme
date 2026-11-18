import type { Pool, PoolClient } from "@benchme/core";
import { SPORTS_RETURN_REASONS, SPORTS_TODAY, searchSportsVariants, type SportCategory, type SportProduct, type SportShippingPolicy, type SportVariant, type SportsOffer, type SportsSearch } from "@benchme/scenarios";
import { type CategoryRow, type ProductRow, type VariantRow, toCategory, toProduct, toVariant } from "./rows.js";

export type Policies = { today: string; shipping: SportShippingPolicy; categories: SportCategory[]; returnReasons: string[] };
export type ProductSummary = SportProduct & { fromCents: number; variants: number; variantsInStock: number };
export type ProductDetail = SportProduct & { variants: SportVariant[] };
export type VariantDetail = SportVariant & { productName: string; brand: string; category: string };
export type ProductFilter = { category?: string; query?: string };

/**
 * The catalog: categories with their return windows, the shipping policy,
 * products and their variants. Search is @benchme/scenarios'
 * `searchSportsVariants` over the workspace's rows — the function the answer
 * keys are derived with.
 */
export interface CatalogRepo {
  policies(ws: string, c?: Pool | PoolClient): Promise<Policies>;
  facets(ws: string): Promise<{ sizes: string[]; colours: string[] }>;
  listProducts(ws: string, f: ProductFilter): Promise<ProductSummary[]>;
  getProduct(ws: string, code: string): Promise<ProductDetail | null>;
  getVariant(ws: string, sku: string): Promise<VariantDetail | null>;
  search(ws: string, q: SportsSearch): Promise<SportsOffer[]>;
}

export class PgCatalogRepo implements CatalogRepo {
  constructor(private readonly pool: Pool) {}

  async policies(ws: string, c: Pool | PoolClient = this.pool): Promise<Policies> {
    const cats = await c.query<CategoryRow>("SELECT key, name, return_window_days FROM sports.categories WHERE workspace_id = $1 ORDER BY name", [ws]);
    const ship = (await c.query<{ fee_cents: number; free_from_cents: number }>("SELECT fee_cents, free_from_cents FROM sports.shipping_policy WHERE workspace_id = $1", [ws])).rows[0];
    return {
      today: SPORTS_TODAY,
      shipping: { feeCents: ship?.fee_cents ?? 0, freeFromCents: ship?.free_from_cents ?? 0 },
      categories: cats.rows.map(toCategory),
      returnReasons: [...SPORTS_RETURN_REASONS],
    };
  }

  async facets(ws: string) {
    const r = await this.pool.query<{ size: string; colour: string }>("SELECT DISTINCT size, colour FROM sports.variants WHERE workspace_id = $1", [ws]);
    const order = (xs: string[]) => [...new Set(xs)].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
    return { sizes: order(r.rows.map((x) => x.size)), colours: order(r.rows.map((x) => x.colour)) };
  }

  async listProducts(ws: string, f: ProductFilter): Promise<ProductSummary[]> {
    const { products, variants } = await this.rows(ws);
    const words = (f.query ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
    return products
      .filter((p) => !f.category || p.category === f.category.trim().toLowerCase())
      .filter((p) => words.every((w) => `${p.name} ${p.brand} ${p.category} ${p.material}`.toLowerCase().includes(w)))
      .map((p) => {
        const mine = variants.filter((v) => v.productCode === p.code);
        return { ...p, fromCents: Math.min(...mine.map((v) => v.priceCents)), variants: mine.length, variantsInStock: mine.filter((v) => v.stock > 0).length };
      });
  }

  async getProduct(ws: string, code: string): Promise<ProductDetail | null> {
    const p = (await this.pool.query<ProductRow>("SELECT * FROM sports.products WHERE workspace_id = $1 AND code = $2", [ws, code])).rows[0];
    if (!p) return null;
    const v = await this.pool.query<VariantRow>("SELECT * FROM sports.variants WHERE workspace_id = $1 AND product_code = $2 ORDER BY sku", [ws, code]);
    return { ...toProduct(p), variants: v.rows.map(toVariant) };
  }

  async getVariant(ws: string, sku: string): Promise<VariantDetail | null> {
    const r = await this.pool.query<VariantRow & { name: string; brand: string; category: string }>(
      "SELECT v.*, p.name, p.brand, p.category FROM sports.variants v JOIN sports.products p ON p.workspace_id = v.workspace_id AND p.code = v.product_code WHERE v.workspace_id = $1 AND v.sku = $2",
      [ws, sku],
    );
    const row = r.rows[0];
    return row ? { ...toVariant(row), productName: row.name, brand: row.brand, category: row.category } : null;
  }

  async search(ws: string, q: SportsSearch): Promise<SportsOffer[]> {
    return searchSportsVariants(await this.rows(ws), q);
  }

  private async rows(ws: string): Promise<{ products: SportProduct[]; variants: SportVariant[] }> {
    const p = await this.pool.query<ProductRow>("SELECT * FROM sports.products WHERE workspace_id = $1 ORDER BY code", [ws]);
    const v = await this.pool.query<VariantRow>("SELECT * FROM sports.variants WHERE workspace_id = $1 ORDER BY sku", [ws]);
    return { products: p.rows.map(toProduct), variants: v.rows.map(toVariant) };
  }
}
