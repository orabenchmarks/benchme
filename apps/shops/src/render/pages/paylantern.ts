import { esc, icon } from "../components.js";
import { money } from "../checkout-views.js";
import { layout, type PageCtx } from "../layout.js";

export type PaylanternView = {
  /** The merchant's name, when `m` names a store. */
  merchant: string | null;
  /** The referenced checkout's amount, when it is this workspace's and open. */
  amountCents: number | null;
  ref: string | null;
  m: string | null;
  /** The failure every submission ends in. */
  error: string | null;
  /** The form's action (prefixed). */
  action: string;
  /** "← Back to <merchant>": the merchant's checkout the shopper came from, or its store; null without a merchant. */
  back: { href: string; label: string } | null;
};

type PlField = { name: string; label: string; autocomplete: string; placeholder?: string; inputmode?: string; maxlength?: number };

/** One of the card form's fields: PayLantern's own markup and classes (public/css/paylantern.css), nothing of a store's checkout. */
function plField(f: PlField): string {
  const id = `pl-${f.name}`;
  const attrs = [
    `class="pl-field__input"`,
    `id="${esc(id)}"`,
    `name="${esc(f.name)}"`,
    `type="text"`,
    `autocomplete="${esc(f.autocomplete)}"`,
    f.inputmode ? `inputmode="${esc(f.inputmode)}"` : "",
    f.placeholder ? `placeholder="${esc(f.placeholder)}"` : "",
    f.maxlength ? `maxlength="${f.maxlength}"` : "",
  ].filter(Boolean);
  return `<div class="pl-field"><label class="pl-field__label" for="${esc(id)}">${esc(f.label)}</label><input ${attrs.join(" ")}></div>`;
}

/**
 * PayLantern's payment page: a generic processor's card form — the merchant and amount up top, card
 * number, expiry, CVC and name, a lock and "256-bit encryption", and a way back to the merchant. Its
 * header and footer are the paylantern skin's (layout() gives a site without a catalogue "plain"
 * chrome) and its styles are its own (public/css/paylantern.css); it never shows the number back, not
 * even after a failed attempt.
 */
export function paylanternPayPage(ctx: PageCtx, v: PaylanternView): string {
  const heading = v.merchant ? `PayLantern Checkout — Pay ${v.merchant}` : "PayLantern Checkout";
  const lock = (cls: string) => `<span class="${cls}" data-lock>${icon("lock")}</span>`;
  const body = `<div class="container pl-pay">
${v.back ? `<a class="pl-back" href="${esc(v.back.href)}"><span aria-hidden="true">←</span> ${esc(v.back.label)}</a>` : ""}
<section class="pl-card" aria-labelledby="pl-title">
<div class="pl-card__top">
<h1 class="pl-card__title" id="pl-title">${esc(heading)}</h1>
${
  v.amountCents !== null
    ? `<p class="pl-card__amount"><span class="pl-card__amount-label">Amount due</span><strong class="pl-card__amount-value">${esc(money(v.amountCents))}</strong></p>`
    : ""
}
${v.ref ? `<p class="pl-card__ref">Payment reference <code>${esc(v.ref.slice(0, 12))}</code></p>` : ""}
</div>
${v.error ? `<div class="pl-alert" role="alert">${icon("shield")}<p>${esc(v.error)}</p></div>` : ""}
<form class="pl-form" method="post" action="${esc(v.action)}" novalidate>
<input type="hidden" name="ref" value="${esc(v.ref ?? "")}">
<input type="hidden" name="m" value="${esc(v.m ?? "")}">
${plField({ name: "number", label: "Card number", autocomplete: "cc-number", inputmode: "numeric", placeholder: "1234 5678 9012 3456", maxlength: 23 })}
<div class="pl-row pl-row--2">
${plField({ name: "expiry", label: "Expiry (MM/YY)", autocomplete: "cc-exp", placeholder: "MM/YY", maxlength: 7 })}
${plField({ name: "cvc", label: "CVC", autocomplete: "cc-csc", inputmode: "numeric", placeholder: "123", maxlength: 4 })}
</div>
${plField({ name: "name", label: "Name on card", autocomplete: "cc-name" })}
<button class="pl-pay-btn" type="submit">${lock("pl-pay-btn__lock")}<span>${v.amountCents !== null ? `Pay ${esc(money(v.amountCents))}` : "Pay now"}</span></button>
</form>
<p class="pl-card__secure"><span class="pl-card__secure-lead">${lock("pl-card__secure-lock")}<span>256-bit encryption.</span></span> <span>Your card details are sent securely.</span></p>
</section>
<p class="pl-pay__note">PayLantern processes card payments for independent stores.</p>
</div>`;
  return layout(ctx, v.merchant ? `Pay ${v.merchant}` : "Secure payment", body, { bodyClass: "page-paylantern" });
}
