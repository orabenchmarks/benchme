/**
 * Small, local schema.org JSON-LD builders for the generated company site.
 *
 * apps/data deliberately does NOT depend on @benchme/site-kit (it keeps its
 * own tiny `esc()` too, see site.ts) — this file is the equivalent isolation
 * for structured data: plain object literals, no shared-package import.
 */

export type JsonLd = Record<string, unknown>;

/** A generated page, addressed by its site-relative path (e.g. "products/tools.html"). */
export function webPage(url: string, name: string, description: string): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": url,
    url,
    name,
    description,
  };
}

/** The company itself, from `company` scenario facts. */
export function organization(
  url: string,
  name: string,
  opts: { foundingDate?: number; numberOfEmployees?: number; address?: string } = {},
): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": url,
    url,
    name,
    ...(opts.foundingDate !== undefined ? { foundingDate: String(opts.foundingDate) } : {}),
    ...(opts.numberOfEmployees !== undefined ? { numberOfEmployees: opts.numberOfEmployees } : {}),
    ...(opts.address !== undefined ? { address: opts.address } : {}),
  };
}

/** A warehouse depot, from a `warehouse.locations` row. */
export function place(url: string, name: string, opts: { code?: string; city?: string } = {}): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "Place",
    "@id": url,
    url,
    name,
    ...(opts.code !== undefined ? { identifier: opts.code } : {}),
    ...(opts.city !== undefined ? { address: { "@type": "PostalAddress", addressLocality: opts.city } } : {}),
  };
}

/** A catalog item, from a `warehouse.products` row; price is dollars-as-string per schema.org convention. */
export function product(url: string, name: string, opts: { sku: string; category: string; priceCents: number }): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    "@id": url,
    url,
    name,
    sku: opts.sku,
    category: opts.category,
    offers: {
      "@type": "Offer",
      price: (opts.priceCents / 100).toFixed(2),
      priceCurrency: "USD",
    },
  };
}
