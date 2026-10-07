import { breadcrumb, dollars, esc, hourLabel, href, icon } from "../components.js";
import { layout, type StoreCtx } from "../layout.js";

/**
 * The answer to a delivery ZIP check (routes/storefront.ts deliveryCheck()). `date` is the earliest
 * delivery date and `today` the store's own date (Pacific time), both "2026-10-07".
 */
export type DeliveryResult = { ok: true; zip: string; date: string; today: string; message: string } | { ok: false; zip: string; message: string };

/** Where the ZIP check lands without JavaScript: the answer, and the form to try another ZIP. */
export function deliveryCheckPage(ctx: StoreCtx, r: DeliveryResult): string {
  const d = ctx.store.delivery;
  const when = hourLabel(d?.cutoffHourLocal ?? 14);
  const body = `<div class="container">${breadcrumb(ctx, [{ label: "Delivery check" }])}</div>
<div class="container delivery-page">
<h1 class="delivery-page__title">Check delivery</h1>
<p class="delivery-result delivery-result--${r.ok ? "ok" : "error"}" data-delivery-result role="status">${icon(r.ok ? "check" : "pin")}<span>${esc(r.message)}</span></p>
<form class="delivery-check delivery-check--page" action="${esc(href(ctx, "/delivery-check"))}" method="get" data-delivery-check>
<label class="delivery-check__label" for="zip-page">Recipient's ZIP code</label>
<div class="delivery-check__row"><input class="delivery-check__input" id="zip-page" name="zip" inputmode="numeric" autocomplete="postal-code" value="${esc(r.zip)}" maxlength="10"><button class="btn btn--secondary" type="submit">Check</button></div>
</form>
${d ? `<p class="delivery-page__note">Order by ${esc(when)} Pacific time for delivery the same day (${esc(dollars(d.sameDayFeeCents))} extra), or choose a later date at checkout.</p>` : ""}
<p><a class="btn btn--primary" href="${esc(href(ctx, "/collections/all"))}">Shop all flowers and plants</a></p>
</div>`;
  return layout(ctx, "Delivery check", body, { bodyClass: "page-delivery" });
}
