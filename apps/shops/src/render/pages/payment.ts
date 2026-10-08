import type { Brand, StoreDef, Surface, Totals } from "@benchme/storefront";
import type { Checkout } from "../../db/index.js";
import { assetHref, esc, href, icon } from "../components.js";
import { CHECKOUT_CSS, FAKE_PAY_CSS, alertBox, checkoutShell, jsonScript, money, reviewBox, textField, type ReviewRow, type SummaryView } from "../checkout-views.js";
import { fontStack, layout, type StoreCtx } from "../layout.js";
import { reviewRows } from "./checkout.js";

/** Stripe.js: the one script a payment page loads from elsewhere (Stripe requires it from js.stripe.com). */
export const STRIPE_JS = "https://js.stripe.com/v3/";

/** The script of fake mode's card form (public/js/fake-pay.js): loaded before pay.js, on the step that shows the form, in fake mode only. */
export const FAKE_PAY_JS = "js/fake-pay.js";

export type PaymentUrls = {
  intent: string;
  session: string;
  confirm: string;
  authenticate: string;
  complete: string;
  /** Absolute: where Stripe sends the shopper back after a redirect (3D Secure, Link). */
  returnUrl: string;
  shipping: string;
  information: string;
};

export type PaymentView = {
  token: string;
  mode: "fake" | "stripe";
  surface: Surface;
  /** The scenario's outbound payment notice, which replaces the payment block. */
  notice: { title: string; body: string; linkLabel: string; href: string } | null;
  /** Why the last attempt did not pay (the processor's message), from ?error=. */
  error: string | null;
  /**
   * The shipping update a pay attempt announced: its note stays on the page once it fired (pay.js shows it
   * in place the first time). `fresh` right after that attempt: the shopper has to pay again to confirm.
   */
  priceUpdate: { label: string; totalCents: number; previousCents: number; fresh: boolean } | null;
  /** What the payment step charges: the live cart, the late fee, the update once it fired. */
  totals: Totals;
  summary: SummaryView;
  checkout: Checkout;
  store: StoreDef;
  shippingCents: number;
  urls: PaymentUrls;
  publishableKey: string;
};

const HEX = /^#[0-9a-fA-F]{3,8}$/;
const LENGTH = /^\d+(?:\.\d+)?(?:px|rem|em)$/;

/** Stripe Elements' Appearance API from the brand's tokens, so the card form reads as the store's own. */
export function stripeAppearance(brand: Brand, bodyFallback: string): object {
  const t = brand.tokens;
  const c = (v: string, d: string) => (HEX.test(v) ? v : d);
  const accent = c(t.accent, "#333333");
  return {
    theme: "stripe",
    variables: {
      colorPrimary: accent,
      colorBackground: c(t.surface, "#ffffff"),
      colorText: c(t.fg, "#111111"),
      colorTextSecondary: c(t.muted, "#666666"),
      colorDanger: "#A1241A",
      fontFamily: fontStack(brand.fonts.body, bodyFallback),
      fontSizeBase: "16px",
      borderRadius: LENGTH.test(t.radius) ? t.radius : "6px",
      spacingUnit: "4px",
    },
    rules: {
      ".Input": { borderColor: c(t.border, "#dddddd"), boxShadow: "none" },
      ".Input:focus": { borderColor: accent, boxShadow: `0 0 0 1px ${accent}` },
      ".Label": { fontWeight: "600" },
      ".Tab--selected": { borderColor: accent },
    },
  };
}

/**
 * What the card's billing details start from. A store that ships to the buyer: the name and ZIP of the address.
 * A florist delivers to the recipient, so its address says nothing of the card: the sender's own name (Contact's
 * "Your name"), when given, and no ZIP.
 */
export function billingDefaults(store: StoreDef, c: Checkout): { name: string; email: string; postalCode: string } {
  const email = c.contact?.email ?? "";
  if (store.delivery) return { name: c.contact?.name ?? "", email, postalCode: "" };
  const a = c.address;
  return { name: a ? `${a.firstName} ${a.lastName}`.trim() : "", email, postalCode: a?.zip ?? "" };
}

/**
 * The total a form-posting page shows, sent with the form: a press from a page that showed an older
 * total (the same form posted twice, a tab opened before a price update) does not pay the newer one.
 */
const shownField = (v: PaymentView) => `<input type="hidden" name="shownCents" value="${v.totals.totalCents}">`;

/**
 * The card form of fake mode: what a processor's card fields ask, posted to the fake confirm (its script,
 * public/js/fake-pay.js, sends it with fetch). The ZIP starts as billingDefaults() says.
 */
function fakeCardForm(v: PaymentView, attrs: string): string {
  const zip = billingDefaults(v.store, v.checkout).postalCode;
  return `<form class="payment-block card-form" ${attrs} data-fake-card method="post" action="${esc(v.urls.confirm)}" novalidate>
${shownField(v)}
<div class="card-form__head"><p class="card-form__title">${icon("lock")}<span>Credit or debit card</span></p><span class="test-badge" title="Payments on this store are processed in test mode">Test payment</span></div>
<div class="card-form__fields">
${textField({ name: "number", label: "Card number", value: "", autocomplete: "cc-number", inputmode: "numeric", placeholder: "1234 1234 1234 1234", maxlength: 23, id: "card-number" })}
<div class="cfield-row cfield-row--2">
${textField({ name: "expiry", label: "Expiration date", value: "", autocomplete: "cc-exp", placeholder: "MM / YY", maxlength: 7, id: "card-expiry" })}
${textField({ name: "cvc", label: "Security code", value: "", autocomplete: "cc-csc", inputmode: "numeric", placeholder: "CVC", maxlength: 4, id: "card-cvc" })}
</div>
${textField({ name: "zip", label: "ZIP code", value: zip, autocomplete: "postal-code", inputmode: "numeric", maxlength: 10, id: "card-zip" })}
</div>
<button class="btn btn--primary btn--lg btn--block pay-button" type="submit" data-pay-button>${icon("lock")}<span>Pay <span data-pay-amount>${esc(money(v.totals.totalCents))}</span></span></button>
<p class="payment-error" data-payment-error role="alert" hidden></p>
</form>`;
}

/** Stripe mode: the containers pay.js mounts Elements into (the Express Checkout Element above the Payment Element). */
function stripeBlock(v: PaymentView, attrs: string): string {
  const express =
    v.surface === "express-checkout"
      ? `<div class="express" data-express-wrap><p class="express__title">Express checkout</p><div id="express-checkout-element" class="express__element" data-express-checkout></div><p class="or-divider"><span>Or pay with card</span></p></div>`
      : "";
  return `<div class="payment-block" ${attrs} data-stripe-payment>
${express}
<div id="payment-element" class="stripe-element" data-payment-element><p class="payment-loading">Loading the secure card form…</p></div>
<button class="btn btn--primary btn--lg btn--block pay-button" type="button" data-pay-button disabled>${icon("lock")}<span>Pay <span data-pay-amount>${esc(money(v.totals.totalCents))}</span></span></button>
<p class="payment-error" data-payment-error role="alert" hidden></p>
<noscript><p class="payment-error">Turn on JavaScript to pay by card.</p></noscript>
</div>`;
}

/** The hosted surface: one button to the processor's secure payment page. */
function hostedBlock(v: PaymentView): string {
  return `<form class="payment-block payment-block--hosted" data-surface="checkout" method="post" action="${esc(v.urls.session)}">
${shownField(v)}
<div class="hosted-note">${icon("lock")}<p>You'll pay <strong data-pay-amount>${esc(money(v.totals.totalCents))}</strong> by card on our secure payment page, then come back here for your confirmation.</p></div>
<button class="btn btn--primary btn--lg btn--block pay-button" type="submit" data-pay-button>Continue to secure payment</button>
<p class="payment-error" data-payment-error role="alert" hidden></p>
</form>`;
}

/** The outbound notice: it takes the place of the payment block (no surface is rendered). */
function noticeBlock(n: NonNullable<PaymentView["notice"]>): string {
  return `<div class="payment-notice" data-payment-notice>
<p class="payment-notice__title">${esc(n.title)}</p>
<p class="payment-notice__body">${esc(n.body)}</p>
<a class="btn btn--primary btn--lg payment-notice__link" href="${esc(n.href)}">${esc(n.linkLabel)}</a>
</div>`;
}

/**
 * What pay.js (and in fake mode the card form's script) needs, as JSON on the page (no secrets: the client
 * secret comes from the intent call). Each mode gets its own endpoints only: fake mode its card form's confirm
 * and 3D Secure step, Stripe mode the report of a confirmation that failed, was challenged or was authorized (the
 * store takes it there, or declines the card), the capture method the intent is made with, and the billing details
 * Elements start from — a Stripe-mode page names nothing of fake mode, and loads none of its script.
 */
function config(ctx: StoreCtx, v: PaymentView): object {
  const common = { intent: v.urls.intent, complete: v.urls.complete, returnUrl: v.urls.returnUrl };
  return {
    mode: v.mode,
    surface: v.surface,
    store: ctx.brand.name,
    amountCents: v.totals.totalCents,
    urls: v.mode === "fake" ? { ...common, confirm: v.urls.confirm, authenticate: v.urls.authenticate } : { ...common, report: href(ctx, `/checkout/${v.token}/payment/report`) },
    ...(v.mode === "stripe"
      ? {
          publishableKey: v.publishableKey,
          methods: v.surface === "express-checkout" ? ["card", "link"] : ["card"],
          // As the intent is made (routes/pay.ts): confirmed payments are authorized, then taken by the store.
          captureMethod: "manual",
          appearance: stripeAppearance(ctx.brand, ctx.skin.fontFallbacks.body),
          fonts: ctx.brand.fonts.href ? [{ cssSrc: ctx.brand.fonts.href }] : [],
          billing: billingDefaults(v.store, v.checkout),
        }
      : {}),
  };
}

/** /checkout/:token/payment — the review, the late fee if any, then the store's payment surface or the notice. */
export function paymentPage(ctx: StoreCtx, v: PaymentView): string {
  const method = v.store.shipping.find((m) => m.id === v.checkout.shippingId);
  const extra: ReviewRow[] = [];
  if (method) extra.push({ label: "Method", value: `${method.label} · ${v.shippingCents === 0 ? "Free" : money(v.shippingCents)}`, change: v.urls.shipping, data: { "review-shipping": method.label } });
  if (v.checkout.delivery?.message) extra.push({ label: "Card message", value: `“${v.checkout.delivery.message}”${v.checkout.delivery.signature ? ` — ${v.checkout.delivery.signature}` : ""}`, change: v.urls.information });
  const surfaceAttr = `data-surface="${esc(v.surface)}"`;
  const block = v.notice ? noticeBlock(v.notice) : v.surface === "checkout" ? hostedBlock(v) : v.mode === "fake" ? fakeCardForm(v, surfaceAttr) : stripeBlock(v, surfaceAttr);
  const pu = v.priceUpdate;
  const banner = pu
    ? `<p><strong>${esc(pu.label)}:</strong> your total is now <strong>${esc(money(pu.totalCents))}</strong> (was ${esc(money(pu.previousCents))}).${pu.fresh ? " Review it, then pay again to confirm." : ""}</p>`
    : "";
  const main = `${reviewBox(reviewRows(ctx, v.token, v.checkout, extra))}
${v.error ? alertBox("error", `<p>${esc(v.error)}</p>`, "data-error-banner") : ""}
${alertBox("info", banner, `data-price-banner${v.priceUpdate ? "" : " hidden"}`)}
<section class="checkout-section payment" aria-labelledby="payment-title">
<h2 class="checkout-section__title" id="payment-title">Payment</h2>
<p class="checkout-section__intro">${icon("lock")}<span>All transactions are secure and encrypted.</span></p>
${block}
</section>
<div class="checkout-actions checkout-actions--payment">
<a class="checkout-actions__back" href="${esc(v.urls.shipping)}">${icon("chevron-left")}<span>Return to shipping</span></a>
</div>
${v.notice ? "" : jsonScript("checkout-config", config(ctx, v))}`;
  // A card surface's fields: Stripe's Elements (Stripe.js), or in fake mode the store's own card form and its script.
  const cardSurface = !v.notice && v.surface !== "checkout";
  return checkoutShell(ctx, {
    title: "Payment",
    step: "payment",
    token: v.token,
    main,
    summary: v.summary,
    ...(cardSurface ? { scripts: [v.mode === "stripe" ? STRIPE_JS : assetHref(ctx, FAKE_PAY_JS)] } : {}),
  });
}

/** A completion that cannot be trusted (a payment of another checkout): says so and leads back to the payment step. */
export function paymentProblemPage(ctx: StoreCtx, v: { message: string; back: string }): string {
  const body = `<div class="container auth-page">
<section class="auth-card" aria-labelledby="problem-title">
<h1 class="auth-card__title" id="problem-title">We couldn't confirm this payment</h1>
<p>${esc(v.message)}</p>
<p><a class="btn btn--primary btn--lg btn--block" href="${esc(v.back)}">Return to payment</a></p>
</section>
</div>`;
  return layout(ctx, "Payment not confirmed", body, { chrome: "checkout", styles: [CHECKOUT_CSS], bodyClass: "page-checkout page-auth" });
}

/** The fake card's 3D Secure step without JavaScript (the card form's script shows the same step in place): complete or fail it. */
export function authenticatePage(ctx: StoreCtx, v: { amountCents: number; action: string; back: string }): string {
  const body = `<div class="container auth-page">
<section class="auth-card" aria-labelledby="auth-title">
<p class="auth-card__head"><span>${icon("shield")}<span>Card verification</span></span><span class="test-badge">Test payment</span></p>
<h1 class="auth-card__title" id="auth-title">Confirm it's you</h1>
<p>Your card issuer asks you to confirm this payment of <strong>${esc(money(v.amountCents))}</strong> to ${esc(ctx.brand.name)}.</p>
<form method="post" action="${esc(v.action)}" class="auth-card__actions">
<button class="btn btn--primary btn--lg btn--block" type="submit" name="result" value="complete">Complete authentication</button>
<button class="btn btn--secondary btn--block" type="submit" name="result" value="fail">Fail authentication</button>
</form>
<p class="auth-card__back"><a href="${esc(href(ctx, v.back))}">Cancel and return to payment</a></p>
</section>
</div>`;
  return layout(ctx, "Confirm your payment", body, { chrome: "checkout", styles: [CHECKOUT_CSS, FAKE_PAY_CSS], bodyClass: "page-checkout page-auth" });
}
