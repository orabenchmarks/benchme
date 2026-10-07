import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { computeTotals, formatUsd, type Brand, type PolicyKey, type Product, type StoreDef } from "@benchme/storefront";
import { z } from "zod";

/**
 * The content contract every store catalogue keeps: what makes it read as a real, consistent shop
 * (sizes, copy, reviews, prices, stock, licensed photographs, brand). Violations come back as plain
 * sentences so an author can fix a catalogue without reading this file. Nothing here knows any task.
 */

/** One photograph's provenance, as tools/fetch-images.mjs records it in public/img/<store>/manifest.json. */
export const manifestEntrySchema = z
  .object({
    /** The image's slug: the photo is img/<store>/<file>.jpg. */
    file: z.string().min(1),
    /** The photo's landing page. */
    source: z.string().url(),
    creator: z.string(),
    /** "cc0" or "pdm"; anything else breaks the contract. */
    license: z.string(),
    /** The title the photo is published under at its source, as given there. */
    title: z.string(),
    provider: z.string(),
    /** How the photo here differs from the source's (a retouch, a crop), when it does. */
    edited: z.string().optional(),
  })
  .strict();
export type ManifestEntry = z.infer<typeof manifestEntrySchema>;

type StoreId = StoreDef["id"];
const NAMES: Record<StoreId, string> = { wrenfield: "Wrenfield Flowers", halden: "Halden Audio", quillfeather: "Quillfeather Coffee" };
const PREFIXES: Record<StoreId, StoreDef["orderPrefix"]> = { wrenfield: "WF", halden: "HA", quillfeather: "QF" };
const SURFACES: Record<StoreId, StoreDef["defaultSurface"]> = { wrenfield: "payment-element", halden: "checkout", quillfeather: "express-checkout" };
const POLICY_KEYS: readonly PolicyKey[] = ["shipping", "returns", "privacy", "terms", "faq", "about", "contact"];
const COLOUR_TOKENS = ["bg", "fg", "muted", "accent", "accentFg", "surface", "border"] as const;
const LICENSES = ["cc0", "pdm"];
/** Review dates: from the stores' (fictional) opening to the day the catalogues were frozen. */
const REVIEWS_FROM = "2025-01-01";
const REVIEWS_TO = "2026-10-06";
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const CSS_LENGTH = /^(?:0|\d+(?:\.\d+)?(?:px|rem|em))$/;

const wholeCents = (n: number) => Number.isInteger(n) && n >= 0;
const positiveCents = (n: number) => Number.isInteger(n) && n > 0;
/** Shop prices end in .00, .95 or .99. */
const shopPrice = (n: number) => [0, 95, 99].includes(n % 100);
const wordCount = (s: string) => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
/** "$75" for a whole-dollar amount, "$75.50" otherwise — the way an announcement bar writes it. */
const dollars = (cents: number) => (cents % 100 === 0 ? `$${cents / 100}` : formatUsd(cents));

function duplicates<T>(xs: readonly T[]): T[] {
  const seen = new Set<T>();
  const dup = new Set<T>();
  for (const x of xs) (seen.has(x) ? dup : seen).add(x);
  return [...dup];
}

/** Ends in . ! or ? and has no sentence break (a terminal mark, then a space and a capital or digit) inside. */
function isOneSentence(s: string): boolean {
  const t = s.trim();
  return /[.!?]["'”’)]?$/.test(t) && !/[.!?]["'”’)]?\s+["'“‘(]?[A-Z0-9]/.test(t);
}

function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function isNonEmptyFile(path: string): boolean {
  try {
    const st = statSync(path);
    return st.isFile() && st.size > 0;
  } catch {
    return false;
  }
}

/** The family names a Google Fonts stylesheet URL loads (css2 or css), or null when it is not one. */
function googleFamilies(href: string): string[] | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname !== "fonts.googleapis.com") return null;
  return url.searchParams
    .getAll("family")
    .flatMap((f) => f.split("|"))
    .map((f) => (f.split(":")[0] ?? "").trim());
}

/** The first family of a CSS font stack: `'Inter', sans-serif` → `Inter`. */
const firstFamily = (stack: string) => (stack.split(",")[0] ?? "").trim().replace(/^["']|["']$/g, "");

/**
 * A store's photo manifest. `entries` is null when there is nothing usable to look images up in
 * (missing, not JSON, not an array) — the one problem says so, instead of one per image.
 */
export function readManifest(publicDir: string, storeId: string): { entries: ManifestEntry[] | null; problems: string[] } {
  const rel = `img/${storeId}/manifest.json`;
  const path = join(publicDir, rel);
  if (!existsSync(path)) return { entries: null, problems: [`${rel} is missing (apps/shops/tools/fetch-images.mjs ${storeId} writes it)`] };
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return { entries: null, problems: [`${rel} is not valid JSON`] };
  }
  if (!Array.isArray(json)) return { entries: null, problems: [`${rel} is not an array of entries`] };
  const entries: ManifestEntry[] = [];
  const problems: string[] = [];
  json.forEach((raw, i) => {
    const parsed = manifestEntrySchema.safeParse(raw);
    if (parsed.success) entries.push(parsed.data);
    else problems.push(`${rel} entry ${i} is invalid: ${parsed.error.issues.map((x) => `${x.path.join(".") || "entry"}: ${x.message}`).join("; ")}`);
  });
  for (const f of duplicates(entries.map((e) => e.file))) problems.push(`${rel} lists "${f}" more than once`);
  return { entries, problems };
}

/** What every site's brand (the stores and PayLantern) needs to render as its own product. */
export function brandInvariantErrors(brand: Brand): string[] {
  const errors: string[] = [];
  for (const k of ["name", "tagline", "announcement", "supportEmail", "supportPhone"] as const) {
    if (!brand[k].trim()) errors.push(`brand.${k} is empty`);
  }
  if (brand.supportEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(brand.supportEmail)) {
    errors.push(`brand.supportEmail "${brand.supportEmail}" is not an email address`);
  }
  const svg = brand.logoSvg.trim();
  if (!svg.startsWith("<svg") || !svg.endsWith("</svg>") || /<script|\son[a-z]+\s*=/i.test(svg)) {
    errors.push("brand.logoSvg is not an inline <svg>…</svg> without scripts");
  }
  const families = googleFamilies(brand.fonts.href);
  if (!families) errors.push(`brand.fonts.href "${brand.fonts.href}" is not an https://fonts.googleapis.com URL`);
  else {
    for (const k of ["display", "body"] as const) {
      const family = firstFamily(brand.fonts[k]);
      if (!families.includes(family)) errors.push(`brand.fonts.${k} "${family}" is not loaded by brand.fonts.href`);
    }
  }
  for (const k of COLOUR_TOKENS) if (!HEX.test(brand.tokens[k])) errors.push(`brand.tokens.${k} "${brand.tokens[k]}" is not a hex colour`);
  if (!CSS_LENGTH.test(brand.tokens.radius)) errors.push(`brand.tokens.radius "${brand.tokens.radius}" is not a CSS length`);
  return errors;
}

/** One value per option group — the first that is not sold out — as a shopper's default pick. */
function defaultOptions(p: Product): Record<string, string> {
  const picked: Record<string, string> = {};
  for (const g of p.options) {
    const v = g.values.find((x) => !x.soldOut) ?? g.values[0];
    if (v) picked[g.id] = v.id;
  }
  return picked;
}

/**
 * Every way `store` breaks the content contract, as readable sentences (empty = it keeps it).
 * Image paths are relative to `publicDir` (apps/shops/public): "img/<store>/<file>.jpg", on disk
 * and listed in that store's manifest under a CC0 or public-domain mark.
 */
export function storeInvariantErrors(store: StoreDef, publicDir: string): string[] {
  const errors: string[] = [];
  const err = (msg: string) => void errors.push(msg);
  const { brand, collections, products, addOns, shipping } = store;
  const prefix = PREFIXES[store.id];

  // Identity: the name, order prefix and default payment surface belong to the store id.
  if (brand.name !== NAMES[store.id]) err(`brand.name is "${brand.name}" (want "${NAMES[store.id]}")`);
  if (store.orderPrefix !== prefix) err(`orderPrefix is "${store.orderPrefix}" (want "${prefix}")`);
  if (store.defaultSurface !== SURFACES[store.id]) err(`defaultSurface is "${store.defaultSurface}" (want "${SURFACES[store.id]}")`);
  for (const e of brandInvariantErrors(brand)) if (!e.startsWith("brand.name ")) err(e);

  // Photographs: on disk, under this store, licensed CC0 or public domain in the manifest.
  const manifest = readManifest(publicDir, store.id);
  manifest.problems.forEach(err);
  const pathShape = new RegExp(`^img/${store.id}/([a-z0-9]+(?:-[a-z0-9]+)*)\\.(?:jpe?g|png|webp)$`);
  const checkImage = (where: string, path: string) => {
    const m = pathShape.exec(path);
    if (!m) return err(`${where}: image "${path}" is not img/${store.id}/<file>.jpg`);
    if (!isNonEmptyFile(join(publicDir, path))) err(`${where}: image "${path}" is missing or empty in public/`);
    if (!manifest.entries) return;
    const base = path.slice(path.lastIndexOf("/") + 1);
    const listed = manifest.entries.find((e) => e.file === m[1] || e.file === base);
    if (!listed) err(`${where}: image "${path}" is not listed in img/${store.id}/manifest.json`);
    else if (!LICENSES.includes(listed.license.toLowerCase())) err(`${where}: image "${path}" is licensed "${listed.license}" (want cc0 or pdm)`);
  };

  // The home page's hero, when the brand names one.
  if (store.brand.heroImage !== undefined) checkImage("brand hero", store.brand.heroImage);

  // Collections.
  if (collections.length < 3 || collections.length > 5) err(`${collections.length} collections (want 3–5)`);
  for (const s of duplicates(collections.map((c) => c.slug))) err(`duplicate collection slug "${s}"`);
  for (const c of collections) {
    const at = `collection "${c.slug}"`;
    if (!SLUG.test(c.slug)) err(`collection slug "${c.slug}" is not a lowercase slug`);
    if (!c.name.trim()) err(`${at}: name is empty`);
    if (!c.blurb.trim()) err(`${at}: blurb is empty`);
    if (!products.some((p) => p.collection === c.slug)) err(`${at} has no products`);
    if (c.hero !== undefined) checkImage(at, c.hero);
  }

  // Products: size of the catalogue and its ids.
  if (products.length < 18 || products.length > 24) err(`${products.length} products (want 18–24)`);
  const skus = [...products.map((p) => p.sku), ...addOns.map((a) => a.sku)];
  for (const s of duplicates(skus)) err(`duplicate sku "${s}"`);
  for (const s of duplicates(products.map((p) => p.slug))) err(`duplicate product slug "${s}"`);
  const skuShape = new RegExp(`^${prefix}-[A-Z0-9]+(?:-[A-Z0-9]+)*$`);
  for (const s of skus) if (!skuShape.test(s)) err(`sku "${s}" is not an upper-case id starting with "${prefix}-"`);
  const collectionSlugs = new Set(collections.map((c) => c.slug));

  for (const p of products) {
    const at = `product "${p.slug}"`;
    if (!SLUG.test(p.slug)) err(`product slug "${p.slug}" is not a lowercase slug`);
    if (!collectionSlugs.has(p.collection)) err(`${at}: collection "${p.collection}" does not exist`);
    if (!p.name.trim()) err(`${at}: name is empty`);

    if (!positiveCents(p.priceCents)) err(`${at}: price ${p.priceCents} is not a positive whole number of cents`);
    else if (!shopPrice(p.priceCents)) err(`${at}: price ${formatUsd(p.priceCents)} does not end in .00, .95 or .99`);
    if (p.compareAtCents !== undefined && !(positiveCents(p.compareAtCents) && p.compareAtCents > p.priceCents && shopPrice(p.compareAtCents))) {
      err(`${at}: compare-at price ${p.compareAtCents} is not above the price or does not end in .00, .95 or .99`);
    }

    if (!isOneSentence(p.summary)) err(`${at}: summary is not one sentence`);
    const words = wordCount(p.description);
    if (words < 60 || words > 150) err(`${at}: description has ${words} words (want 60–150)`);
    if (p.details.length < 3 || p.details.length > 6) err(`${at}: ${p.details.length} details (want 3–6)`);
    if (p.details.some((d) => !d.trim())) err(`${at}: a detail is empty`);

    if (p.images.length < 1 || p.images.length > 3) err(`${at}: ${p.images.length} images (want 1–3)`);
    for (const img of p.images) checkImage(at, img);

    for (const g of duplicates(p.options.map((o) => o.id))) err(`${at}: option "${g}" appears twice`);
    for (const g of p.options) {
      if (!SLUG.test(g.id)) err(`${at}: option id "${g.id}" is not a lowercase slug`);
      if (!g.name.trim() || g.values.some((v) => !v.label.trim())) err(`${at}: option "${g.id}" has an empty name or value label`);
      if (g.values.length === 0) err(`${at}: option "${g.id}" has no values`);
      for (const v of duplicates(g.values.map((x) => x.id))) err(`${at}: option "${g.id}" repeats value "${v}"`);
      for (const v of g.values) {
        if (!SLUG.test(v.id)) err(`${at}: option "${g.id}" value id "${v.id}" is not a lowercase slug`);
        if (v.priceDeltaCents !== undefined && !positiveCents(v.priceDeltaCents)) {
          err(`${at}: option "${g.id}" value "${v.id}" has a price delta of ${v.priceDeltaCents} (want a positive whole number of cents)`);
        }
      }
    }

    const n = p.reviews.length;
    if (n < 3 || n > 8) err(`${at}: ${n} reviews (want 3–8)`);
    p.reviews.forEach((r, i) => {
      const rv = `${at}: review ${i + 1}`;
      if (!isIsoDate(r.date)) err(`${rv} date "${r.date}" is not an ISO date (YYYY-MM-DD)`);
      else if (r.date < REVIEWS_FROM || r.date > REVIEWS_TO) err(`${rv} date ${r.date} is outside ${REVIEWS_FROM}..${REVIEWS_TO}`);
      if (!(Number.isInteger(r.rating) && r.rating >= 1 && r.rating <= 5)) err(`${rv} rating ${r.rating} is not 1–5`);
      if (!r.author.trim() || !r.title.trim() || !r.body.trim()) err(`${rv} has an empty author, title or body`);
    });
    if (n > 0) {
      const sum = p.reviews.reduce((a, r) => a + r.rating, 0);
      // 3.5 ≤ sum / n ≤ 4.8, in integers.
      if (sum * 10 < 35 * n || sum * 10 > 48 * n) err(`${at}: average rating ${(sum / n).toFixed(2)} (want 3.5–4.8)`);
    }
    if (n > 1 && new Set(p.reviews.map((r) => r.rating)).size === 1) err(`${at}: every review is rated ${p.reviews[0]?.rating} (want mixed ratings)`);

    if (!(Number.isInteger(p.stock) && p.stock >= 0 && p.stock <= 40)) err(`${at}: stock ${p.stock} is not a whole number 0–40`);

    if (p.subscription) {
      const { savePct, intervals } = p.subscription;
      if (!(Number.isInteger(savePct) && savePct >= 1 && savePct <= 99)) err(`${at}: subscription savePct ${savePct} is not 1–99`);
      if (intervals.length === 0 || duplicates(intervals).length > 0 || intervals.some((x) => !x.trim())) err(`${at}: subscription intervals must be distinct and non-empty`);
    }
  }
  const low = products.filter((p) => p.stock <= 5).length;
  if (low < 2 || low > 3) err(`${low} products at stock ≤ 5 (want 2–3)`);

  // Add-ons.
  for (const a of addOns) {
    const at = `add-on "${a.sku}"`;
    if (!positiveCents(a.priceCents)) err(`${at}: price ${a.priceCents} is not a positive whole number of cents`);
    if (!a.name.trim() || !a.description.trim()) err(`${at}: name or description is empty`);
    if (a.image !== undefined) checkImage(at, a.image);
  }

  // Shipping, and the free-shipping threshold the announcement and nudges quote.
  if (shipping.length !== 2) err(`${shipping.length} shipping methods (want 2)`);
  for (const s of duplicates(shipping.map((m) => m.id))) err(`duplicate shipping method "${s}"`);
  for (const m of shipping) {
    const at = `shipping method "${m.id}"`;
    if (!m.label.trim()) err(`${at}: label is empty`);
    if (!wholeCents(m.priceCents)) err(`${at}: price ${m.priceCents} is not a whole number of cents ≥ 0`);
    const [lo, hi] = m.days;
    if (!(Number.isInteger(lo) && Number.isInteger(hi) && lo >= 0 && lo <= hi)) err(`${at}: days [${lo}, ${hi}] is not a range of whole days`);
  }
  const freeOver = [...new Set(shipping.flatMap((m) => (m.freeOverCents === undefined ? [] : [m.freeOverCents])))];
  if (freeOver.length > 1 || freeOver[0] !== store.freeShippingOverCents) {
    const declared = store.freeShippingOverCents === undefined ? "unset" : formatUsd(store.freeShippingOverCents);
    const methods = freeOver.length ? freeOver.map(formatUsd).join(", ") : "nothing";
    err(`free-shipping threshold: freeShippingOverCents is ${declared} but the shipping methods are free over ${methods} (they must agree)`);
  }
  const threshold = store.freeShippingOverCents ?? freeOver[0];
  if (threshold !== undefined && !brand.announcement.includes(dollars(threshold))) {
    err(`brand.announcement does not mention the free-shipping threshold (${dollars(threshold)})`);
  }

  // Promo codes: shoppers' input is upper-cased before the lookup; the newsletter's WELCOME10 is everywhere.
  for (const [code, promo] of Object.entries(store.promoCodes)) {
    if (!code.trim() || code !== code.trim().toUpperCase()) err(`promo code "${code}" is not upper-case (codes are looked up upper-cased)`);
    const pct = promo.pctBp ?? 0;
    const off = promo.offCents ?? 0;
    if (!(Number.isInteger(pct) && pct >= 0 && pct <= 10_000 && wholeCents(off) && pct + off > 0)) {
      err(`promo code "${code}" gives no discount (want pctBp 1–10000 or offCents > 0)`);
    }
  }
  const welcome = store.promoCodes["WELCOME10"];
  if (!welcome) err("promo code WELCOME10 is missing");
  else if (welcome.pctBp !== 1000 || (welcome.offCents ?? 0) !== 0 || (welcome.minSubtotalCents ?? 0) !== 0) {
    err("promo code WELCOME10 must be 10 % off (pctBp 1000) with no minimum and no fixed amount");
  }

  for (const k of POLICY_KEYS) if (!store.policies[k].trim()) err(`policy "${k}" is empty`);

  if (store.delivery) {
    const { sameDayFeeCents, cutoffHourLocal } = store.delivery;
    if (!positiveCents(sameDayFeeCents)) err(`delivery.sameDayFeeCents ${sameDayFeeCents} is not a positive whole number of cents`);
    if (!(Number.isInteger(cutoffHourLocal) && cutoffHourLocal >= 0 && cutoffHourLocal <= 23)) err(`delivery.cutoffHourLocal ${cutoffHourLocal} is not an hour 0–23`);
  }

  // Every product, alone in a cart to California, totals a positive amount with every shipping method.
  for (const m of shipping) {
    const bad = products.filter((p) => {
      try {
        const t = computeTotals({ store, lines: [{ sku: p.sku, options: defaultOptions(p), qty: 1 }], addOns: [], shippingId: m.id, state: "CA", promo: null });
        return !positiveCents(t.totalCents);
      } catch {
        return true;
      }
    });
    if (bad.length) {
      const more = bad.length > 1 ? ` and ${bad.length - 1} more` : "";
      err(`shipping "${m.id}": one unit of "${bad[0]?.slug}"${more} to CA does not total a positive whole number of cents`);
    }
  }

  return errors;
}
