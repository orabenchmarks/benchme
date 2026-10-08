import type { Checkout, OrderRow } from "../../db/index.js";
import { esc, href, icon } from "../components.js";
import { CHECKOUT_CSS, alertBox, longDate, money, orderSummary, type SummaryView } from "../checkout-views.js";
import { layout, type StoreCtx } from "../layout.js";

/**
 * `greeting`: the first name the page thanks (the buyer's: at a florist the sender's, never the recipient's), or null.
 * `recovered`: the shopper was sent here by a step that recorded this order for a payment whose return page never
 * loaded — the notice that says so, and whether the cart still holds something (added since) to go back to.
 */
export type ConfirmationView = {
  order: OrderRow;
  checkout: Checkout | null;
  summary: SummaryView;
  greeting: string | null;
  recovered?: { message: string; cartHasItems: boolean } | null;
};

const block = (title: string, html: string) => `<div class="details-grid__item"><h3 class="details-grid__title">${esc(title)}</h3>${html}</div>`;

/** /orders/:orderNo — the thank-you page: the order number up front, what happens next, the details, the summary. */
export function confirmationPage(ctx: StoreCtx, v: ConfirmationView): string {
  const { order, checkout } = v;
  const store = ctx.store;
  const a = checkout?.address ?? null;
  const contact = checkout?.contact ?? null;
  const method = store.shipping.find((m) => m.id === order.details.shippingId);
  const d = order.details.delivery;
  const florist = !!store.delivery;
  const details = [
    block("Contact information", `<p>${esc(order.email)}</p>${contact?.phone ? `<p>${esc(contact.phone)}</p>` : ""}`),
    a
      ? block(
          florist ? "Delivery address" : "Shipping address",
          `<p>${esc(`${a.firstName} ${a.lastName}`)}<br>${esc(a.line1)}${a.line2 ? `<br>${esc(a.line2)}` : ""}<br>${esc(`${a.city}, ${a.state} ${a.zip}`)}<br>United States</p>`,
        )
      : "",
    method
      ? block(
          florist ? "Delivery" : "Shipping method",
          `<p>${esc(method.label)}</p>${d ? `<p>${esc(longDate(d.date))}${d.sameDay ? " (same day)" : ""}</p>` : ""}`,
        )
      : "",
    d && (d.message || d.signature) ? block("Card message", `${d.message ? `<p>“${esc(d.message)}”</p>` : ""}${d.signature ? `<p>${esc(d.signature)}</p>` : ""}`) : "",
    // What the processor charged: the items and totals beside it are what that payment paid for.
    block("Payment", `<p>${icon("lock")}<span>Paid by card · ${esc(money(order.chargedCents ?? order.totals.totalCents))}</span></p>`),
  ].join("");
  const next = florist
    ? "Our florist will hand-tie your arrangement on the delivery day, and we'll email you when it's on its way."
    : "We'll email you again with tracking details when your order ships.";
  const r = v.recovered;
  const notice = r
    ? alertBox(
        "success",
        `<p>${esc(r.message)}</p>${r.cartHasItems ? `<p>What you added since is still in your cart: <a href="${esc(href(ctx, "/cart"))}">view your cart</a>.</p>` : ""}`,
        "data-recovered-notice",
      )
    : "";
  const body = `<div class="checkout container confirmation">
<div class="checkout__main">
${notice}
<div class="confirmation__head">
<span class="confirmation__icon">${icon("check")}</span>
<div>
<p class="confirmation__number">Order <strong data-order-number>${esc(order.orderNo)}</strong></p>
<h1 class="confirmation__title">Thank you${v.greeting ? `, ${esc(v.greeting)}` : ""}!</h1>
</div>
</div>
<section class="confirmation-box" aria-labelledby="confirmed-title">
<h2 class="confirmation-box__title" id="confirmed-title">Your order is confirmed</h2>
<p class="confirmation-box__sent">A confirmation was sent to ${esc(order.email)}.</p>
<p>${esc(next)}</p>
</section>
<section class="confirmation-box" aria-labelledby="details-title">
<h2 class="confirmation-box__title" id="details-title">Order details</h2>
<div class="details-grid">${details}</div>
</section>
<div class="checkout-actions checkout-actions--confirmation">
<p class="checkout-actions__help">Need help? <a href="mailto:${esc(store.brand.supportEmail)}">${esc(store.brand.supportEmail)}</a></p>
<a class="btn btn--primary btn--lg checkout-actions__next" href="${esc(href(ctx, "/collections/all"))}">Continue shopping</a>
</div>
</div>
${orderSummary(ctx, v.summary)}
</div>`;
  return layout(ctx, `Order ${order.orderNo}`, body, {
    chrome: "checkout",
    styles: [CHECKOUT_CSS],
    checkoutBack: { label: "Continue shopping", path: "/collections/all" },
    bodyClass: "page-checkout page-confirmation",
  });
}
