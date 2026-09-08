import { minstd, scenarios, type ScenarioRows } from "@benchme/scenarios";

/** One generated page or download of the company site. */
export type SiteFile = { path: string; contentType: string; body: string };

const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

function page(company: string, title: string, body: string, nav: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><title>${esc(title)} — ${esc(company)}</title>
<style>body{font:15px/1.5 system-ui,sans-serif;margin:0;color:#1b1b1b}header{background:#233;color:#fff;padding:.6rem 1rem}header a{color:#fff;margin-right:1rem;text-decoration:none}main{max-width:60rem;margin:1.5rem auto;padding:0 1rem}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:.3em .6em;text-align:left}</style></head>
<body><header>${nav}</header><main>${body}</main></body></html>`;
}

/**
 * The fictional company's public site, generated from the scenario so every
 * figure on it is derivable from the seed. Static: the same for every workspace.
 */
export function buildSite(seed: number, scenarioKey = "acme-v1"): SiteFile[] {
  const rows: ScenarioRows = scenarios.get(scenarioKey).generate(seed);
  const co = rows.company;
  const rng = minstd(seed + 7);
  const nav = `<a href="/data/">Home</a><a href="/data/about.html">About</a><a href="/data/products/">Products</a><a href="/data/locations.html">Locations</a><a href="/data/reports/annual-report.html">Annual report</a><a href="/data/changelog.html">Changelog</a><a href="/data/downloads/">Downloads</a>`;
  const p = (title: string, body: string) => page(co.name, title, body, nav);
  const files: SiteFile[] = [];
  const add = (path: string, body: string, contentType = "text/html; charset=utf-8") => files.push({ path, contentType, body });

  const categories = [...new Set(rows.warehouse.products.map((x) => x.category))].sort();
  add("index.html", p("Home", `<h1>${esc(co.name)}</h1><p>Industrial supply since ${co.founded}, headquartered in ${esc(co.headquarters)}. ${co.employees} employees across ${rows.warehouse.locations.length} depots.</p><ul>${categories.map((c) => `<li><a href="/data/products/${c}.html">${esc(c)}</a></li>`).join("")}</ul>`));
  add("about.html", p("About", `<h1>About ${esc(co.name)}</h1><table><tr><th>Founded</th><td>${co.founded}</td></tr><tr><th>Headquarters</th><td>${esc(co.headquarters)}</td></tr><tr><th>Employees</th><td>${co.employees}</td></tr><tr><th>Depots</th><td>${rows.warehouse.locations.length}</td></tr><tr><th>Customers</th><td>${rows.warehouse.customers.length}</td></tr></table>`));
  add("locations.html", p("Locations", `<h1>Depots</h1><table><tr><th>Code</th><th>Name</th><th>City</th></tr>${rows.warehouse.locations.map((l) => `<tr><td>${l.code}</td><td>${esc(l.name)}</td><td>${esc(l.city)}</td></tr>`).join("")}</table>`));

  add("products/index.html", p("Products", `<h1>Product categories</h1><ul>${categories.map((c) => `<li><a href="/data/products/${c}.html">${esc(c)}</a> (${rows.warehouse.products.filter((x) => x.category === c).length})</li>`).join("")}</ul>`));
  for (const c of categories) {
    const items = rows.warehouse.products.filter((x) => x.category === c);
    add(`products/${c}.html`, p(c, `<h1>${esc(c)}</h1><table><tr><th>SKU</th><th>Name</th><th>List price</th></tr>${items.map((x) => `<tr><td>${x.sku}</td><td>${esc(x.name)}</td><td>${money(x.unitPriceCents)}</td></tr>`).join("")}</table>`));
  }

  const rev = co.fiscalYearRevenueCents;
  const byQuarter = [0.22, 0.24, 0.26, 0.28].map((share) => Math.round(rev * share));
  add("reports/annual-report.html", p("Annual report", `<h1>Annual report FY2025</h1><p>Total revenue: <strong>${money(rev)}</strong>.</p><table><tr><th>Quarter</th><th>Revenue</th></tr>${byQuarter.map((q, i) => `<tr><td>Q${i + 1}</td><td>${money(q)}</td></tr>`).join("")}</table><p>Headcount at year end: ${co.employees}.</p>`));

  const entries = Array.from({ length: 12 }, (_, i) => ({ v: `2.${11 - i}.0`, date: `2026-${String(1 + Math.floor((11 - i) / 2)).padStart(2, "0")}-${String(1 + Math.floor(rng() * 27)).padStart(2, "0")}`, note: ["pagination on the orders API", "transfer completion endpoint", "low-stock report", "gold tier discounts", "depot BRM opened", "MCP server published", "cursor pagination for products", "api tokens for accounts", "order cancellation rules", "customer tiers", "stock reservations on transfers", "initial release"][i] }));
  add("changelog.html", p("Changelog", `<h1>Changelog</h1><table><tr><th>Version</th><th>Date</th><th>Change</th></tr>${entries.map((e) => `<tr><td>${e.v}</td><td>${e.date}</td><td>${esc(e.note)}</td></tr>`).join("")}</table>`));

  add("downloads/index.html", p("Downloads", `<h1>Downloads</h1><ul><li><a href="/data/downloads/products.csv">products.csv</a></li><li><a href="/data/downloads/locations.csv">locations.csv</a></li><li><a href="/data/downloads/customers.csv">customers.csv</a></li></ul>`));
  add("downloads/products.csv", ["sku,name,category,unit_price_cents", ...rows.warehouse.products.map((x) => `${x.sku},"${x.name.replace(/"/g, '""')}",${x.category},${x.unitPriceCents}`)].join("\n"), "text/csv");
  add("downloads/locations.csv", ["code,name,city", ...rows.warehouse.locations.map((l) => `${l.code},"${l.name}",${l.city}`)].join("\n"), "text/csv");
  add("downloads/customers.csv", ["code,name,tier,city", ...rows.warehouse.customers.map((c) => `${c.code},"${c.name}",${c.tier},${c.city}`)].join("\n"), "text/csv");

  add("mcp/index.html", p("MCP registry", `<h1>MCP servers</h1><p>Our systems expose Model Context Protocol servers per benchme workspace. See the benchme gateway's <a href="/registry">registry</a> for endpoints.</p><table><tr><th>Server</th><th>Purpose</th></tr><tr><td>warehouse</td><td>products, stock, orders, transfers</td></tr><tr><td>helpdesk</td><td>tickets, comments, SLAs (coming)</td></tr><tr><td>vaultdocs</td><td>documents as resources + search (coming)</td></tr></table>`));
  add("robots.txt", "User-agent: *\nDisallow: /\n", "text/plain");
  return files;
}
