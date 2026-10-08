import type { Product, StoreDef } from "@benchme/storefront";
import {
  accountLink,
  badgesHtml,
  cartButton,
  collectionHref,
  defaultPriceCents,
  defaultSkin,
  dollars,
  esc,
  finePrint,
  footerColumns,
  formatUsd,
  hasPriceRange,
  href,
  icon,
  img,
  logoLink,
  menuButton,
  newsletterForm,
  pageHref,
  paymentIcons,
  plural,
  priceHtml,
  productGrid,
  productHref,
  ratingOf,
  ratingText,
  searchForm,
  socialLinks,
  stars,
  telHref,
  type CollectionTile,
  type CollectionView,
  type HomeSection,
  type ReviewHighlight,
} from "../components.js";
import type { PageCtx, StoreCtx } from "../layout.js";
import type { Skin } from "./index.js";

/**
 * Halden Audio — a direct-to-consumer audio brand that sells on measurements. Precise and confident:
 * white and carbon with one electric blue, Space Grotesk set tight. Its own structure, not a recolour:
 * a carbon utility bar over a header whose collection menu opens full-width panels of products; a
 * full-bleed dark hero with a rail of promises; products on grey wells with a type line, spec chips and
 * colour dots; a flagship spotlight with measured figures; the brand story told as a bench measurement
 * (a frequency-response graph); collection headers with the range's numbers and, on Headphones, a
 * comparison table; product pages with key specs in the buy box, a specs sheet with "What's in the box",
 * and an add-to-cart bar that stays on screen on phones; a carbon footer.
 *
 * Every figure shown is read from the catalogue (details, tags, options, shipping rules) — nothing is a
 * claim the product page doesn't make. Styles: public/css/halden.css (classes prefixed hd-).
 */

/* ------------------------------------------------------------------ reading specs off the catalogue */

/** The value of a "Key: value" line of a product's details ("Battery" → "up to 40 hours …"). */
function detail(p: Product, key: string): string | undefined {
  const k = `${key.toLowerCase()}:`;
  return p.details.find((d) => d.toLowerCase().startsWith(k))?.slice(k.length).trim();
}

/** Hours per charge from the "Battery" line: the first figure (with noise cancelling on, where both are given). */
function batteryHours(p: Product): number | null {
  const m = detail(p, "Battery")?.match(/(\d+)\s*hours?/);
  return m ? Number(m[1]) : null;
}

const weightOf = (p: Product) => detail(p, "Weight")?.match(/^[\d.,]+\s*k?g\b/)?.[0] ?? null;
const waterOf = (p: Product) => detail(p, "Water resistance")?.match(/IPX\d/)?.[0] ?? null;
const powerOf = (p: Product) => detail(p, "Power")?.match(/^(?:\d+\s*×\s*)?\d+\s*W\b/)?.[0] ?? null;

/** "40 mm", "2 × 45 mm": one driver size (a line naming a woofer and a tweeter has no single size). */
function driverOf(p: Product): string | null {
  const d = detail(p, "Driver") ?? detail(p, "Drivers");
  if (!d || / and /.test(d)) return null;
  return d.match(/^(?:\d+\s*×\s*)?\d+(?:\.\d+)?\s*mm\b/)?.[0] ?? null;
}

/** The facts a listener compares first, as short chips: noise cancelling, battery, water, power, weight, driver. */
export function specChips(p: Product, max = 3): string[] {
  const chips: string[] = [];
  if (p.tags.includes("anc")) chips.push("Noise cancelling");
  const h = batteryHours(p);
  if (h) chips.push(`${h} h battery`);
  const water = waterOf(p);
  if (water) chips.push(water);
  const power = powerOf(p);
  if (power) chips.push(power);
  const weight = weightOf(p);
  if (weight) chips.push(weight);
  const driver = driverOf(p);
  if (driver) chips.push(`${driver} ${driver.includes("×") ? "drivers" : "driver"}`);
  return chips.slice(0, max);
}

const FORMS: readonly (readonly [tag: string, label: string])[] = [
  ["over-ear", "Over-ear"],
  ["on-ear", "On-ear"],
  ["true-wireless", "True wireless"],
  ["neckband", "Neckband"],
  ["portable", "Portable"],
  ["desktop", "Desktop"],
  ["bookshelf", "Bookshelf"],
];

/** What kind of thing it is, from its tags: "Over-ear · Wireless", "True wireless", "Portable · Waterproof", "Accessory". */
function typeLine(p: Product, store: StoreDef): string {
  const parts: string[] = [];
  const form = FORMS.find(([t]) => p.tags.includes(t))?.[1];
  if (form) parts.push(form);
  if (p.tags.includes("wired")) parts.push("Wired");
  else if (p.tags.includes("wireless") && !p.tags.includes("true-wireless")) parts.push("Wireless");
  if (p.tags.includes("waterproof")) parts.push("Waterproof");
  if (p.tags.includes("powered")) parts.push("Powered");
  if (parts.length) return parts.join(" · ");
  const c = store.collections.find((x) => x.slug === p.collection)?.name ?? "";
  return /ies$/.test(c) ? c.replace(/ies$/, "y") : c.replace(/s$/, "");
}

/** The option a shopper picks a look by: its colour, or a finish. */
const swatchGroup = (p: Product) => p.options.find((g) => g.id === "color" || g.id === "finish");

/** "$329", or "From $14.95" when an option changes the price. */
const fromPrice = (p: Product) => `${hasPriceRange(p) ? "From " : ""}${dollars(p.priceCents)}`;

const chipList = (chips: string[], cls: string, label?: string) =>
  chips.length ? `<ul class="${esc(cls)}"${label ? ` aria-label="${esc(label)}"` : ""}>${chips.map((c) => `<li class="chip">${esc(c)}</li>`).join("")}</ul>` : "";

/** A right arrow for "go" links (decorative). */
const ARROW = `<svg class="icon hd-arrow" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`;

const eyebrow = (text: string, cls = "") => `<p class="hd-eyebrow${cls ? ` ${esc(cls)}` : ""}">${esc(text)}</p>`;

/** A section heading: an eyebrow, the title, and a "see all" link on the right. */
function head(ctx: PageCtx, o: { kicker?: string; title: string; intro?: string; link?: { label: string; path: string } }): string {
  return `<div class="hd-head"><div class="hd-head__copy">${o.kicker ? eyebrow(o.kicker) : ""}<h2 class="section__title">${esc(o.title)}</h2>${
    o.intro ? `<p class="hd-head__intro">${esc(o.intro)}</p>` : ""
  }</div>${o.link ? `<a class="hd-arrow-link" href="${esc(href(ctx, o.link.path))}">${esc(o.link.label)}${ARROW}</a>` : ""}</div>`;
}

/* ------------------------------------------------------------------ announcement, header, footer */

function announcement(ctx: PageCtx): string {
  const links: [string, string][] = [
    ["contact", "Contact"],
    ["shipping", "Shipping"],
    ["returns", "Returns"],
  ];
  return `<div class="announcement hd-announcement" role="region" aria-label="Announcement"><div class="container hd-announcement__inner">
<p>${esc(ctx.brand.announcement)}</p>
<ul class="hd-announcement__links">${links.map(([k, l]) => `<li><a href="${esc(pageHref(ctx, k))}">${esc(l)}</a></li>`).join("")}</ul>
</div></div>`;
}

/** The collection menu: each collection opens a full-width panel of its products (wide screens; phones use the menu drawer). */
function megaNav(ctx: PageCtx): string {
  const store = ctx.store;
  if (!store) return "";
  const items = store.collections
    .map((c) => {
      const ps = store.products.filter((p) => p.collection === c.slug);
      const tiles = ps
        .slice(0, 6)
        .map(
          (p) =>
            `<li><a class="hd-mega__product" href="${esc(productHref(ctx, p))}"><span class="hd-mega__media">${img(ctx, p.images[0], "", { lazy: true })}</span><span class="hd-mega__name">${esc(
              p.name,
            )}</span><span class="hd-mega__meta">${esc(typeLine(p, store))}</span><span class="hd-mega__price">${esc(fromPrice(p))}</span></a></li>`,
        )
        .join("");
      return `<li class="nav__item hd-nav__item"><a class="nav__link hd-nav__link" href="${esc(collectionHref(ctx, c.slug))}">${esc(c.name)}</a>
<div class="hd-mega"><div class="container hd-mega__inner">
<div class="hd-mega__intro"><p class="hd-mega__title">${esc(c.name)}</p><p class="hd-mega__blurb">${esc(c.blurb)}</p><a class="hd-arrow-link" href="${esc(collectionHref(ctx, c.slug))}">Shop all ${esc(
        plural(ps.length, c.name.toLowerCase(), c.name.toLowerCase()),
      )}${ARROW}</a></div>
<ul class="hd-mega__products">${tiles}</ul>
</div></div></li>`;
    })
    .join("");
  return `<nav class="nav hd-nav" aria-label="Collections"><ul class="nav__list">${items}<li class="nav__item hd-nav__item"><a class="nav__link hd-nav__link" href="${esc(pageHref(ctx, "faq"))}">Support</a></li></ul></nav>`;
}

/** Logo left, the collection menu beside it; search, account and cart on the right (search is an icon on phones). */
function header(ctx: PageCtx): string {
  return `<header class="site-header hd-header" data-site-header>
<div class="container site-header__bar hd-header__bar">
${menuButton()}
${logoLink(ctx)}
${megaNav(ctx)}
<div class="header-actions hd-header__actions">${searchForm(ctx, "header", { placeholder: "Search products" })}<a class="icon-btn hd-search-link" href="${esc(
    href(ctx, "/search"),
  )}" aria-label="Search">${icon("search")}</a>${accountLink(ctx)}${cartButton(ctx)}</div>
</div>
</header>`;
}

function footer(ctx: PageCtx): string {
  return `<footer class="site-footer hd-footer">
<div class="container">
<div class="site-footer__top hd-footer__top">
<div class="site-footer__brand hd-footer__brand">${logoLink(ctx, "logo logo--footer")}
<p class="hd-footer__tagline">${esc(ctx.brand.tagline)}</p>
<p class="hd-footer__hours">Our support team in Portland answers the phone Monday to Friday, 8 am to 6 pm Pacific.</p>
${socialLinks(ctx.skin.socials)}</div>
${footerColumns(ctx)}
</div>
<div class="site-footer__bottom hd-footer__bottom"><p class="copyright">© 2026 ${esc(ctx.brand.name)} · Portland, Oregon</p>${paymentIcons()}</div>
${finePrint(ctx)}
</div>
</footer>`;
}

/* ------------------------------------------------------------------ home */

/** The flagship the spotlight is built around (the over-ear bestseller), or the first product. */
function flagship(store: StoreDef): Product | undefined {
  const ps = store.products;
  return ps.find((p) => p.collection === "headphones" && p.badges?.includes("Bestseller")) ?? ps[0];
}

/** "1–2 business days", "1 business day". */
const businessDays = ([a, b]: [number, number]) => (a === b ? plural(a, "business day") : `${a}–${b} business days`);

/** The collections that open with a comparison table of every model. */
const COMPARED = new Set(["headphones"]);

/** The tagline as the hero sets it: one line per sentence. */
const taglineLines = (t: string) =>
  t
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean)
    .map((s) => `<span>${esc(s)}</span>`)
    .join(" ");

/** The hero's photograph: the DJ pair on a dark desk (it sits in the carbon hero), else the brand's hero image. */
function heroPhoto(store: StoreDef): { src: string | undefined; alt: string } {
  const dark = store.products.find((p) => p.slug === "skerry-dj-headphones")?.images[0];
  return dark
    ? { src: dark, alt: "Over-ear headphones with a braided cable on a dark desk" }
    : { src: store.brand.heroImage, alt: "Headphones held on a subway platform" };
}

function hero(ctx: StoreCtx): string {
  const s = ctx.store;
  const photo = heroPhoto(s);
  const first = s.collections[0];
  const second = s.collections[1];
  const fastest = [...s.shipping].sort((a, b) => a.days[1] - b.days[1])[0];
  const facts = [
    s.freeShippingOverCents ? { icon: "truck", strong: "Free shipping", text: `on orders of ${dollars(s.freeShippingOverCents)} or more` } : null,
    fastest && s.shipping.length > 1 ? { icon: "clock", strong: "Express", text: `delivery in ${businessDays(fastest.days)}` } : null,
    { icon: "return", strong: "45-day returns", text: "with free return shipping" },
    { icon: "shield", strong: "1-year warranty", text: "on every product we make" },
  ].filter((f): f is { icon: string; strong: string; text: string } => f !== null);
  return `<section class="hero hd-hero" data-section="hero">
<div class="container hd-hero__inner">
<div class="hd-hero__content">
${eyebrow(s.collections.map((c) => c.name).slice(0, 3).join(" · "), "hd-eyebrow--on-dark")}
<h1 class="hd-hero__title">${taglineLines(s.brand.tagline)}</h1>
<p class="hd-hero__text">Headphones, earbuds and speakers from a workshop of acoustic engineers in Portland, Oregon. Every unit is measured against one reference curve before it ships.</p>
<div class="hd-hero__actions">${first ? `<a class="btn btn--primary btn--lg" href="${esc(collectionHref(ctx, first.slug))}">Shop ${esc(first.name.toLowerCase())}</a>` : ""}${
    second ? `<a class="btn btn--glass btn--lg" href="${esc(collectionHref(ctx, second.slug))}">Shop ${esc(second.name.toLowerCase())}</a>` : ""
  }</div>
</div>
</div>
<div class="hd-hero__media">${img(ctx, photo.src, photo.alt, { eager: true })}</div>
<div class="hd-hero__rail"><div class="container"><ul class="hd-hero__facts">${facts
    .map((f) => `<li>${icon(f.icon)}<span><strong>${esc(f.strong)}</strong> ${esc(f.text)}</span></li>`)
    .join("")}</ul></div></div>
</section>`;
}

const categoryTiles: HomeSection = (ctx, data) => {
  const tile = (t: CollectionTile) => {
    const ps = ctx.store.products.filter((p) => p.collection === t.collection.slug);
    const from = ps.length ? Math.min(...ps.map((p) => p.priceCents)) : null;
    return `<li><a class="hd-cat" href="${esc(collectionHref(ctx, t.collection.slug))}">
<span class="hd-cat__media">${img(ctx, t.image, "")}</span>
<span class="hd-cat__body"><span class="hd-cat__text"><span class="hd-cat__name">${esc(t.collection.name)}</span><span class="hd-cat__meta">${esc(plural(t.count, "product"))}${
      from !== null ? ` · from ${esc(dollars(from))}` : ""
    }</span></span><span class="hd-cat__go">${ARROW}</span></span>
</a></li>`;
  };
  return `<section class="section hd-cats" data-section="featured-collections"><div class="container">
${head(ctx, { kicker: "Shop by category", title: "Find your fit", link: { label: "Shop all", path: "/collections/all" } })}
<ul class="hd-cats__list" role="list">${data.collections.map(tile).join("")}</ul>
</div></section>`;
};

const bestsellers: HomeSection = (ctx, data) => `<section class="section hd-best" data-section="bestsellers"><div class="container">
${head(ctx, { kicker: "Most loved", title: "Bestsellers", link: { label: "Shop all products", path: "/collections/all" } })}
${productGrid(ctx, data.bestsellers.slice(0, 8), { cls: "grid--home" })}
</div></section>`;

const WORDS: Readonly<Record<string, number>> = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

/** The flagship's measured figures, from its details and description; only what the catalogue says. */
function flagshipStats(p: Product): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  const h = batteryHours(p);
  if (h) out.push({ value: `${h} h`, label: /noise cancelling on/i.test(detail(p, "Battery") ?? "") ? "battery, noise cancelling on" : "battery per charge" });
  const mics = /\b(\w+) microphones\b/i.exec(p.description)?.[1]?.toLowerCase();
  const n = mics ? (WORDS[mics] ?? Number(mics)) : Number.NaN;
  if (p.tags.includes("anc") && Number.isInteger(n) && n > 0) out.push({ value: String(n), label: "microphones for noise cancelling" });
  const matched = /within ([\d.]+)\s*dB/i.exec(p.description)?.[1];
  if (matched) out.push({ value: `${matched} dB`, label: "driver pair matching" });
  const w = weightOf(p);
  if (w) out.push({ value: w, label: "weight" });
  return out.slice(0, 4);
}

const spotlight: HomeSection = (ctx) => {
  const p = flagship(ctx.store);
  if (!p) return "";
  const c = ctx.store.collections.find((x) => x.slug === p.collection);
  const stats = flagshipStats(p);
  const short = p.name.split(" ")[0] ?? p.name;
  return `<section class="section hd-spotlight" data-section="spotlight"><div class="container hd-spotlight__inner">
<div class="hd-spotlight__media">${img(ctx, p.images[0], p.name)}</div>
<div class="hd-spotlight__body">
${eyebrow(`Our flagship · ${typeLine(p, ctx.store)}`)}
<h2 class="hd-spotlight__title">${esc(p.name)}</h2>
<p class="hd-spotlight__text">${esc(p.summary)}</p>
${stats.length ? `<dl class="hd-stats">${stats.map((s) => `<div class="hd-stats__item"><dt>${esc(s.label)}</dt><dd>${esc(s.value)}</dd></div>`).join("")}</dl>` : ""}
<div class="hd-spotlight__actions"><a class="btn btn--primary btn--lg" href="${esc(productHref(ctx, p))}">Shop ${esc(short)}</a><p class="hd-spotlight__price">${priceHtml(p)}</p></div>
${c && COMPARED.has(c.slug) ? `<a class="hd-arrow-link" href="${esc(`${collectionHref(ctx, c.slug)}#compare`)}">Compare all ${esc(c.name.toLowerCase())}${ARROW}</a>` : ""}
</div>
</div></section>`;
};

/** The bench graph: the reference curve, its tolerance band and one unit's measured response, 20 Hz–20 kHz (computed once). */
const BENCH_GRAPH = (() => {
  const W = 640;
  const H = 340;
  const L = 40;
  const R = 14;
  const T = 14;
  const B = 34;
  const lo = Math.log10(20);
  const span = 3;
  const x = (f: number) => L + ((Math.log10(f) - lo) / span) * (W - L - R);
  const y = (db: number) => T + ((9 - db) / 18) * (H - T - B);
  const target = (f: number) => {
    const lf = Math.log10(f);
    const bass = 4.6 / (1 + (f / 115) ** 2);
    const presence = 2.4 * Math.exp(-((lf - Math.log10(3100)) ** 2) / (2 * 0.17 ** 2));
    const air = -4.2 / (1 + (10500 / f) ** 3);
    return bass + presence + air - 0.6;
  };
  const measured = (f: number) => {
    const lf = Math.log10(f);
    return target(f) + 0.42 * Math.sin(lf * 11.3 + 0.7) * Math.min(1, 0.35 + f / 3000) + 0.18 * Math.sin(lf * 31);
  };
  const freqs = Array.from({ length: 145 }, (_, i) => 20 * 10 ** ((i / 144) * span));
  const pt = (f: number, db: number) => `${x(f).toFixed(1)} ${y(db).toFixed(1)}`;
  const line = (fn: (f: number) => number) => freqs.map((f, i) => `${i ? "L" : "M"}${pt(f, fn(f))}`).join("");
  const band = `${freqs.map((f, i) => `${i ? "L" : "M"}${pt(f, target(f) + 1.4)}`).join("")}${[...freqs]
    .reverse()
    .map((f) => `L${pt(f, target(f) - 1.4)}`)
    .join("")}Z`;
  const vlines = [20, 30, 40, 50, 60, 70, 80, 90, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000, 20000];
  const majors = new Set([20, 100, 1000, 10000, 20000]);
  const xLabels: [number, string][] = [
    [20, "20 Hz"],
    [100, "100"],
    [1000, "1k"],
    [10000, "10k"],
    [20000, "20k"],
  ];
  const hlines = [-6, -3, 0, 3, 6];
  const grid = [
    ...vlines.map((f) => `<line class="${majors.has(f) ? "is-major" : ""}" x1="${x(f).toFixed(1)}" y1="${T}" x2="${x(f).toFixed(1)}" y2="${H - B}"/>`),
    ...hlines.map((d) => `<line class="${d === 0 ? "is-major" : ""}" x1="${L}" y1="${y(d).toFixed(1)}" x2="${W - R}" y2="${y(d).toFixed(1)}"/>`),
  ].join("");
  const labels = [
    ...xLabels.map(([f, t]) => `<text x="${x(f).toFixed(1)}" y="${H - 12}" text-anchor="${f === 20 ? "start" : f === 20000 ? "end" : "middle"}">${t}</text>`),
    ...hlines.map((d) => `<text x="${L - 8}" y="${(y(d) + 4).toFixed(1)}" text-anchor="end">${d > 0 ? `+${d}` : d < 0 ? `−${-d}` : "0"}</text>`),
    `<text x="${L - 8}" y="${T + 4}" text-anchor="end" class="hd-graph__unit">dB</text>`,
  ].join("");
  return `<svg class="hd-graph" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="hd-graph-title" focusable="false"><title id="hd-graph-title">A measured frequency response lying inside the tolerance band around Halden's reference curve, from 20 Hz to 20 kHz</title>
<g class="hd-graph__grid">${grid}</g>
<g class="hd-graph__labels" aria-hidden="true">${labels}</g>
<path class="hd-graph__band" d="${band}"/>
<path class="hd-graph__target" d="${line(target)}"/>
<path class="hd-graph__measured" d="${line(measured)}"/>
</svg>`;
})();

const bench: HomeSection = (ctx) => `<section class="section hd-bench" data-section="story"><div class="container hd-bench__inner">
<div class="hd-bench__body">
${eyebrow("How we tune", "hd-eyebrow--on-dark")}
<h2 class="hd-bench__title">One reference curve. Every unit measured.</h2>
<p>Every Halden product is tuned by ear in our listening room, then measured on the bench against a single reference curve, so a song sounds like the same song on our earbuds, our headphones and our speakers.</p>
<p>Drivers are matched in pairs, and every finished unit is measured before it's packed. If it misses the curve, it doesn't ship.</p>
<ul class="hd-bench__facts" role="list">
<li><strong>Tuned by ear</strong><span>in our Portland listening room</span></li>
<li><strong>Measured</strong><span>against one reference curve</span></li>
<li><strong>Repairable</strong><span>cushions, cables and headbands come off without tools</span></li>
</ul>
<a class="btn btn--glass" href="${esc(pageHref(ctx, "about"))}">How we tune${ARROW}</a>
</div>
<figure class="hd-bench__figure">${BENCH_GRAPH}<figcaption><span class="hd-key hd-key--target">Reference curve</span><span class="hd-key hd-key--band">Tolerance</span><span class="hd-key hd-key--measured">A finished unit, measured</span></figcaption></figure>
</div></section>`;

function quote(ctx: StoreCtx, h: ReviewHighlight): string {
  const r = h.review;
  return `<figure class="hd-quote">
${stars(r.rating, "stars stars--small")}
<blockquote class="hd-quote__text"><p class="hd-quote__title">${esc(r.title)}</p><p>${esc(r.body)}</p></blockquote>
<figcaption class="hd-quote__by"><a class="hd-quote__product" href="${esc(productHref(ctx, h.product))}"><span class="hd-quote__thumb">${img(ctx, h.product.images[0], "")}</span><span><span class="hd-quote__author">${esc(
    r.author,
  )}${r.verified ? " · Verified buyer" : ""}</span><span class="hd-quote__name">${esc(h.product.name)}</span></span></a></figcaption>
</figure>`;
}

const listeners: HomeSection = (ctx, data) => {
  const all = ctx.store.products.flatMap((p) => p.reviews);
  const avg = all.length ? all.reduce((a, r) => a + r.rating, 0) / all.length : 0;
  return `<section class="section hd-reviews" data-section="reviews"><div class="container">
<div class="hd-head hd-reviews__head"><div class="hd-head__copy">${eyebrow("Reviews")}<h2 class="section__title">What listeners say</h2></div>${
    all.length
      ? `<div class="hd-score"><p class="hd-score__avg">${esc(ratingText(avg))}</p><div class="hd-score__detail">${stars(avg)}<p>Average of ${esc(plural(all.length, "review"))} across the range</p></div></div>`
      : ""
  }</div>
<div class="hd-quotes">${data.reviews
    .slice(0, 3)
    .map((h) => quote(ctx, h))
    .join("")}</div>
</div></section>`;
};

const newsletter: HomeSection = (ctx) => `<section class="section hd-news" data-section="newsletter"><div class="container hd-news__inner">
<div class="hd-news__copy">${eyebrow("The Halden newsletter", "hd-eyebrow--on-accent")}<h2 class="hd-news__title">Get 10% off your first order</h2>
<p>New releases, listening notes from the bench and the occasional offer, a couple of times a month. Your code appears the moment you sign up.</p></div>
<div class="hd-news__form">${newsletterForm(ctx, "block")}<p class="hd-news__note">No spam. Unsubscribe with one click from any email.</p></div>
</div></section>`;

/* ------------------------------------------------------------------ product card */

function productCard(p: Product, ctx: StoreCtx): string {
  const { avg, count } = ratingOf(p);
  const second = p.images[1];
  const group = swatchGroup(p);
  const shown = group?.values.slice(0, 5) ?? [];
  const dots =
    group && group.values.length > 1
      ? `<span class="hd-dots"><span class="visually-hidden">${esc(`Available in ${plural(group.values.length, group.id === "finish" ? "finish" : "color", group.id === "finish" ? "finishes" : "colors")}`)}</span>${shown
          .map((v) => `<span class="hd-dot" data-swatch="${esc(v.id)}" title="${esc(v.label)}" aria-hidden="true"></span>`)
          .join("")}${group.values.length > shown.length ? `<span class="hd-dots__more" aria-hidden="true">+${group.values.length - shown.length}</span>` : ""}</span>`
      : "";
  return `<article class="card hd-card" data-product-slug="${esc(p.slug)}" data-price-cents="${p.priceCents}">
<a class="card__link" href="${esc(productHref(ctx, p))}">
<div class="card__media">${img(ctx, p.images[0], p.name, { cls: "card__img" })}${second ? img(ctx, second, "", { cls: "card__img card__img--alt" }) : ""}${badgesHtml(p, "card__badges badges")}</div>
<div class="card__body">
<p class="hd-card__type">${esc(typeLine(p, ctx.store))}</p>
<h3 class="card__title">${esc(p.name)}</h3>
${count ? `<p class="card__rating">${stars(avg)}<span class="card__count">${esc(ratingText(avg))} (${count})</span></p>` : ""}
${chipList(specChips(p), "chips hd-chips")}
<div class="hd-card__foot"><p class="card__price">${priceHtml(p)}</p>${dots}</div>
</div>
</a>
</article>`;
}

/* ------------------------------------------------------------------ collection header and the comparison table */

function collectionStats(ps: Product[], count: number): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [{ label: count === 1 ? "Product" : "Products", value: String(count) }];
  if (ps.length) out.push({ label: "Starting at", value: dollars(Math.min(...ps.map((p) => p.priceCents))) });
  const hours = ps.map(batteryHours).filter((h): h is number => h !== null);
  if (hours.length) out.push({ label: "Longest battery", value: `${Math.max(...hours)} h` });
  const anc = ps.filter((p) => p.tags.includes("anc")).length;
  if (anc) out.push({ label: anc === 1 ? "Model with noise cancelling" : "Models with noise cancelling", value: String(anc) });
  return out.slice(0, 4);
}

/** Every model in the collection side by side: fit, connection, noise cancelling, battery, weight, driver. */
function compareTable(ctx: StoreCtx, c: CollectionView, ps: Product[]): string {
  if (ps.length < 3) return "";
  const dash = '<span class="hd-no"><span aria-hidden="true">—</span><span class="visually-hidden">None</span></span>';
  const yes = (t: string) => `<span class="hd-yes">${icon("check")}${esc(t)}</span>`;
  const rows: [string, (p: Product) => string][] = [
    ["Fit", (p) => esc(FORMS.find(([t]) => p.tags.includes(t))?.[1] ?? "—")],
    ["Connection", (p) => esc(p.tags.includes("wired") ? "Wired, 3.5 mm" : `Bluetooth ${detail(p, "Bluetooth")?.match(/^[\d.]+/)?.[0] ?? ""}`.trim())],
    ["Noise cancelling", (p) => (p.tags.includes("anc") ? yes("Active") : dash)],
    ["Battery", (p) => (batteryHours(p) ? esc(`${batteryHours(p)} h`) : p.tags.includes("wired") ? '<span class="hd-no">No battery</span>' : dash)],
    ["Weight", (p) => esc(weightOf(p) ?? "—")],
    ["Driver", (p) => esc(driverOf(p) ?? "—")],
  ];
  const cols = ps
    .map(
      (p) =>
        `<th scope="col"><a class="hd-compare__product" href="${esc(productHref(ctx, p))}"><span class="hd-compare__thumb">${img(ctx, p.images[0], "")}</span><span class="hd-compare__name">${esc(
          p.name,
        )}</span><span class="hd-compare__price">${esc(fromPrice(p))}</span></a></th>`,
    )
    .join("");
  const body = rows.map(([label, cell]) => `<tr><th scope="row">${esc(label)}</th>${ps.map((p) => `<td>${cell(p)}</td>`).join("")}</tr>`).join("");
  return `<section class="hd-compare" id="compare" aria-labelledby="compare-title"><div class="container">
<div class="hd-compare__head"><h2 class="hd-compare__title" id="compare-title">Compare ${esc(c.name.toLowerCase())}</h2><p class="hd-compare__note">${esc(
    `All ${plural(ps.length, "model")} side by side, from the specs on each product page.`,
  )}<span class="hd-compare__swipe" aria-hidden="true"> Swipe the table to see them all.</span></p></div>
<div class="hd-compare__scroll" role="region" aria-labelledby="compare-title" tabindex="0">
<table class="hd-compare__table"><thead><tr><td class="hd-compare__corner"></td>${cols}</tr></thead><tbody>${body}</tbody></table>
</div>
</div></section>`;
}

function collectionHeader(c: CollectionView, ctx: StoreCtx): string {
  const ps = c.slug === "all" ? ctx.store.products : ctx.store.products.filter((p) => p.collection === c.slug);
  const stats = collectionStats(ps, c.count);
  return `<header class="collection-header hd-colhead">
<div class="container hd-colhead__inner">
<div class="hd-colhead__copy">
${eyebrow(c.slug === "all" ? "The full range" : "Collection")}
<h1 class="collection-header__title">${esc(c.name)}</h1>
<p class="collection-header__blurb">${esc(c.blurb)}</p>
</div>
<dl class="hd-colhead__stats">${stats.map((s) => `<div><dt>${esc(s.label)}</dt><dd>${esc(s.value)}</dd></div>`).join("")}</dl>
</div>
${COMPARED.has(c.slug) ? compareTable(ctx, c, ps) : ""}
</header>`;
}

/* ------------------------------------------------------------------ product page */

/** The details as a specs sheet: "Key: value" lines become rows (the box contents have their own list), the rest are features. */
function specRows(p: Product): [string, string][] {
  const rows: [string, string][] = [];
  const features: string[] = [];
  for (const d of p.details) {
    const i = d.indexOf(":");
    if (i > 0 && i < 40) {
      const key = d.slice(0, i).trim();
      if (key.toLowerCase() !== "in the box") rows.push([key, esc(d.slice(i + 1).trim())]);
    } else features.push(d);
  }
  if (features.length) rows.unshift(["Features", features.length === 1 ? esc(features[0] ?? "") : `<ul class="hd-specs__list">${features.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>`]);
  rows.push(["Model number", esc(p.sku)]);
  return rows;
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * What ships in the box, read from the catalogue: an "In the box:" detail line when the product has one;
 * otherwise the unit itself, the case, tips and cables its details and description name, a USB-C cable for
 * anything with a battery, and the quick-start guide every box carries (see the returns policy). Accessories
 * (no driver) have no list.
 */
function boxContents(p: Product): string[] {
  if (!p.details.some((d) => /^drivers?:/i.test(d))) return [];
  const text = `${p.summary} ${p.description} ${p.details.join(". ")}`;
  const items = [/\bsold as a pair\b|\ba pair of\b/i.test(text) ? `${p.name} (pair)` : p.name];
  const explicit = detail(p, "In the box");
  if (explicit) {
    items.push(...explicit.split(/,\s*|\s+and\s+/).map((s) => capital(s.trim())).filter(Boolean));
  } else {
    if (p.tags.includes("true-wireless")) items.push(/wireless charging case/i.test(text) ? "Wireless charging case" : "Charging case");
    if (/\btips\b/i.test(p.description)) {
      const sizes = /\b(two|three|four|five)\s+sizes\b/i.exec(p.description)?.[1]?.toLowerCase();
      const kind = /\bwing tips\b/i.test(p.description) ? "Wing tips" : "Ear tips";
      items.push(sizes ? `${kind} in ${sizes} sizes` : kind);
    }
    const included = p.details.map((d) => /(?:^|[;:]\s*)([^;:]*?)\s+included\b/i.exec(d)?.[1]?.trim()).find((s): s is string => !!s);
    if (included) items.push(capital(/cable/i.test(included) ? included : `${included} cables`));
    else {
      const detachable = /^detachable\s+([^;]+)/i.exec(detail(p, "Connection") ?? "")?.[1];
      if (detachable) items.push(capital(detachable.trim()));
    }
  }
  if ((p.tags.includes("wireless") || p.tags.includes("portable")) && !items.some((i) => /usb-c/i.test(i))) items.push("USB-C charging cable");
  items.push("Quick-start guide");
  return items;
}

/** Beside the description: who answers questions about this product, and how to reach them. */
function helpCard(p: Product, ctx: StoreCtx): string {
  const b = ctx.store.brand;
  return `<aside class="hd-help" aria-labelledby="help-title"><h2 class="hd-help__title" id="help-title">Questions about ${esc(p.name)}?</h2>
<p class="hd-help__text">Our support team in Portland answers the email and the phone themselves, Monday to Friday, 8 am to 6 pm Pacific.</p>
<ul class="hd-help__links" role="list"><li><a href="mailto:${esc(b.supportEmail)}">${icon("mail")}<span>${esc(b.supportEmail)}</span></a></li><li><a href="${esc(
    telHref(b.supportPhone),
  )}">${icon("phone")}<span>${esc(b.supportPhone)}</span></a></li></ul></aside>`;
}

function productExtras(p: Product, ctx: StoreCtx): string {
  const rows = specRows(p);
  const box = boxContents(p);
  return `${helpCard(p, ctx)}
<section class="hd-specs" id="specs" aria-labelledby="specs-title">
<div class="hd-specs__head"><h2 class="hd-specs__title" id="specs-title">Tech specs</h2><p class="hd-specs__note">Every figure on this page is measured on our bench.</p></div>
<div class="hd-specs__grid">
<table class="hd-specs__table"><tbody>${rows.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${v}</td></tr>`).join("")}</tbody></table>
${
  box.length
    ? `<div class="hd-box"><h3 class="hd-box__title">What's in the box</h3><ol class="hd-box__list" role="list">${box.map((b) => `<li>${esc(b)}</li>`).join("")}</ol></div>`
    : ""
}
</div>
</section>`;
}

/** Between the rating and the price: what kind of thing it is, and the key specs with links to the full sheet. */
function buyBoxIntro(p: Product, ctx: StoreCtx): string {
  const chips = specChips(p, 4);
  return `<div class="hd-intro">
${eyebrow(typeLine(p, ctx.store), "hd-buybox__type")}
${
  chips.length
    ? `<div class="hd-keyspecs">${chipList(chips, "chips hd-chips", "Key specs")}<a class="hd-keyspecs__link" href="#specs">Full specs</a>${
        COMPARED.has(p.collection) ? `<a class="hd-keyspecs__link" href="${esc(`${collectionHref(ctx, p.collection)}#compare`)}">Compare models</a>` : ""
      }</div>`
    : ""
}
</div>`;
}

/**
 * Under the promises, returns and warranty; then the bar that stays at the bottom of a phone's screen:
 * the name, the price of the chosen options (data-price: store.js keeps it current) and an Add to cart
 * button that submits the buy box's form from outside it (form="buy-form"). Wide screens hide the bar.
 */
function buyBoxExtras(p: Product): string {
  const soldOut = p.stock <= 0;
  return `<ul class="promises hd-promises"><li>${icon("return")}<span>45-day returns, with free return shipping in the US</span></li><li>${icon("shield")}<span>One-year limited warranty</span></li></ul>
<div class="hd-buybar">
<div class="hd-buybar__info"><span class="hd-buybar__name">${esc(p.name)}</span><span class="hd-buybar__price" data-price>${esc(formatUsd(defaultPriceCents(p)))}</span></div>
<button class="btn btn--primary hd-buybar__btn" type="submit" form="buy-form"${soldOut ? " disabled" : ""}>${soldOut ? "Sold out" : "Add to cart"}</button>
</div>`;
}

/* ------------------------------------------------------------------ the skin */

export const haldenSkin: Skin = {
  ...defaultSkin,
  id: "halden",
  bodyClass: "skin-halden",
  fontFallbacks: { display: "'Helvetica Neue', Arial, sans-serif", body: defaultSkin.fontFallbacks.body },
  homeTitle: () => "Headphones, earbuds and speakers, tuned by ear",
  allProductsBlurb: () => "Every pair of headphones, earbuds, speaker and spare we make, with the specs that matter on each page.",
  socials: ["Instagram", "YouTube", "TikTok"],
  announcement,
  header,
  hero,
  homeSections: () => [categoryTiles, bestsellers, spotlight, bench, listeners, newsletter],
  productCard,
  collectionHeader,
  productLayout: "gallery-left",
  productExtras,
  buyBoxIntro,
  buyBoxExtras,
  newsletterPitch: () => ({
    title: "10% off your first order",
    text: "New releases and listening notes from the bench, a couple of times a month. Sign up and your code appears right away.",
  }),
  footer,
};
