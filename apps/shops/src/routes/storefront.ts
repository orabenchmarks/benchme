/**
 * The storefront: every page a shopper browses before the cart, on the three store sites.
 *
 *   GET  /                      home (the scenario's `featured` products lead the bestsellers)
 *   GET  /collections/:slug     a collection, or "all"; ?sort=featured|price-asc|price-desc|rating, ?page=N,
 *                               ?opt_<groupId>=<valueId> (repeatable: any of the values), ?min= / ?max= (dollars, inclusive)
 *   GET  /products/:slug        a product (the scenario's `injectedReview` among its reviews, which the page lists
 *                               newest first, and counted in its rating; Quillfeather opens on subscribe & save every
 *                               4 weeks under `defaultSubscribe`)
 *   GET  /search?q=             results page (searchProducts: names, tags, option values and details; words are boosts)
 *   GET  /search/suggest?q=     {"items":[{slug,name,priceCents,image,url}]}, at most 6 (store.js, as you type)
 *   GET  /pages/:slug           shipping | returns | privacy | terms | faq | about | contact
 *   POST /newsletter            email → StateRepo.setNewsletter; 303 to /newsletter/thanks, or JSON
 *                               {"ok":true,"code":"WELCOME10"} for fetch (Accept: application/json); 422 on a bad address
 *   GET  /newsletter/thanks     the welcome code, once this workspace signed up at this store
 *   GET  /delivery-check?zip=   Wrenfield only: "Delivers to <zip> as soon as today, <weekday, month day>, when you
 *                               order by <cutoff> Pacific time." or "… as soon as tomorrow, <weekday, month day> (today
 *                               is <weekday, month day>, Pacific time)." (JSON {ok, zip, date, today, message} for fetch)
 *   GET  /account               sign-in page with the guest-checkout nudge (POST /account/sign-in never finds an account)
 *
 * The scenario hook: utm_campaign on ANY GET of a store site (registerCampaignHook, a scope-wide preHandler)
 * is recorded with StateRepo.setCampaign before any handler calls req.scenario(); an unknown code, or another
 * store's, is ignored and logged as a "campaign_ignored" event {code}; a code arriving after checkout locked the
 * store is logged as {code, reason: "locked"}; a code Postgres cannot store (a NUL, half a surrogate pair) as
 * {code (those characters shown as U+FFFD), reason: "invalid"}. The page is served either way.
 *
 * ── The cart contract (implemented by routes/cart.ts; the pages and public/js/store.js rely on it) ─────────────
 *
 * Bodies arrive as application/x-www-form-urlencoded (a plain form post, and store.js's fetch) or as JSON.
 * A request with "Accept: application/json" (store.js) is answered with JSON; anything else is a browser
 * form post and is answered with a redirect (303) or an HTML page.
 *
 *   POST <prefix>/cart/add     the product page's form (data-add-to-cart):
 *        sku            the product's SKU
 *        opt_<groupId>  one per option group of the product: the chosen value id (opt_size=deluxe, opt_color=black)
 *        qty            1–10
 *        mode           Quillfeather coffees only: "once" | "subscribe"
 *        interval       with mode=subscribe, one of the product's subscription intervals ("4 weeks");
 *                       the form always sends it — ignore it when mode=once
 *      JSON  → 200 CartJson
 *              422 {"error":"UNKNOWN_SKU"|"SOLD_OUT"|"INVALID","message":"<sentence for the shopper>"}
 *      form  → 303 <prefix>/cart, or 422 with the message on an HTML page
 *   GET  <prefix>/cart.json    → CartJson (the drawer); with `recovered` { orderNo, message, url } beside it when opening
 *                              the drawer recorded the order of a payment whose return page never loaded (routes/recovered.ts)
 *   POST <prefix>/cart/update  key, qty (0 removes)  → CartJson (JSON) | 303 <prefix>/cart (form)
 *   POST <prefix>/cart/remove  key                   → CartJson (JSON) | 303 <prefix>/cart (form)
 *   GET  <prefix>/cart         the cart page (the cart button's link without JavaScript)
 *   POST <prefix>/checkout     the drawer's "Check out" button (a form post)
 *
 *   CartJson = { lines: [{ key, name, image, optionsLabel, qty, unitCents, totalCents, url }], subtotalCents, count }
 *     key           lineKey() of @benchme/storefront: what update/remove take back
 *     image         <prefix>/assets/img/… (the product's first photo)
 *     optionsLabel  components.ts optionsLabel(): "Deluxe", "12 oz / Drip / Every 4 weeks"
 *     url           <prefix>/products/<slug>
 *     count         the sum of qty, as the header shows it
 *
 * store.js renders the drawer from CartJson with DOM APIs and, while cart.json answers 404, links to <prefix>/cart.
 * The header's count is rendered server-side from CartsRepo (pageCtx below).
 */
import { defaultPublicBaseUrl } from "@benchme/site-kit";
import { addDays, normalizeZip, stateForZip, type Collection, type Product, type Review, type ScenarioDef, type StoreDef, type StoreId } from "@benchme/storefront";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { assetHref, hourLabel, productHref } from "../render/components.js";
import type { PageCtx, StoreCtx } from "../render/layout.js";
import { accountPage } from "../render/pages/account.js";
import { collectionPage, SORTS, type CollectionPageView, type FilterGroup, type SortKey } from "../render/pages/collection.js";
import { deliveryCheckPage, type DeliveryResult } from "../render/pages/delivery-check.js";
import { homePage } from "../render/pages/home.js";
import { newsletterThanksPage } from "../render/pages/newsletter-thanks.js";
import { isPolicyKey, policyPage } from "../render/pages/policy.js";
import { productPage } from "../render/pages/product.js";
import { searchPage } from "../render/pages/search.js";
import { skinFor, type HomeData, type ReviewHighlight } from "../render/skins/index.js";
import { PAYLANTERN_BRAND, STORE_TZ } from "../stores/index.js";
import type { RouteDeps } from "./index.js";

/** The code the newsletter sign-up reveals; every store's promoCodes carries it (stores/invariants.ts). */
export const NEWSLETTER_CODE = "WELCOME10";
/** Products per collection page. */
export const PAGE_SIZE = 12;
const SUGGEST_LIMIT = 6;

/* ------------------------------------------------------------------ request context */

/** The page's path below the site root ("/products/x"), without the query. */
export function sitePath(req: FastifyRequest): string {
  const path = (req.url.split("?")[0] ?? "/").replace(new RegExp(`^/s/${req.site}(?=/|$)`), "");
  return path || "/";
}

/** The gateway's public origin plus the prefix, without a default port or a trailing slash. */
function publicBase(req: FastifyRequest): string {
  const raw = defaultPublicBaseUrl(req);
  try {
    const u = new URL(raw);
    return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return raw.replace(/\/+$/, "");
  }
}

/** Everything a page renders from, for this request: brand, catalogue, skin, prefix, cart count, URLs. Other route modules use it too. */
export async function pageCtx(req: FastifyRequest, deps: Pick<RouteDeps, "repos">): Promise<PageCtx> {
  const store = req.store;
  const cartCount = store && req.workspaceId ? (await deps.repos.carts.get(req.workspaceId, req.site)).lines.reduce((a, l) => a + l.qty, 0) : 0;
  return {
    site: req.site,
    brand: store?.brand ?? PAYLANTERN_BRAND,
    store,
    skin: skinFor(req.site),
    prefix: req.prefix,
    cartCount,
    publicBase: publicBase(req),
    path: sitePath(req),
  };
}

/** Sends a rendered page. Pages depend on the workspace's cart, so no shared cache keeps them. */
export function sendHtml(reply: FastifyReply, html: string, status = 200): FastifyReply {
  return reply.code(status).header("cache-control", "private, no-cache").type("text/html; charset=utf-8").send(html);
}

/** True for store.js's fetches (Accept: application/json), false for a browser navigating or posting a form. */
export function wantsJson(req: FastifyRequest): boolean {
  const accept = req.headers.accept ?? "";
  return accept.includes("application/json") && !accept.includes("text/html");
}

/* ------------------------------------------------------------------ scenario mechanisms on the catalogue */

/** The token a hidden scenario's injected review may carry; it becomes this workspace's PayLantern page. */
export const PAYLANTERN_URL_TOKEN = "{{paylantern_url}}";

/** This workspace's PayLantern payment page for a store: the store's public base with its last segment swapped. */
export function paylanternUrl(publicBase: string, site: string): string {
  return `${publicBase.replace(/\/[^/]+$/, "/paylantern")}/pay?m=${encodeURIComponent(site)}`;
}

/**
 * The catalogue as this workspace sees it: the scenario's injected review added to its product, with
 * {{paylantern_url}} filled in (a planted review can only point at a run's own PayLantern page at render time).
 * The product page lists every product's reviews newest first, so the injected one sits at its own date.
 */
export function productsFor(store: StoreDef, scenario: ScenarioDef | null, vars: { paylanternUrl?: string } = {}): Product[] {
  const inj = scenario?.mechanisms.injectedReview;
  if (!inj) return store.products;
  const fill = (text: string) => (vars.paylanternUrl ? text.split(PAYLANTERN_URL_TOKEN).join(vars.paylanternUrl) : text);
  const review: Review = { ...(inj.review as Review), title: fill(inj.review.title), body: fill(inj.review.body) };
  return store.products.map((p) => (p.slug === inj.productSlug ? { ...p, reviews: [review, ...p.reviews] } : p));
}

const avgOf = (p: Product) => (p.reviews.length ? p.reviews.reduce((a, r) => a + r.rating, 0) / p.reviews.length : 0);

/** Bestseller badge first, then the most reviewed, then the best rated; ties keep catalogue order. */
function bestsellerOrder(products: Product[]): Product[] {
  const rank = (p: Product) => [p.badges?.includes("Bestseller") ? 0 : 1, -p.reviews.length, -avgOf(p)];
  return products
    .map((p, i) => ({ p, i, r: rank(p) }))
    .sort((a, b) => a.r[0]! - b.r[0]! || a.r[1]! - b.r[1]! || a.r[2]! - b.r[2]! || a.i - b.i)
    .map((x) => x.p);
}

/** Recent five-star reviews worth quoting, one per product (never the scenario's injected review). */
function reviewHighlights(store: StoreDef): ReviewHighlight[] {
  const all = store.products.flatMap((product) => product.reviews.filter((r) => r.rating === 5 && r.body.length >= 60).map((review) => ({ review, product })));
  all.sort((a, b) => b.review.date.localeCompare(a.review.date));
  const seen = new Set<string>();
  const out: ReviewHighlight[] = [];
  for (const h of all) {
    if (seen.has(h.product.slug)) continue;
    seen.add(h.product.slug);
    out.push(h);
    if (out.length === 6) break;
  }
  return out;
}

/** How many products "You may also like" shows. */
export const RELATED_COUNT = 4;

/**
 * "You may also like" under a product: the rest of its collection first, then the other collections, in catalogue
 * order — skipping any product whose photo is already on the page (the product's own, or an earlier pick's), so
 * two variants sold under one photo never sit side by side.
 */
export function relatedProducts(products: Product[], p: Product): Product[] {
  const shown = new Set([p.images[0] ?? p.slug]);
  const out: Product[] = [];
  for (const x of [...products.filter((y) => y.collection === p.collection), ...products.filter((y) => y.collection !== p.collection)]) {
    const photo = x.images[0] ?? x.slug;
    if (x.slug === p.slug || shown.has(photo)) continue;
    shown.add(photo);
    out.push(x);
    if (out.length === RELATED_COUNT) break;
  }
  return out;
}

export function homeData(store: StoreDef, products: Product[], scenario: ScenarioDef | null): HomeData {
  const featured = (scenario?.mechanisms.featured ?? []).flatMap((f) => {
    const p = products.find((x) => x.slug === f || x.sku === f);
    return p ? [p] : [];
  });
  const lead = [...new Set(featured)];
  const rest = bestsellerOrder(products).filter((p) => !lead.includes(p));
  return {
    bestsellers: [...lead, ...rest].slice(0, Math.max(8, lead.length)),
    collections: store.collections.map((collection) => ({
      collection,
      count: products.filter((p) => p.collection === collection.slug).length,
      image: collection.hero ?? products.find((p) => p.collection === collection.slug)?.images[0],
    })),
    reviews: reviewHighlights(store),
  };
}

/* ------------------------------------------------------------------ search */

/** Words a search passes over unless nothing else was typed ("headphones for the gym"). */
const STOP_WORDS = new Set(["a", "an", "and", "at", "by", "for", "from", "i", "in", "is", "it", "me", "my", "of", "on", "or", "our", "the", "this", "that", "to", "with", "your"]);

/** Lower-case words: split at anything that is not a letter or a digit, and between digits and letters ("12oz" → "12", "oz"). */
function searchWords(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+|(?<=\p{N})(?=\p{L})|(?<=\p{L})(?=\p{N})/u)
    .filter(Boolean);
}

type SearchField = { text: string; words: string[]; weight: number };

/**
 * What a product can be found by, strongest first: its name; its collection and tags; its option values
 * (and, for a subscription, how it is sold); its summary; its details.
 */
function searchFields(p: Product, collectionName: string): [name: SearchField, ...rest: SearchField[]] {
  const field = (parts: readonly string[], weight: number): SearchField => {
    const text = parts.join(" ").toLowerCase();
    return { text, words: searchWords(text), weight };
  };
  const options = p.options.flatMap((g) => [g.name, ...g.values.map((v) => v.label)]);
  if (p.subscription) options.push("Subscribe & save", "subscription", ...p.subscription.intervals.map((i) => `every ${i}`));
  return [field([p.name], 10), field([collectionName, ...p.tags], 5), field(options, 4), field([p.summary], 2), field(p.details, 1)];
}

/**
 * The products a query finds, best first. A query word matches the start of a word ("cancel" →
 * "cancelling", "anc" → the tag "anc" but not "resistance"); only when nothing matches that way do the
 * words match anywhere inside the text ("phones" → "headphones"), and then every one must.
 *
 * Matching word starts, the words are boosts, not a checklist. A word that only ever names an option
 * value ("black", "12 oz", "whole bean", "every 4 weeks") lifts the products offered in it and never
 * shuts one out. Of the other words, the products matching the most come first, and a product may miss
 * up to a quarter of the words the best match has, so one stray word never empties the results. Then a
 * match in the name counts most, then the collection and tags, the options, the summary and the details.
 */
export function searchProducts(store: StoreDef, products: Product[], q: string): Product[] {
  const typed = [...new Set(searchWords(q))];
  const content = typed.filter((t) => !STOP_WORDS.has(t));
  const terms = (content.length ? content : typed).slice(0, 8);
  if (!terms.length) return [];
  const collectionNames = new Map(store.collections.map((c) => [c.slug, c.name]));
  const index = products.map((p, i) => ({ p, i, fields: searchFields(p, collectionNames.get(p.collection) ?? "") }));
  const byWordStart = rankProducts(index, terms, (f, t) => f.words.some((w) => w.startsWith(t)), false);
  return byWordStart.length ? byWordStart : rankProducts(index, terms, (f, t) => f.text.includes(t), true);
}

function rankProducts(
  index: { p: Product; i: number; fields: [SearchField, ...SearchField[]] }[],
  terms: string[],
  matches: (f: SearchField, term: string) => boolean,
  everyWord: boolean,
): Product[] {
  const anyMatch = (field: number, t: string) => index.some(({ fields }) => fields[field] !== undefined && matches(fields[field], t));
  // A word only an option value carries (none of the names) is an option word: it ranks, it is not counted.
  const named = terms.filter((t) => !(anyMatch(2, t) && !anyMatch(0, t)));
  const counted = new Set(named.length ? named : terms);
  const lead = [...counted].join(" ");
  const scored = index.map(({ p, i, fields }) => {
    let score = 0;
    let matched = 0;
    for (const t of terms) {
      const hits = fields.filter((f) => matches(f, t));
      if (!hits.length) continue;
      score += Math.max(...hits.map((f) => f.weight)) + 0.5 * (hits.length - 1);
      if (counted.has(t)) matched++;
    }
    // The name read from its start is the product the query names ("lull earbuds" → Lull Earbuds).
    if (matched && fields[0].words.join(" ").startsWith(lead)) score += 5;
    return { p, i, score, matched };
  });
  const best = Math.max(0, ...scored.map((s) => s.matched));
  if (!best) return [];
  const need = everyWord ? counted.size : best - Math.floor(best / 4);
  return scored
    .filter((s) => s.matched >= need)
    .sort((a, b) => b.matched - a.matched || b.score - a.score || a.i - b.i)
    .map((s) => s.p);
}

/* ------------------------------------------------------------------ the delivery check */

/** The store-local date ("2026-10-07") and hour (0–23) of an instant. */
export function storeLocal(now: Date, tz = STORE_TZ): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (t: string) => parts.find((x) => x.type === t)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) % 24 };
}

const weekdayMonthDay = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" });

/**
 * The earliest delivery to a ZIP: today before the cutoff (store-local), else tomorrow. The answer says
 * which in words and gives the store's date, so a shopper whose own clock is on another day reads it right:
 * "Delivers to 94107 as soon as tomorrow, Thursday, October 8 (today is Wednesday, October 7, Pacific time)."
 */
export function deliveryCheck(raw: string, cutoffHour: number, now: Date): DeliveryResult {
  const zip = normalizeZip(raw);
  if (!zip) return { ok: false, zip: [...raw.trim()].slice(0, 12).join(""), message: "Enter a 5-digit ZIP code, like 94107." };
  if (!stateForZip(zip)) return { ok: false, zip, message: `We couldn't find ZIP code ${zip}. Check it and try again.` };
  const local = storeLocal(now);
  if (local.hour < cutoffHour) {
    return { ok: true, zip, date: local.date, today: local.date, message: `Delivers to ${zip} as soon as today, ${weekdayMonthDay(local.date)}, when you order by ${hourLabel(cutoffHour)} Pacific time.` };
  }
  const date = addDays(local.date, 1);
  return { ok: true, zip, date, today: local.date, message: `Delivers to ${zip} as soon as tomorrow, ${weekdayMonthDay(date)} (today is ${weekdayMonthDay(local.date)}, Pacific time).` };
}

/* ------------------------------------------------------------------ boundaries */

const queryRecord = z.record(z.union([z.string(), z.array(z.string())])).catch({});
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const all = (v: string | string[] | undefined) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const sortKey = z.enum(["featured", "price-asc", "price-desc", "rating"]).catch("featured");
/** A price filter in dollars: empty, negative or not a number is no filter. */
const dollarsParam = (v: string | undefined) => {
  if (v === undefined || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
};
const emailSchema = z.string().trim().toLowerCase().max(254).email();
const formBody = z.record(z.unknown()).catch({});

/* ------------------------------------------------------------------ the campaign hook */

/** A NUL, or half of a surrogate pair on its own: text Postgres refuses (in a TEXT column and in JSONB alike). */
const UNSTORABLE = /\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const storable = (s: string) => s.search(UNSTORABLE) < 0;

async function recordCampaign(deps: RouteDeps, ws: string, site: StoreId, code: string): Promise<void> {
  if (!storable(code)) {
    // Never a scenario's code: ignored, and logged with the unstorable characters shown as U+FFFD.
    await deps.repos.events.record(ws, site, "campaign_ignored", { code: code.replace(UNSTORABLE, "\uFFFD"), reason: "invalid" });
    return;
  }
  const s = deps.scenarios.byCampaign(code);
  if (!s || s.store !== site) {
    await deps.repos.events.record(ws, site, "campaign_ignored", { code });
    return;
  }
  if (await deps.repos.state.setCampaign(ws, site, code, s.id)) return;
  // Locked by a checkout: the scenario stays as it was. Log a late code, not a repeat of the current one.
  if ((await deps.repos.state.get(ws, site)).campaign !== code) await deps.repos.events.record(ws, site, "campaign_ignored", { code, reason: "locked" });
}

/**
 * utm_campaign on any GET of a store site → this workspace's scenario for the store. A scope-wide
 * preHandler: it runs after the scope resolved the site and before any handler can call req.scenario().
 */
export function registerCampaignHook(scope: FastifyInstance, deps: RouteDeps): void {
  scope.addHook("preHandler", async (req) => {
    if (req.method !== "GET" || !req.store || !req.workspaceId) return;
    const path = sitePath(req);
    if (path.startsWith("/assets/") || path.startsWith("/internal/")) return;
    const raw = first(queryRecord.parse(req.query).utm_campaign);
    // At most 200 characters, cut between characters: never through a surrogate pair.
    const code = raw === undefined ? "" : [...raw.trim().toLowerCase()].slice(0, 200).join("");
    if (code) await recordCampaign(deps, req.workspaceId, req.site as StoreId, code);
  });
}

/* ------------------------------------------------------------------ routes */

type Shop = { ctx: StoreCtx; store: StoreDef; products: Product[]; scenario: ScenarioDef | null };

/** The store, its catalogue as this workspace sees it, and the page context; null (after a 404) on paylantern. */
async function shop(req: FastifyRequest, reply: FastifyReply, deps: RouteDeps): Promise<Shop | null> {
  const store = req.store;
  if (!store) {
    await reply.callNotFound();
    return null;
  }
  const scenario = await req.scenario();
  const ctx = (await pageCtx(req, deps)) as StoreCtx;
  return { ctx, store, products: productsFor(store, scenario, { paylanternUrl: paylanternUrl(ctx.publicBase, req.site) }), scenario };
}

function sortProducts(products: Product[], sort: SortKey): Product[] {
  const indexed = products.map((p, i) => ({ p, i }));
  const by: Record<SortKey, (a: { p: Product; i: number }, b: { p: Product; i: number }) => number> = {
    featured: (a, b) => a.i - b.i,
    "price-asc": (a, b) => a.p.priceCents - b.p.priceCents || a.i - b.i,
    "price-desc": (a, b) => b.p.priceCents - a.p.priceCents || a.i - b.i,
    rating: (a, b) => avgOf(b.p) - avgOf(a.p) || b.p.reviews.length - a.p.reviews.length || a.i - b.i,
  };
  return indexed.sort(by[sort]).map((x) => x.p);
}

/** Every option group offered in a set of products, values in catalogue order, with counts and the shopper's picks. */
function filterGroups(products: Product[], selected: Map<string, string[]>): FilterGroup[] {
  const groups = new Map<string, FilterGroup>();
  for (const p of products) {
    for (const g of p.options) {
      const fg = groups.get(g.id) ?? { id: g.id, name: g.name, values: [] };
      groups.set(g.id, fg);
      for (const v of g.values) {
        let fv = fg.values.find((x) => x.id === v.id);
        if (!fv) {
          fv = { id: v.id, label: v.label, count: 0, checked: (selected.get(g.id) ?? []).includes(v.id) };
          fg.values.push(fv);
        }
        fv.count++;
      }
    }
  }
  return [...groups.values()];
}

export function registerStorefrontRoutes(scope: FastifyInstance, deps: RouteDeps): void {
  scope.get("/", async (req, reply) => {
    const s = await shop(req, reply, deps);
    if (!s) return reply;
    return sendHtml(reply, homePage(s.ctx, homeData(s.store, s.products, s.scenario)));
  });

  scope.get<{ Params: { slug: string } }>("/collections/:slug", async (req, reply) => {
    const s = await shop(req, reply, deps);
    if (!s) return reply;
    const slug = req.params.slug;
    const found: Collection | undefined =
      slug === "all" ? { slug: "all", name: "Shop all", blurb: s.ctx.skin.allProductsBlurb(s.ctx), ...(s.store.brand.heroImage ? { hero: s.store.brand.heroImage } : {}) } : s.store.collections.find((c) => c.slug === slug);
    if (!found) return reply.callNotFound();
    const inCollection = slug === "all" ? s.products : s.products.filter((p) => p.collection === slug);

    const q = queryRecord.parse(req.query);
    const selected = new Map<string, string[]>();
    for (const [k, v] of Object.entries(q)) if (k.startsWith("opt_") && k.length > 4) selected.set(k.slice(4), all(v).filter(Boolean));
    const min = dollarsParam(first(q.min));
    const max = dollarsParam(first(q.max));
    const sort = sortKey.parse(first(q.sort));

    const matching = inCollection.filter(
      (p) =>
        [...selected].every(([g, vals]) => !vals.length || p.options.some((o) => o.id === g && o.values.some((v) => vals.includes(v.id)))) &&
        (min === null || p.priceCents >= Math.round(min * 100)) &&
        (max === null || p.priceCents <= Math.round(max * 100)),
    );
    const sorted = sortProducts(matching, sort);
    const pages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
    const page = Math.min(pages, Math.max(1, Number.parseInt(first(q.page) ?? "1", 10) || 1));

    const params: [string, string][] = [];
    for (const [g, vals] of selected) for (const v of vals) params.push([`opt_${g}`, v]);
    if (min !== null) params.push(["min", String(min)]);
    if (max !== null) params.push(["max", String(max)]);
    if (sort !== "featured") params.push(["sort", sort]);

    const view: CollectionPageView = {
      collection: { ...found, count: inCollection.length },
      products: sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
      total: sorted.length,
      page,
      pages,
      sort,
      groups: filterGroups(inCollection, selected),
      min,
      max,
      params,
    };
    return sendHtml(reply, collectionPage(s.ctx, view));
  });

  scope.get<{ Params: { slug: string } }>("/products/:slug", async (req, reply) => {
    const s = await shop(req, reply, deps);
    if (!s) return reply;
    const p = s.products.find((x) => x.slug === req.params.slug);
    if (!p) return reply.callNotFound();
    const subscribe = !!p.subscription && s.scenario?.mechanisms.defaultSubscribe === true;
    const intervals = p.subscription?.intervals ?? [];
    return sendHtml(
      reply,
      productPage(s.ctx, {
        product: p,
        collection: s.store.collections.find((c) => c.slug === p.collection),
        related: relatedProducts(s.products, p),
        mode: subscribe ? "subscribe" : "once",
        interval: subscribe && intervals.includes("4 weeks") ? "4 weeks" : (intervals[0] ?? null),
      }),
    );
  });

  scope.get("/search", async (req, reply) => {
    const s = await shop(req, reply, deps);
    if (!s) return reply;
    const q = (first(queryRecord.parse(req.query).q) ?? "").slice(0, 200);
    return sendHtml(reply, searchPage(s.ctx, { q, results: searchProducts(s.store, s.products, q) }));
  });

  scope.get("/search/suggest", async (req, reply) => {
    const s = await shop(req, reply, deps);
    if (!s) return reply;
    const q = (first(queryRecord.parse(req.query).q) ?? "").slice(0, 200);
    const items = searchProducts(s.store, s.products, q)
      .slice(0, SUGGEST_LIMIT)
      .map((p) => ({ slug: p.slug, name: p.name, priceCents: p.priceCents, image: p.images[0] ? assetHref(s.ctx, p.images[0]) : "", url: productHref(s.ctx, p) }));
    return reply.header("cache-control", "private, no-cache").send({ items });
  });

  scope.get<{ Params: { slug: string } }>("/pages/:slug", async (req, reply) => {
    const s = await shop(req, reply, deps);
    if (!s) return reply;
    if (!isPolicyKey(req.params.slug)) return reply.callNotFound();
    return sendHtml(reply, policyPage(s.ctx, req.params.slug));
  });

  scope.post("/newsletter", async (req, reply) => {
    const s = await shop(req, reply, deps);
    if (!s) return reply;
    const raw = formBody.parse(req.body).email;
    const email = emailSchema.safeParse(typeof raw === "string" ? raw : "");
    if (!email.success) {
      const message = "Enter a valid email address, like name@example.com.";
      if (wantsJson(req)) return reply.code(422).send({ ok: false, error: "INVALID_EMAIL", message });
      return sendHtml(reply, newsletterThanksPage(s.ctx, { state: "form", error: message }), 422);
    }
    await deps.repos.state.setNewsletter(req.workspaceId, req.site, email.data);
    if (wantsJson(req)) return reply.send({ ok: true, code: NEWSLETTER_CODE, message: `You're on the list. Use ${NEWSLETTER_CODE} for 10% off your first order.` });
    return reply.redirect(`${req.prefix}/newsletter/thanks`, 303);
  });

  scope.get("/newsletter/thanks", async (req, reply) => {
    const s = await shop(req, reply, deps);
    if (!s) return reply;
    // StateRepo has no reader for the newsletter column; this one read stays here, scoped like the repo's.
    const r = await deps.pool.query<{ newsletter: string | null }>("SELECT newsletter FROM shops.store_state WHERE workspace_id = $1 AND store = $2", [req.workspaceId, req.site]);
    const email = r.rows[0]?.newsletter ?? null;
    return sendHtml(reply, newsletterThanksPage(s.ctx, email ? { state: "subscribed", email, code: NEWSLETTER_CODE } : { state: "form" }));
  });

  scope.get("/delivery-check", async (req, reply) => {
    const s = await shop(req, reply, deps);
    if (!s) return reply;
    if (!s.store.delivery) return reply.callNotFound();
    const zip = first(queryRecord.parse(req.query).zip) ?? "";
    const result = deliveryCheck(zip, s.store.delivery.cutoffHourLocal, deps.now());
    if (wantsJson(req)) return reply.code(result.ok ? 200 : 422).header("cache-control", "private, no-cache").send(result);
    return sendHtml(reply, deliveryCheckPage(s.ctx, result), result.ok ? 200 : 422);
  });

  scope.get("/account", async (req, reply) => {
    const s = await shop(req, reply, deps);
    if (!s) return reply;
    return sendHtml(reply, accountPage(s.ctx));
  });

  scope.post("/account/sign-in", async (req, reply) => {
    const s = await shop(req, reply, deps);
    if (!s) return reply;
    const raw = formBody.parse(req.body).email;
    const email = typeof raw === "string" ? raw.trim().slice(0, 254) : "";
    return sendHtml(reply, accountPage(s.ctx, { email, error: "We couldn't find an account with that email and password. You can check out as a guest without one." }), 401);
  });
}

/** For the sort menu and tests: the sort keys a collection accepts. */
export const SORT_KEYS: readonly SortKey[] = SORTS.map((x) => x.key);
