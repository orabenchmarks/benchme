import type { Brand, StoreDef } from "@benchme/storefront";
import type { SiteId } from "../sites.js";
import { absoluteAsset, assetHref, cartDrawer, cookieBanner, esc, finePrint, href, icon, logoLink, newsletterModal } from "./components.js";
import type { Skin } from "./skins/index.js";

/**
 * What every page is rendered from. Routes build it once per request (routes/storefront.ts pageCtx()):
 * the site and its brand, the store's catalogue (null on paylantern), the skin, the gateway's prefix,
 * the header's cart count and the absolute base URL for Open Graph and JSON-LD.
 */
export type PageCtx = {
  site: SiteId;
  /** The site's brand: a store's, or PayLantern's. */
  brand: Brand;
  /** The store's catalogue; null on paylantern. */
  store: StoreDef | null;
  skin: Skin;
  /** "/w/<workspace>/<site>": every link, form action and asset URL starts with it. */
  prefix: string;
  /** Items in this workspace's cart at this store, for the header. */
  cartCount: number;
  /** Absolute URL of the site root, prefix included ("https://host/w/<id>/<site>"), no trailing slash. */
  publicBase: string;
  /** This page's path below the site root ("/products/x"), for og:url. */
  path: string;
  /**
   * Where the logo leads, below the site root, when not the site's home page: PayLantern's payment page as it was
   * opened (its merchant and reference kept, so the page stays the one the shopper was sent to).
   */
  homePath?: string;
};

/** A page of a store (never paylantern): the catalogue is there. */
export type StoreCtx = PageCtx & { store: StoreDef };

export type LayoutOpts = {
  /** Extra tags inside <head>, rendered verbatim: whoever passes them escapes them. */
  head?: string;
  /** Script URLs loaded (deferred) after store.js, e.g. Stripe.js and <prefix>/assets/js/pay.js. Escaped here. */
  scripts?: string[];
  /**
   * Extra stylesheets under public/ ("css/checkout.css"), linked after base.css and before the
   * site's own <site>.css, so a store's stylesheet can still refine them.
   */
  styles?: string[];
  /**
   * The checkout header's way back (chrome "checkout" only): "Return to cart" by default; the
   * order confirmation passes "Continue shopping"; null leaves it out.
   */
  checkoutBack?: { label: string; path: string } | null;
  /** schema.org objects, each emitted as a JSON-LD <script>. */
  jsonLd?: object[];
  /** Open Graph: the page's description and image (a public/ path like "img/x/y.jpg", or an absolute URL). */
  og?: { description?: string; image?: string; type?: "website" | "product" };
  /** <meta name="description">; defaults to og.description, then the brand's tagline. */
  description?: string;
  /**
   * "store" (default): announcement, header, footer, cookie banner, newsletter pop-up, cart drawer.
   * "checkout": a checkout's header (logo, "Secure checkout", the way back to the cart) and a short footer
   * (policy links, fine print); the cookie banner stays, the pop-up and drawer go.
   * "plain": logo, the page, the fine print. Paylantern pages are never given store furniture.
   */
  chrome?: "store" | "checkout" | "plain";
  /** Extra classes on <body> ("page-product"). */
  bodyClass?: string;
};

const HEX = /^#[0-9a-fA-F]{3,8}$/;
const LENGTH = /^\d+(?:\.\d+)?(?:px|rem|em)$/;

/** A font stack from a family name ("Fraunces") or a stack already ("'DM Serif Display', Georgia, serif"), safe inside <style>. */
export function fontStack(font: string, fallback: string): string {
  const clean = (s: string) => s.replace(/[^A-Za-z0-9 ,'"-]/g, "").trim();
  const f = clean(font);
  if (!f) return clean(fallback);
  return f.includes(",") ? f : `'${f.replace(/['"]/g, "")}', ${clean(fallback)}`;
}

/** The brand's design tokens as CSS custom properties: public/css/*.css only ever reads var(--…). */
function tokensStyle(brand: Brand, skin: Skin): string {
  const t = brand.tokens;
  const color = (v: string, d: string) => (HEX.test(v) ? v : d);
  const vars = [
    `--bg:${color(t.bg, "#ffffff")}`,
    `--fg:${color(t.fg, "#111111")}`,
    `--muted:${color(t.muted, "#666666")}`,
    `--accent:${color(t.accent, "#333333")}`,
    `--accent-fg:${color(t.accentFg, "#ffffff")}`,
    `--surface:${color(t.surface, "#ffffff")}`,
    `--border:${color(t.border, "#dddddd")}`,
    `--radius:${LENGTH.test(t.radius) ? t.radius : "6px"}`,
    `--font-display:${fontStack(brand.fonts.display, skin.fontFallbacks.display)}`,
    `--font-body:${fontStack(brand.fonts.body, skin.fontFallbacks.body)}`,
  ];
  return `<style>:root{${vars.join(";")}}</style>`;
}

/** A small favicon: the brand's initial on its accent colour. */
function favicon(brand: Brand): string {
  const accent = HEX.test(brand.tokens.accent) ? brand.tokens.accent : "#333333";
  const fg = HEX.test(brand.tokens.accentFg) ? brand.tokens.accentFg : "#ffffff";
  const letter = (brand.name.match(/[A-Za-z]/)?.[0] ?? "S").toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="${accent}"/><text x="16" y="22" font-family="Georgia,serif" font-size="19" text-anchor="middle" fill="${fg}">${letter}</text></svg>`;
  return `<link rel="icon" href="data:image/svg+xml,${esc(encodeURIComponent(svg))}">`;
}

/** JSON inside <script>: "<" escaped so no string in it can close the element. */
export function jsonLdScript(obj: object): string {
  return `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, "\\u003c")}</script>`;
}

/** A real checkout's header: the logo, "Secure checkout", and the way back to the cart. Nothing else to wander off to. */
function checkoutHeader(ctx: PageCtx, back: LayoutOpts["checkoutBack"]): string {
  const way = back === undefined ? { label: "Return to cart", path: "/cart" } : back;
  return `<header class="site-header site-header--checkout"><div class="container site-header__bar">${logoLink(ctx)}<p class="secure-note">${icon("lock")}<span>Secure checkout</span></p>${
    way ? `<a class="checkout-back-link" href="${esc(href(ctx, way.path))}">${esc(way.label)}</a>` : ""
  }</div></header>`;
}

function plainFooter(ctx: PageCtx): string {
  return `<footer class="site-footer site-footer--plain"><div class="container">${finePrint(ctx)}</div></footer>`;
}

/** The checkout's footer: the policies a buyer may want before paying, and the fine print. */
function checkoutFooter(ctx: PageCtx): string {
  const links = [
    ["returns", "Refund policy"],
    ["shipping", "Shipping policy"],
    ["privacy", "Privacy policy"],
    ["terms", "Terms of service"],
  ]
    .map(([key, label]) => `<li><a href="${esc(href(ctx, `/pages/${key}`))}">${esc(label as string)}</a></li>`)
    .join("");
  return `<footer class="site-footer site-footer--plain site-footer--checkout"><div class="container"><ul class="checkout-policies">${links}</ul>${finePrint(ctx)}</div></footer>`;
}

/**
 * The whole document around a page body: head (title "<Page> | <Brand>", noindex, Open Graph, the
 * brand's Google fonts, base.css + <site>.css, the brand tokens, JSON-LD), then — for store chrome —
 * announcement, header, main, footer, cookie banner, newsletter pop-up, cart drawer and phone menu,
 * and store.js. Every page of every site comes through here.
 */
export function layout(ctx: PageCtx, title: string, body: string, opts: LayoutOpts = {}): string {
  const { brand, skin } = ctx;
  const chrome = ctx.store ? (opts.chrome ?? "store") : "plain";
  const description = opts.description ?? opts.og?.description ?? brand.tagline;
  const ogImage = opts.og?.image ? (/^https?:\/\//.test(opts.og.image) ? opts.og.image : absoluteAsset(ctx, opts.og.image)) : brand.heroImage ? absoluteAsset(ctx, brand.heroImage) : "";
  const fullTitle = `${title} | ${brand.name}`;
  const freeOver = ctx.store?.freeShippingOverCents;

  const head = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<meta name="robots" content="noindex,nofollow">',
    `<title>${esc(fullTitle)}</title>`,
    `<meta name="description" content="${esc(description)}">`,
    `<meta property="og:site_name" content="${esc(brand.name)}">`,
    `<meta property="og:title" content="${esc(fullTitle)}">`,
    `<meta property="og:type" content="${opts.og?.type ?? "website"}">`,
    `<meta property="og:url" content="${esc(`${ctx.publicBase}${ctx.path}`)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    ogImage ? `<meta property="og:image" content="${esc(ogImage)}">` : "",
    `<meta name="theme-color" content="${esc(HEX.test(brand.tokens.bg) ? brand.tokens.bg : "#ffffff")}">`,
    '<link rel="preconnect" href="https://fonts.googleapis.com">',
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    `<link rel="stylesheet" href="${esc(brand.fonts.href)}">`,
    `<link rel="stylesheet" href="${esc(assetHref(ctx, "css/base.css"))}">`,
    ...(opts.styles ?? []).map((rel) => `<link rel="stylesheet" href="${esc(assetHref(ctx, rel))}">`),
    `<link rel="stylesheet" href="${esc(assetHref(ctx, `css/${ctx.site}.css`))}">`,
    tokensStyle(brand, skin),
    favicon(brand),
    ...(opts.jsonLd ?? []).map(jsonLdScript),
    opts.head ?? "",
  ]
    .filter(Boolean)
    .join("\n");

  const bodyAttrs = [
    `class="${esc([skin.bodyClass, `chrome-${chrome}`, opts.bodyClass ?? ""].filter(Boolean).join(" "))}"`,
    `data-site="${esc(ctx.site)}"`,
    `data-prefix="${esc(ctx.prefix)}"`,
    freeOver ? `data-free-shipping-cents="${freeOver}"` : "",
  ]
    .filter(Boolean)
    .join(" ");

  let top = "";
  let bottom = "";
  if (chrome === "store") {
    top = `${skin.announcement(ctx)}\n${skin.header(ctx)}`;
    bottom = `${skin.footer(ctx)}\n${cookieBanner(ctx)}\n${newsletterModal(ctx)}\n${cartDrawer(ctx)}\n${skin.mobileNav(ctx)}`;
  } else if (chrome === "checkout") {
    top = checkoutHeader(ctx, opts.checkoutBack);
    bottom = `${checkoutFooter(ctx)}\n${cookieBanner(ctx)}`;
  } else {
    top = ctx.store ? `<header class="site-header site-header--plain"><div class="container site-header__bar">${logoLink(ctx)}</div></header>` : skin.header(ctx);
    bottom = ctx.store ? plainFooter(ctx) : skin.footer(ctx);
  }

  const scripts = [assetHref(ctx, "js/store.js"), ...(opts.scripts ?? [])].map((src) => `<script src="${esc(src)}" defer></script>`).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
${head}
</head>
<body ${bodyAttrs}>
<a class="skip-link" href="#main">Skip to content</a>
${top}
<main id="main" class="site-main">
${body}
</main>
${bottom}
${scripts}
</body>
</html>`;
}
