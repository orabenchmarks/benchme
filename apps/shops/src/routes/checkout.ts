/**
 * A store's checkout: three steps over one row of shops.checkouts, always priced from the LIVE cart
 * (an edit after the checkout started is what gets paid — Review Focus 5).
 *
 *   POST /checkout                         from the cart: the store's open checkout resumed with every choice made on
 *                                          it (checkout_resumed), else a new one with the scenario's pre-ticked
 *                                          add-ons (checkout_started); the store's scenario locked (Review Focus 1);
 *                                          → its information step. A code typed beside "Check out" is applied first
 *                                          (an unknown one goes back to the cart)
 *   GET  /checkout, /checkout/:token       → the cart, → the step the checkout is at
 *   GET|POST /checkout/:token/information  email, phone, "Email me with news and offers" (unticked unless the scenario's
 *                                          precheckMarketing; its final state is contact.marketing), the address with
 *                                          ZIP ↔ state validation; Wrenfield also takes the sender's name (optional,
 *                                          contact.name: its address is the recipient's), the delivery date (store-local:
 *                                          tomorrow by default, today only before the cutoff, with the same-day fee;
 *                                          said in words with today's date), a card message (≤ 200) and a signature.
 *                                          Errors: 422, the form again with per-field messages and what was typed.
 *                                          ?recheck=delivery (where the payment step sends a date it can no longer
 *                                          deliver): the stored date's problem on the date field, tomorrow offered
 *   GET|POST /checkout/:token/shipping     the methods with prices and arrival dates, the add-ons (ticked from the
 *                                          checkout's addOns), the code: intent=apply-promo applies it and stays,
 *                                          intent=remove-promo removes it, Continue applies a typed code and goes on
 *   GET  /checkout/:token/payment          the summary with the scenario's late fee (only here: flags.lateFeeShown,
 *                                          late_fee_shown), then the payment surface — or the outbound notice
 *                                          (notice_shown) that replaces it. The surface's own endpoints: routes/pay.ts,
 *                                          whose preHandler also sends a payment of the checkout that went through
 *                                          without reaching the return URL to /complete instead of letting it be paid again.
 *                                          A delivery date the store can no longer deliver at the store-local now (it has
 *                                          passed, or it is today after the same-day cutoff): 303 to the information step
 *                                          with ?recheck=delivery — as the surface's endpoints refuse to start a payment.
 *
 * A token is unique within a workspace only, so a checkout is served only on its own store's site; a
 * paid checkout answers every step with a redirect to its order.
 */
import { addDays, computeTotals, normalizeZip, stateForZip, US_STATES, zipMatchesState, type ScenarioDef, type ShippingMethod, type StoreDef, type StoreId, type Surface, type Totals } from "@benchme/storefront";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { CHECKOUT_TOKEN } from "../db/checkouts-repo.js";
import { withLock, type Address, type Cart, type Checkout, type Contact, type Delivery, type OrderRow } from "../db/index.js";
import { assetHref, hourLabel, optionsLabel, productHref } from "../render/components.js";
import { longDate, shortDate, type FieldErrors, type SummaryView } from "../render/checkout-views.js";
import type { StoreCtx } from "../render/layout.js";
import { informationPage, shippingPage, type DeliveryWindow, type InfoValues, type ShippingMethodView } from "../render/pages/checkout.js";
import { paymentPage, type PaymentView } from "../render/pages/payment.js";
import { STORE_TZ } from "../stores/index.js";
import { charCount, cleanText } from "../text.js";
import { checkPromo, field, fieldAll, formBody, liveLines, promoNote } from "./cart.js";
import type { RouteDeps } from "./index.js";
import { pageCtx, sendHtml, storeLocal, wantsJson } from "./storefront.js";

/** How far ahead Wrenfield takes a delivery date. */
export const MAX_DAYS_AHEAD = 60;

/* ------------------------------------------------------------------ the checkout as the routes see it */

/** A checkout of this workspace at this store, with its live cart and the store's scenario. */
export type Loaded = { ws: string; site: StoreId; store: StoreDef; checkout: Checkout; cart: Cart; scenario: ScenarioDef | null };

export const checkoutPath = (token: string, step?: string) => `/checkout/${token}${step ? `/${step}` : ""}`;

/** The order a checkout was paid by (the first, if a second payment ever paid it again). */
export async function orderOf(deps: Pick<RouteDeps, "repos">, ws: string, token: string): Promise<OrderRow | null> {
  return (await deps.repos.orders.list(ws)).find((o) => o.checkoutToken === token) ?? null;
}

/**
 * The checkout of `:token`, or the answer already sent: 404 for a token that is not this
 * workspace's or not this store's (and on paylantern); for a paid checkout, unless `allowPaid`,
 * 303 to its order (409 with `redirect` for a script).
 */
export async function loadCheckout(req: FastifyRequest, reply: FastifyReply, deps: RouteDeps, opts: { allowPaid?: boolean } = {}): Promise<Loaded | null> {
  const store = req.store;
  const token = (req.params as { token?: string }).token ?? "";
  const checkout = store && CHECKOUT_TOKEN.test(token) ? await deps.repos.checkouts.get(req.workspaceId, token) : null;
  if (!store || !checkout || checkout.store !== req.site) {
    await reply.callNotFound();
    return null;
  }
  if (checkout.status === "paid" && !opts.allowPaid) {
    const order = await orderOf(deps, req.workspaceId, token);
    const to = `${req.prefix}${order ? `/orders/${encodeURIComponent(order.orderNo)}` : "/cart"}`;
    if (wantsJson(req)) await reply.code(409).send({ error: "PAID", message: "This order is already paid.", redirect: to });
    else await reply.redirect(to, 303);
    return null;
  }
  const cart = await deps.repos.carts.get(req.workspaceId, req.site);
  return { ws: req.workspaceId, site: req.site as StoreId, store, checkout, cart: { lines: liveLines(store, cart.lines), promo: cart.promo }, scenario: await req.scenario() };
}

/** The step a checkout still needs before payment, or null when it is ready to pay. */
export function stepNeeded(store: StoreDef, c: Checkout): "information" | "shipping" | null {
  if (!c.contact || !c.address || (store.delivery && !c.delivery)) return "information";
  if (!c.shippingId || !store.shipping.some((m) => m.id === c.shippingId)) return "shipping";
  return null;
}

/**
 * A workspace's scenario at a store, read the way the site scope reads `req.scenario()` — for the
 * pages that price another site's checkout (PayLantern, the internal state API).
 */
export async function scenarioOf(deps: Pick<RouteDeps, "repos" | "scenarios">, ws: string, store: StoreId): Promise<ScenarioDef | null> {
  const { scenarioId } = await deps.repos.state.get(ws, store);
  const s = scenarioId ? deps.scenarios.byId(scenarioId) : undefined;
  return s && s.store === store ? s : null;
}

/** An open checkout's payable total (what its payment step would charge now), or null when there is nothing to pay. */
export async function payableCents(deps: Pick<RouteDeps, "repos" | "scenarios">, ws: string, store: StoreDef, checkout: Checkout): Promise<number | null> {
  if (checkout.status !== "open") return null;
  const cart = await deps.repos.carts.get(ws, store.id);
  const lines = liveLines(store, cart.lines);
  if (!lines.length) return null;
  return totalsFor({ store, checkout, cart: { lines, promo: cart.promo }, scenario: await scenarioOf(deps, ws, store.id) }, true).totalCents;
}

/** The payment surface: the scenario's, else the store's own. */
export function surfaceOf(store: StoreDef, scenario: ScenarioDef | null): Surface {
  return scenario?.mechanisms.surface ?? store.defaultSurface;
}

const knownAddOns = (store: StoreDef, skus: string[]) => skus.filter((s, i) => skus.indexOf(s) === i && store.addOns.some((a) => a.sku === s));

/**
 * What the scenario's shipping update adds to every shipping rate once it has fired (flags.priceUpdated):
 * from then on it IS the rate, on every step — the shipping step's method prices, every summary, the
 * charge — so the store never quotes the old rate again. 0 before it fires.
 */
export function shippingDeltaOf(l: Pick<Loaded, "checkout" | "scenario">): number {
  const pu = l.scenario?.mechanisms.priceUpdateOnPay;
  return pu && l.checkout.flags.priceUpdated === true ? pu.deltaCents : 0;
}

/**
 * The checkout priced from its live cart. `paying` is what the payment step shows and charges: the
 * scenario's late fee, which the earlier steps do not show. The shipping update is in every total once
 * it has fired (shippingDeltaOf). `shippingId` overrides the stored method (the shipping step shows its pick).
 */
export function totalsFor(l: Pick<Loaded, "store" | "checkout" | "cart" | "scenario">, paying: boolean, shippingId?: string | null): Totals {
  const m = l.scenario?.mechanisms;
  return computeTotals({
    store: l.store,
    lines: l.cart.lines,
    addOns: knownAddOns(l.store, l.checkout.addOns),
    shippingId: shippingId === undefined ? l.checkout.shippingId : shippingId,
    state: l.checkout.address?.state ?? null,
    promo: l.cart.promo,
    sameDay: l.checkout.delivery?.sameDay === true,
    extraFees: paying && m?.lateFee ? [{ label: m.lateFee.label, cents: m.lateFee.cents }] : [],
    shippingDeltaCents: shippingDeltaOf(l),
  });
}

/** The order summary of a checkout page. */
export function summaryOf(ctx: Pick<StoreCtx, "prefix">, l: Pick<Loaded, "store" | "cart" | "checkout">, totals: Totals, shippingId: string | null): SummaryView {
  const { store, cart } = l;
  return {
    items: cart.lines.map((line, i) => {
      const p = store.products.find((x) => x.sku === line.sku);
      return {
        name: p?.name ?? line.sku,
        optionsLabel: optionsLabel(p, line),
        qty: line.qty,
        totalCents: totals.lines[i]?.totalCents ?? 0,
        image: p?.images[0] ? assetHref(ctx, p.images[0]) : "",
        url: p ? productHref(ctx, p) : "",
      };
    }),
    totals,
    promo: cart.promo,
    promoNote: promoNote(store, cart.promo, totals.subtotalCents),
    shippingLabel: store.shipping.find((m) => m.id === shippingId)?.label ?? null,
    taxKnown: !!l.checkout.address,
    shippingWord: store.delivery ? "Delivery" : "Shipping",
    recurring: Object.fromEntries(store.addOns.flatMap((a) => (a.recurring ? [[a.sku, a.recurring]] : []))),
  };
}

/**
 * Sets a flag on a checkout only if it is not set yet; true for the one caller that set it. What
 * must happen once per checkout (the price update, the confirmation email) is claimed with it.
 */
export async function claimFlag(deps: Pick<RouteDeps, "pool">, ws: string, token: string, flag: string): Promise<boolean> {
  const r = await deps.pool.query(
    "UPDATE shops.checkouts SET flags = flags || jsonb_build_object($3::text, true), updated_at = now() WHERE workspace_id = $1 AND token = $2 AND NOT (flags ? $3::text) RETURNING 1",
    [ws, token, flag],
  );
  return (r.rowCount ?? 0) > 0;
}

/** Gives a claimed flag back (the work it guarded failed and may be retried). */
export async function releaseFlag(deps: Pick<RouteDeps, "pool">, ws: string, token: string, flag: string): Promise<void> {
  await deps.pool.query("UPDATE shops.checkouts SET flags = flags - $3::text WHERE workspace_id = $1 AND token = $2", [ws, token, flag]);
}

/** Today in the stores' time zone, as the delivery dates and the order date read it. */
export const storeToday = (now: Date): string => storeLocal(now, STORE_TZ).date;

/** n business days after a date (weekends skipped). */
export function addBusinessDays(iso: string, n: number): string {
  let d = iso;
  for (let left = n; left > 0; ) {
    d = addDays(d, 1);
    const wd = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (wd !== 0 && wd !== 6) left--;
  }
  return d;
}

/** When a method gets there: the chosen date at a florist, a business-day window elsewhere. */
export function arrivalText(store: StoreDef, m: ShippingMethod, today: string, delivery: Delivery | null): string {
  if (store.delivery) return delivery ? `Delivered ${longDate(delivery.date)}` : "Delivered on the date you choose";
  const [a, b] = m.days;
  const days = a === b ? `${a} business day${a === 1 ? "" : "s"}` : `${a}–${b} business days`;
  const from = shortDate(addBusinessDays(today, a));
  return a === b ? `${days} · Arrives ${from}` : `${days} · Arrives ${from} – ${shortDate(addBusinessDays(today, b))}`;
}

/** The cost of a method for this cart: free over its threshold. */
export function methodCents(m: ShippingMethod, subtotalCents: number): number {
  return m.freeOverCents !== undefined && subtotalCents >= m.freeOverCents ? 0 : m.priceCents;
}

/** The payment step's link to PayLantern in the same workspace: /w/<ws>/<site> → /w/<ws>/paylantern/pay?ref=<token>&m=<site>. */
export function paylanternHref(prefix: string, site: string, token: string): string {
  const base = prefix.endsWith(`/${site}`) ? `${prefix.slice(0, -site.length)}paylantern` : "/s/paylantern";
  return `${base}/pay?ref=${encodeURIComponent(token)}&m=${encodeURIComponent(site)}`;
}

/* ------------------------------------------------------------------ the information step */

const EMAIL = z.string().email();
const DATE = /^\d{4}-\d{2}-\d{2}$/;

type InfoResult = { ok: true; contact: Contact; address: Address; delivery: Delivery | null } | { ok: false; values: InfoValues; errors: FieldErrors };

/**
 * What the information step takes, checked as a careful store checks it. Every value is cleanText'd: a
 * field's limit counts characters, and a line break of the card message (CRLF in a form post) counts as
 * one, as the textarea's own limit does.
 */
export function readInformation(store: StoreDef, body: Record<string, unknown>, now: Date): InfoResult {
  const t = (name: string, max: number) => cleanText(field(body, name), max);
  const values: InfoValues = {
    // A florist's buyer is not its recipient: the sender's own name, optional, beside the contact details.
    senderName: store.delivery ? t("senderName", 80) : "",
    email: t("email", 254),
    phone: t("phone", 40),
    marketing: field(body, "marketing") !== "",
    firstName: t("firstName", 60),
    lastName: t("lastName", 60),
    line1: t("line1", 120),
    line2: t("line2", 120),
    city: t("city", 60),
    state: t("state", 2).toUpperCase(),
    zip: t("zip", 12),
    deliveryDate: t("deliveryDate", 10),
    message: t("message", 400),
    signature: t("signature", 120),
  };
  const errors: FieldErrors = {};
  if (!values.email) errors.email = "Enter an email address.";
  else if (!EMAIL.safeParse(values.email).success) errors.email = "Enter a valid email address, like name@example.com.";
  const digits = values.phone.replace(/\D/g, "");
  if (!values.phone) errors.phone = "Enter a phone number.";
  else if (!/^[+()\-.\s\d]+$/.test(values.phone) || digits.length < 7 || digits.length > 15) errors.phone = "Enter a valid phone number, like (415) 555-0134.";
  if (!values.firstName) errors.firstName = "Enter a first name.";
  if (!values.lastName) errors.lastName = "Enter a last name.";
  if (!values.line1) errors.line1 = "Enter an address.";
  if (!values.city) errors.city = "Enter a city.";
  const stateOk = US_STATES.some((s) => s.code === values.state);
  if (!stateOk) errors.state = "Select a state.";
  const zip = normalizeZip(values.zip);
  if (!values.zip) errors.zip = "Enter a ZIP code.";
  else if (!zip) errors.zip = "Enter a valid ZIP code, like 94107 or 94107-1234.";
  else if (!stateForZip(zip)) errors.zip = `We couldn't find ZIP code ${zip}. Check it and try again.`;
  else if (stateOk && !zipMatchesState(zip, values.state)) errors.zip = "This ZIP code doesn't match the state. Check the ZIP code or the state.";

  let delivery: Delivery | null = null;
  const rules = store.delivery;
  if (rules) {
    const local = storeLocal(now, STORE_TZ);
    const sameDayOpen = local.hour < rules.cutoffHourLocal;
    const d = values.deliveryDate;
    const valid = DATE.test(d) && new Date(`${d}T12:00:00Z`).toISOString().slice(0, 10) === d;
    if (!d) errors.deliveryDate = "Choose a delivery date.";
    else if (!valid) errors.deliveryDate = "Enter the delivery date as a date, like 2026-10-08.";
    else if (d < local.date) errors.deliveryDate = `That date has passed. Choose ${sameDayOpen ? "today" : "tomorrow"} or a later date.`;
    else if (d === local.date && !sameDayOpen) errors.deliveryDate = `Same-day delivery closes at ${hourLabel(rules.cutoffHourLocal)} Pacific. Choose tomorrow or a later date.`;
    else if (d > addDays(local.date, MAX_DAYS_AHEAD)) errors.deliveryDate = `We take orders up to ${MAX_DAYS_AHEAD} days ahead. Choose an earlier date.`;
    if (rules.giftMessage && charCount(values.message) > 200) errors.message = "Keep the card message to 200 characters or fewer.";
    if (charCount(values.signature) > 60) errors.signature = "Keep the signature to 60 characters or fewer.";
    delivery = { date: d, sameDay: d === local.date, message: rules.giftMessage ? values.message : "", signature: values.signature };
  }
  if (Object.keys(errors).length) return { ok: false, values, errors };
  return {
    ok: true,
    contact: { email: values.email.toLowerCase(), phone: values.phone, marketing: values.marketing, ...(values.senderName ? { name: values.senderName } : {}) },
    address: { firstName: values.firstName, lastName: values.lastName, line1: values.line1, line2: values.line2, city: values.city, state: values.state, zip: zip as string },
    delivery,
  };
}

/** The query the information step is opened with when the payment step finds the delivery date can no longer be delivered. */
export const RECHECK_DELIVERY = "recheck=delivery";

/**
 * Why a checkout's delivery date can no longer be delivered at `now`, store-local, or null: a date that has passed,
 * or today once same-day delivery has closed. The information step refused both when the date was chosen; a payment
 * starts later, so it asks again (the payment step, the intent, the session and the card form).
 */
export function deliveryProblem(store: StoreDef, delivery: Delivery | null, now: Date): string | null {
  const rules = store.delivery;
  if (!rules || !delivery) return null;
  const local = storeLocal(now, STORE_TZ);
  if (delivery.date < local.date) return `Your delivery date, ${longDate(delivery.date)}, has passed. Choose a new delivery date to continue.`;
  if (delivery.date === local.date && local.hour >= rules.cutoffHourLocal) {
    return `Same-day delivery closed at ${hourLabel(rules.cutoffHourLocal)} Pacific, so we can no longer deliver today, ${longDate(delivery.date)}. Choose tomorrow or a later date to continue.`;
  }
  return null;
}

/** Wrenfield's delivery window at `now`, in store-local dates: from today while same-day delivery is open (else tomorrow), MAX_DAYS_AHEAD days out. */
export function deliveryWindowAt(store: StoreDef, now: Date): DeliveryWindow | null {
  if (!store.delivery) return null;
  const local = storeLocal(now, STORE_TZ);
  const open = local.hour < store.delivery.cutoffHourLocal;
  return {
    today: local.date,
    min: open ? local.date : addDays(local.date, 1),
    max: addDays(local.date, MAX_DAYS_AHEAD),
    sameDayOpen: open,
    cutoffLabel: hourLabel(store.delivery.cutoffHourLocal),
    sameDayFeeCents: store.delivery.sameDayFeeCents,
    giftMessage: store.delivery.giftMessage,
  };
}

/**
 * The information step as stored — or, before it was filled in, its defaults (tomorrow; the scenario's opt-in
 * default). A stored delivery date that can no longer be chosen (a resumed checkout, a day later or past the
 * same-day cutoff) comes back as tomorrow.
 */
function storedInformation(l: Loaded, now: Date): InfoValues {
  const c = l.checkout;
  const earliest = deliveryWindowAt(l.store, now)?.min;
  const date = c.delivery?.date;
  return {
    senderName: c.contact?.name ?? "",
    email: c.contact?.email ?? "",
    phone: c.contact?.phone ?? "",
    marketing: c.contact ? c.contact.marketing : l.scenario?.mechanisms.precheckMarketing === true,
    firstName: c.address?.firstName ?? "",
    lastName: c.address?.lastName ?? "",
    line1: c.address?.line1 ?? "",
    line2: c.address?.line2 ?? "",
    city: c.address?.city ?? "",
    state: c.address?.state ?? "",
    zip: c.address?.zip ?? "",
    deliveryDate: date && earliest && date >= earliest ? date : addDays(storeToday(now), 1),
    message: c.delivery?.message ?? "",
    signature: c.delivery?.signature ?? "",
  };
}

/* ------------------------------------------------------------------ routes */

export function registerCheckoutRoutes(scope: FastifyInstance, deps: RouteDeps): void {
  const { carts, checkouts, state, events } = deps.repos;

  const renderInformation = async (req: FastifyRequest, reply: FastifyReply, l: Loaded, values: InfoValues, errors: FieldErrors, status = 200) => {
    const ctx = (await pageCtx(req, deps)) as StoreCtx;
    const totals = totalsFor(l, false);
    return sendHtml(
      reply,
      informationPage(ctx, { token: l.checkout.token, values, errors, delivery: deliveryWindowAt(l.store, deps.now()), summary: summaryOf(ctx, l, totals, l.checkout.shippingId) }),
      status,
    );
  };

  const renderShipping = async (
    req: FastifyRequest,
    reply: FastifyReply,
    l: Loaded,
    pick: { shippingId: string | null; addOns: string[] },
    extra: { errors?: FieldErrors; promoError?: { message: string; code: string } } = {},
    status = 200,
  ) => {
    const ctx = (await pageCtx(req, deps)) as StoreCtx;
    const selected = pick.shippingId ?? l.checkout.shippingId ?? l.store.shipping[0]?.id ?? null;
    const shown = { ...l, checkout: { ...l.checkout, addOns: pick.addOns } };
    const totals = totalsFor(shown, false, selected);
    const today = storeToday(deps.now());
    const delta = shippingDeltaOf(l);
    const methods: ShippingMethodView[] = l.store.shipping.map((m) => ({
      id: m.id,
      label: m.label,
      cents: methodCents(m, totals.subtotalCents) + delta,
      when: arrivalText(l.store, m, today, l.checkout.delivery),
      checked: m.id === selected,
    }));
    return sendHtml(
      reply,
      shippingPage(ctx, {
        token: l.checkout.token,
        checkout: l.checkout,
        store: l.store,
        methods,
        addOns: l.store.addOns.map((a) => ({ ...a, checked: pick.addOns.includes(a.sku) })),
        promo: l.cart.promo,
        promoNote: promoNote(l.store, l.cart.promo, totals.subtotalCents),
        promoError: extra.promoError ?? null,
        errors: extra.errors ?? {},
        summary: summaryOf(ctx, shown, totals, selected),
      }),
      status,
    );
  };

  /**
   * A step's GET/POST runs only once the steps before it are done, and only with something in the cart. The payment
   * step also needs a delivery date that can still be delivered: else back to the information step, which says why.
   */
  const gate = async (req: FastifyRequest, reply: FastifyReply, l: Loaded, step: "information" | "shipping" | "payment"): Promise<boolean> => {
    if (!l.cart.lines.length) {
      await reply.redirect(`${req.prefix}/cart`, 303);
      return false;
    }
    const need = stepNeeded(l.store, l.checkout);
    const order = ["information", "shipping", "payment"];
    if (need && order.indexOf(need) < order.indexOf(step)) {
      await reply.redirect(`${req.prefix}${checkoutPath(l.checkout.token, need)}`, 303);
      return false;
    }
    if (step === "payment" && deliveryProblem(l.store, l.checkout.delivery, deps.now())) {
      await reply.redirect(`${req.prefix}${checkoutPath(l.checkout.token, "information")}?${RECHECK_DELIVERY}`, 303);
      return false;
    }
    return true;
  };

  scope.post("/checkout", async (req, reply) => {
    const store = req.store;
    if (!store) return reply.callNotFound();
    const ws = req.workspaceId;
    const cart = await carts.get(ws, req.site);
    const lines = liveLines(store, cart.lines);
    if (!lines.length) {
      if (wantsJson(req)) return reply.code(409).send({ error: "EMPTY_CART", message: "Your cart is empty.", redirect: `${req.prefix}/cart` });
      return reply.redirect(`${req.prefix}/cart`, 303);
    }
    const typed = field(formBody.parse(req.body), "code");
    if (typed.trim()) {
      const check = checkPromo(store, typed);
      if (!check.ok) {
        if (wantsJson(req)) return reply.code(422).send({ error: check.error, message: check.message });
        const q = new URLSearchParams({ promo_error: check.error === "EMPTY_CODE" ? "empty" : "invalid", ...(check.code ? { code: check.code } : {}) });
        return reply.redirect(`${req.prefix}/cart?${q.toString()}`, 303);
      }
      await carts.put(ws, req.site, lines, check.code);
    }
    const scenario = await req.scenario();
    // One open checkout per store: Check out again (back from the cart, a second tab, a double press) resumes it
    // with everything chosen on it so far; only a store without one starts a new checkout, with the scenario's
    // pre-ticked add-ons. Under the store's lock, so two presses at once cannot both start one.
    const { checkout: co, resumed } = await withLock(deps.pool, `shops.checkout-start:${ws}`, req.site, async (db) => {
      const open = await checkouts.latestOpen(ws, req.site, db);
      if (open) return { checkout: open, resumed: true };
      return { checkout: await checkouts.create(ws, req.site, { addOns: knownAddOns(store, scenario?.mechanisms.precheckedAddOns ?? []) }, db), resumed: false };
    });
    await state.lock(ws, req.site);
    await events.record(ws, req.site, resumed ? "checkout_resumed" : "checkout_started", { token: co.token });
    const to = `${req.prefix}${checkoutPath(co.token, "information")}`;
    if (wantsJson(req)) return reply.code(resumed ? 200 : 201).send({ token: co.token, redirect: to, resumed });
    return reply.redirect(to, 303);
  });

  scope.get("/checkout", async (req, reply) => {
    if (!req.store) return reply.callNotFound();
    return reply.redirect(`${req.prefix}/cart`, 303);
  });

  scope.get<{ Params: { token: string } }>("/checkout/:token", async (req, reply) => {
    const l = await loadCheckout(req, reply, deps);
    if (!l) return reply;
    return reply.redirect(`${req.prefix}${checkoutPath(l.checkout.token, stepNeeded(l.store, l.checkout) ?? "payment")}`, 303);
  });

  scope.get<{ Params: { token: string }; Querystring: { recheck?: unknown } }>("/checkout/:token/information", async (req, reply) => {
    const l = await loadCheckout(req, reply, deps);
    if (!l || !(await gate(req, reply, l, "information"))) return reply;
    const now = deps.now();
    // Sent back by the payment step: why the stored delivery date will not do (the field then offers the earliest one).
    const late = req.query.recheck === "delivery" ? deliveryProblem(l.store, l.checkout.delivery, now) : null;
    return renderInformation(req, reply, l, storedInformation(l, now), late ? { deliveryDate: late } : {});
  });

  scope.post<{ Params: { token: string } }>("/checkout/:token/information", async (req, reply) => {
    const l = await loadCheckout(req, reply, deps);
    if (!l || !(await gate(req, reply, l, "information"))) return reply;
    const now = deps.now();
    const r = readInformation(l.store, formBody.parse(req.body), now);
    if (!r.ok) return renderInformation(req, reply, l, r.values, r.errors, 422);
    // informationDate: the store-local day the step was accepted on — what a delivery date chosen now
    // ("tomorrow") is graded against, however late the payment completes.
    await checkouts.update(l.ws, l.checkout.token, { contact: r.contact, address: r.address, delivery: r.delivery, flags: { informationDate: storeToday(now) } });
    return reply.redirect(`${req.prefix}${checkoutPath(l.checkout.token, "shipping")}`, 303);
  });

  scope.get<{ Params: { token: string } }>("/checkout/:token/shipping", async (req, reply) => {
    const l = await loadCheckout(req, reply, deps);
    if (!l || !(await gate(req, reply, l, "shipping"))) return reply;
    return renderShipping(req, reply, l, { shippingId: l.checkout.shippingId, addOns: knownAddOns(l.store, l.checkout.addOns) });
  });

  scope.post<{ Params: { token: string } }>("/checkout/:token/shipping", async (req, reply) => {
    const l = await loadCheckout(req, reply, deps);
    if (!l || !(await gate(req, reply, l, "shipping"))) return reply;
    const body = formBody.parse(req.body);
    const method = l.store.shipping.find((m) => m.id === field(body, "shipping"));
    const addOns = knownAddOns(l.store, fieldAll(body, "addon"));
    if (!method) return renderShipping(req, reply, l, { shippingId: null, addOns }, { errors: { shipping: "Choose a shipping method." } }, 422);
    const saved: Loaded = { ...l, checkout: await checkouts.update(l.ws, l.checkout.token, { shippingId: method.id, addOns }) };
    const here = `${req.prefix}${checkoutPath(l.checkout.token, "shipping")}`;
    const intent = field(body, "intent");
    if (intent === "remove-promo") {
      await carts.put(l.ws, l.site, l.cart.lines, null);
      return reply.redirect(here, 303);
    }
    const typed = field(body, "code");
    if (intent === "apply-promo" || typed.trim()) {
      const check = checkPromo(l.store, typed);
      if (!check.ok) return renderShipping(req, reply, saved, { shippingId: method.id, addOns }, { promoError: { message: check.message, code: check.code } }, 422);
      await carts.put(l.ws, l.site, l.cart.lines, check.code);
      if (intent === "apply-promo") return reply.redirect(here, 303);
    }
    return reply.redirect(`${req.prefix}${checkoutPath(l.checkout.token, "payment")}`, 303);
  });

  scope.get<{ Params: { token: string }; Querystring: Record<string, unknown> }>("/checkout/:token/payment", async (req, reply) => {
    const l = await loadCheckout(req, reply, deps);
    if (!l || !(await gate(req, reply, l, "payment"))) return reply;
    const m = l.scenario?.mechanisms;
    if (m?.lateFee && (await claimFlag(deps, l.ws, l.checkout.token, "lateFeeShown"))) {
      await events.record(l.ws, l.site, "late_fee_shown", { token: l.checkout.token, label: m.lateFee.label, cents: m.lateFee.cents });
    }
    if (m?.outboundPaymentNotice) await events.record(l.ws, l.site, "notice_shown", { token: l.checkout.token });
    const ctx = (await pageCtx(req, deps)) as StoreCtx;
    return sendHtml(reply, paymentPage(ctx, paymentView(req, deps, ctx, l)));
  });
}

/* ------------------------------------------------------------------ the payment page's view */

const paymentQuery = z.object({ error: z.string().max(300).optional(), updated: z.string().optional() }).catch({});

/** Everything the payment page shows, from the checkout as it stands. */
export function paymentView(req: FastifyRequest, deps: RouteDeps, ctx: StoreCtx, l: Loaded): PaymentView {
  const totals = totalsFor(l, true);
  const m = l.scenario?.mechanisms;
  const q = paymentQuery.parse(req.query);
  const token = l.checkout.token;
  const path = (step: string) => `${req.prefix}${checkoutPath(token, step)}`;
  const notice = m?.outboundPaymentNotice;
  return {
    token,
    mode: deps.payments.mode,
    surface: surfaceOf(l.store, l.scenario),
    notice: notice ? { ...notice, href: paylanternHref(req.prefix, l.site, token) } : null,
    error: q.error?.trim() ? q.error.trim() : null,
    // Once the shipping update fired, its note stays on the page for the rest of the checkout;
    // `fresh` right after the press that fired it (?updated=1), which the shopper has to repeat.
    priceUpdate:
      m?.priceUpdateOnPay && l.checkout.flags.priceUpdated === true
        ? { label: m.priceUpdateOnPay.label, totalCents: totals.totalCents, previousCents: totals.totalCents - m.priceUpdateOnPay.deltaCents, fresh: !!q.updated }
        : null,
    totals,
    summary: summaryOf(ctx, l, totals, l.checkout.shippingId),
    checkout: l.checkout,
    store: l.store,
    shippingCents: totals.shippingCents,
    urls: {
      intent: path("payment/intent"),
      session: path("payment/session"),
      confirm: path("payment/fake-confirm"),
      authenticate: path("payment/authenticate"),
      complete: path("complete"),
      returnUrl: `${ctx.publicBase}${checkoutPath(token, "complete")}`,
      shipping: path("shipping"),
      information: path("information"),
    },
    publishableKey: deps.payments.publishableKey,
  };
}
