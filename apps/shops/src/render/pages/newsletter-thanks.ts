import { breadcrumb, esc, href, icon, newsletterForm } from "../components.js";
import { layout, type StoreCtx } from "../layout.js";

export type NewsletterState =
  /** Signed up at this store: the welcome code is theirs. */
  | { state: "subscribed"; email: string; code: string }
  /** Not signed up yet (or the address was refused): the form, with the error when there is one. */
  | { state: "form"; error?: string };

/**
 * /newsletter/thanks — where the sign-up form lands without JavaScript. The code is shown only to a
 * workspace that signed up at this store, so it is reachable without the pop-up but not without signing up.
 */
export function newsletterThanksPage(ctx: StoreCtx, s: NewsletterState): string {
  let body: string;
  if (s.state === "subscribed") {
    body = `<div class="container newsletter-page">
<h1 class="newsletter-page__title">You're on the list</h1>
<p>Thanks for signing up with ${esc(s.email)}. Here is your code for 10% off your first order:</p>
<div class="code-box"><p class="code-box__code" data-code>${esc(s.code)}</p><button type="button" class="btn btn--secondary code-box__copy" data-copy-code="${esc(s.code)}">${icon("copy")}<span>Copy code</span></button></div>
<p>Enter it in the promo code field of your cart or at checkout.</p>
<p><a class="btn btn--primary" href="${esc(href(ctx, "/collections/all"))}">Start shopping</a></p>
</div>`;
  } else {
    body = `<div class="container newsletter-page">
<h1 class="newsletter-page__title">Get 10% off your first order</h1>
<p>Sign up for the ${esc(ctx.brand.name)} newsletter and we'll show your code right away.</p>
${s.error ? `<p class="form-error" role="alert">${esc(s.error)}</p>` : ""}
${newsletterForm(ctx, "page")}
</div>`;
  }
  return layout(ctx, s.state === "subscribed" ? "Thanks for signing up" : "Newsletter", `<div class="container">${breadcrumb(ctx, [{ label: "Newsletter" }])}</div>\n${body}`, {
    bodyClass: "page-newsletter",
  });
}
