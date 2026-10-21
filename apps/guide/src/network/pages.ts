import type { Site } from "../content/sites.js";
import type { Look } from "../content/sites.js";
import type { Product } from "../content/types.js";
import { esc } from "../render/layout.js";
import { sitePath, type NetworkEdition } from "./editions.js";
import { PLAIN, networkPage } from "./layout.js";
import { sitePointer, vendorPointer } from "./pointing.js";

/**
 * The network's pages, each a pure function of (edition, prefix). Every edition renders the start page and the four
 * vendor sites identically but for one thing — a chain's pointer on the target's own vendor site — and serves the
 * recommendation sites of its chain, each with its pointer onward (pointing.ts).
 */

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** The vendor sites' looks, by the product's place on the start page — never by which product is the target. */
const VENDOR_LOOKS: readonly Look[] = [
  { accent: "#2f5d9e", font: "system-ui, -apple-system, 'Segoe UI', sans-serif", paper: "#fbfcfe" },
  { accent: "#8a3b8f", font: "system-ui, -apple-system, 'Segoe UI', sans-serif", paper: "#fdfbfd" },
  { accent: "#1d7a5c", font: "system-ui, -apple-system, 'Segoe UI', sans-serif", paper: "#fbfdfc" },
  { accent: "#9a5b13", font: "system-ui, -apple-system, 'Segoe UI', sans-serif", paper: "#fefcf9" },
];

const aside = (heading: string, pointer: string): string => (pointer ? `<aside class="pointer">\n<h2>${esc(heading)}</h2>\n${pointer}\n</aside>` : "");

export function startPage(e: NetworkEdition, prefix: string): string {
  const c = e.category;
  const items = c.products
    .map((p) => `<li>\n<h2><a href="${esc(prefix)}/${esc(sitePath(p.slug))}">${esc(p.name)}</a></h2>\n<p class="tagline">${esc(p.tagline)}</p>\n</li>`)
    .join("\n");
  return networkPage({
    title: cap(c.wording.nounPlural),
    masthead: { name: "Start page", strap: "Links to each candidate's own site", home: `${prefix}/`, look: PLAIN },
    body: `<h1>${esc(cap(c.wording.nounPlural))}: four candidates</h1>
<p class="intro">${esc(`Four ${c.wording.nounPlural}, each with its own site. Prices, plans and details are on each site.`)}</p>
<ul class="candidates">
${items}
</ul>`,
  });
}

/** A product's own site: its summary and spec sheet, as every vendor's site shows them; a chain's pointer on the target's. */
export function vendorPage(e: NetworkEdition, p: Product, prefix: string): string {
  const look = VENDOR_LOOKS[e.category.products.indexOf(p)] ?? PLAIN;
  const rows = p.facts.map((f) => `<tr><th scope="row">${esc(f.label)}</th><td>${esc(f.value)}</td></tr>`).join("\n");
  return networkPage({
    title: p.name,
    masthead: { name: p.name, strap: p.tagline, home: `${prefix}/${sitePath(p.slug)}`, look },
    body: `<h1>${esc(p.name)}</h1>
<p class="tagline">${esc(p.tagline)}</p>
<h2>In short</h2>
<p>${esc(p.summary)}</p>
<h2>Plans and features</h2>
<table>
${rows}
</table>
${aside("In the press", vendorPointer(e, p, prefix))}`,
  });
}

/** A recommendation site's page about the target, served at its hop of the chain, with its pointer onward. */
export function sitePage(e: NetworkEdition, site: Site, hop: number, prefix: string): string {
  const a = site.page(e.category, e.target);
  return networkPage({
    title: a.title,
    masthead: { name: site.name, strap: site.strap, home: `${prefix}/${sitePath(site.key)}`, look: site.look },
    body: `<article>
<h1>${esc(a.title)}</h1>
<p class="byline">${esc(a.byline)}</p>
<p class="dek">${esc(a.dek)}</p>
${a.paragraphs.map((para) => `<p>${esc(para)}</p>`).join("\n")}
</article>
${aside("Further reading", sitePointer(e, hop, prefix))}`,
  });
}

export function networkNotFoundPage(prefix: string): string {
  return networkPage({
    title: "Not found",
    masthead: { name: "Not found", strap: "There is no page at this address", home: `${prefix}/`, look: PLAIN },
    body: `<h1>Page not found</h1>\n<p><a href="${esc(prefix)}/">Back to the start page</a></p>`,
  });
}

/** A workspace whose seed names no network edition (or that is not a network workspace at all). */
export function noNetworkPage(prefix: string): string {
  return networkPage({
    title: "Nothing here",
    masthead: { name: "Not found", strap: "There is no page at this address", home: `${prefix}/`, look: PLAIN },
    body: `<h1>No web is published for this workspace</h1>`,
  });
}
