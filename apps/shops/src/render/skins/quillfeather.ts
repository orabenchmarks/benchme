import type { Product } from "@benchme/storefront";
import {
  aboutLead,
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
  href,
  icon,
  img,
  logoLink,
  menuButton,
  mobileNav,
  pageHref,
  paymentIcons,
  plural,
  priceHtml,
  primaryNav,
  productHref,
  ratingOf,
  ratingText,
  searchForm,
  sectionHead,
  sections,
  socialLinks,
  stars,
  subscriptionCents,
  type CollectionTile,
  type CollectionView,
  type HomeSection,
} from "../components.js";
import type { PageCtx, StoreCtx } from "../layout.js";
import type { Skin } from "./index.js";

/**
 * Quillfeather Coffee — a small-lot roaster in an old print shop, warm and exact about every coffee.
 * Words on the left, pictures on the right: a split hero whose photograph runs to the edge of the page
 * with this week's coffee pinned to it as a bag label, a header with the subscribe-and-save pill beside
 * the logo, product cards typeset like bag labels (tasting-note chips and a five-step roast meter), the
 * coffee's origin, process and altitude in the buy box, a brew guide and a subscription band with a
 * worked price. Styles: public/css/quillfeather.css.
 */

/* ------------------------------------------------------------------ reading the catalogue */

/** A "Key: value" line of a product's details. */
function detail(p: Product, key: string): string | undefined {
  const k = `${key.toLowerCase()}:`;
  return p.details.find((d) => d.toLowerCase().startsWith(k))?.slice(k.length).trim();
}

/** "blueberry, jasmine, cacao nib" → three notes. */
export function tastingNotes(p: Product): string[] {
  return (detail(p, "Tasting notes") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const LEVELS: Readonly<Record<string, number>> = { light: 1, "light-medium": 2, "medium-light": 2, medium: 3, "medium-dark": 4, dark: 5 };

/** The roast on a five-step scale, from the "Roast: …" detail; null for gear. */
export function roastOf(p: Product): { label: string; level: number } | null {
  const label = detail(p, "Roast");
  const level = label ? LEVELS[label.toLowerCase()] : undefined;
  return label && level ? { label, level } : null;
}

/** Five steps from light to dark, filled to the roast: "▮▮▯▯▯ Medium-light roast". */
export function roastMeter(r: { label: string; level: number }, cls = "roast-meter"): string {
  const steps = [1, 2, 3, 4, 5].map((i) => `<span class="roast-meter__step${i <= r.level ? " is-on" : ""}"></span>`).join("");
  return `<span class="${esc(cls)}" role="img" aria-label="${esc(`${r.label} roast, ${r.level} of 5 from light to dark`)}"><span class="roast-meter__scale" aria-hidden="true">${steps}</span><span class="roast-meter__value" aria-hidden="true">${esc(r.label)} roast</span></span>`;
}

const notesList = (notes: string[], cls: string) =>
  notes.length ? `<ul class="${esc(cls)}" aria-label="Tasting notes">${notes.map((n) => `<li class="note">${esc(n)}</li>`).join("")}</ul>` : "";

/** The subscription every coffee carries (15 % off every 2, 4 or 6 weeks), read off the catalogue. */
const subscriptionOf = (ctx: { store: PageCtx["store"] }) => ctx.store?.products.find((p) => p.subscription)?.subscription;

/** ["2 weeks", "4 weeks", "6 weeks"] → "2, 4 or 6 weeks". */
function intervalsText(intervals: readonly string[]): string {
  const weeks = intervals.map((i) => /^(\d+) weeks?$/.exec(i)?.[1]);
  const parts = weeks.every(Boolean) ? weeks.map(String) : [...intervals];
  const last = parts.pop();
  const head = parts.length ? `${parts.join(", ")} or ${last}` : (last ?? "");
  return weeks.every(Boolean) ? `${head} weeks` : head;
}

/** The label of a grind option ("pour-over" → "Pour-over"), as the product pages offer it. */
function grindLabel(ctx: StoreCtx, id: string): string | undefined {
  for (const p of ctx.store.products) {
    const v = p.options.find((g) => g.id === "grind")?.values.find((x) => x.id === id);
    if (v) return v.label;
  }
  return undefined;
}

/* ------------------------------------------------------------------ line drawings (static, decorative) */

const svg = (body: string, cls: string, box = 48) =>
  `<svg class="${cls}" viewBox="0 0 ${box} ${box}" width="${box}" height="${box}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;

/** Two arrows chasing each other: a delivery that comes back. */
const LOOP = svg('<path d="M4.5 11a7.5 7.5 0 0 1 13-4.6l1.5 1.6"/><path d="M19 3.5V8h-4.5"/><path d="M19.5 13a7.5 7.5 0 0 1-13 4.6L5 16"/><path d="M5 20.5V16h4.5"/>', "icon sub-pill__icon", 24);

const BREWERS: Readonly<Record<string, string>> = {
  "pour-over":
    '<path d="M9 9h30l-9.5 15h-11z"/><path d="M15 9l5 15M33 9l-5 15"/><path d="M14 28h20"/><path d="M16 28v9a5 5 0 0 0 5 5h6a5 5 0 0 0 5-5v-9"/><path d="M32 31h2.5a3 3 0 0 1 0 6H32"/>',
  drip: '<path d="M10 6h28v9H10z"/><path d="M13 15v27h22V15"/><path d="M19 22h10l-1.5 4h-7z"/><path d="M18 30h12v8a2 2 0 0 1-2 2H20a2 2 0 0 1-2-2z"/><path d="M30 32h2a2 2 0 0 1 0 4h-2"/><circle cx="31" cy="10.5" r="1.2"/>',
  "french-press":
    '<path d="M24 3v10"/><path d="M19 3h10"/><rect x="14" y="13" width="20" height="29" rx="2"/><path d="M14 22h20"/><path d="M34 18h3.5a1.5 1.5 0 0 1 1.5 1.5v15a1.5 1.5 0 0 1-1.5 1.5H34"/><path d="M12 45h24"/>',
  espresso:
    '<path d="M11 21h22v7a9 9 0 0 1-9 9h-4a9 9 0 0 1-9-9z"/><path d="M33 24h2.5a3.5 3.5 0 0 1 0 7H32"/><path d="M7 41h30"/><path d="M18 8c-2 2.5 2 3.5 0 6.5M24 8c-2 2.5 2 3.5 0 6.5"/>',
};

/* ------------------------------------------------------------------ header and footer */

/** Logo with the subscribe-and-save pill beside it, the collection menu, then search, account and cart. The double rule under it is CSS. */
function header(ctx: PageCtx): string {
  const sub = subscriptionOf(ctx);
  const pill = sub ? `<a class="sub-pill" href="${esc(href(ctx, "/#subscribe"))}">${LOOP}<span>Subscribe &amp; save ${esc(sub.savePct)}%</span></a>` : "";
  return `<header class="site-header site-header--roastery" data-site-header>
<div class="container site-header__bar">
${menuButton()}
<div class="site-header__brand">${logoLink(ctx)}${pill}</div>
${primaryNav(ctx)}
<div class="header-actions">${searchForm(ctx, "header", { placeholder: "Search coffee" })}${accountLink(ctx)}${cartButton(ctx)}</div>
</div>
</header>`;
}

function footer(ctx: PageCtx): string {
  return `<footer class="site-footer site-footer--roastery">
<div class="container">
<div class="site-footer__top">
<div class="site-footer__brand">${logoLink(ctx, "logo logo--footer")}<p>${esc(ctx.brand.tagline)}</p><p class="site-footer__roastery">${icon("pin")}<span>Roasted Monday to Thursday in an old print shop in Tacoma, Washington.</span></p>${socialLinks(ctx.skin.socials)}</div>
${footerColumns(ctx)}
</div>
<div class="site-footer__bottom"><p class="copyright">© 2026 ${esc(ctx.brand.name)}</p>${paymentIcons()}</div>
${finePrint(ctx)}
</div>
</footer>`;
}

/* ------------------------------------------------------------------ the bag label: product cards */

function productCard(p: Product, ctx: StoreCtx): string {
  const { avg, count } = ratingOf(p);
  const r = roastOf(p);
  const notes = tastingNotes(p);
  const about = r || notes.length ? `${notesList(notes, "notes notes--card")}${r ? roastMeter(r, "roast-meter roast-meter--card") : ""}` : `<p class="qf-card__summary">${esc(p.summary)}</p>`;
  return `<article class="card qf-card" data-product-slug="${esc(p.slug)}" data-price-cents="${esc(p.priceCents)}">
<a class="qf-card__link" href="${esc(productHref(ctx, p))}">
<div class="qf-card__media">${img(ctx, p.images[0], "", { cls: "qf-card__img" })}${badgesHtml(p, "qf-card__badges badges")}</div>
<div class="qf-card__label">
<h3 class="qf-card__title">${esc(p.name)}</h3>
${about}
<p class="qf-card__foot"><span class="qf-card__price">${priceHtml(p)}</span>${
    count ? `<span class="qf-card__rating">${stars(avg, "stars stars--small")}<span>${esc(`${ratingText(avg)} (${count})`)}</span></span>` : ""
  }</p>
</div>
</a>
</article>`;
}

/* ------------------------------------------------------------------ home */

/** This week's coffee, pinned to the hero photograph: the limited lot when there is one in stock. */
function featuredCoffee(ctx: StoreCtx): Product | undefined {
  const coffees = ctx.store.products.filter((p) => p.subscription && p.stock > 0);
  return coffees.find((p) => p.badges?.some((b) => /limited/i.test(b))) ?? coffees[0];
}

function hero(ctx: StoreCtx): string {
  const p = featuredCoffee(ctx);
  const r = p ? roastOf(p) : null;
  const label = p
    ? `<a class="hero-label" href="${esc(productHref(ctx, p))}">
<span class="hero-label__kicker">On the roaster this week</span>
<span class="hero-label__name">${esc(p.name)}</span>
${notesList(tastingNotes(p), "notes notes--label")}
${r ? roastMeter(r, "roast-meter roast-meter--label") : ""}
<span class="hero-label__foot"><span>${esc(p.badges?.[0] ?? ctx.store.collections.find((c) => c.slug === p.collection)?.name ?? "")}</span><span class="hero-label__price">From ${esc(formatUsd(p.priceCents))}</span></span>
</a>`
    : "";
  return `<section class="hero hero--roastery" data-section="hero">
<div class="hero__copy">
<h1 class="hero__title">Every coffee, carefully noted</h1>
<p class="hero__text">Single origins, blends and decaf, roasted to order in an old print shop in Tacoma and shipped within 48 hours of roasting.</p>
<div class="hero__actions"><a class="btn btn--primary btn--lg" href="${esc(collectionHref(ctx, "single-origins"))}">Shop single origins</a><a class="btn btn--secondary btn--lg" href="${esc(collectionHref(ctx, "blends"))}">Shop blends</a></div>
</div>
<div class="hero__media">${img(ctx, ctx.store.brand.heroImage, "An espresso cup heaped with freshly roasted coffee beans", { eager: true, cls: "hero__img" })}${label}</div>
</section>`;
}

/** The lightest and darkest roast among some products; null when none of them is coffee. */
function roastBounds(products: Product[]): { lo: { label: string; level: number }; hi: { label: string; level: number } } | null {
  const roasts = products.flatMap((p) => {
    const r = roastOf(p);
    return r ? [r] : [];
  });
  roasts.sort((a, b) => a.level - b.level);
  const lo = roasts[0];
  const hi = roasts[roasts.length - 1];
  return lo && hi ? { lo, hi } : null;
}

/** "Light to medium-dark roasts": the span of a collection's roasts, in words. */
function roastRange(products: Product[]): string {
  const b = roastBounds(products);
  if (!b) return "";
  return b.lo.label === b.hi.label ? `${b.lo.label} roast` : `${b.lo.label} to ${b.hi.label.toLowerCase()} roasts`;
}

/** The same span on the five-bean scale: the beans from the lightest roast to the darkest are filled. */
function roastSpan(products: Product[]): string {
  const b = roastBounds(products);
  if (!b) return "";
  const steps = [1, 2, 3, 4, 5].map((i) => `<span class="roast-meter__step${i >= b.lo.level && i <= b.hi.level ? " is-on" : ""}"></span>`).join("");
  return `<span class="roast-meter roast-meter--span" role="img" aria-label="${esc(roastRange(products))}"><span class="roast-meter__scale" aria-hidden="true">${steps}</span></span>`;
}

/** Each collection on a paper tag pinned to its photograph: what's in it, and how dark it goes. */
const collectionTiles: HomeSection = (ctx, data) => {
  const tile = (t: CollectionTile) => {
    const ps = ctx.store.products.filter((p) => p.collection === t.collection.slug);
    const coffees = ps.length > 0 && ps.every((p) => p.subscription);
    return `<a class="tile qf-tile" href="${esc(collectionHref(ctx, t.collection.slug))}">
<span class="tile__media">${img(ctx, t.image, "")}</span>
<span class="tile__label"><span class="tile__name">${esc(t.collection.name)}</span><span class="tile__meta"><span class="tile__count">${esc(plural(t.count, coffees ? "coffee" : "item"))}</span>${roastSpan(ps)}</span></span>
</a>`;
  };
  return `<section class="section section--collections qf-collections" data-section="featured-collections"><div class="container">
${sectionHead(ctx, "Find your coffee", { label: "Shop all", path: "/collections/all" })}
<div class="tiles">${data.collections.map(tile).join("")}</div>
</div></section>`;
};

/** Subscribe & save, explained with a worked price: the bestselling blend's 12 oz bag, once and on subscription. */
const subscribeBand: HomeSection = (ctx) => {
  const coffees = ctx.store.products.filter((p) => p.subscription);
  const p = coffees.find((x) => x.badges?.includes("Bestseller")) ?? coffees[0];
  const sub = p?.subscription;
  if (!p || !sub) return "";
  const once = defaultPriceCents(p);
  const each = subscriptionCents(once, sub.savePct);
  const size = p.options.find((g) => g.id === "size")?.values[0]?.label;
  const freeOver = ctx.store.freeShippingOverCents;
  const points = [
    `Deliveries every ${intervalsText(sub.intervals)}, roasted for you that week`,
    "Skip, pause, swap coffees or cancel whenever you like",
    freeOver ? `Free standard shipping on deliveries of ${dollars(freeOver)} or more` : "",
  ].filter(Boolean);
  return `<section class="section subscribe-band" id="subscribe" data-section="subscribe"><div class="container subscribe-band__inner">
<div class="subscribe-band__copy">
<h2 class="subscribe-band__title">Subscribe &amp; save ${esc(sub.savePct)}%</h2>
<p class="subscribe-band__text">Choose any coffee, then how often it should arrive. Every delivery costs ${esc(sub.savePct)}% less than buying the same bag once, and nothing is ever roasted before you need it.</p>
<ul class="subscribe-band__points">${points.map((t) => `<li>${icon("check")}<span>${esc(t)}</span></li>`).join("")}</ul>
<div class="subscribe-band__actions"><a class="btn btn--light btn--lg" href="${esc(href(ctx, "/collections/all"))}">Choose a coffee</a><a class="subscribe-band__link" href="${esc(pageHref(ctx, "faq"))}#how-does-subscribe-save-work">How subscriptions work</a></div>
</div>
<figure class="sub-ticket">
<figcaption class="sub-ticket__title"><a href="${esc(productHref(ctx, p))}">${esc(p.name)}</a>${size ? `<span>${esc(size)} bag</span>` : ""}</figcaption>
<dl class="sub-ticket__rows">
<div class="sub-ticket__row"><dt>One-time purchase</dt><dd>${esc(formatUsd(once))}</dd></div>
<div class="sub-ticket__row sub-ticket__row--sub"><dt>Subscribe &amp; save ${esc(sub.savePct)}%</dt><dd>${esc(formatUsd(each))}</dd></div>
</dl>
<p class="sub-ticket__saving">You save ${esc(formatUsd(once - each))} on every bag.</p>
</figure>
</div></section>`;
};

type BrewMethod = { id: string; name: string; best: RegExp; roasts: readonly number[]; recipe: readonly (readonly [string, string])[]; tip: string };

/** How we brew at the roastery. The grind ids are the product pages' grind options. */
const METHODS: readonly BrewMethod[] = [
  {
    id: "pour-over",
    name: "Pour-over",
    best: /pour-over|cone/i,
    roasts: [1, 2],
    recipe: [
      ["Coffee", "15 g"],
      ["Water", "250 g at 205°F"],
      ["Time", "3 to 3½ minutes"],
    ],
    tip: "Rinse the filter, wet the grounds with 40 g of water for 45 seconds, then pour the rest in slow circles.",
  },
  {
    id: "drip",
    name: "Drip machine",
    best: /drip/i,
    roasts: [3],
    recipe: [
      ["Coffee", "60 g"],
      ["Water", "1 liter"],
      ["Time", "5 to 6 minutes"],
    ],
    tip: "Use filtered water, and pour it into a warm carafe within half an hour; the hot plate cooks it.",
  },
  {
    id: "french-press",
    name: "French press",
    best: /french press/i,
    roasts: [4, 5],
    recipe: [
      ["Coffee", "30 g"],
      ["Water", "500 g at 205°F"],
      ["Time", "4 minutes"],
    ],
    tip: "Stir once after a minute, skim the crust at four, then press slowly and pour it all out at once.",
  },
  {
    id: "espresso",
    name: "Espresso",
    best: /espresso/i,
    roasts: [],
    recipe: [
      ["Coffee", "18 g"],
      ["In the cup", "36 g"],
      ["Time", "27 to 30 seconds"],
    ],
    tip: "Running fast and sour? Grind finer. Slow and bitter? Grind coarser. Change one thing at a time.",
  },
];

/** Where a method is first named in a product's "Best for" line (-1 when it isn't). */
function bestAt(p: Product, m: BrewMethod): number {
  const best = detail(p, "Best for");
  return best ? best.search(m.best) : -1;
}

/** The method a coffee is best for (its "Best for" line, else its roast), or the method a piece of gear is for. */
function methodFor(p: Product): BrewMethod | undefined {
  const first = METHODS.map((m) => ({ m, at: bestAt(p, m) }))
    .filter((x) => x.at >= 0)
    .sort((a, b) => a.at - b.at)[0];
  if (first) return first.m;
  const r = roastOf(p);
  if (r) return METHODS.find((m) => m.roasts.includes(r.level));
  return METHODS.find((m) => p.tags.includes(m.id));
}

/** The recipe as a definition list, starting with the grind to order (the product pages' own label for it). */
function recipeRows(ctx: StoreCtx, m: BrewMethod, cls: string): string {
  const grind = grindLabel(ctx, m.id);
  const rows: (readonly [string, string])[] = [...(grind ? [["Grind", grind] as const] : []), ...m.recipe];
  return `<dl class="${esc(cls)}">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>`;
}

/** Four ways we brew, the grind to order for each, and the coffee that names it first in its "Best for" line. */
const brewGuide: HomeSection = (ctx) => {
  const used = new Set<string>();
  const cards = METHODS.map((m) => {
    const pick = ctx.store.products
      .map((p, i) => ({ p, i, at: used.has(p.slug) ? -1 : bestAt(p, m) }))
      .filter((x) => x.at >= 0)
      .sort((a, b) => a.at - b.at || a.i - b.i)[0]?.p;
    if (pick) used.add(pick.slug);
    return `<article class="brew-card">
${svg(BREWERS[m.id] ?? "", "brew-card__icon")}
<h3 class="brew-card__name">${esc(m.name)}</h3>
${recipeRows(ctx, m, "recipe")}
<p class="brew-card__tip">${esc(m.tip)}</p>
${pick ? `<a class="brew-card__try" href="${esc(productHref(ctx, pick))}">Try it with ${esc(pick.name)}</a>` : ""}
</article>`;
  });
  return `<section class="section brew-guide" id="brew-guide" data-section="brew-guide"><div class="container">
${sectionHead(ctx, "Brew guide", undefined, "The four ways we brew at the roastery. Weigh the coffee and the water if you can: it's the surest way to the same good cup every morning.")}
<div class="brew-guide__grid">${cards.join("")}</div>
</div></section>`;
};

/** The first paragraphs of the About page: how the roastery started and where its name came from. */
function storyParagraphs(ctx: StoreCtx): string[] {
  const paras = ctx.store.policies.about
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter((b) => b && !b.startsWith("## "));
  return paras.length ? paras.slice(0, 2) : [aboutLead(ctx.store)];
}

const story: HomeSection = (ctx) => `<section class="section story story--roastery" data-section="story"><div class="container story__inner">
<div class="story__media">${img(ctx, "img/quillfeather/box-grinder.jpg", "An old wooden box grinder full of beans beside a cup of coffee")}</div>
<div class="story__body">
<h2 class="story__title">Hello from the roastery</h2>
${storyParagraphs(ctx)
  .map((p) => `<p>${esc(p)}</p>`)
  .join("")}
<p class="story__sign">Nell &amp; Arturo</p>
<a class="btn btn--secondary" href="${esc(pageHref(ctx, "about"))}">Read our story</a>
</div>
</div></section>`;

/* ------------------------------------------------------------------ collection and product pages */

function collectionHeader(c: CollectionView, ctx: StoreCtx): string {
  const ps = c.slug === "all" ? ctx.store.products : ctx.store.products.filter((p) => p.collection === c.slug);
  const coffees = ps.filter((p) => p.subscription);
  const sample = coffees[0];
  let note = "";
  if (sample?.subscription && coffees.length === ps.length) {
    const sizes = sample.options.find((g) => g.id === "size")?.values.map((v) => v.label) ?? [];
    const grinds = sample.options.find((g) => g.id === "grind")?.values.length ?? 0;
    const bits = [
      sizes.length > 1 ? `${sizes.slice(0, -1).join(", ")} or ${sizes[sizes.length - 1]} bags` : "",
      grinds > 1 ? `whole bean or ground to order` : "",
      `${sample.subscription.savePct}% off on subscription`,
    ].filter(Boolean);
    note = `Every coffee: ${bits.join(", ")}.`;
  } else if (!coffees.length && ps.length) {
    note = "Gear ships with your coffee, in the same box.";
  }
  const range = roastRange(ps);
  return `<header class="collection-header collection-header--roastery">
<div class="container collection-header__inner">
<div class="collection-header__copy">
<h1 class="collection-header__title">${esc(c.name)}</h1>
<p class="collection-header__blurb">${esc(c.blurb)}</p>
${note || range ? `<p class="collection-header__note">${esc([note, range && c.slug !== "all" ? `${range}.` : ""].filter(Boolean).join(" "))}</p>` : ""}
</div>
${c.hero ? `<figure class="collection-header__media">${img(ctx, c.hero, "", { eager: true })}</figure>` : ""}
</div>
</header>`;
}

/** In the buy box, under the summary (CSS orders it there): tasting notes, the roast, and where the coffee is from. */
function cupLabel(p: Product): string {
  const r = roastOf(p);
  const notes = tastingNotes(p);
  if (!r && !notes.length) return "";
  const facts = ["Origin", "Process", "Altitude", "Variety"].flatMap((k) => {
    const v = detail(p, k);
    return v ? [`<div class="qf-facts__row"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`] : [];
  });
  return `<div class="qf-cup">
${notesList(notes, "notes notes--pdp")}
${r ? roastMeter(r, "roast-meter roast-meter--pdp") : ""}
${facts.length ? `<dl class="qf-facts">${facts.join("")}</dl>` : ""}
</div>`;
}

/** Under the description: how we would brew this coffee, or the recipe this piece of gear is for. */
function brewCard(p: Product, ctx: StoreCtx): string {
  const m = methodFor(p);
  if (!m) return "";
  return `<aside class="brew-note" aria-labelledby="brew-note-title">
<div class="brew-note__head">${svg(BREWERS[m.id] ?? "", "brew-note__icon")}<div><h2 class="brew-note__title" id="brew-note-title">${p.subscription ? "How we brew it" : "Brew with it"}</h2><p class="brew-note__method">${esc(m.name)}</p></div></div>
${recipeRows(ctx, m, "recipe recipe--note")}
<p class="brew-note__tip">${esc(m.tip)}</p>
<a class="brew-note__more" href="${esc(href(ctx, "/#brew-guide"))}">All four recipes in our brew guide</a>
</aside>`;
}

/* ------------------------------------------------------------------ the skin */

export const quillfeatherSkin: Skin = {
  ...defaultSkin,
  id: "quillfeather",
  bodyClass: "skin-quillfeather",
  fontFallbacks: { display: "Georgia, 'Times New Roman', serif", body: defaultSkin.fontFallbacks.body },
  homeTitle: () => "Small-lot coffee, roasted to order",
  allProductsBlurb: () => "Every coffee on the roast schedule, and the gear from our own tasting bench.",
  socials: ["Instagram", "YouTube", "Pinterest"],
  header,
  hero: (ctx) => hero(ctx),
  homeSections: () => [
    sections.bestsellers({ title: "Customer favorites", link: { label: "Shop all", path: "/collections/all" } }),
    collectionTiles,
    subscribeBand,
    brewGuide,
    story,
    sections.reviewsBand({ title: "Notes from our customers" }),
    sections.newsletterBlock({
      title: "Get 10% off your first order",
      text: "New arrivals, brewing notes and the occasional roastery mishap, about twice a month. Your code appears the moment you sign up.",
    }),
  ],
  productCard,
  collectionHeader,
  productLayout: "gallery-right",
  productExtras: (p, ctx) => brewCard(p, ctx),
  buyBoxAfterSummary: (p) => cupLabel(p),
  buyBoxExtras: (p) =>
    p.subscription ? `<p class="roast-note">${icon("calendar")}<span>Roasted to order Monday to Thursday and shipped within 48 hours of roasting.</span></p>` : "",
  newsletterPitch: () => ({
    title: "10% off your first order",
    text: "New arrivals and brewing notes from the roastery, about twice a month. Sign up and your code appears right away.",
  }),
  // The pop-up's own photograph: the hero's is right behind it on the home page.
  newsletterImage: "img/quillfeather/postscript.jpg",
  // The subscribe-and-save pill beside the logo has no room on a phone: the menu links to the same explainer.
  mobileNav: (ctx) => mobileNav(ctx, { extra: subscriptionOf(ctx) ? [{ label: "Subscriptions", path: "/#subscribe" }] : [] }),
  footer,
};
