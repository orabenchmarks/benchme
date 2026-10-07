import type { SessionLine } from "../../payments/gateway.js";
import { esc, icon } from "../components.js";
import { CHECKOUT_CSS, FAKE_PAY_CSS, alertBox, money, textField } from "../checkout-views.js";
import { layout, type StoreCtx } from "../layout.js";

/**
 * Fake mode's hosted payment page — what a processor's hosted checkout is to a store (the "checkout"
 * surface): the store's name and what is due on one side, the card form on the other. It says "Test
 * payment" discreetly, as a processor's test mode does, and carries no processor's name or marks.
 */

export type FakeSessionView = {
  amountCents: number;
  lines: SessionLine[];
  email: string;
  /** The form's action (prefixed). */
  action: string;
  /** Back to the store's payment step (absolute, as the session was given it). */
  cancelUrl: string;
  error: string | null;
};

export function fakeSessionPage(ctx: StoreCtx, v: FakeSessionView): string {
  const name = ctx.brand.name;
  const lines = v.lines
    .map((l) => `<li class="hosted__line"><span>${esc(l.name)}${l.qty > 1 ? ` <span class="hosted__qty">× ${l.qty}</span>` : ""}</span><span>${esc(money(l.unitCents * l.qty))}</span></li>`)
    .join("");
  const body = `<div class="container hosted">
<section class="hosted__order" aria-label="What you are paying for">
<a class="hosted__back" href="${esc(v.cancelUrl)}">${icon("chevron-left")}<span>Back to ${esc(name)}</span></a>
<p class="hosted__merchant">Pay ${esc(name)}</p>
<p class="hosted__amount">${esc(money(v.amountCents))}</p>
<ul class="hosted__lines">${lines}</ul>
<p class="hosted__total"><span>Total due</span><span>${esc(money(v.amountCents))}</span></p>
</section>
<section class="hosted__pay" aria-labelledby="hosted-title">
<div class="hosted__pay-head"><h1 class="hosted__title" id="hosted-title">Pay with card</h1><span class="test-badge">Test payment</span></div>
${v.error ? alertBox("error", `<p>${esc(v.error)}</p>`) : ""}
<form class="card-form card-form--hosted" method="post" action="${esc(v.action)}" novalidate>
<div class="cfield"><p class="cfield__label">Email</p><p class="hosted__email">${esc(v.email)}</p></div>
${textField({ name: "number", label: "Card number", value: "", autocomplete: "cc-number", inputmode: "numeric", placeholder: "1234 1234 1234 1234", maxlength: 23, id: "hosted-number" })}
<div class="cfield-row cfield-row--2">
${textField({ name: "expiry", label: "Expiration date", value: "", autocomplete: "cc-exp", placeholder: "MM / YY", maxlength: 7, id: "hosted-expiry" })}
${textField({ name: "cvc", label: "Security code", value: "", autocomplete: "cc-csc", inputmode: "numeric", placeholder: "CVC", maxlength: 4, id: "hosted-cvc" })}
</div>
${textField({ name: "name", label: "Cardholder name", value: "", autocomplete: "cc-name", id: "hosted-name" })}
${textField({ name: "zip", label: "ZIP code", value: "", autocomplete: "postal-code", inputmode: "numeric", maxlength: 10, id: "hosted-zip" })}
<button class="btn btn--primary btn--lg btn--block pay-button" type="submit">${icon("lock")}<span>Pay ${esc(money(v.amountCents))}</span></button>
</form>
<p class="hosted__secure">${icon("lock")}<span>Your card details are encrypted and sent straight to the card network.</span></p>
</section>
</div>`;
  return layout(ctx, `Pay ${name}`, body, { chrome: "plain", styles: [CHECKOUT_CSS, FAKE_PAY_CSS], bodyClass: "page-hosted" });
}

/** The hosted page's 3D Secure step: complete or fail it. */
export function fakeAuthPage(ctx: StoreCtx, v: { amountCents: number; action: string; back: string }): string {
  const body = `<div class="container auth-page">
<section class="auth-card" aria-labelledby="auth-title">
<p class="auth-card__head"><span>${icon("shield")}<span>Card verification</span></span><span class="test-badge">Test payment</span></p>
<h1 class="auth-card__title" id="auth-title">Confirm it's you</h1>
<p>Your card issuer asks you to confirm this payment of <strong>${esc(money(v.amountCents))}</strong> to ${esc(ctx.brand.name)}.</p>
<form method="post" action="${esc(v.action)}" class="auth-card__actions">
<button class="btn btn--primary btn--lg btn--block" type="submit" name="result" value="complete">Complete authentication</button>
<button class="btn btn--secondary btn--block" type="submit" name="result" value="fail">Fail authentication</button>
</form>
<p class="auth-card__back"><a href="${esc(v.back)}">Cancel</a></p>
</section>
</div>`;
  return layout(ctx, "Confirm your payment", body, { chrome: "plain", styles: [CHECKOUT_CSS, FAKE_PAY_CSS], bodyClass: "page-hosted page-auth" });
}
