/**
 * The cart of a store, exactly as the contract at the top of routes/storefront.ts documents it (the
 * product page's form and store.js's drawer rely on it), plus the cart page and the promo code.
 *
 *   GET  /cart              the cart page (lines, quantities, the code field, "Check out")
 *   GET  /cart.json         CartJson, for the drawer — plus `recovered` { orderNo, message, url } when the store has just
 *                           recorded the order of a payment whose return page never loaded (routes/recovered.ts): the
 *                           drawer shows the notice and links the order
 *   POST /cart/add          sku, opt_<group>, qty, mode, interval  → 303 /cart | CartJson; 422 with a sentence (a
 *                           qty that is not a whole number from 1 to 10; none typed is 1)
 *   POST /cart/update       key, qty (0 removes)  → 303 /cart | CartJson; 422 for a qty that is not a whole number ≥ 0
 *   POST /cart/remove       key  → 303 /cart | CartJson
 *   POST /cart/promo        code (or remove=1)  → 303 /cart (?promo=… or ?promo_error=…) | CartJson + {promo, discountCents}; 422
 *
 * A line holds at most ten, or the stock left: an add or an update asking for more leaves it at its most and
 * says so — CartJson's `notice` for the drawer, the cart page's notice (303 /cart?capped=<line key>) for a form.
 *
 * A request with "Accept: application/json" is answered with JSON; anything else is a browser
 * posting a form. The applied code lives on the cart (CartsRepo `promo`) and is priced by
 * computeTotals wherever totals are shown; only codes the store knows are kept. A known code whose
 * minimum order is not met stays applied (it starts counting once the order is big enough) and the
 * pages say what it needs.
 */
import { addLine, computeTotals, lineKey, removeLine, setQty, type CartLine, type Product, type StoreDef } from "@benchme/storefront";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { assetHref, dollars, optionsLabel, productHref } from "../render/components.js";
import type { StoreCtx } from "../render/layout.js";
import { cartPage, type CartPageView } from "../render/pages/cart.js";
import { storableText, truncateText } from "../text.js";
import type { RouteDeps } from "./index.js";
import { recoveredFor } from "./recovered.js";
import { pageCtx, sendHtml, wantsJson } from "./storefront.js";

/** The most of one line a cart holds (the product page's stepper stops there too). */
export const MAX_QTY = 10;

/* ------------------------------------------------------------------ reading form bodies */

/** A form or JSON body as a record; anything else is an empty one. */
export const formBody = z.record(z.unknown()).catch({});

/**
 * One field of a form or JSON body as text: the first of a repeated field, numbers as digits, anything
 * else "". Always storable (text.ts): no NUL, no half of a surrogate pair.
 */
export function field(body: Record<string, unknown>, name: string): string {
  const v = body[name];
  const one = Array.isArray(v) ? v[0] : v;
  return typeof one === "string" ? storableText(one) : typeof one === "number" && Number.isFinite(one) ? String(one) : "";
}

/** Every value of a repeated field (checkboxes), as storable text. */
export function fieldAll(body: Record<string, unknown>, name: string): string[] {
  const v = body[name];
  return (Array.isArray(v) ? v : v === undefined ? [] : [v]).filter((x): x is string => typeof x === "string").map(storableText);
}

/** A typed quantity: a whole number (of any size, a sign allowed), "missing" when nothing was typed, or null for anything else. */
function readQty(raw: string): number | "missing" | null {
  const s = raw.trim();
  if (!s) return "missing";
  return /^[+-]?\d+$/.test(s) ? Number(s) : null;
}

/* ------------------------------------------------------------------ the cart's shape */

export type CartJsonLine = { key: string; name: string; image: string; optionsLabel: string; qty: number; unitCents: number; totalCents: number; url: string };
export type CartJson = { lines: CartJsonLine[]; subtotalCents: number; count: number };

/** The lines the catalogue still sells: a line whose SKU is gone is neither shown nor priced. */
export function liveLines(store: StoreDef, lines: CartLine[]): CartLine[] {
  return lines.filter((l) => l.qty > 0 && store.products.some((p) => p.sku === l.sku));
}

const productFor = (store: StoreDef, sku: string): Product | undefined => store.products.find((p) => p.sku === sku);

/** How many of a product one line may hold: ten, or the stock left when that is less. */
const maxQtyOf = (p: Product | undefined) => Math.max(1, Math.min(MAX_QTY, p?.stock ?? MAX_QTY));

/**
 * What a line held at its most says, after an add or an update asked for more:
 * "We have only 4 of Skerry DJ Headphones in stock, so your cart has 4." or
 * "You can buy up to 10 of Soft Carry Case in one order, so your cart has 10."
 */
export function limitNotice(store: StoreDef, line: CartLine): string {
  const p = productFor(store, line.sku);
  const opts = optionsLabel(p, line);
  const name = `${p?.name ?? line.sku}${opts ? ` (${opts})` : ""}`;
  return p && p.stock < MAX_QTY
    ? `We have only ${p.stock} of ${name} in stock, so your cart has ${line.qty}.`
    : `You can buy up to ${MAX_QTY} of ${name} in one order, so your cart has ${line.qty}.`;
}

/** The cart as store.js and the cart page read it. */
export function cartJson(ctx: Pick<StoreCtx, "prefix">, store: StoreDef, raw: CartLine[]): CartJson {
  const lines = liveLines(store, raw);
  const totals = computeTotals({ store, lines, addOns: [], shippingId: null, state: null, promo: null });
  const out = lines.map((l, i) => {
    const p = productFor(store, l.sku) as Product;
    const t = totals.lines[i] as (typeof totals.lines)[number];
    return {
      key: lineKey(l),
      name: p.name,
      image: p.images[0] ? assetHref(ctx, p.images[0]) : "",
      optionsLabel: optionsLabel(p, l),
      qty: l.qty,
      unitCents: t.unitCents,
      totalCents: t.totalCents,
      url: productHref(ctx, p),
    };
  });
  return { lines: out, subtotalCents: totals.subtotalCents, count: lines.reduce((a, l) => a + l.qty, 0) };
}

/* ------------------------------------------------------------------ adding a line */

type AddError = { error: "UNKNOWN_SKU" | "SOLD_OUT" | "INVALID"; message: string; product?: Product };

/** A form's (or store.js's) add-to-cart request as a cart line, or the sentence that says why not. */
export function lineFromForm(store: StoreDef, body: Record<string, unknown>): { line: CartLine; product: Product } | AddError {
  const sku = field(body, "sku").trim();
  const p = productFor(store, sku);
  if (!p) return { error: "UNKNOWN_SKU", message: "We couldn't find that product. It may no longer be available." };
  if (p.stock <= 0) return { error: "SOLD_OUT", message: `${p.name} is sold out.`, product: p };
  for (const k of Object.keys(body)) {
    if (k.startsWith("opt_") && !p.options.some((g) => `opt_${g.id}` === k)) return { error: "INVALID", message: `${p.name} has no option "${k.slice(4)}".`, product: p };
  }
  const options: Record<string, string> = {};
  for (const g of p.options) {
    const id = field(body, `opt_${g.id}`).trim();
    const group = g.name.toLowerCase();
    if (!id) return { error: "INVALID", message: `Choose a ${group} for ${p.name}.`, product: p };
    const v = g.values.find((x) => x.id === id);
    if (!v) return { error: "INVALID", message: `${p.name} doesn't come in that ${group}. Choose ${g.values.map((x) => x.label).join(", ")}.`, product: p };
    if (v.soldOut) return { error: "SOLD_OUT", message: `${p.name} in ${v.label} is sold out. Choose another ${group}.`, product: p };
    options[g.id] = v.id;
  }
  const mode = field(body, "mode").trim() || "once";
  if (mode !== "once" && mode !== "subscribe") return { error: "INVALID", message: "Choose one-time purchase or subscribe & save.", product: p };
  // Nothing typed is one (the product page's stepper starts there); anything but a whole number from 1 to 10
  // is refused. More than the stock allows is the route's to cap, with a notice.
  const asked = readQty(field(body, "qty"));
  if (asked === null || (asked !== "missing" && (asked < 1 || asked > MAX_QTY))) return { error: "INVALID", message: `Choose a quantity from 1 to ${maxQtyOf(p)}.`, product: p };
  const qty = asked === "missing" ? 1 : asked;
  if (mode === "once") return { line: { sku: p.sku, options, qty, ...(p.subscription ? { mode: "once" as const } : {}) }, product: p };
  if (!p.subscription) return { error: "INVALID", message: `${p.name} isn't sold by subscription.`, product: p };
  const interval = field(body, "interval").trim();
  if (!p.subscription.intervals.includes(interval)) {
    return { error: "INVALID", message: `Choose how often it comes: every ${p.subscription.intervals.join(", ")}.`, product: p };
  }
  return { line: { sku: p.sku, options, qty, mode: "subscribe", interval }, product: p };
}

/* ------------------------------------------------------------------ promo codes */

export type PromoCheck = { ok: true; code: string } | { ok: false; error: "EMPTY_CODE" | "INVALID_CODE"; message: string; code: string };

/** A typed code as the store reads it: trimmed, upper case, and known to the store — or why not. */
export function checkPromo(store: StoreDef, raw: string): PromoCheck {
  const code = truncateText(storableText(raw).trim().toUpperCase(), 40);
  if (!code) return { ok: false, error: "EMPTY_CODE", message: "Enter a discount code.", code };
  if (!Object.hasOwn(store.promoCodes, code)) return { ok: false, error: "INVALID_CODE", message: "This code isn't valid. Check it and try again.", code };
  return { ok: true, code };
}

/** What an applied code still needs, when its minimum order is not met: "SPRING15 applies to orders of $50 or more." */
export function promoNote(store: StoreDef, code: string | null, subtotalCents: number): string | null {
  if (!code) return null;
  const rule = store.promoCodes[code];
  if (!rule?.minSubtotalCents || subtotalCents >= rule.minSubtotalCents) return null;
  return `${code} applies to orders of ${dollars(rule.minSubtotalCents)} or more.`;
}

/* ------------------------------------------------------------------ routes */

/** The store of a store site, or null after answering 404 (paylantern has no cart). */
async function storeOf(req: FastifyRequest, reply: FastifyReply): Promise<StoreDef | null> {
  if (req.store) return req.store;
  await reply.callNotFound();
  return null;
}

/**
 * The query flags the cart page shows once: a code applied, refused or removed; `capped`, the key of a line an
 * add or an update asked more of than it may hold (its limitNotice, while the line is still at its most).
 */
const flashQuery = z
  .object({
    promo: z.enum(["applied", "removed"]).optional(),
    promo_error: z.enum(["invalid", "empty"]).optional(),
    code: z.string().max(40).optional(),
    capped: z.string().max(500).optional(),
  })
  .catch({});

async function renderCart(req: FastifyRequest, reply: FastifyReply, deps: RouteDeps, store: StoreDef, extra: { error?: CartPageView["error"]; status?: number } = {}): Promise<FastifyReply> {
  const ctx = (await pageCtx(req, deps)) as StoreCtx;
  const cart = await deps.repos.carts.get(req.workspaceId, req.site);
  const lines = liveLines(store, cart.lines);
  const totals = computeTotals({ store, lines, addOns: [], shippingId: null, state: null, promo: cart.promo });
  const json = cartJson(ctx, store, lines);
  const q = flashQuery.parse(req.query);
  const capped = q.capped === undefined ? undefined : lines.find((l) => lineKey(l) === q.capped && l.qty >= maxQtyOf(productFor(store, l.sku)));
  const view: CartPageView = {
    lines: json.lines.map((l, i) => ({ ...l, maxQty: maxQtyOf(productFor(store, (lines[i] as CartLine).sku)) })),
    totals,
    promo: cart.promo,
    promoNote: promoNote(store, cart.promo, totals.subtotalCents),
    promoError: q.promo_error ? { message: q.promo_error === "empty" ? "Enter a discount code." : "This code isn't valid. Check it and try again.", code: q.code ?? "" } : null,
    notice: q.promo === "applied" && cart.promo ? `${cart.promo} is applied to your order.` : q.promo === "removed" ? "The code was removed." : null,
    limit: capped ? limitNotice(store, capped) : null,
    error: extra.error ?? null,
  };
  return sendHtml(reply, cartPage(ctx, view), extra.status ?? 200);
}

/**
 * After a change: the cart as JSON for store.js (with `notice` when a line was held at its most), or back to
 * the cart page for a form (which then shows that notice, from `capped`).
 */
async function answer(req: FastifyRequest, reply: FastifyReply, deps: RouteDeps, store: StoreDef, capped: CartLine | null = null): Promise<FastifyReply> {
  const lines = liveLines(store, (await deps.repos.carts.get(req.workspaceId, req.site)).lines);
  const held = capped ? (lines.find((l) => lineKey(l) === lineKey(capped)) ?? null) : null;
  if (wantsJson(req)) {
    const ctx = await pageCtx(req, deps);
    return reply.header("cache-control", "private, no-cache").send({ ...cartJson(ctx, store, lines), ...(held ? { notice: limitNotice(store, held) } : {}) });
  }
  return reply.redirect(`${req.prefix}/cart${held ? `?capped=${encodeURIComponent(lineKey(held))}` : ""}`, 303);
}

/** A refused quantity: 422 with the sentence, as JSON for store.js or on the cart page for a form. */
async function refuseQty(req: FastifyRequest, reply: FastifyReply, deps: RouteDeps, store: StoreDef, message: string, product?: Product): Promise<FastifyReply> {
  if (wantsJson(req)) return reply.code(422).send({ error: "INVALID", message });
  const ctx = { prefix: req.prefix };
  return renderCart(req, reply, deps, store, { status: 422, error: { message, ...(product ? { product: { name: product.name, url: productHref(ctx, product) } } : {}) } });
}

export function registerCartRoutes(scope: FastifyInstance, deps: RouteDeps): void {
  const carts = deps.repos.carts;

  scope.get("/cart", async (req, reply) => {
    const store = await storeOf(req, reply);
    if (!store) return reply;
    return renderCart(req, reply, deps, store);
  });

  scope.get("/cart.json", async (req, reply) => {
    const store = await storeOf(req, reply);
    if (!store) return reply;
    const ctx = await pageCtx(req, deps);
    const recovered = recoveredFor(req);
    return reply.header("cache-control", "private, no-cache").send({ ...cartJson(ctx, store, (await carts.get(req.workspaceId, req.site)).lines), ...(recovered ? { recovered } : {}) });
  });

  scope.post("/cart/add", async (req, reply) => {
    const store = await storeOf(req, reply);
    if (!store) return reply;
    const parsed = lineFromForm(store, formBody.parse(req.body));
    if ("error" in parsed) {
      if (wantsJson(req)) return reply.code(422).send({ error: parsed.error, message: parsed.message });
      const ctx = { prefix: req.prefix };
      return renderCart(req, reply, deps, store, {
        status: 422,
        error: { message: parsed.message, ...(parsed.product ? { product: { name: parsed.product.name, url: productHref(ctx, parsed.product) } } : {}) },
      });
    }
    const cart = await carts.get(req.workspaceId, req.site);
    const lines = liveLines(store, cart.lines);
    const max = maxQtyOf(parsed.product);
    const had = lines.find((l) => lineKey(l) === lineKey(parsed.line))?.qty ?? 0;
    await carts.put(req.workspaceId, req.site, addLine(lines, parsed.line, max));
    // More than the line may hold (the stock left, or ten): it holds its most, and the answer says so.
    return answer(req, reply, deps, store, had + parsed.line.qty > max ? parsed.line : null);
  });

  scope.post("/cart/update", async (req, reply) => {
    const store = await storeOf(req, reply);
    if (!store) return reply;
    const body = formBody.parse(req.body);
    const key = field(body, "key");
    const cart = await carts.get(req.workspaceId, req.site);
    const lines = liveLines(store, cart.lines);
    const line = lines.find((l) => lineKey(l) === key);
    if (!line) return answer(req, reply, deps, store);
    const product = productFor(store, line.sku);
    const max = maxQtyOf(product);
    const qty = readQty(field(body, "qty"));
    if (typeof qty !== "number" || qty < 0) return refuseQty(req, reply, deps, store, `Choose a quantity from 0 to ${max}.`, product);
    await carts.put(req.workspaceId, req.site, setQty(lines, key, qty, max));
    return answer(req, reply, deps, store, qty > max ? line : null);
  });

  scope.post("/cart/remove", async (req, reply) => {
    const store = await storeOf(req, reply);
    if (!store) return reply;
    const key = field(formBody.parse(req.body), "key");
    const cart = await carts.get(req.workspaceId, req.site);
    const lines = liveLines(store, cart.lines);
    if (lines.some((l) => lineKey(l) === key)) await carts.put(req.workspaceId, req.site, removeLine(lines, key));
    return answer(req, reply, deps, store);
  });

  scope.post("/cart/promo", async (req, reply) => {
    const store = await storeOf(req, reply);
    if (!store) return reply;
    const body = formBody.parse(req.body);
    const cart = await carts.get(req.workspaceId, req.site);
    const lines = liveLines(store, cart.lines);
    const done = async (promo: string | null, query: string) => {
      if (!wantsJson(req)) return reply.redirect(`${req.prefix}/cart${query}`, 303);
      const ctx = await pageCtx(req, deps);
      const totals = computeTotals({ store, lines, addOns: [], shippingId: null, state: null, promo });
      return reply.send({ ...cartJson(ctx, store, lines), promo, discountCents: totals.discountCents, note: promoNote(store, promo, totals.subtotalCents) });
    };
    if (field(body, "remove")) {
      await carts.put(req.workspaceId, req.site, lines, null);
      return done(null, "?promo=removed");
    }
    const check = checkPromo(store, field(body, "code"));
    if (!check.ok) {
      if (wantsJson(req)) return reply.code(422).send({ error: check.error, message: check.message });
      const q = new URLSearchParams({ promo_error: check.error === "EMPTY_CODE" ? "empty" : "invalid", ...(check.code ? { code: check.code } : {}) });
      return reply.redirect(`${req.prefix}/cart?${q.toString()}`, 303);
    }
    await carts.put(req.workspaceId, req.site, lines, check.code);
    return done(check.code, "?promo=applied");
  });
}
