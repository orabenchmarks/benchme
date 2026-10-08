import { esc } from "@benchme/site-kit";
import { formatUsd, type CartLine, type Product, type Review, type StoreDef } from "@benchme/storefront";
import type { PageCtx, StoreCtx } from "./layout.js";
import type { CollectionTile, CollectionView, HomeData, HomeSection, ReviewHighlight, Skin } from "./skins/index.js";

/**
 * The storefront's building blocks and the default skin made of them. Every page and every skin
 * renders through these helpers, so two rules hold everywhere: each interpolated value goes through
 * esc(), and each link, form action and image URL goes through href() / assetHref() (the workspace
 * prefix the gateway forwarded). The one deliberate exception is a brand's logo, which is inline SVG
 * markup authored with the catalogue (stores/*.ts; stores/invariants.ts refuses scripts in it).
 */

export { esc, formatUsd };

/** Changes on every boot, so a browser never keeps last deploy's CSS or JS past a restart. */
export const ASSET_VERSION = Date.now().toString(36);

/* ------------------------------------------------------------------ URLs */

/** A path of this site ("/cart", "/products/x?y=1") with the workspace prefix in front. */
export function href(ctx: Pick<PageCtx, "prefix">, path: string): string {
  return `${ctx.prefix}${path.startsWith("/") ? path : `/${path}`}`;
}

/** A file under apps/shops/public ("img/halden/x.jpg"), as the assets route serves it. CSS and JS carry ASSET_VERSION. */
export function assetHref(ctx: Pick<PageCtx, "prefix">, rel: string): string {
  const versioned = /\.(?:css|js)$/.test(rel) ? `?v=${ASSET_VERSION}` : "";
  return href(ctx, `/assets/${rel}${versioned}`);
}

/** The same file as an absolute URL (Open Graph, JSON-LD). */
export function absoluteAsset(ctx: Pick<PageCtx, "publicBase">, rel: string): string {
  return `${ctx.publicBase}/assets/${rel}`;
}

export const productHref = (ctx: Pick<PageCtx, "prefix">, p: Pick<Product, "slug">) => href(ctx, `/products/${encodeURIComponent(p.slug)}`);
export const collectionHref = (ctx: Pick<PageCtx, "prefix">, slug: string) => href(ctx, `/collections/${encodeURIComponent(slug)}`);
export const pageHref = (ctx: Pick<PageCtx, "prefix">, key: string) => href(ctx, `/pages/${encodeURIComponent(key)}`);

/* ------------------------------------------------------------------ numbers and words */

/** The average rating and the number of reviews (an injected review is already in `p.reviews`). */
export function ratingOf(p: Pick<Product, "reviews">): { avg: number; count: number } {
  const count = p.reviews.length;
  return { avg: count ? p.reviews.reduce((a, r) => a + r.rating, 0) / count : 0, count };
}

/** "4.3": the rating as the pages print it. */
export const ratingText = (avg: number) => avg.toFixed(1);

/** True when an option changes the price, so a card reads "From $64.99". */
export const hasPriceRange = (p: Product) => p.options.some((g) => g.values.some((v) => (v.priceDeltaCents ?? 0) > 0));

/** The option values a shopper starts with: the first value of each group that is not sold out. */
export function defaultOptions(p: Product): Record<string, string> {
  const out: Record<string, string> = {};
  for (const g of p.options) {
    const v = g.values.find((x) => !x.soldOut) ?? g.values[0];
    if (v) out[g.id] = v.id;
  }
  return out;
}

/** The price of the default options, one-time. */
export function defaultPriceCents(p: Product): number {
  const picked = defaultOptions(p);
  return p.priceCents + p.options.reduce((a, g) => a + (g.values.find((v) => v.id === picked[g.id])?.priceDeltaCents ?? 0), 0);
}

/** A subscription's unit price: the saving rounds like the cart's (packages/storefront unitPrice). */
export const subscriptionCents = (cents: number, savePct: number) => Math.round((cents * (100 - savePct)) / 100);

/** "June 14, 2025" from an ISO date. */
export function formatDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { timeZone: "UTC", year: "numeric", month: "long", day: "numeric" });
}

/** "$75" for whole dollars, "$75.50" otherwise: how a sentence quotes a threshold. */
export const dollars = (cents: number) => (cents % 100 === 0 ? `$${(cents / 100).toLocaleString("en-US")}` : formatUsd(cents));

/** An hour of the day as a delivery cutoff reads: "2 pm", "noon", "9 am". */
export const hourLabel = (h: number) => (h === 12 ? "noon" : h === 0 ? "midnight" : h > 12 ? `${h - 12} pm` : `${h} am`);

/** "1 item" / "3 items". */
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A cart line's chosen options in words ("Deluxe", "12 oz / Drip / Every 4 weeks"): for the drawer, the cart and the checkout summary. */
export function optionsLabel(p: Product | undefined, line: Pick<CartLine, "options" | "mode" | "interval">): string {
  const parts = (p?.options ?? []).flatMap((g) => {
    const v = g.values.find((x) => x.id === line.options[g.id]);
    return v ? [v.label] : [];
  });
  if (line.mode === "subscribe" && line.interval) parts.push(`Every ${line.interval}`);
  return parts.join(" / ");
}

/** A slug for an in-page anchor. */
export const anchor = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/* ------------------------------------------------------------------ icons */

const ICONS: Readonly<Record<string, string>> = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4.35-4.35"/>',
  bag: '<path d="M5 8h14l-1.1 12.1a1 1 0 0 1-1 .9H7.1a1 1 0 0 1-1-.9L5 8Z"/><path d="M9 10V6.5a3 3 0 0 1 6 0V10"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5c.6-3.9 3.6-6 7.5-6s6.9 2.1 7.5 6"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  "chevron-down": '<path d="m6 9 6 6 6-6"/>',
  "chevron-right": '<path d="m9 6 6 6-6 6"/>',
  "chevron-left": '<path d="m15 6-6 6 6 6"/>',
  minus: '<path d="M5 12h14"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  truck: '<path d="M2.5 6.5h11v9h-11zM13.5 10h4l3 3.2v2.3h-7"/><circle cx="6.5" cy="17.5" r="1.8"/><circle cx="16.5" cy="17.5" r="1.8"/>',
  return: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  shield: '<path d="M12 3 5 6v5.5c0 4.4 3 7.9 7 9.5 4-1.6 7-5.1 7-9.5V6l-7-3Z"/><path d="m9 12 2 2 4-4"/>',
  leaf: '<path d="M5 20c0-9 6-15 15-15 0 9-6 15-15 15Z"/><path d="M5 20 14 11"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  pin: '<path d="M12 21s-6.5-5.7-6.5-11.2a6.5 6.5 0 0 1 13 0C18.5 15.3 12 21 12 21Z"/><circle cx="12" cy="9.8" r="2.3"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
  gift: '<rect x="3.5" y="8.5" width="17" height="4" rx="1"/><path d="M5 12.5v8h14v-8M12 8.5v12M12 8.5C10.5 5 7 4.5 7 6.6S10 8.5 12 8.5Zm0 0c1.5-3.5 5-4 5-1.9S14 8.5 12 8.5Z"/>',
  mail: '<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="m3.8 7 8.2 6 8.2-6"/>',
  phone: '<path d="M6.5 3.5h3l1.8 4.6-2.2 1.4a11.5 11.5 0 0 0 5.4 5.4l1.4-2.2 4.6 1.8v3a1.5 1.5 0 0 1-1.6 1.5C10.9 18.4 5.6 13.1 5 5.1a1.5 1.5 0 0 1 1.5-1.6Z"/>',
  filter: '<path d="M4 6.5h9M17 6.5h3M4 12h3M11 12h9M4 17.5h11M19 17.5h1"/><circle cx="15" cy="6.5" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17.5" r="2"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>',
  headphones: '<path d="M4 15.5V12a8 8 0 0 1 16 0v3.5"/><rect x="3" y="14" width="4.5" height="7" rx="1.6"/><rect x="16.5" y="14" width="4.5" height="7" rx="1.6"/>',
  wrench: '<path d="M14.5 6.2a4.2 4.2 0 0 0-5.6 5.4L3.8 16.7a1.7 1.7 0 0 0 2.4 2.4l5.1-5.1a4.2 4.2 0 0 0 5.4-5.6l-2.4 2.4-2.3-.4-.4-2.3 2.9-1.9Z"/>',
  wave: '<path d="M2 12c1.7-4.7 3.3-4.7 5 0s3.3 4.7 5 0 3.3-4.7 5 0 3.3 4.7 5 0"/>',
  cup: '<path d="M4 9h12v5.5A5.5 5.5 0 0 1 10.5 20h-1A5.5 5.5 0 0 1 4 14.5V9Z"/><path d="M16 11h1.5a2.5 2.5 0 0 1 0 5H16M7.5 3.5c-.8 1 .8 1.8 0 3M11 3.5c-.8 1 .8 1.8 0 3"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  star: '<path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9l-5.2 2.8 1-5.9-4.3-4.1 5.9-.8L12 3.5Z"/>',
};

/** A 24 × 24 line icon, decorative (aria-hidden): label the control that holds it. */
export function icon(name: keyof typeof ICONS | string, cls = "icon"): string {
  const body = ICONS[name] ?? "";
  return `<svg class="${esc(cls)}" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
}

/* ------------------------------------------------------------------ small pieces */

/** Five stars filled to the rating, read out as "Rated 4.3 out of 5". */
export function stars(avg: number, cls = "stars"): string {
  const r = Math.max(0, Math.min(5, avg));
  return `<span class="${esc(cls)}" style="--rating:${r.toFixed(2)}" role="img" aria-label="Rated ${ratingText(r)} out of 5"><span aria-hidden="true">★★★★★</span></span>`;
}

/** A product's price: "From" when options change it, the compare-at price struck through when it is on sale. */
export function priceHtml(p: Product, opts: { from?: boolean } = {}): string {
  const from = opts.from ?? hasPriceRange(p);
  const was = p.compareAtCents && p.compareAtCents > p.priceCents ? ` <s class="price__was"><span class="visually-hidden">Regular price </span>${esc(formatUsd(p.compareAtCents))}</s>` : "";
  return `<span class="price${was ? " price--sale" : ""}">${from ? '<span class="price__from">From </span>' : ""}<span class="price__now">${esc(formatUsd(p.priceCents))}</span>${was}</span>`;
}

/** The stock line a shopper sees: "Only 3 left" at five or fewer, "Sold out" at none. */
export function stockNote(p: Pick<Product, "stock">): string {
  if (p.stock <= 0) return "Sold out";
  return p.stock <= 5 ? `Only ${p.stock} left` : "";
}

/** The badges on a product: the catalogue's, then "Sale", then (unless `stock: false`) the stock note. */
export function productBadges(p: Product, opts: { stock?: boolean } = {}): { label: string; kind: string }[] {
  const out = (p.badges ?? []).map((label) => ({ label, kind: anchor(label) }));
  if (p.compareAtCents && p.compareAtCents > p.priceCents && !out.some((b) => b.kind === "sale")) out.push({ label: "Sale", kind: "sale" });
  const note = opts.stock === false ? "" : stockNote(p);
  if (note) out.push({ label: note, kind: p.stock <= 0 ? "sold-out" : "low-stock" });
  return out;
}

export function badgesHtml(p: Product, cls = "badges", opts: { stock?: boolean } = {}): string {
  const list = productBadges(p, opts);
  return list.length ? `<span class="${esc(cls)}">${list.map((b) => `<span class="badge badge--${esc(b.kind)}">${esc(b.label)}</span>`).join("")}</span>` : "";
}

/**
 * An image from public/. `alt` is required: pass "" for decoration. Pages load and decode their photos
 * eagerly — no loading="lazy", no decoding="async" — because a full-page screenshot (an agent's
 * included) rasters the whole page at once and would show empty boxes for photos not yet decoded.
 * `lazy` is only for pictures hidden until asked for (menu dropdowns, the pop-up); `eager` marks the
 * one the page opens on.
 */
export function img(ctx: Pick<PageCtx, "prefix">, rel: string | undefined, alt: string, opts: { cls?: string; eager?: boolean; lazy?: boolean } = {}): string {
  if (!rel) return "";
  const loading = opts.eager ? ' fetchpriority="high"' : opts.lazy ? ' loading="lazy"' : "";
  return `<img${opts.cls ? ` class="${esc(opts.cls)}"` : ""} src="${esc(assetHref(ctx, rel))}" alt="${esc(alt)}"${loading}>`;
}

/** A breadcrumb trail; the last crumb is the current page. */
export function breadcrumb(ctx: PageCtx, items: { label: string; path?: string }[]): string {
  const all = [{ label: "Home", path: "/" }, ...items];
  const lis = all
    .map((c, i) =>
      i < all.length - 1 && c.path !== undefined
        ? `<li><a href="${esc(href(ctx, c.path))}">${esc(c.label)}</a></li>`
        : `<li><span aria-current="page">${esc(c.label)}</span></li>`,
    )
    .join("");
  return `<nav class="breadcrumb" aria-label="Breadcrumb"><ol>${lis}</ol></nav>`;
}

/** schema.org BreadcrumbList for the same trail: Home, then the given pages (absolute URLs). */
export function breadcrumbJsonLd(ctx: Pick<PageCtx, "publicBase">, items: { name: string; path: string }[]): object {
  const all = [{ name: "Home", path: "/" }, ...items];
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: all.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: `${ctx.publicBase}${c.path}` })),
  };
}

/** A section heading with an optional "see all" link. */
export function sectionHead(ctx: PageCtx, title: string, link?: { label: string; path: string }, intro?: string): string {
  return `<div class="section__head"><div><h2 class="section__title">${esc(title)}</h2>${intro ? `<p class="section__intro">${esc(intro)}</p>` : ""}</div>${
    link ? `<a class="section__link" href="${esc(href(ctx, link.path))}">${esc(link.label)}</a>` : ""
  }</div>`;
}

/* ------------------------------------------------------------------ header pieces */

/** The brand's logo linking home. Inline SVG from the catalogue (see the note at the top of this file). */
export function logoLink(ctx: PageCtx, cls = "logo"): string {
  return `<a class="${esc(cls)}" href="${esc(href(ctx, "/"))}" aria-label="${esc(ctx.brand.name)} home">${ctx.brand.logoSvg}</a>`;
}

/** The header search: a GET form to /search with live suggestions from /search/suggest (store.js). */
export function searchForm(ctx: PageCtx, id = "header", opts: { placeholder?: string; cls?: string } = {}): string {
  const q = `search-${anchor(id)}`;
  return `<form class="${esc(opts.cls ?? "search")}" role="search" action="${esc(href(ctx, "/search"))}" method="get" data-search>
<label class="visually-hidden" for="${q}">Search ${esc(ctx.brand.name)}</label>
<input class="search__input" id="${q}" type="search" name="q" placeholder="${esc(opts.placeholder ?? "Search")}" autocomplete="off" data-search-input role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${q}-results">
<button class="search__submit" type="submit" aria-label="Search">${icon("search")}</button>
<div class="search__results" id="${q}-results" role="listbox" aria-label="Suggestions" data-search-results hidden></div>
</form>`;
}

export function accountLink(ctx: PageCtx): string {
  return `<a class="icon-btn account-link" href="${esc(href(ctx, "/account"))}" aria-label="Account">${icon("user")}</a>`;
}

/** The cart button: a link to /cart without JavaScript; store.js opens the drawer instead. The count comes from the cart in the database. */
export function cartButton(ctx: PageCtx): string {
  const n = ctx.cartCount;
  return `<a class="icon-btn cart-btn" href="${esc(href(ctx, "/cart"))}" data-cart-open aria-label="Cart, ${esc(plural(n, "item"))}">${icon("bag")}<span class="cart-count" data-cart-count${n ? "" : " data-empty"}>${n}</span></a>`;
}

export function menuButton(): string {
  return `<button type="button" class="icon-btn menu-btn" data-menu-open aria-controls="mobile-nav" aria-expanded="false" aria-label="Menu">${icon("menu")}</button>`;
}

/** The collection menu: each collection, with a dropdown of its products on wide screens. */
export function primaryNav(ctx: PageCtx, opts: { cls?: string; dropdowns?: boolean; extra?: { label: string; path: string }[] } = {}): string {
  const store = ctx.store;
  if (!store) return "";
  const items = store.collections
    .map((c) => {
      const products = store.products.filter((p) => p.collection === c.slug);
      const menu =
        opts.dropdowns === false
          ? ""
          : `<div class="nav__menu"><div class="nav__menu-inner"><ul class="nav__products">${products
              .map((p) => `<li><a href="${esc(productHref(ctx, p))}">${esc(p.name)}</a></li>`)
              .join("")}</ul><a class="nav__all" href="${esc(collectionHref(ctx, c.slug))}">Shop all ${esc(c.name.toLowerCase())}</a>${
              c.hero ? `<span class="nav__menu-media">${img(ctx, c.hero, "", { lazy: true })}</span>` : ""
            }</div></div>`;
      return `<li class="nav__item${menu ? " has-menu" : ""}"><a class="nav__link" href="${esc(collectionHref(ctx, c.slug))}">${esc(c.name)}</a>${menu}</li>`;
    })
    .join("");
  const extra = (opts.extra ?? []).map((e) => `<li class="nav__item"><a class="nav__link" href="${esc(href(ctx, e.path))}">${esc(e.label)}</a></li>`).join("");
  return `<nav class="${esc(opts.cls ?? "nav")}" aria-label="Collections"><ul class="nav__list">${items}${extra}</ul></nav>`;
}

/** A link a skin adds to a menu: a page of this site (`path`, prefixed like every link), or a phone number to call. */
export type NavExtra = { label: string; path: string } | { label: string; tel: string };

/** "tel:+18775550134" from "+1 (877) 555-0134". */
export const telHref = (phone: string) => `tel:${phone.replace(/[^+\d]/g, "")}`;

/**
 * The phone-width menu (opened by menuButton): search, the collections, then the skin's extra pages
 * ("Same-day delivery"), the help pages and the account, and last any number to call, with the number shown.
 */
export function mobileNav(ctx: PageCtx, opts: { extra?: readonly NavExtra[] } = {}): string {
  const store = ctx.store;
  if (!store) return "";
  const pages = (opts.extra ?? []).flatMap((x) => ("path" in x ? [x] : []));
  const calls = (opts.extra ?? []).flatMap((x) => ("tel" in x ? [x] : []));
  const cols = [...store.collections.map((c) => ({ label: c.name, path: `/collections/${c.slug}` })), { label: "Shop all", path: "/collections/all" }, ...pages];
  const help = HELP_PAGES.map(([key, label]) => ({ label, path: `/pages/${key}` }));
  const list = (xs: { label: string; path: string }[], cls: string) =>
    `<ul class="${cls}">${xs.map((x) => `<li><a href="${esc(href(ctx, x.path))}">${esc(x.label)}</a></li>`).join("")}</ul>`;
  const call = calls.length
    ? `<ul class="mobile-nav__call">${calls
        .map((c) => `<li><a href="${esc(telHref(c.tel))}">${icon("phone")}<span class="mobile-nav__call-label">${esc(c.label)}</span><span class="mobile-nav__call-number">${esc(c.tel)}</span></a></li>`)
        .join("")}</ul>`
    : "";
  return `<div class="mobile-nav" id="mobile-nav" data-mobile-nav hidden>
<div class="mobile-nav__backdrop" data-menu-close></div>
<nav class="mobile-nav__panel" aria-label="Menu">
<div class="mobile-nav__head">${logoLink(ctx, "logo logo--small")}<button type="button" class="icon-btn" data-menu-close aria-label="Close menu">${icon("close")}</button></div>
${searchForm(ctx, "mobile")}
${list(cols, "mobile-nav__list")}
${list([...help, { label: "Account", path: "/account" }], "mobile-nav__help")}
${call}</nav></div>`;
}

/* ------------------------------------------------------------------ default announcement, header, hero */

export function defaultAnnouncement(ctx: PageCtx): string {
  return `<div class="announcement" role="region" aria-label="Announcement"><div class="container announcement__inner"><p>${esc(ctx.brand.announcement)}</p></div></div>`;
}

/** Logo on the left, the collection menu beside it, search, account and cart on the right. */
export function defaultHeader(ctx: PageCtx): string {
  return `<header class="site-header" data-site-header>
<div class="container site-header__bar">
${menuButton()}
${logoLink(ctx)}
${primaryNav(ctx)}
<div class="header-actions">${searchForm(ctx)}${accountLink(ctx)}${cartButton(ctx)}</div>
</div>
</header>`;
}

/** A hero: a headline, a line of text, actions, and a photograph. Skins pass their own copy and markup around it. */
export function heroBlock(
  ctx: StoreCtx,
  o: { title: string; text: string; actions: { label: string; path: string; kind?: "primary" | "secondary" }[]; image?: string; imageAlt?: string; cls?: string; extra?: string },
): string {
  const actions = o.actions
    .map((a) => `<a class="btn btn--${a.kind ?? "primary"} btn--lg" href="${esc(href(ctx, a.path))}">${esc(a.label)}</a>`)
    .join("");
  return `<section class="hero${o.cls ? ` ${esc(o.cls)}` : ""}" data-section="hero">
<div class="hero__media">${img(ctx, o.image, o.imageAlt ?? "", { eager: true })}</div>
<div class="container hero__inner"><div class="hero__content">
<h1 class="hero__title">${esc(o.title)}</h1>
<p class="hero__text">${esc(o.text)}</p>
${o.extra ?? ""}
<div class="hero__actions">${actions}</div>
</div></div>
</section>`;
}

export function defaultHero(ctx: StoreCtx): string {
  const first = ctx.store.collections[0];
  const lead = aboutLead(ctx.store);
  return heroBlock(ctx, {
    title: ctx.store.brand.tagline,
    text: /^.+?[.!?](?=\s|$)/.exec(lead)?.[0] ?? lead,
    actions: [{ label: "Shop now", path: first ? `/collections/${first.slug}` : "/collections/all" }],
    image: ctx.store.brand.heroImage,
  });
}

/* ------------------------------------------------------------------ product card */

/** The default card: photo with badges, name, rating, price. The root carries the slug and base price for scripts and tests. */
export function defaultProductCard(p: Product, ctx: StoreCtx, opts: { cls?: string; extra?: string; summary?: boolean } = {}): string {
  const { avg, count } = ratingOf(p);
  const second = p.images[1];
  return `<article class="card${opts.cls ? ` ${esc(opts.cls)}` : ""}" data-product-slug="${esc(p.slug)}" data-price-cents="${p.priceCents}">
<a class="card__link" href="${esc(productHref(ctx, p))}">
<div class="card__media">${img(ctx, p.images[0], p.name, { cls: "card__img" })}${second ? img(ctx, second, "", { cls: "card__img card__img--alt" }) : ""}${badgesHtml(p, "card__badges badges")}</div>
<div class="card__body">
<h3 class="card__title">${esc(p.name)}</h3>
${opts.summary ? `<p class="card__summary">${esc(p.summary)}</p>` : ""}
${count ? `<p class="card__rating">${stars(avg)}<span class="card__count">${esc(ratingText(avg))} (${count})</span></p>` : ""}
${opts.extra ?? ""}
<p class="card__price">${priceHtml(p)}</p>
</div>
</a>
</article>`;
}

/** A grid of cards in the skin's style. `data-product-grid` marks the main results grid of a page. */
export function productGrid(ctx: StoreCtx, products: Product[], opts: { cls?: string; main?: boolean } = {}): string {
  return `<div class="grid${opts.cls ? ` ${esc(opts.cls)}` : ""}"${opts.main ? " data-product-grid" : ""}>${products.map((p) => ctx.skin.productCard(p, ctx)).join("")}</div>${opts.main ? "<!-- /grid -->" : ""}`;
}

/* ------------------------------------------------------------------ collection header */

export function defaultCollectionHeader(c: CollectionView, ctx: StoreCtx): string {
  return `<header class="collection-header">
<div class="container collection-header__inner">
<h1 class="collection-header__title">${esc(c.name)}</h1>
<p class="collection-header__blurb">${esc(c.blurb)}</p>
</div>
${c.hero ? `<div class="collection-header__media">${img(ctx, c.hero, "", { eager: true })}</div>` : ""}
</header>`;
}

/* ------------------------------------------------------------------ home sections */

/** The first paragraph of the store's About page (not a "## " heading). */
export function aboutLead(store: StoreDef): string {
  return (
    store.policies.about
      .split(/\n\s*\n/)
      .map((b) => b.trim())
      .find((b) => b && !b.startsWith("## ")) ?? store.brand.tagline
  );
}

function reviewQuote(ctx: StoreCtx, h: ReviewHighlight): string {
  const r: Review = h.review;
  return `<figure class="quote">
${stars(r.rating, "stars stars--small")}
<blockquote class="quote__text"><p class="quote__title">${esc(r.title)}</p><p>${esc(r.body)}</p></blockquote>
<figcaption class="quote__by">${esc(r.author)} on <a href="${esc(productHref(ctx, h.product))}">${esc(h.product.name)}</a></figcaption>
</figure>`;
}

function collectionTile(ctx: StoreCtx, t: CollectionTile): string {
  return `<a class="tile" href="${esc(collectionHref(ctx, t.collection.slug))}">
<span class="tile__media">${img(ctx, t.image, "")}</span>
<span class="tile__label"><span class="tile__name">${esc(t.collection.name)}</span><span class="tile__count">${esc(plural(t.count, "product"))}</span></span>
</a>`;
}

/** The home page's sections, as factories a skin configures and orders. */
export const sections = {
  /** Every collection as a picture tile. */
  featuredCollections:
    (o: { title?: string; intro?: string; cls?: string } = {}): HomeSection =>
    (ctx, data) =>
      `<section class="section section--collections${o.cls ? ` ${esc(o.cls)}` : ""}" data-section="featured-collections"><div class="container">
${sectionHead(ctx, o.title ?? "Shop by collection", undefined, o.intro)}
<div class="tiles">${data.collections.map((t) => collectionTile(ctx, t)).join("")}</div>
</div></section>`,

  /** The bestsellers grid (the scenario's featured products first). */
  bestsellers:
    (o: { title?: string; intro?: string; limit?: number; link?: { label: string; path: string } | null; cls?: string } = {}): HomeSection =>
    (ctx, data) =>
      `<section class="section section--bestsellers${o.cls ? ` ${esc(o.cls)}` : ""}" data-section="bestsellers"><div class="container">
${sectionHead(ctx, o.title ?? "Bestsellers", o.link === null ? undefined : (o.link ?? { label: "Shop all", path: "/collections/all" }), o.intro)}
${productGrid(ctx, data.bestsellers.slice(0, o.limit ?? 8), { cls: "grid--home" })}
</div></section>`,

  /** The brand's story: a photograph and a few paragraphs, linking to the About page. */
  storyBand:
    (o: { title?: string; paragraphs?: string[]; image?: string; imageAlt?: string; link?: { label: string; path: string } | null; cls?: string } = {}): HomeSection =>
    (ctx) => {
      const paras = o.paragraphs ?? [aboutLead(ctx.store)];
      const image = o.image ?? ctx.store.collections[1]?.hero ?? ctx.store.brand.heroImage;
      const link = o.link === null ? null : (o.link ?? { label: "Read our story", path: "/pages/about" });
      return `<section class="section story${o.cls ? ` ${esc(o.cls)}` : ""}" data-section="story"><div class="container story__inner">
<div class="story__media">${img(ctx, image, o.imageAlt ?? "")}</div>
<div class="story__body"><h2 class="story__title">${esc(o.title ?? "Our story")}</h2>${paras.map((p) => `<p>${esc(p)}</p>`).join("")}${
        link ? `<a class="btn btn--secondary" href="${esc(href(ctx, link.path))}">${esc(link.label)}</a>` : ""
      }</div>
</div></section>`;
    },

  /** Customer reviews from across the catalogue. */
  reviewsBand:
    (o: { title?: string; intro?: string; limit?: number; cls?: string } = {}): HomeSection =>
    (ctx, data) =>
      `<section class="section section--reviews${o.cls ? ` ${esc(o.cls)}` : ""}" data-section="reviews"><div class="container">
${sectionHead(ctx, o.title ?? "What customers say", undefined, o.intro)}
<div class="quotes">${data.reviews
        .slice(0, o.limit ?? 3)
        .map((h) => reviewQuote(ctx, h))
        .join("")}</div>
</div></section>`,

  /** The newsletter sign-up: 10 % off the first order, the code revealed after signing up. */
  newsletterBlock:
    (o: { title?: string; text?: string; cls?: string } = {}): HomeSection =>
    (ctx) =>
      `<section class="section newsletter-block${o.cls ? ` ${esc(o.cls)}` : ""}" data-section="newsletter"><div class="container newsletter-block__inner">
<div class="newsletter-block__copy"><h2 class="newsletter-block__title">${esc(o.title ?? "Get 10% off your first order")}</h2>
<p>${esc(o.text ?? `Sign up for the ${ctx.brand.name} newsletter: new arrivals, seasonal picks and the occasional offer. Your code arrives the moment you sign up.`)}</p></div>
${newsletterForm(ctx, "block")}
</div></section>`,

  /** A row of short promises (delivery, returns, …), each with an icon. */
  valueProps:
    (o: { items: { icon: string; title: string; text: string }[]; cls?: string }): HomeSection =>
    () =>
      `<section class="section props${o.cls ? ` ${esc(o.cls)}` : ""}" data-section="value-props"><div class="container props__inner">${o.items
        .map((i) => `<div class="prop">${icon(i.icon, "icon prop__icon")}<div><p class="prop__title">${esc(i.title)}</p><p class="prop__text">${esc(i.text)}</p></div></div>`)
        .join("")}</div></section>`,
};

/** The newsletter form (home block, modal, thanks page): POST /newsletter; store.js submits it with fetch and shows the code inline. */
export function newsletterForm(ctx: PageCtx, id: string, opts: { button?: string } = {}): string {
  const fid = `newsletter-${anchor(id)}`;
  return `<form class="newsletter-form" method="post" action="${esc(href(ctx, "/newsletter"))}" data-newsletter-form novalidate>
<label class="visually-hidden" for="${fid}">Email address</label>
<input id="${fid}" type="email" name="email" required autocomplete="email" placeholder="Email address">
<button class="btn btn--primary" type="submit">${esc(opts.button ?? "Sign up")}</button>
<p class="newsletter-form__msg" data-newsletter-msg role="status" aria-live="polite"></p>
</form>`;
}

/* ------------------------------------------------------------------ footer */

/** The fictional-store notice every page carries. */
export function finePrintText(ctx: Pick<PageCtx, "brand">): string {
  return `${ctx.brand.name} is a fictional store operated for research. Orders are not fulfilled.`;
}

export function finePrint(ctx: Pick<PageCtx, "brand">): string {
  return `<p class="fine-print">${esc(finePrintText(ctx))}</p>`;
}

/** The help pages, in footer order: [policy key, link label]. */
export const HELP_PAGES: readonly (readonly [string, string])[] = [
  ["shipping", "Shipping"],
  ["returns", "Returns"],
  ["faq", "FAQ"],
  ["contact", "Contact us"],
];
export const ABOUT_PAGES: readonly (readonly [string, string])[] = [
  ["about", "Our story"],
  ["privacy", "Privacy policy"],
  ["terms", "Terms of service"],
];

/** The cards a store takes, as generic card shapes: no card network's mark. */
export function paymentIcons(): string {
  const card = (label: string, fill: string, ink: string, extra: string) =>
    `<svg viewBox="0 0 38 24" width="38" height="24" role="img" aria-label="${esc(label)}"><rect x=".5" y=".5" width="37" height="23" rx="3.5" fill="${fill}" stroke="rgba(0,0,0,.14)"/><rect x="5" y="7.5" width="7" height="5.5" rx="1.2" fill="#D9B95B"/><path d="M5 17.5h9M17 17.5h5" stroke="${ink}" stroke-width="1.6" stroke-linecap="round"/>${extra}</svg>`;
  return `<div class="payment-icons" aria-label="Payment methods we accept">${[
    card("Credit card", "#1E2B4A", "rgba(255,255,255,.7)", '<circle cx="29" cy="8" r="3" fill="rgba(255,255,255,.35)"/>'),
    card("Debit card", "#2E5B4F", "rgba(255,255,255,.7)", '<path d="M26 7h6" stroke="rgba(255,255,255,.55)" stroke-width="1.6" stroke-linecap="round"/>'),
    card("Prepaid card", "#F2F0EA", "rgba(0,0,0,.45)", '<circle cx="28" cy="8" r="2.6" fill="none" stroke="rgba(0,0,0,.4)" stroke-width="1.2"/>'),
    `<svg viewBox="0 0 38 24" width="38" height="24" role="img" aria-label="Digital wallet"><rect x=".5" y=".5" width="37" height="23" rx="3.5" fill="#FFFFFF" stroke="rgba(0,0,0,.14)"/><rect x="14" y="4.5" width="10" height="15" rx="2" fill="none" stroke="#333" stroke-width="1.4"/><path d="M17.5 16.5h3" stroke="#333" stroke-width="1.4" stroke-linecap="round"/></svg>`,
  ].join("")}</div>`;
}

export function socialLinks(names: readonly string[]): string {
  return `<ul class="social" aria-label="Social media">${names.map((n) => `<li><a href="#">${esc(n)}</a></li>`).join("")}</ul>`;
}

/** Shop / Help / About columns. */
export function footerColumns(ctx: PageCtx): string {
  const store = ctx.store;
  const col = (title: string, links: { label: string; path: string }[]) =>
    `<div class="footer-col"><h2 class="footer-col__title">${esc(title)}</h2><ul>${links.map((l) => `<li><a href="${esc(href(ctx, l.path))}">${esc(l.label)}</a></li>`).join("")}</ul></div>`;
  const shop = store ? [...store.collections.map((c) => ({ label: c.name, path: `/collections/${c.slug}` })), { label: "Shop all", path: "/collections/all" }] : [];
  return `<div class="footer-cols">
${shop.length ? col("Shop", shop) : ""}
${col(
  "Help",
  HELP_PAGES.map(([k, l]) => ({ label: l, path: `/pages/${k}` })),
)}
${col(
  "About",
  ABOUT_PAGES.map(([k, l]) => ({ label: l, path: `/pages/${k}` })),
)}
<div class="footer-col footer-col--contact"><h2 class="footer-col__title">Get in touch</h2>
<p><a href="mailto:${esc(ctx.brand.supportEmail)}">${esc(ctx.brand.supportEmail)}</a></p>
<p>${esc(ctx.brand.supportPhone)}</p></div>
</div>`;
}

export function defaultFooter(ctx: PageCtx): string {
  return `<footer class="site-footer">
<div class="container">
<div class="site-footer__top">
<div class="site-footer__brand">${logoLink(ctx, "logo logo--footer")}<p>${esc(ctx.brand.tagline)}</p>${socialLinks(ctx.skin.socials)}</div>
${footerColumns(ctx)}
</div>
<div class="site-footer__bottom">
<p class="copyright">© 2026 ${esc(ctx.brand.name)}</p>
${paymentIcons()}
</div>
${finePrint(ctx)}
</div>
</footer>`;
}

/* ------------------------------------------------------------------ furniture: cookie banner, newsletter pop-up, cart drawer */

/** Shown by store.js until localStorage "cookie-consent" holds a choice ("accepted" for Accept). */
export function cookieBanner(ctx: PageCtx): string {
  return `<div class="cookie-banner" data-cookie-banner role="region" aria-label="Cookie consent" hidden>
<div class="cookie-banner__inner">
<p class="cookie-banner__text">We use cookies to keep your cart and checkout working and, if you accept, to understand how the shop is used. <a href="${esc(pageHref(ctx, "privacy"))}">Privacy policy</a></p>
<div class="cookie-banner__actions"><button type="button" class="btn btn--secondary" data-cookie-manage aria-expanded="false" aria-controls="cookie-prefs">Manage</button><button type="button" class="btn btn--primary" data-cookie-accept>Accept</button></div>
<form class="cookie-banner__prefs" id="cookie-prefs" data-cookie-prefs hidden>
<label><input type="checkbox" checked disabled> Essential: cart, checkout and security (always on)</label>
<label><input type="checkbox" name="analytics"> Analytics: how pages are used</label>
<label><input type="checkbox" name="marketing"> Marketing: offers on other sites</label>
<button type="submit" class="btn btn--primary">Save choices</button>
</form>
</div>
</div>`;
}

/**
 * Opened by store.js after 8 s on the second page view, unless localStorage "newsletter-dismissed" is "1".
 * Its photograph is the skin's newsletterImage, else the brand's hero image, else the first collection's.
 */
export function newsletterModal(ctx: PageCtx): string {
  const store = ctx.store;
  const pic = ctx.skin.newsletterImage ?? store?.brand.heroImage ?? store?.collections[0]?.hero;
  const pitch = ctx.skin.newsletterPitch(ctx);
  return `<div class="modal" data-newsletter-modal hidden>
<div class="modal__backdrop" data-modal-close></div>
<div class="modal__dialog" role="dialog" aria-modal="true" aria-labelledby="newsletter-modal-title">
<button type="button" class="icon-btn modal__close" data-modal-close aria-label="Close">${icon("close")}</button>
${pic ? `<div class="modal__media">${img(ctx, pic, "", { lazy: true })}</div>` : ""}
<div class="modal__body">
<h2 class="modal__title" id="newsletter-modal-title">${esc(pitch.title)}</h2>
<p class="modal__text">${esc(pitch.text)}</p>
${newsletterForm(ctx, "modal")}
<div class="modal__success" data-newsletter-success hidden></div>
<button type="button" class="link-btn" data-modal-close>No thanks</button>
</div>
</div>
</div>`;
}

/** The slide-out cart. Empty here: store.js fills it from GET <prefix>/cart.json (see routes/storefront.ts). */
export function cartDrawer(ctx: PageCtx): string {
  return `<div class="drawer" data-cart-drawer hidden>
<div class="drawer__backdrop" data-drawer-close></div>
<aside class="drawer__panel" role="dialog" aria-modal="true" aria-labelledby="cart-drawer-title" tabindex="-1">
<div class="drawer__head"><h2 class="drawer__title" id="cart-drawer-title">Your cart</h2><button type="button" class="icon-btn" data-drawer-close aria-label="Close cart">${icon("close")}</button></div>
<div class="drawer__notice" data-cart-notice role="status" aria-live="polite"></div>
<div class="drawer__body" data-cart-lines></div>
<div class="drawer__foot" data-cart-foot hidden>
<p class="drawer__subtotal"><span>Subtotal</span><span data-cart-subtotal></span></p>
<p class="drawer__note">Shipping and taxes are calculated at checkout.</p>
<form method="post" action="${esc(href(ctx, "/checkout"))}"><button class="btn btn--primary btn--block" type="submit">Check out</button></form>
<a class="btn btn--secondary btn--block" href="${esc(href(ctx, "/cart"))}">View cart</a>
</div>
</aside>
</div>`;
}

/* ------------------------------------------------------------------ the default skin */

export const SYSTEM_SANS = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

/** What every skin starts from; skins/<store>.ts spreads it and overrides. */
export const defaultSkin: Omit<Skin, "id" | "bodyClass"> = {
  fontFallbacks: { display: SYSTEM_SANS, body: SYSTEM_SANS },
  homeTitle: (ctx) => ctx.store.brand.tagline.replace(/[.!]\s*$/, ""),
  allProductsBlurb: (ctx) => `Everything in the ${ctx.store.brand.name} shop, in one place.`,
  socials: ["Instagram", "Facebook", "Pinterest"],
  announcement: defaultAnnouncement,
  header: defaultHeader,
  hero: (ctx) => defaultHero(ctx),
  homeSections: () => [sections.featuredCollections(), sections.bestsellers(), sections.storyBand(), sections.reviewsBand(), sections.newsletterBlock()],
  productCard: (p, ctx) => defaultProductCard(p, ctx),
  collectionHeader: defaultCollectionHeader,
  productLayout: "gallery-left",
  productExtras: () => "",
  buyBoxIntro: () => "",
  buyBoxAfterSummary: () => "",
  buyBoxExtras: () => "",
  newsletterPitch: (ctx) => ({
    title: "10% off your first order",
    text: `Join the ${ctx.brand.name} newsletter for new arrivals and seasonal picks. We'll show your code as soon as you sign up.`,
  }),
  mobileNav: (ctx) => mobileNav(ctx),
  footer: defaultFooter,
};

/** Re-exported for skins: the home data types they render. */
export type { CollectionTile, CollectionView, HomeData, HomeSection, ReviewHighlight };
