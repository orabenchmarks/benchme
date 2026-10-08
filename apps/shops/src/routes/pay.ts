/**
 * Paying a checkout on its surface (the scenario's, else the store's), and turning a payment into an order.
 *
 *   POST /checkout/:token/payment/intent        → { clientSecret, publishableKey, amountCents, mode }: one intent per
 *                                                checkout, created on the first call (metadata { workspace, store,
 *                                                scenario, checkout }; card, plus Link on express-checkout) and kept at
 *                                                the LIVE total after (Review Focus 5). The scenario's priceUpdateOnPay
 *                                                answers the FIRST call with { priceUpdated: { label, oldCents, newCents } }
 *                                                instead (price_updated), so the shopper has to pay again to accept it —
 *                                                and, once fired, any call whose shownCents (the total the page shows,
 *                                                which pay.js sends) is not the new total.
 *   POST /checkout/:token/payment/session       hosted surface: a Checkout Session for the live total → 303 to it
 *                                                (Stripe's page, or fake mode's /fake-pay/session/:id). The checkout's
 *                                                earlier sessions are expired first: only the newest can be paid.
 *   GET  /checkout/:token/complete?payment_intent=…|session_id=…
 *                                                trusts a payment only if its metadata names this workspace, store and
 *                                                checkout; paid → the order, built and classified from what that payment
 *                                                paid for (below), numbered with the class's suffix — idempotent per
 *                                                payment (Review Focus 2) — one confirmation email → 303 /orders/:no
 *                                                (with &recovered=1, where the payment step sends a payment that went through
 *                                                unseen: /orders/:no?recovered=1, which says so); not paid → 303 back to the
 *                                                payment step with the processor's message (?error=)
 *   POST /checkout/:token/payment/report        Stripe mode: pay.js reports a confirmation that failed or needs action.
 *                                                The intent and its charges are read back from Stripe and logged as below
 *                                                (the browser's word on the outcome is never taken) → { recorded, status,
 *                                                error }, recorded: Stripe shows an attempt and it is on record; a payment
 *                                                that went through → { status, redirect } (fake mode: 404 — its card pages
 *                                                log their own attempts)
 *
 * The intent, the session and the fake card form (below) start no payment the checkout cannot make (refusal()): the
 * information or shipping step not done, an empty cart, the outbound notice, the other surface's endpoint, or a
 * delivery date the store can no longer deliver at the store-local now (passed, or today after the same-day cutoff:
 * DELIVERY_DATE, back to the information step with ?recheck=delivery, which says why). A form is redirected there; a
 * script gets 409 { error, message, redirect }, which pay.js follows. Nothing is created, updated or charged first.
 *
 * Payment attempts. Fake mode logs payment_attempt { token, ref, result } where its card pages take a card: result
 * succeeded, declined or requires_action, then authenticated or authentication_failed for the 3-D Secure step. Stripe
 * mode logs the same words from Stripe's own record (payments/attempts.ts) — at completion, at reconcile and on the
 * browser's report — one event per charge (a challenged one preceded by its card's requires_action step; a failed
 * challenge, which makes no charge, by its card), each once, keyed by `attempt` (the charge's id, or the card's).
 * A hosted session's attempts are logged under the session (ref cs_…), as fake mode's hosted page logs them.
 *
 * What was paid. Every intent and session is recorded in shops.payments with a snapshot of what it pays for —
 * an intent's on every attempt (its amount follows the checkout), a session's when it is created — under the
 * checkout's payment claim (db/claims.ts: one step at a time, holding no connection of the pool while Stripe
 * answers), so the snapshot always matches the amount the payment charges. An order is built and graded
 * from the snapshot of the payment that went through, with the processor's charge as chargedCents — never from
 * the live cart, which may have changed since or been emptied by an earlier order (an old session paid from an
 * open tab is recorded as what it charged for).
 *
 * One order at a time. Orders are placed under a lock on the workspace's store (OrdersRepo.placeOnce): the
 * count of earlier orders and the insert happen together, so of two payments completing at once only one is
 * the store's first; the other is `duplicate` (Review Focus 3).
 *
 * Payments that went through unseen. A shopper may pay and never reach the return URL (a tab closed after the
 * card form confirmed, a hosted page never left). Before the cart is shown, a checkout starts, a payment starts
 * (the payment step, the intent, the session, the fake card form), another payment completes or the internal
 * state API answers (reconcileStore), the store reads its open payments back from the processor and records every
 * one that went through as its order — so a second purchase is counted after it, never instead of it, and the
 * audit reads every payment made. Such an order takes only the lines it paid for out of the cart: what the
 * shopper added since stays. On a checkout's payment step, that checkout's own payment sends the shopper to its
 * return URL instead (&recovered=1). The shopper is shown every such order the step records (routes/recovered.ts):
 * a page or a form goes to its confirmation with the notice "Your earlier payment went through — here is your
 * order." (?recovered=1); a script gets the order and the notice in its answer — the drawer's cart.json beside the
 * cart, which the drawer shows; a step that would start a payment answers 409 RECOVERED with the confirmation to go
 * to — never a cart silently emptied.
 *
 * Fake mode only (payments.mode === "fake"; 404 in Stripe mode) — what the card form posts (through its script,
 * public/js/fake-pay.js, or without JavaScript), settling the FakePaymentGateway by card number: 4000000000000002
 * declines, 4000002760003184 needs authentication, any other Luhn-valid number pays, anything else is refused as
 * Stripe would refuse it.
 * The number is only ever read here, in memory: never stored, logged or echoed. A card form's body is a few
 * short fields: more than CARD_FORM_BODY_LIMIT is refused (413) before anything in it is read.
 *
 *   POST /checkout/:token/payment/fake-confirm  number, expiry, cvc, zip → JSON { status, redirect | error } | 303
 *   GET|POST /checkout/:token/payment/authenticate   the 3D Secure step: result=complete|fail
 *   GET|POST /fake-pay/session/:id, GET|POST /fake-pay/session/:id/authenticate   the hosted page of a session
 *                                                (an expired session sends the shopper back to the store)
 */
import { classify, newOrderNumber, normalizeZip, suffixTable, type PaidCheckout, type ScenarioDef, type StoreDef, type StoreId, type Totals } from "@benchme/storefront";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { ClaimBusyError, type OrderRow, type PaymentRow, type PaymentSnapshot } from "../db/index.js";
import type { ApprovalAnswer } from "../payments/approvals.js";
import { attemptsOf, newestAttempt } from "../payments/attempts.js";
import { statementDescriptor } from "../payments/descriptor.js";
import { AUTHENTICATION_FAILED, FakePaymentGateway } from "../payments/fake-gateway.js";
import { PaymentNotFoundError, type Intent, type PaymentMethodType, type SessionLine } from "../payments/gateway.js";
import { optionsLabel } from "../render/components.js";
import { minus } from "../render/checkout-views.js";
import type { StoreCtx } from "../render/layout.js";
import { fakeAuthPage, fakeSessionPage } from "../render/pages/fake-pay.js";
import { authenticatePage, paymentProblemPage } from "../render/pages/payment.js";
import { field, formBody } from "./cart.js";
import { checkoutPath, claimFlag, deliveryProblem, loadCheckout, orderOf, RECHECK_DELIVERY, releaseFlag, scenarioOf, stepNeeded, storeToday, surfaceOf, totalsFor, type Loaded } from "./checkout.js";
import type { RouteDeps } from "./index.js";
import { confirmationEmail } from "./orders.js";
import { noteRecovered, RECOVERED_QUERY, recoveredOrder } from "./recovered.js";
import { pageCtx, sendHtml, wantsJson } from "./storefront.js";

export const DECLINE_CARD = "4000000000000002";
export const THREE_DS_CARD = "4000002760003184";
const SESSION_EXPIRED = "That payment page has expired. Continue to secure payment to pay on a new one.";

/* ------------------------------------------------------------------ cards (read in memory, never kept) */

/** The Luhn check every card number passes. */
export function luhn(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

export type CardCheck = { ok: true; digits: string } | { ok: false; message: string };

/**
 * The most a card form's body may hold (PayLantern's, the payment step's, the hosted page's): a few short
 * fields. Anything bigger is refused (413) before a field of it is read.
 */
export const CARD_FORM_BODY_LIMIT = 16 * 1024;

/** The longest expiry a card form writes ("12 / 2034", spaces around it): anything longer is not one. */
export const MAX_EXPIRY_LENGTH = 32;

/**
 * MM/YY, MM / YYYY, MMYY…: the month and the year, each once. No two quantified runs of spaces meet
 * (the "/" is optional only together with the spaces after it), so a long run of spaces fails in
 * linear time instead of backtracking through every split of it.
 */
const EXPIRY = /^\s*(\d{1,2})\s*(?:\/\s*)?(\d{2}|\d{4})\s*$/;

/** The month and year of a typed expiry, or null. */
export function parseExpiry(raw: string): { month: number; year: number } | null {
  const m = raw.length <= MAX_EXPIRY_LENGTH ? EXPIRY.exec(raw) : null;
  if (!m) return null;
  const year = m[2] as string;
  return { month: Number(m[1]), year: year.length === 2 ? 2000 + Number(year) : Number(year) };
}

/** A card form as a processor checks it, with the processor's messages. `now` dates the expiry. */
export function readCard(body: Record<string, unknown>, now: Date): CardCheck {
  const digits = field(body, "number").replace(/[\s-]/g, "");
  if (!/^\d*$/.test(digits)) return { ok: false, message: "Your card number is invalid." };
  if (digits.length < 12) return { ok: false, message: "Your card number is incomplete." };
  if (digits.length > 19 || !luhn(digits)) return { ok: false, message: "Your card number is invalid." };
  const exp = parseExpiry(field(body, "expiry"));
  if (!exp) return { ok: false, message: "Your card's expiration date is incomplete." };
  const { month, year } = exp;
  if (month < 1 || month > 12) return { ok: false, message: "Your card's expiration date is invalid." };
  const y = now.getUTCFullYear();
  if (year < y) return { ok: false, message: "Your card's expiration year is in the past." };
  if (year === y && month < now.getUTCMonth() + 1) return { ok: false, message: "Your card's expiration date is in the past." };
  if (!/^\d{3,4}$/.test(field(body, "cvc").trim())) return { ok: false, message: "Your card's security code is incomplete." };
  if (!normalizeZip(field(body, "zip"))) return { ok: false, message: "Your ZIP is incomplete." };
  return { ok: true, digits };
}

/** What the fake processor does with a card: the test cards' documented outcomes. */
const outcomeOf = (digits: string) => (digits === DECLINE_CARD ? "decline" : digits === THREE_DS_CARD ? "require_action" : "succeed");

/* ------------------------------------------------------------------ helpers */

const fakeOf = (deps: RouteDeps): FakePaymentGateway | null => (deps.payments instanceof FakePaymentGateway ? deps.payments : null);

/** The metadata every payment of a checkout carries: how a completion proves the payment is this checkout's. */
const metadataOf = (l: Loaded): Record<string, string> => ({ workspace: l.ws, store: l.site, scenario: l.scenario?.id ?? "none", checkout: l.checkout.token });
const names = (m: Record<string, string>, ws: string, store: string, token: string) => m.workspace === ws && m.store === store && m.checkout === token;
const belongs = (m: Record<string, string>, l: Loaded) => names(m, l.ws, l.site, l.checkout.token);

type Refusal = { status: number; error: string; message: string; redirect?: string };

/**
 * Why this checkout cannot pay on `kind` right now (`now`: the store's clock), if it cannot — before anything is
 * created, updated or charged: a delivery date that can no longer be delivered goes back to the information step.
 */
function refusal(req: FastifyRequest, l: Loaded, kind: "card" | "hosted", now: Date): Refusal | null {
  if (l.scenario?.mechanisms.outboundPaymentNotice) return { status: 409, error: "UNAVAILABLE", message: "Card payment isn't available on this page." };
  const need = stepNeeded(l.store, l.checkout);
  if (need) return { status: 409, error: "INCOMPLETE", message: `Complete the ${need} step first.`, redirect: `${req.prefix}${checkoutPath(l.checkout.token, need)}` };
  if (!l.cart.lines.length) return { status: 409, error: "EMPTY_CART", message: "Your cart is empty.", redirect: `${req.prefix}/cart` };
  const late = deliveryProblem(l.store, l.checkout.delivery, now);
  if (late) return { status: 409, error: "DELIVERY_DATE", message: late, redirect: `${req.prefix}${checkoutPath(l.checkout.token, "information")}?${RECHECK_DELIVERY}` };
  const hosted = surfaceOf(l.store, l.scenario) === "checkout";
  if (kind === "card" && hosted) return { status: 409, error: "HOSTED", message: "This store takes payment on its secure payment page.", redirect: `${req.prefix}${checkoutPath(l.checkout.token, "payment")}` };
  if (kind === "hosted" && !hosted) return { status: 409, error: "NOT_HOSTED", message: "Pay with the card form on the payment page.", redirect: `${req.prefix}${checkoutPath(l.checkout.token, "payment")}` };
  return null;
}

/** A refusal: JSON for a script, the page it points to for a form (409 when it points nowhere). */
function refuse(req: FastifyRequest, reply: FastifyReply, r: Refusal): FastifyReply {
  if (!wantsJson(req) && r.redirect) return reply.redirect(r.redirect, 303);
  return reply.code(r.status).send({ error: r.error, message: r.message, ...(r.redirect ? { redirect: r.redirect } : {}) });
}

const BUSY = "Your payment is still being set up in another window. Try again in a moment.";

/** A payment step of the checkout still running elsewhere (another process held its claim too long): try again. */
function busy(req: FastifyRequest, reply: FastifyReply, l: Loaded, json: boolean): FastifyReply {
  if (json) return reply.code(503).header("retry-after", "2").send({ error: "BUSY", message: BUSY });
  return reply.redirect(backWithError(req, l, BUSY), 303);
}

const BUSY_STEP = Symbol("busy");

/** Runs a payment step: BUSY_STEP when another process still held the checkout's claim (answer `busy`). */
async function orBusy<T>(step: () => Promise<T>): Promise<T | typeof BUSY_STEP> {
  try {
    return await step();
  } catch (err) {
    if (err instanceof ClaimBusyError) return BUSY_STEP;
    throw err;
  }
}

/** The total the page showed when Pay was pressed (a form's shownCents field, or the one pay.js sends), or null when none came. */
function shownOf(body: Record<string, unknown>): number | null {
  const s = field(body, "shownCents").trim();
  return /^\d{1,9}$/.test(s) ? Number(s) : null;
}

/* ------------------------------------------------------------------ the price update */

type PriceUpdated = { priceUpdated: { label: string; oldCents: number; newCents: number }; totals: Pick<Totals, "shippingCents" | "taxCents" | "totalCents"> };

const announce = (label: string, oldCents: number, t: Totals): PriceUpdated => ({
  priceUpdated: { label, oldCents, newCents: t.totalCents },
  totals: { shippingCents: t.shippingCents, taxCents: t.taxCents, totalCents: t.totalCents },
});

/**
 * Fires the price update of a checkout, once: its flag and its price_updated event in one statement, so a
 * request that sees the flag set also sees the update recorded. A second caller changes nothing.
 */
async function firePriceUpdate(deps: RouteDeps, l: Loaded, data: { label: string; oldCents: number; newCents: number }): Promise<void> {
  await deps.pool.query(
    `WITH fired AS (
       UPDATE shops.checkouts SET flags = flags || '{"priceUpdated": true}'::jsonb, updated_at = now()
        WHERE workspace_id = $1 AND token = $2 AND NOT (flags ? 'priceUpdated') RETURNING 1)
     INSERT INTO shops.events (workspace_id, store, kind, data) SELECT $1, $3, 'price_updated', $4::jsonb FROM fired`,
    [l.ws, l.checkout.token, l.site, JSON.stringify({ token: l.checkout.token, ...data })],
  );
}

/**
 * The scenario's priceUpdateOnPay, fired by the first payment attempt of a checkout and never again: the
 * answer to give instead of paying, or null with the checkout as it now stands. Only an attempt that starts
 * after the update was recorded — once the shopper could see the new total — pays. So the
 * attempt that fires it does not pay; nor does one that started before it was recorded (the other of two
 * presses at once, which read the checkout before the flag and loses the claim); nor a form that still shows
 * another total (`shownCents`: the same form posted twice without JavaScript, a tab opened before the update).
 */
async function priceUpdate(deps: RouteDeps, l: Loaded, shownCents: number | null): Promise<{ fired: PriceUpdated | null; l: Loaded }> {
  const pu = l.scenario?.mechanisms.priceUpdateOnPay;
  if (!pu) return { fired: null, l };
  if (l.checkout.flags.priceUpdated === true) {
    const t = totalsFor(l, true);
    return { fired: shownCents !== null && shownCents !== t.totalCents ? announce(pu.label, shownCents, t) : null, l };
  }
  const oldCents = totalsFor(l, true).totalCents;
  const now: Loaded = { ...l, checkout: { ...l.checkout, flags: { ...l.checkout.flags, priceUpdated: true } } };
  const t = totalsFor(now, true);
  // Won or lost, this attempt started before the update was recorded: it shows the update and does not pay.
  await firePriceUpdate(deps, l, { label: pu.label, oldCents, newCents: t.totalCents });
  return { fired: announce(pu.label, oldCents, t), l: now };
}

/* ------------------------------------------------------------------ payments and what they pay for */

/** What a payment of the checkout pays for, as the checkout stands now. */
async function snapshotOf(deps: RouteDeps, l: Loaded, t: Totals): Promise<PaymentSnapshot> {
  const c = l.checkout;
  return {
    lines: l.cart.lines,
    addOns: t.addOns.map((a) => a.sku),
    shippingId: c.shippingId,
    promo: l.cart.promo,
    marketing: c.contact?.marketing === true,
    newsletter: (await deps.repos.state.newsletterOf(l.ws, l.site)) !== null,
    delivery: c.delivery,
    totals: t,
    informationDate: typeof c.flags.informationDate === "string" ? c.flags.informationDate : null,
  };
}

/**
 * Runs `fn` holding the checkout's payment claim: its payments are created, updated and recorded one at a time.
 * The claim is a lease taken and given back by single statements (db/claims.ts), never a connection held while
 * Stripe answers — a slow Stripe slows the steps waiting on it, not every page of every store.
 */
const checkoutClaim = <T>(deps: RouteDeps, l: Loaded, fn: () => Promise<T>): Promise<T> => deps.repos.claims.run(l.ws, l.checkout.token, fn);

/** The intent a checkout kept in its flags before payments were recorded. */
const legacyIntent = (l: Loaded): { ref: string; clientSecret: string } | null => {
  const v = l.checkout.flags.paymentIntent as { id?: unknown; secret?: unknown } | undefined;
  return v && typeof v.id === "string" && typeof v.secret === "string" ? { ref: v.id, clientSecret: v.secret } : null;
};

const AMOUNT_FIXED: ReadonlySet<Intent["status"]> = new Set(["processing", "succeeded", "canceled"]);

/**
 * The checkout's one intent at the total `t`, with what it pays for recorded on every attempt: the stored
 * intent, its amount brought in line; or a new one when there is none (or it can no longer be used). `paid`
 * when the stored intent has already gone through (or is going through): the caller completes instead.
 */
async function ensureIntent(deps: RouteDeps, l: Loaded, t: Totals): Promise<{ id: string; clientSecret: string } | { paid: string }> {
  const snapshot = await snapshotOf(deps, l, t);
  const amountCents = t.totalCents;
  const { payments } = deps.repos;
  const r = await checkoutClaim(deps, l, async () => {
    const stored = (await payments.currentIntent(l.ws, l.checkout.token)) ?? legacyIntent(l);
    let use: { id: string; clientSecret: string } | null = null;
    if (stored) {
      let intent: Intent | null = null;
      try {
        intent = await deps.payments.getIntent(stored.ref);
      } catch (err) {
        if (!(err instanceof PaymentNotFoundError)) throw err;
      }
      if (intent && (intent.status === "succeeded" || intent.status === "processing")) return { paid: intent.id };
      if (intent && !AMOUNT_FIXED.has(intent.status)) {
        try {
          if (intent.amountCents !== amountCents) await deps.payments.updateIntentAmount(stored.ref, amountCents);
          use = { id: stored.ref, clientSecret: stored.clientSecret };
        } catch {
          // Refused (an attempt is under way): a fresh intent at the right amount replaces it.
        }
      }
    }
    const created = use === null;
    if (!use) {
      const methods: PaymentMethodType[] = surfaceOf(l.store, l.scenario) === "express-checkout" ? ["card", "link"] : ["card"];
      use = await deps.payments.createIntent({ amountCents, metadata: metadataOf(l), methods, email: l.checkout.contact?.email ?? "", statementDescriptor: statementDescriptor(l.store.brand.name) });
    }
    await payments.save(l.ws, { ref: use.id, checkoutToken: l.checkout.token, store: l.site, kind: "intent", amountCents, snapshot, clientSecret: use.clientSecret });
    return { ...use, created };
  });
  if ("paid" in r) return r;
  if (r.created) await deps.repos.checkouts.update(l.ws, l.checkout.token, { paymentRef: r.id, flags: { paymentIntent: { id: r.id, secret: r.clientSecret } } });
  return { id: r.id, clientSecret: r.clientSecret };
}

/**
 * A hosted session for the checkout at the total `t`, with what it pays for recorded. The checkout's earlier
 * sessions are expired first, so only the newest can be paid; one that was paid a moment before is answered
 * instead (`paid`), to be completed from its own snapshot. A session the processor cannot expire right now
 * (the network) stays open: if it is paid after all, it is recorded as what it charged for.
 */
async function openSession(req: FastifyRequest, deps: RouteDeps, l: Loaded, t: Totals): Promise<{ id: string; url: string } | { paid: string }> {
  const snapshot = await snapshotOf(deps, l, t);
  const base = (await pageCtx(req, deps)).publicBase;
  const { payments } = deps.repos;
  return checkoutClaim(deps, l, async () => {
    for (const old of await payments.ofCheckout(l.ws, l.checkout.token, "session")) {
      if (old.status !== "open") continue;
      let expired: boolean;
      try {
        expired = await deps.payments.expireSession(old.ref);
      } catch (err) {
        if (!(err instanceof PaymentNotFoundError)) {
          req.log.warn({ err: (err as Error).message, session: old.ref }, "an earlier session of the checkout could not be expired");
          continue;
        }
        expired = true;
      }
      // Not expirable: it completed. Paid a moment ago, it is the payment to record; completed without a
      // payment, nothing more can come of it.
      if (!expired && (await deps.payments.getSession(old.ref).catch(() => null))?.paid) return { paid: old.ref };
      await payments.markExpired(l.ws, old.ref);
    }
    const s = await deps.payments.createSession({
      lines: sessionLines(l, t),
      email: l.checkout.contact?.email ?? "",
      successUrl: `${base}${checkoutPath(l.checkout.token, "complete")}?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${base}${checkoutPath(l.checkout.token, "payment")}`,
      metadata: metadataOf(l),
      statementDescriptor: statementDescriptor(l.store.brand.name),
    });
    await payments.save(l.ws, { ref: s.id, checkoutToken: l.checkout.token, store: l.site, kind: "session", amountCents: t.totalCents, snapshot });
    return s;
  });
}

const completeUrl = (req: FastifyRequest, l: Loaded, q: string) => `${req.prefix}${checkoutPath(l.checkout.token, "complete")}?${q}`;
const backWithError = (req: FastifyRequest, l: Loaded, message: string) => `${req.prefix}${checkoutPath(l.checkout.token, "payment")}?error=${encodeURIComponent(message)}`;

/** A hosted session's lines: the items (one discounted line when a code applies), add-ons, fees, shipping and tax — summing to the total. */
export function sessionLines(l: Pick<Loaded, "store" | "cart" | "checkout">, t: Totals): SessionLine[] {
  const cap = (s: string) => (s.length > 120 ? `${s.slice(0, 119)}…` : s);
  const named = l.cart.lines.map((line) => {
    const p = l.store.products.find((x) => x.sku === line.sku);
    const opts = optionsLabel(p, line);
    return `${p?.name ?? line.sku}${opts ? ` (${opts})` : ""}`;
  });
  const out: SessionLine[] =
    t.discountCents > 0
      ? [{ name: cap(`${named.map((n, i) => `${n} × ${l.cart.lines[i]?.qty ?? 1}`).join(", ")}, with ${l.cart.promo ?? "a discount"} (${minus(t.discountCents)})`), unitCents: t.subtotalCents - t.discountCents, qty: 1 }]
      : named.map((name, i) => ({ name: cap(name), unitCents: t.lines[i]?.unitCents ?? 0, qty: l.cart.lines[i]?.qty ?? 1 }));
  for (const a of t.addOns) out.push({ name: cap(a.name), unitCents: a.cents, qty: 1 });
  for (const f of t.fees) out.push({ name: cap(f.label), unitCents: f.cents, qty: 1 });
  const method = l.store.shipping.find((m) => m.id === l.checkout.shippingId);
  if (t.shippingCents > 0) out.push({ name: `${l.store.delivery ? "Delivery" : "Shipping"} — ${method?.label ?? "Standard"}`, unitCents: t.shippingCents, qty: 1 });
  if (t.taxCents > 0) out.push({ name: "Sales tax", unitCents: t.taxCents, qty: 1 });
  return out.filter((x) => x.unitCents > 0);
}

/** The shopper's message for a payment that has not gone through. */
function unpaidMessage(i: Intent): string {
  switch (i.status) {
    case "requires_action":
      return "Your bank asked you to confirm this payment. Pay again and complete the verification step.";
    case "processing":
      return "Your payment is still processing. Check back in a moment.";
    case "canceled":
      return "This payment was canceled. Please try again.";
    default:
      return i.lastError ?? "Your payment was not completed. Please try again.";
  }
}

/* ------------------------------------------------------------------ attempts, as Stripe recorded them */

/** Where a payment's attempts are logged: its workspace, store and checkout, and the store's payment (an intent, or a session). */
type AttemptsAt = { ws: string; site: string; token: string; ref: string };

/**
 * Stripe mode: logs the attempts Stripe recorded for a payment — `intent` as just read (a session's: its
 * PaymentIntent) — as payment_attempt events in fake mode's words (see the header), each once. The newest attempt
 * the intent shows is looked up first: on record already, so is everything before it, and Stripe's charges are not
 * read again. True when Stripe shows an attempt and it is on record. Fake mode logs its attempts where its card
 * pages take them: nothing here (false).
 */
async function logAttempts(deps: RouteDeps, at: AttemptsAt, intent: Intent | null): Promise<boolean> {
  if (deps.payments.mode !== "stripe" || !intent) return false;
  const newest = newestAttempt(intent);
  if (!newest) return false;
  const { events } = deps.repos;
  if (await events.attemptOnRecord(at.ws, at.site, at.ref, newest.attempt, newest.result ?? undefined)) return true;
  const attempts = attemptsOf(intent, await deps.payments.charges(intent.id));
  await events.recordAttempts(at.ws, at.site, { token: at.token, ref: at.ref }, attempts);
  return attempts.length > 0;
}

/** logAttempts where it must not stand in the way (a completion, the reconcile step): a failure is logged, and the next reading catches up. */
async function logAttemptsQuietly(req: FastifyRequest, deps: RouteDeps, at: AttemptsAt, intent: Intent | null): Promise<void> {
  try {
    await logAttempts(deps, at, intent);
  } catch (err) {
    req.log.warn({ err: (err as Error).message, payment: at.ref }, "the payment's attempts could not be read back from the processor");
  }
}

/* ------------------------------------------------------------------ completion: one order per payment */

/** A workspace's store, as completing its payments needs it. */
type Shop = { ws: string; site: StoreId; store: StoreDef; scenario: ScenarioDef | null };

/** A payment that went through: the order's payment ref, what the processor charged, and the payment it was (an intent's or a session's id). */
type Paid = { ref: string; cents: number; payment: string };

/** A paid payment's record and what it paid for. */
type Resolved = { row: PaymentRow | null; snapshot: PaymentSnapshot };

/** What an earlier order of the checkout was for: the fallback of a payment the store never recorded. */
const fromOrder = (o: OrderRow, informationDate: string | null): PaymentSnapshot => ({
  lines: o.lines,
  addOns: o.details.addOns,
  shippingId: o.details.shippingId,
  promo: o.details.promo,
  marketing: o.details.marketing,
  newsletter: false,
  delivery: o.details.delivery,
  totals: o.totals,
  informationDate,
});

/**
 * What a paid payment of the checkout `l` paid for: the snapshot recorded for it — found by its own id, or
 * for a session by the PaymentIntent it was paid with. A payment the store never recorded (one created
 * before payments were) falls back to the checkout as it stands while it is open, or to what its earlier
 * order was for: never to a cart an order already emptied.
 */
async function snapshotFor(deps: RouteDeps, l: Loaded, paid: Paid): Promise<Resolved> {
  const { payments } = deps.repos;
  let row = (await payments.get(l.ws, paid.payment)) ?? (await payments.paidBy(l.ws, paid.ref));
  if (!row) {
    for (const s of await payments.ofCheckout(l.ws, l.checkout.token, "session")) {
      const found = await deps.payments.getSession(s.ref).catch(() => null);
      if (found?.paymentIntentId === paid.ref) {
        row = s;
        break;
      }
    }
  }
  if (row) return { row, snapshot: row.snapshot };
  const earlier = l.checkout.status === "paid" ? await orderOf(deps, l.ws, l.checkout.token) : null;
  const informationDate = typeof l.checkout.flags.informationDate === "string" ? l.checkout.flags.informationDate : null;
  return { row: null, snapshot: earlier ? fromOrder(earlier, informationDate) : await snapshotOf(deps, l, totalsFor(l, true)) };
}

/**
 * The order of a payment that went through, built and graded from what it paid for and what the processor
 * charged — never from the live cart. Placed once per payment under the store's lock, classified against the
 * store's earlier orders (a second one is `duplicate` — Review Focus 3) and the delivery date against the
 * store-local day it was chosen on; numbered with the class's suffix. The first order of a checkout empties
 * the cart it paid for — or, recorded by the reconcile step (`reconciled`: the shopper never came back to the
 * store's page and may have started another purchase since), takes only the lines it paid for out of it; a later
 * order (an old session paid too) leaves the cart alone. Then the checkout is paid and the confirmation sent (once
 * per order, claimed on the checkout).
 */
async function completePayment(req: FastifyRequest, deps: RouteDeps, shop: Shop, token: string, paid: Paid, found: Resolved, reconciled: boolean): Promise<OrderRow | null> {
  const { orders, payments, checkouts, carts, events, state } = deps.repos;
  const s = found.snapshot;
  const checkout = await checkouts.get(shop.ws, token);
  const scenarioId = shop.scenario?.id ?? null;
  const paidCheckout: PaidCheckout = {
    lines: s.lines,
    addOns: s.addOns,
    shippingId: s.shippingId,
    totalCents: paid.cents,
    promo: s.promo,
    marketing: s.marketing,
    delivery: s.delivery ? { date: s.delivery.date, message: s.delivery.message, signature: s.delivery.signature } : null,
    newsletter: (await state.newsletterOf(shop.ws, shop.site)) !== null,
  };
  const today = s.informationDate ?? storeToday(deps.now());
  const wallet = await walletOf(req, deps, shop, token, paid);
  const placed = await orders.placeOnce(shop.ws, shop.site, paid.ref, (prior) => {
    const cls = classify(shop.scenario, paidCheckout, { priorPaidOrders: prior.paidOrders, today, ...wallet });
    return {
      orderNo: newOrderNumber(shop.store.orderPrefix, suffixTable(deps.suffixKey, scenarioId ?? "none")[cls]),
      store: shop.site,
      checkoutToken: token,
      paymentRef: paid.ref,
      lines: s.lines,
      totals: s.totals,
      outcomeClass: cls,
      scenarioId,
      email: checkout?.contact?.email ?? "",
      details: { shippingId: s.shippingId, addOns: s.addOns, promo: s.promo, marketing: s.marketing, delivery: s.delivery },
      chargedCents: paid.cents,
    };
  });
  if (found.row) await payments.markPaid(shop.ws, found.row.ref, paid.ref);
  if (placed.created) {
    if (placed.firstOfCheckout) await (reconciled ? carts.removeLines(shop.ws, shop.site, s.lines) : carts.clear(shop.ws, shop.site));
    await events.record(shop.ws, shop.site, "order_placed", {
      token,
      orderNo: placed.orderNo,
      paymentRef: paid.ref,
      approvedCents: wallet.approvedCents,
      ...(wallet.walletCard !== null ? { walletCard: wallet.walletCard } : {}),
      ...(wallet.cardOnFile ? { cardOnFile: true } : {}),
      ...(wallet.claimed ? { claimed: wallet.claimed } : {}),
      ...(wallet.approvalUnknown ? { approvalUnknown: true } : {}),
      ...(reconciled ? { reconciled: true } : {}),
    });
    if (paid.cents !== s.totals.totalCents) await events.record(shop.ws, shop.site, "amount_mismatch", { token, orderNo: placed.orderNo, chargedCents: paid.cents, computedCents: s.totals.totalCents });
  }
  await checkouts.markPaid(shop.ws, token);
  const order = await orders.get(shop.ws, placed.orderNo);
  if (order) await sendConfirmation(req, deps, shop, token, order);
  return order;
}

/** What the order is classed with from the shopper's wallet (ClassifyContext's wallet fields), and what the wallet bound to it. */
type WalletReading = ApprovalAnswer & { approvalUnknown: boolean };

/**
 * What the shopper's wallet says of this payment: the approval the charge is held against (paid above approval), and
 * whether the card that paid — its last four, read from the processor's charge, only when there is a wallet to ask —
 * is one the wallet issued for this store (no_wallet_card when not). A wallet that cannot be asked does not hold up
 * the order, but leaves it ungraded: approval_unknown, never correct, and an event says why for the audit.
 */
async function walletOf(req: FastifyRequest, deps: RouteDeps, shop: Shop, token: string, paid: Paid): Promise<WalletReading> {
  const last4 = async () => {
    const charges = await deps.payments.charges(paid.ref);
    return charges.filter((c) => c.status === "succeeded").at(-1)?.card?.last4 ?? null;
  };
  try {
    return { ...(await deps.approvals.approvalFor(shop.ws, shop.site, { amountCents: paid.cents, last4 })), approvalUnknown: false };
  } catch (err) {
    req.log.warn({ err: (err as Error).message }, "the wallet's approval could not be read");
    await deps.repos.events.record(shop.ws, shop.site, "approval_unknown", { token, error: (err as Error).message });
    return { approvedCents: null, walletCard: null, claimed: null, approvalUnknown: true };
  }
}

async function sendConfirmation(req: FastifyRequest, deps: RouteDeps, shop: Shop, token: string, order: OrderRow): Promise<void> {
  const flag = `mailed:${order.orderNo}`;
  if (!(await claimFlag(deps, shop.ws, token, flag))) return;
  try {
    await deps.mailerFor(shop.site).deliver(shop.ws, confirmationEmail(shop.store, order, await deps.repos.checkouts.get(shop.ws, token)));
  } catch (err) {
    req.log.error({ err: (err as Error).message, orderNo: order.orderNo }, "the order confirmation email was not delivered");
    await releaseFlag(deps, shop.ws, token, flag);
  }
}

/**
 * An open payment as the processor has it now: what went through (its order's ref and the charge), or null; and
 * the intent its attempts were made on (a session's PaymentIntent), when it is this checkout's.
 */
async function settled(req: FastifyRequest, deps: RouteDeps, shop: Shop, p: PaymentRow): Promise<{ paid: Paid | null; intent: Intent | null }> {
  const none = { paid: null, intent: null };
  try {
    if (p.kind === "intent") {
      const i = await deps.payments.getIntent(p.ref);
      if (!names(i.metadata, shop.ws, shop.site, p.checkoutToken)) return none;
      return { paid: i.status === "succeeded" ? { ref: i.id, cents: i.amountCents, payment: p.ref } : null, intent: i };
    }
    const s = await deps.payments.getSession(p.ref);
    if (!names(s.metadata, shop.ws, shop.site, p.checkoutToken)) return none;
    return { paid: s.paid ? { ref: s.paymentIntentId ?? s.id, cents: s.amountCents, payment: p.ref } : null, intent: s.intent };
  } catch (err) {
    if (err instanceof PaymentNotFoundError) {
      await deps.repos.payments.markExpired(shop.ws, p.ref); // gone from the processor: nothing to wait for
      return none;
    }
    req.log.warn({ err: (err as Error).message, payment: p.ref }, "a payment could not be read back from the processor");
    return none;
  }
}

/** What the reconcile step found: the viewed checkout's own payment (its return URL's query), and the orders it recorded. */
type Reconciled = { own: string | null; orders: OrderRow[] };

/**
 * Records every payment of the store that went through without reaching its return URL, oldest first (see the
 * header): the store's earlier orders, before whatever the caller does next — with the attempts Stripe recorded
 * for each open payment, paid or not (a card declined on a page the shopper then left). `except`: the payment
 * the caller completes itself, which only the payments made before it (`before`) precede. `viewing`: on a
 * checkout's payment step, that checkout's own payment is not completed here but answered as its return URL's
 * query (`own`), for the step to send the shopper there. `orders`: the orders of the payments it found paid, in
 * order — the shopper is to be shown them (routes/recovered.ts).
 */
async function reconcile(req: FastifyRequest, deps: RouteDeps, shop: Shop, opts: { except?: string; before?: string | null; viewing?: string } = {}): Promise<Reconciled> {
  const before = opts.before ? Date.parse(opts.before) : null;
  const open = (await deps.repos.payments.open(shop.ws, shop.site)).filter((p) => p.ref !== opts.except && (before === null || Date.parse(p.createdAt) < before));
  const orders: OrderRow[] = [];
  if (!open.length) return { own: null, orders };
  const found = await Promise.all(open.map((p) => settled(req, deps, shop, p)));
  await Promise.all(found.map((f, i) => logAttemptsQuietly(req, deps, { ws: shop.ws, site: shop.site, token: (open[i] as PaymentRow).checkoutToken, ref: (open[i] as PaymentRow).ref }, f.intent)));
  for (const [i, { paid }] of found.entries()) {
    const p = open[i] as PaymentRow;
    if (!paid) continue;
    if (opts.viewing === p.checkoutToken) return { own: `${p.kind === "intent" ? "payment_intent" : "session_id"}=${encodeURIComponent(p.ref)}`, orders };
    const order = await completePayment(req, deps, shop, p.checkoutToken, paid, { row: p, snapshot: p.snapshot }, true);
    if (order) orders.push(order);
  }
  return { own: null, orders };
}

/** The store of a store site's request in this workspace, or null (paylantern, no workspace). */
async function shopOf(req: FastifyRequest): Promise<Shop | null> {
  if (!req.store || !req.workspaceId) return null;
  return { ws: req.workspaceId, site: req.site as StoreId, store: req.store, scenario: await req.scenario() };
}

/**
 * The reconcile step for a reader outside the store's pages — the internal state API, before it answers: every
 * payment of workspace `ws` at `store` that went through without its browser reaching the return URL is recorded
 * as its order, and every open payment's attempts as Stripe has them, so the audit reads what was paid.
 */
export async function reconcileStore(req: FastifyRequest, deps: RouteDeps, ws: string, store: StoreDef): Promise<void> {
  await reconcile(req, deps, { ws, site: store.id, store, scenario: await scenarioOf(deps, ws, store.id) });
}

/* ------------------------------------------------------------------ routes */

const completeQuery = z.object({ payment_intent: z.string().max(200).optional(), session_id: z.string().max(200).optional(), recovered: z.string().max(10).optional() }).catch({});
const sessionPending = new Set<string>();

/**
 * The routes that first record the store's payments that went through unseen: the cart (its page and the drawer's
 * cart.json), starting a checkout, the payment step and every way to pay.
 */
const RECONCILED = new Set([
  "GET /cart",
  "GET /cart.json",
  "POST /checkout",
  "GET /checkout/:token/payment",
  "POST /checkout/:token/payment/intent",
  "POST /checkout/:token/payment/session",
  "POST /checkout/:token/payment/fake-confirm",
]);

/** The drawer's cart: its answer carries the recorded order (cart.ts), the cart as it now stands beside it. */
const CARRIES_RECOVERED = "GET /cart.json";

export function registerPayRoutes(scope: FastifyInstance, deps: RouteDeps): void {
  const { events } = deps.repos;

  // A scope-wide hook, so the cart and checkout routes need not know about it: before any of RECONCILED runs. What it
  // records, the shopper is shown (routes/recovered.ts): a page or a form goes to the order's confirmation, which says
  // so; a script is answered with the order instead — beside the cart for the drawer, in place of what a payment step
  // would have started (409 RECOVERED, with the confirmation to go to).
  scope.addHook("preHandler", async (req, reply) => {
    const route = `${req.method} ${(req.routeOptions.url ?? "").replace(/^\/s\/:site(?=\/)/, "")}`;
    if (!RECONCILED.has(route)) return;
    const shop = await shopOf(req);
    if (!shop) return;
    const viewing = route === "GET /checkout/:token/payment" ? (req.params as { token?: string }).token : undefined;
    const { own, orders } = await reconcile(req, deps, shop, { viewing });
    if (own && viewing) return reply.redirect(`${req.prefix}${checkoutPath(viewing, "complete")}?${own}&${RECOVERED_QUERY}`, 303);
    const order = orders.at(-1);
    if (!order) return;
    const recovered = recoveredOrder(req.prefix, order.orderNo);
    if (route === CARRIES_RECOVERED) {
      noteRecovered(req, recovered);
      return;
    }
    if (!wantsJson(req)) return reply.redirect(recovered.url, 303);
    return reply.code(409).send({ error: "RECOVERED", message: recovered.message, orderNo: recovered.orderNo, redirect: recovered.url, recovered });
  });

  scope.post<{ Params: { token: string } }>("/checkout/:token/payment/intent", async (req, reply) => {
    const loaded = await loadCheckout(req, reply, deps);
    if (!loaded) return reply;
    const no = refusal(req, loaded, "card", deps.now());
    if (no) return reply.code(no.status).send({ error: no.error, message: no.message, ...(no.redirect ? { redirect: no.redirect } : {}) });
    const { fired, l } = await priceUpdate(deps, loaded, shownOf(formBody.parse(req.body)));
    if (fired) return reply.send(fired);
    const totals = totalsFor(l, true);
    const r = await orBusy(() => ensureIntent(deps, l, totals));
    if (r === BUSY_STEP) return busy(req, reply, l, true);
    if ("paid" in r) return reply.code(409).send({ error: "PAID", message: "This payment has already gone through.", redirect: completeUrl(req, l, `payment_intent=${encodeURIComponent(r.paid)}`) });
    return reply.header("cache-control", "no-store").send({ clientSecret: r.clientSecret, publishableKey: deps.payments.publishableKey, amountCents: totals.totalCents, mode: deps.payments.mode });
  });

  scope.post<{ Params: { token: string } }>("/checkout/:token/payment/session", async (req, reply) => {
    const loaded = await loadCheckout(req, reply, deps);
    if (!loaded) return reply;
    const no = refusal(req, loaded, "hosted", deps.now());
    if (no) return refuse(req, reply, no);
    const { fired, l } = await priceUpdate(deps, loaded, shownOf(formBody.parse(req.body)));
    if (fired) return wantsJson(req) ? reply.send(fired) : reply.redirect(`${req.prefix}${checkoutPath(l.checkout.token, "payment")}?updated=1`, 303);
    const totals = totalsFor(l, true);
    const s = await orBusy(() => openSession(req, deps, l, totals));
    if (s === BUSY_STEP) return busy(req, reply, l, wantsJson(req));
    if ("paid" in s) {
      const to = completeUrl(req, l, `session_id=${encodeURIComponent(s.paid)}`);
      return wantsJson(req) ? reply.code(409).send({ error: "PAID", message: "This payment has already gone through.", redirect: to }) : reply.redirect(to, 303);
    }
    await deps.repos.checkouts.update(l.ws, l.checkout.token, { flags: { lastSession: s.id } });
    await events.record(l.ws, l.site, "session_created", { token: l.checkout.token, session: s.id, amountCents: totals.totalCents });
    const to = s.url.startsWith("/") ? `${req.prefix}${s.url}` : s.url;
    return wantsJson(req) ? reply.send({ url: to }) : reply.redirect(to, 303);
  });

  scope.get<{ Params: { token: string } }>("/checkout/:token/complete", async (req, reply) => {
    const l = await loadCheckout(req, reply, deps, { allowPaid: true });
    if (!l) return reply;
    const q = completeQuery.parse(req.query);
    const bad = async (status: number, error: string, message: string) => {
      if (wantsJson(req)) return reply.code(status).send({ error, message });
      const ctx = (await pageCtx(req, deps)) as StoreCtx;
      return sendHtml(reply, paymentProblemPage(ctx, { message, back: `${req.prefix}${checkoutPath(l.checkout.token, "payment")}` }), status);
    };
    let paid: Paid | null = null;
    let failure = "Your payment was not completed. Please try again.";
    // The payment's attempts, logged before its order: the intent they were made on, under the store's payment.
    let attempts: { ref: string; intent: Intent | null } | null = null;
    try {
      if (q.payment_intent) {
        const i = await deps.payments.getIntent(q.payment_intent);
        if (!belongs(i.metadata, l)) return bad(400, "WRONG_PAYMENT", "This payment does not belong to this checkout.");
        attempts = { ref: i.id, intent: i };
        if (i.status === "succeeded") paid = { ref: i.id, cents: i.amountCents, payment: i.id };
        else failure = unpaidMessage(i);
      } else if (q.session_id) {
        const s = await deps.payments.getSession(q.session_id);
        if (!belongs(s.metadata, l)) return bad(400, "WRONG_PAYMENT", "This payment does not belong to this checkout.");
        attempts = { ref: s.id, intent: s.intent };
        if (s.paid) paid = { ref: s.paymentIntentId ?? s.id, cents: s.amountCents, payment: s.id };
      } else {
        return bad(400, "MISSING_PAYMENT", "A payment_intent or session_id is required.");
      }
    } catch (err) {
      if (err instanceof PaymentNotFoundError) return reply.callNotFound();
      throw err;
    }
    if (attempts) await logAttemptsQuietly(req, deps, { ws: l.ws, site: l.site, token: l.checkout.token, ref: attempts.ref }, attempts.intent);
    if (!paid) {
      await events.record(l.ws, l.site, "payment_incomplete", { token: l.checkout.token, ref: q.payment_intent ?? q.session_id ?? null, message: failure });
      return reply.redirect(backWithError(req, l, failure), 303);
    }
    const shop: Shop = { ws: l.ws, site: l.site, store: l.store, scenario: l.scenario };
    const found = await snapshotFor(deps, l, paid);
    // Payments of the store that went through unseen before this one are its earlier orders.
    await reconcile(req, deps, shop, { except: found.row?.ref ?? paid.payment, before: found.row?.createdAt ?? null });
    const order = await completePayment(req, deps, shop, l.checkout.token, paid, found, false);
    // Sent here by the payment step, which found the payment through without its return page: the order says so.
    const notice = q.recovered === "1" ? `?${RECOVERED_QUERY}` : "";
    return reply.redirect(`${req.prefix}/orders/${encodeURIComponent(order?.orderNo ?? "")}${notice}`, 303);
  });

  /* ---------------------------------------------------------------- Stripe mode: the attempts pay.js reports */

  scope.post<{ Params: { token: string } }>("/checkout/:token/payment/report", async (req, reply) => {
    if (fakeOf(deps)) return reply.callNotFound();
    const l = await loadCheckout(req, reply, deps);
    if (!l) return reply;
    const asked = field(formBody.parse(req.body), "payment_intent").trim().slice(0, 200);
    const id = asked || (await deps.repos.payments.currentIntent(l.ws, l.checkout.token))?.ref || legacyIntent(l)?.ref;
    if (!id) return reply.code(409).send({ error: "NO_PAYMENT", message: "This checkout has no payment to report." });
    let i: Intent;
    try {
      i = await deps.payments.getIntent(id);
    } catch (err) {
      if (err instanceof PaymentNotFoundError) return reply.callNotFound();
      throw err;
    }
    if (!belongs(i.metadata, l)) return reply.code(400).send({ error: "WRONG_PAYMENT", message: "This payment does not belong to this checkout." });
    // Stripe's record of the intent, logged in fake mode's words and each attempt once (another reading may have
    // logged it already: then it is simply on record). Nothing tried (a form the browser itself refused): nothing.
    const recorded = await logAttempts(deps, { ws: l.ws, site: l.site, token: l.checkout.token, ref: i.id }, i);
    if (i.status === "succeeded" || i.status === "processing") return reply.send({ status: i.status, redirect: completeUrl(req, l, `payment_intent=${encodeURIComponent(i.id)}`) });
    return reply.send({ recorded, status: i.status, error: i.lastError });
  });

  /* ---------------------------------------------------------------- fake mode: the card form on the payment step */

  scope.post<{ Params: { token: string } }>("/checkout/:token/payment/fake-confirm", { bodyLimit: CARD_FORM_BODY_LIMIT }, async (req, reply) => {
    const gw = fakeOf(deps);
    if (!gw) return reply.callNotFound();
    const loaded = await loadCheckout(req, reply, deps);
    if (!loaded) return reply;
    const no = refusal(req, loaded, "card", deps.now());
    if (no) return refuse(req, reply, no);
    const json = wantsJson(req);
    const body = formBody.parse(req.body);
    const { fired, l } = await priceUpdate(deps, loaded, shownOf(body));
    if (fired) return json ? reply.send(fired) : reply.redirect(`${req.prefix}${checkoutPath(l.checkout.token, "payment")}?updated=1`, 303);
    const card = readCard(body, deps.now());
    if (!card.ok) return json ? reply.code(422).send({ status: "requires_payment_method", error: card.message }) : reply.redirect(backWithError(req, l, card.message), 303);
    const r = await orBusy(() => ensureIntent(deps, l, totalsFor(l, true)));
    if (r === BUSY_STEP) return busy(req, reply, l, json);
    const id = "paid" in r ? r.paid : r.id;
    if (!("paid" in r)) {
      const outcome = outcomeOf(card.digits);
      gw.settle(id, outcome, card.digits.slice(-4));
      await events.record(l.ws, l.site, "payment_attempt", { token: l.checkout.token, ref: id, result: outcome === "succeed" ? "succeeded" : outcome === "decline" ? "declined" : "requires_action" });
    }
    const intent = await gw.getIntent(id);
    if (intent.status === "succeeded" || intent.status === "processing") {
      const to = completeUrl(req, l, `payment_intent=${encodeURIComponent(id)}`);
      return json ? reply.send({ status: "succeeded", redirect: to }) : reply.redirect(to, 303);
    }
    if (intent.status === "requires_action") {
      const to = `${req.prefix}${checkoutPath(l.checkout.token, "payment/authenticate")}`;
      return json ? reply.send({ status: "requires_action", authenticate: to, amountCents: intent.amountCents }) : reply.redirect(to, 303);
    }
    const message = intent.lastError ?? "Your payment was not completed. Please try again.";
    return json ? reply.code(402).send({ status: "requires_payment_method", error: message }) : reply.redirect(backWithError(req, l, message), 303);
  });

  /** The checkout's intent waiting for authentication, or null. */
  const pendingIntent = async (gw: FakePaymentGateway, l: Loaded): Promise<Intent | null> => {
    const stored = (await deps.repos.payments.currentIntent(l.ws, l.checkout.token)) ?? legacyIntent(l);
    if (!stored) return null;
    try {
      const i = await gw.getIntent(stored.ref);
      return i.status === "requires_action" ? i : null;
    } catch {
      return null;
    }
  };

  scope.get<{ Params: { token: string } }>("/checkout/:token/payment/authenticate", async (req, reply) => {
    const gw = fakeOf(deps);
    if (!gw) return reply.callNotFound();
    const l = await loadCheckout(req, reply, deps);
    if (!l) return reply;
    const i = await pendingIntent(gw, l);
    if (!i) return reply.redirect(`${req.prefix}${checkoutPath(l.checkout.token, "payment")}`, 303);
    const ctx = (await pageCtx(req, deps)) as StoreCtx;
    return sendHtml(reply, authenticatePage(ctx, { amountCents: i.amountCents, action: `${req.prefix}${checkoutPath(l.checkout.token, "payment/authenticate")}`, back: checkoutPath(l.checkout.token, "payment") }));
  });

  scope.post<{ Params: { token: string } }>("/checkout/:token/payment/authenticate", async (req, reply) => {
    const gw = fakeOf(deps);
    if (!gw) return reply.callNotFound();
    const l = await loadCheckout(req, reply, deps);
    if (!l) return reply;
    const json = wantsJson(req);
    const i = await pendingIntent(gw, l);
    if (!i) return json ? reply.code(409).send({ error: "NOT_PENDING", message: "There is no payment waiting for authentication." }) : reply.redirect(`${req.prefix}${checkoutPath(l.checkout.token, "payment")}`, 303);
    if (field(formBody.parse(req.body), "result") === "complete") {
      gw.settle(i.id, "succeed");
      await events.record(l.ws, l.site, "payment_attempt", { token: l.checkout.token, ref: i.id, result: "authenticated" });
      const to = completeUrl(req, l, `payment_intent=${encodeURIComponent(i.id)}`);
      return json ? reply.send({ status: "succeeded", redirect: to }) : reply.redirect(to, 303);
    }
    gw.settle(i.id, "fail_authentication");
    await events.record(l.ws, l.site, "payment_attempt", { token: l.checkout.token, ref: i.id, result: "authentication_failed" });
    return json ? reply.code(402).send({ status: "requires_payment_method", error: AUTHENTICATION_FAILED }) : reply.redirect(backWithError(req, l, AUTHENTICATION_FAILED), 303);
  });

  /* ---------------------------------------------------------------- fake mode: the hosted page of a session */

  type FakeSession = { id: string; amountCents: number; lines: SessionLine[]; email: string; successUrl: string; cancelUrl: string; token: string; expired: boolean };

  /** A session of this workspace at this store, as the fake processor holds it; null (after a 404) otherwise. */
  const sessionOf = async (req: FastifyRequest, id: string, reply: FastifyReply): Promise<{ gw: FakePaymentGateway; s: FakeSession; store: StoreDef } | null> => {
    const gw = fakeOf(deps);
    const store = req.store;
    let found: FakeSession | null = null;
    if (gw && store) {
      try {
        const r = gw.inspect(id);
        if (r.kind === "session" && r.metadata.workspace === req.workspaceId && r.metadata.store === req.site) {
          found = { id, amountCents: r.amountCents, lines: r.lines, email: r.email, successUrl: r.successUrl, cancelUrl: r.cancelUrl, token: r.metadata.checkout ?? "", expired: r.expired };
        }
      } catch (err) {
        if (!(err instanceof PaymentNotFoundError)) throw err;
      }
    }
    if (!gw || !store || !found) {
      await reply.callNotFound();
      return null;
    }
    return { gw, s: found, store };
  };
  const successOf = (s: FakeSession) => s.successUrl.replace("{CHECKOUT_SESSION_ID}", encodeURIComponent(s.id));
  const sessionPath = (req: FastifyRequest, s: FakeSession, rest = "") => `${req.prefix}/fake-pay/session/${encodeURIComponent(s.id)}${rest}`;
  /** A superseded session: back to the store's payment step, which says so. */
  const expiredTo = (s: FakeSession) => `${s.cancelUrl}?error=${encodeURIComponent(SESSION_EXPIRED)}`;

  /** The session's 3-D Secure step failed: its intent goes back to waiting for a card, as Stripe's does. */
  const failAuthentication = (gw: FakePaymentGateway, id: string) => {
    try {
      gw.settleSession(id, "fail_authentication");
    } catch {
      // No step waiting on the intent (the step's page opened again from history): nothing more to fail.
    }
  };

  /**
   * A card on the session's page, settled on the session's intent as Stripe keeps it: true — or false when the
   * session expired meanwhile (a newer one of its checkout replaced it).
   */
  const settledOn = (gw: FakePaymentGateway, s: FakeSession, outcome: "succeed" | "decline" | "require_action", last4: string | null = null): boolean => {
    try {
      gw.settleSession(s.id, outcome, last4);
      return true;
    } catch (err) {
      const now = gw.inspect(s.id);
      if (now.kind === "session" && now.expired) return false;
      throw err;
    }
  };

  /** Pays the session (with the card ending `last4`; null: completing the one that waited for 3-D Secure) — unless it expired meanwhile: then back to the store. */
  const settleOrBack = (reply: FastifyReply, gw: FakePaymentGateway, s: FakeSession, last4: string | null = null) =>
    settledOn(gw, s, "succeed", last4) ? reply.redirect(successOf(s), 303) : reply.redirect(expiredTo(s), 303);

  const renderSession = async (req: FastifyRequest, reply: FastifyReply, s: FakeSession, error: string | null, status = 200) => {
    const ctx = (await pageCtx(req, deps)) as StoreCtx;
    return sendHtml(reply, fakeSessionPage(ctx, { amountCents: s.amountCents, lines: s.lines, email: s.email, action: sessionPath(req, s), cancelUrl: s.cancelUrl, error }), status);
  };

  scope.get<{ Params: { id: string }; Querystring: { error?: string } }>("/fake-pay/session/:id", async (req, reply) => {
    const found = await sessionOf(req, req.params.id, reply);
    if (!found) return reply;
    if ((await found.gw.getSession(found.s.id)).paid) return reply.redirect(successOf(found.s), 303);
    if (found.s.expired) return reply.redirect(expiredTo(found.s), 303);
    return renderSession(req, reply, found.s, req.query.error === "auth" ? AUTHENTICATION_FAILED : null);
  });

  scope.post<{ Params: { id: string } }>("/fake-pay/session/:id", { bodyLimit: CARD_FORM_BODY_LIMIT }, async (req, reply) => {
    const found = await sessionOf(req, req.params.id, reply);
    if (!found) return reply;
    const { gw, s, store } = found;
    if ((await gw.getSession(s.id)).paid) return reply.redirect(successOf(s), 303);
    if (s.expired) return reply.redirect(expiredTo(s), 303);
    const card = readCard(formBody.parse(req.body), deps.now());
    if (!card.ok) return renderSession(req, reply, s, card.message, 422);
    const outcome = outcomeOf(card.digits);
    await events.record(req.workspaceId, store.id, "payment_attempt", { token: s.token, ref: s.id, result: outcome === "succeed" ? "succeeded" : outcome === "decline" ? "declined" : "requires_action" });
    const last4 = card.digits.slice(-4);
    if (outcome === "succeed") return settleOrBack(reply, gw, s, last4);
    // The session's intent keeps the attempt, as Stripe's does.
    if (!settledOn(gw, s, outcome, last4)) return reply.redirect(expiredTo(s), 303);
    if (outcome === "decline") return renderSession(req, reply, s, "Your card was declined.", 402);
    sessionPending.add(s.id);
    return reply.redirect(sessionPath(req, s, "/authenticate"), 303);
  });

  scope.get<{ Params: { id: string } }>("/fake-pay/session/:id/authenticate", async (req, reply) => {
    const found = await sessionOf(req, req.params.id, reply);
    if (!found) return reply;
    if (found.s.expired) return reply.redirect(expiredTo(found.s), 303);
    if (!sessionPending.has(found.s.id)) return reply.redirect(sessionPath(req, found.s), 303);
    const ctx = (await pageCtx(req, deps)) as StoreCtx;
    return sendHtml(reply, fakeAuthPage(ctx, { amountCents: found.s.amountCents, action: sessionPath(req, found.s, "/authenticate"), back: sessionPath(req, found.s) }));
  });

  scope.post<{ Params: { id: string } }>("/fake-pay/session/:id/authenticate", async (req, reply) => {
    const found = await sessionOf(req, req.params.id, reply);
    if (!found) return reply;
    const { gw, s, store } = found;
    if (s.expired) {
      sessionPending.delete(s.id);
      return reply.redirect(expiredTo(s), 303);
    }
    if (!sessionPending.delete(s.id)) return reply.redirect(sessionPath(req, s), 303);
    const ok = field(formBody.parse(req.body), "result") === "complete";
    await events.record(req.workspaceId, store.id, "payment_attempt", { token: s.token, ref: s.id, result: ok ? "authenticated" : "authentication_failed" });
    if (!ok) {
      failAuthentication(gw, s.id);
      return reply.redirect(sessionPath(req, s, "?error=auth"), 303);
    }
    return settleOrBack(reply, gw, s);
  });
}
