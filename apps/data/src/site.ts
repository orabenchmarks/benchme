import { minstd, scenarios, type ScenarioRows } from "@benchme/scenarios";
import { organization, place, product, webPage, type JsonLd } from "./jsonld.js";

/** One generated page or download of the company site. */
export type SiteFile = { path: string; contentType: string; body: string };

const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

function page(company: string, title: string, body: string, nav: string, jsonLd: unknown): string {
  // This is intentionally stricter than robots.txt below: the synthetic
  // company site must never land in a search index (hence noindex,nofollow
  // on every page, regardless of what robots.txt allows), while an agent
  // crawler is still free to fetch the page itself and its JSON-LD, and the
  // schema feed/map robots.txt points at.
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><title>${esc(title)} — ${esc(company)}</title>
<style>body{font:15px/1.5 system-ui,sans-serif;margin:0;color:#1b1b1b}header{background:#233;color:#fff;padding:.6rem 1rem}header a{color:#fff;margin-right:1rem;text-decoration:none}main{max-width:60rem;margin:1.5rem auto;padding:0 1rem}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:.3em .6em;text-align:left}</style></head>
<body><header>${nav}</header><main>${body}</main><script type="application/ld+json">${JSON.stringify(jsonLd)}</script></body></html>`;
}

/** The seed the published site is built from (DATA_SEED overrides it at build time). Every workspace serves the same site, whatever its own seed. */
export const DEFAULT_DATA_SEED = 20260908;

/**
 * The fictional company's public site, generated from the scenario so every
 * figure on it is derivable from the seed. Static: the same for every workspace.
 */
export function buildSite(seed: number, scenarioKey = "acme-v1"): SiteFile[] {
  const rows: ScenarioRows = scenarios.get(scenarioKey).generate(seed);
  const co = rows.company;
  const rng = minstd(seed + 7);
  const files: SiteFile[] = [];
  const add = (path: string, body: string, contentType = "text/html; charset=utf-8") => files.push({ path, contentType, body });
  // The site is static and served under a prefix it cannot know at build time
  // (`/w/<workspace>/data/` behind the gateway, `/` on its own), so every
  // link is RELATIVE to the page that carries it: `root(path)` climbs back to
  // the site root ("" on index.html, "../" one directory down, …). The same
  // applies to every JSON-LD `@id`/`url` and to schema/map.xml's `<loc>`
  // below: an absolute URL is what the schemamap spec prefers, but this site
  // cannot mint one for itself — the gateway's host-root robots.txt already
  // publishes the absolute schemamap URL per ask-capable app on the one
  // long-lived shared workspace (see apps/gateway/src/routes/robots.ts), so
  // a relative loc here is the correct, and only possible, choice.
  const root = (path: string) => "../".repeat(path.split("/").length - 1);
  const nav = (r: string) =>
    `<a href="${r}">Home</a><a href="${r}about.html">About</a><a href="${r}products/">Products</a><a href="${r}locations.html">Locations</a><a href="${r}reports/annual-report.html">Annual report</a><a href="${r}changelog.html">Changelog</a><a href="${r}downloads/">Downloads</a>`;

  // Every page carries one WebPage JSON-LD entry, recorded here so
  // schema/feed.jsonl can emit the same set without recomputing it.
  const pages: { path: string; title: string; description: string }[] = [];
  /** Adds an HTML page at `path`; `body(r)` receives the root-relative prefix; `extra()` supplies any non-WebPage JSON-LD (Organization/Place/Product) the page also carries. */
  const html = (path: string, title: string, body: (r: string) => string, description: string, extra: () => JsonLd[] = () => []) => {
    const r = root(path);
    const ld: JsonLd[] = [webPage(path, `${title} — ${co.name}`, description), ...extra()];
    add(path, page(co.name, title, body(r), nav(r), ld.length === 1 ? ld[0] : ld));
    pages.push({ path, title, description });
  };

  const categories = [...new Set(rows.warehouse.products.map((x) => x.category))].sort();
  const orgLd = organization("index.html", co.name, { foundingDate: co.founded, numberOfEmployees: co.employees, address: co.headquarters });
  html(
    "index.html",
    "Home",
    (r) => `<h1>${esc(co.name)}</h1><p>Industrial supply since ${co.founded}, headquartered in ${esc(co.headquarters)}. ${co.employees} employees across ${rows.warehouse.locations.length} depots.</p><ul>${categories.map((c) => `<li><a href="${r}products/${c}.html">${esc(c)}</a></li>`).join("")}</ul>`,
    `A summary of ${co.name}, its history, and its depots.`,
    () => [orgLd],
  );
  html(
    "about.html",
    "About",
    () => `<h1>About ${esc(co.name)}</h1><table><tr><th>Founded</th><td>${co.founded}</td></tr><tr><th>Headquarters</th><td>${esc(co.headquarters)}</td></tr><tr><th>Employees</th><td>${co.employees}</td></tr><tr><th>Depots</th><td>${rows.warehouse.locations.length}</td></tr><tr><th>Customers</th><td>${rows.warehouse.customers.length}</td></tr></table>`,
    `Company facts about ${co.name}.`,
  );
  const locationsLd = () => rows.warehouse.locations.map((l) => place(`locations.html#${l.code}`, l.name, { code: l.code, city: l.city }));
  html(
    "locations.html",
    "Locations",
    () => `<h1>Depots</h1><table><tr><th>Code</th><th>Name</th><th>City</th></tr>${rows.warehouse.locations.map((l) => `<tr><td>${l.code}</td><td>${esc(l.name)}</td><td>${esc(l.city)}</td></tr>`).join("")}</table>`,
    `${co.name}'s depot locations.`,
    locationsLd,
  );

  html(
    "products/index.html",
    "Products",
    () => `<h1>Product categories</h1><ul>${categories.map((c) => `<li><a href="${c}.html">${esc(c)}</a> (${rows.warehouse.products.filter((x) => x.category === c).length})</li>`).join("")}</ul>`,
    `Product categories carried by ${co.name}.`,
  );
  for (const c of categories) {
    const items = rows.warehouse.products.filter((x) => x.category === c);
    const path = `products/${c}.html`;
    html(
      path,
      c,
      () => `<h1>${esc(c)}</h1><table><tr><th>SKU</th><th>Name</th><th>List price</th></tr>${items.map((x) => `<tr><td>${x.sku}</td><td>${esc(x.name)}</td><td>${money(x.unitPriceCents)}</td></tr>`).join("")}</table>`,
      `${c} products carried by ${co.name}.`,
      () => items.map((x) => product(`${path}#${x.sku}`, x.name, { sku: x.sku, category: c, priceCents: x.unitPriceCents })),
    );
  }

  const rev = co.fiscalYearRevenueCents;
  const byQuarter = [0.22, 0.24, 0.26, 0.28].map((share) => Math.round(rev * share));
  html(
    "reports/annual-report.html",
    "Annual report",
    () => `<h1>Annual report FY2025</h1><p>Total revenue: <strong>${money(rev)}</strong>.</p><table><tr><th>Quarter</th><th>Revenue</th></tr>${byQuarter.map((q, i) => `<tr><td>Q${i + 1}</td><td>${money(q)}</td></tr>`).join("")}</table><p>Headcount at year end: ${co.employees}.</p>`,
    `${co.name}'s FY2025 annual report.`,
  );

  const entries = Array.from({ length: 12 }, (_, i) => ({ v: `2.${11 - i}.0`, date: `2026-${String(1 + Math.floor((11 - i) / 2)).padStart(2, "0")}-${String(1 + Math.floor(rng() * 27)).padStart(2, "0")}`, note: ["pagination on the orders API", "transfer completion endpoint", "low-stock report", "gold tier discounts", "depot BRM opened", "MCP server published", "cursor pagination for products", "api tokens for accounts", "order cancellation rules", "customer tiers", "stock reservations on transfers", "initial release"][i] }));
  html(
    "changelog.html",
    "Changelog",
    () => `<h1>Changelog</h1><table><tr><th>Version</th><th>Date</th><th>Change</th></tr>${entries.map((e) => `<tr><td>${e.v}</td><td>${e.date}</td><td>${esc(e.note)}</td></tr>`).join("")}</table>`,
    `Release history of ${co.name}'s systems.`,
  );

  html(
    "downloads/index.html",
    "Downloads",
    () => `<h1>Downloads</h1><ul><li><a href="products.csv">products.csv</a></li><li><a href="locations.csv">locations.csv</a></li><li><a href="customers.csv">customers.csv</a></li></ul>`,
    `Downloadable data exports from ${co.name}.`,
  );
  add("downloads/products.csv", ["sku,name,category,unit_price_cents", ...rows.warehouse.products.map((x) => `${x.sku},"${x.name.replace(/"/g, '""')}",${x.category},${x.unitPriceCents}`)].join("\n"), "text/csv");
  add("downloads/locations.csv", ["code,name,city", ...rows.warehouse.locations.map((l) => `${l.code},"${l.name}",${l.city}`)].join("\n"), "text/csv");
  add("downloads/customers.csv", ["code,name,tier,city", ...rows.warehouse.customers.map((c) => `${c.code},"${c.name}",${c.tier},${c.city}`)].join("\n"), "text/csv");

  html(
    "mcp/index.html",
    "MCP registry",
    () =>
      `<h1>MCP servers</h1><p>Our systems expose Model Context Protocol servers per benchme workspace. See the benchme gateway's <a href="/registry">registry</a> for endpoints.</p><table><tr><th>Server</th><th>Purpose</th></tr><tr><td>warehouse</td><td>products, stock, orders, transfers</td></tr><tr><td>helpdesk</td><td>tickets, comments, SLAs (coming)</td></tr><tr><td>vaultdocs</td><td>documents as resources + search (coming)</td></tr></table>` +
      `<p>Sibling apps also answer natural-language questions directly over NLWeb, e.g. ${esc("…/w/<workspace>/warehouse/ask")}.</p>`,
    `Model Context Protocol servers published by ${co.name}.`,
  );

  // schema/feed.jsonl: one JSON-LD object per line — every product, every
  // location, the organization, and one WebPage per generated html page —
  // the same objects embedded per-page above, so a crawler that only reads
  // the feed sees exactly what a page visitor's browser would.
  const feedLines: JsonLd[] = [
    orgLd,
    ...rows.warehouse.products.map((x) => product(`products/${x.category}.html#${x.sku}`, x.name, { sku: x.sku, category: x.category, priceCents: x.unitPriceCents })),
    ...locationsLd(),
    ...pages.map((p) => webPage(p.path, `${p.title} — ${co.name}`, p.description)),
  ];
  add("schema/feed.jsonl", feedLines.map((l) => JSON.stringify(l)).join("\n"), "application/jsonl");

  add(
    "schema/map.xml",
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:sf="http://schema.org/schemas/schemafeed/0.1">\n<url><loc>feed.jsonl</loc><sf:contentType>structuredData/schema.org</sf:contentType></url>\n</urlset>\n`,
    "application/xml",
  );

  // Allow: / here is deliberately looser than the per-page <meta
  // name="robots" content="noindex,nofollow"> in page() above: this site
  // must never land in a search index (that's what the meta tag blocks),
  // but agent/answer-engine crawlers must still be able to FETCH every page
  // — and, via `schemamap:`, the structured-data feed/map — which is what
  // Allow: / (vs. the old Disallow: /) makes possible. Two different
  // policies for two different readers, on purpose.
  add("robots.txt", "User-agent: *\nAllow: /\nschemamap: schema/map.xml\n", "text/plain");
  return files;
}
