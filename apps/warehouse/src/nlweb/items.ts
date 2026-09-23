import { organization, place, product, type AskItem } from "@benchme/site-kit";
import type { CatalogRepo } from "../db/catalog-repo.js";

const APP = "warehouse";

/**
 * `tokenize` (site-kit's lexical retrieval) has no stemming, so a query for
 * either form of a word must hit: "fasteners" and "fastener" are different
 * tokens to it. Naive (drop/add a trailing "s") is enough for this corpus's
 * invented vocabulary — it does not need to be linguistically correct.
 */
function wordVariants(word: string): string[] {
  const w = word.toLowerCase();
  return w.endsWith("s") ? [w, w.slice(0, -1)] : [w, `${w}s`];
}

/**
 * Every product (with nested Offer availability from live stock), depot
 * (Place), and customer (Organization) as NLWeb items. Built fresh per
 * request — the corpus is small and this keeps items free of a cache
 * invalidation story the CDC doctrine would otherwise require.
 */
export async function warehouseItems(catalog: CatalogRepo, ws: string): Promise<AskItem[]> {
  const prefix = `/w/${ws}/${APP}`;
  const [products, locations, customers] = await Promise.all([
    catalog.listProducts(ws, { limit: 1000 }),
    catalog.listLocations(ws),
    catalog.listCustomers(ws),
  ]);

  const productItems = await Promise.all(products.items.map((p) => productItem(catalog, ws, prefix, p)));
  const locationItems = locations.map((l) => locationItem(prefix, l));
  const customerItems = customers.map((c) => customerItem(prefix, c));
  return [...productItems, ...locationItems, ...customerItems];
}

async function productItem(catalog: CatalogRepo, ws: string, prefix: string, p: { sku: string; name: string; category: string; unitPriceCents: number }): Promise<AskItem> {
  const stock = await catalog.getStock(ws, p.sku);
  const inStock = stock.reduce((sum, s) => sum + s.qty, 0) > 0;
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
  const text = `${c.name} is a ${c.tier} tier customer based in ${c.city}.`;
  return {
    id: url,
    url,
    name: c.name,
    text,
    keywords: [...wordVariants(c.tier), "customer", "customers", c.city.toLowerCase()],
    schema: organization({ id: url, url, name: c.name, description: text }),
  };
}
