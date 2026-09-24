import { organization, place, product, wordVariants, type AskItem } from "@benchme/site-kit";
import type { CatalogRepo } from "../db/catalog-repo.js";

/**
 * Every product (with nested Offer availability from live stock), depot
 * (Place), and customer (Organization) as NLWeb items. Built fresh per
 * request — the corpus is small and this keeps items free of a cache
 * invalidation story the CDC doctrine would otherwise require.
 *
 * `prefix` is the caller's request-time `req.prefix`, NOT re-derived from
 * `ws` — under a `shared-<scenario>-<seed>` alias the gateway forwards the
 * alias in the prefix while `ws` is the resolved internal workspace id; an
 * item minted from a re-derived prefix would name an unstable internal id.
 */
export async function warehouseItems(catalog: CatalogRepo, ws: string, prefix: string): Promise<AskItem[]> {
  const [products, locations, customers, outOfStock] = await Promise.all([
    catalog.listProducts(ws, { limit: 1000 }),
    catalog.listLocations(ws),
    catalog.listCustomers(ws),
    // lowStock(ws, 1): total < 1, i.e. total === 0 — the out-of-stock set,
    // one query instead of a getStock call per product.
    catalog.lowStock(ws, 1),
  ]);
  const outOfStockSkus = new Set(outOfStock.map((s) => s.sku));

  const productItems = products.items.map((p) => productItem(prefix, p, !outOfStockSkus.has(p.sku)));
  const locationItems = locations.map((l) => locationItem(prefix, l));
  const customerItems = customers.map((c) => customerItem(prefix, c));
  return [...productItems, ...locationItems, ...customerItems];
}

function productItem(prefix: string, p: { sku: string; name: string; category: string; unitPriceCents: number }, inStock: boolean): AskItem {
  const url = `${prefix}/products/${p.sku}`;
  const text = `${p.name} is a ${p.category} product, SKU ${p.sku}, priced at $${(p.unitPriceCents / 100).toFixed(2)}.`;
  return {
    id: url,
    url,
    name: p.name,
    text,
    keywords: [...wordVariants(p.category), p.sku.toLowerCase()],
    schema: product({ id: url, url, name: p.name, sku: p.sku, category: p.category, priceCents: p.unitPriceCents, availability: inStock ? "in_stock" : "out_of_stock" }),
  };
}

// No per-location page exists (only the /api/v1/locations list), so the URL
// anchors into that resource — a real, followable link, just not a page of
// its own.
function locationItem(prefix: string, l: { code: string; name: string; city: string }): AskItem {
  const url = `${prefix}/api/v1/locations#${l.code}`;
  const text = `${l.name} is a depot in ${l.city}, depot code ${l.code}.`;
  return {
    id: url,
    url,
    name: l.name,
    text,
    keywords: ["depot", "depots", "location", "locations", l.city.toLowerCase()],
    schema: place({ id: url, url, name: l.name, addressLocality: l.city }),
  };
}

function customerItem(prefix: string, c: { code: string; name: string; tier: string; city: string }): AskItem {
  const url = `${prefix}/customers/${c.code}`;
  const text = `${c.name} (${c.code}) is a ${c.tier} tier customer based in ${c.city}.`;
  return {
    id: url,
    url,
    name: c.name,
    text,
    keywords: [c.code.toLowerCase(), ...wordVariants(c.tier), "customer", "customers", c.city.toLowerCase()],
    schema: organization({ id: url, url, name: c.name, description: text }),
  };
}
