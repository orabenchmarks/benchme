import type { Totals } from "@benchme/storefront";
import { breadcrumb, dollars, esc, href, icon, plural } from "../components.js";
import { CHECKOUT_CSS, alertBox, minus, money } from "../checkout-views.js";
import { layout, type StoreCtx } from "../layout.js";

export type CartPageLine = { key: string; name: string; image: string; optionsLabel: string; qty: number; maxQty: number; unitCents: number; totalCents: number; url: string };

export type CartPageView = {
  lines: CartPageLine[];
  /** The cart priced with its code: no shipping or tax yet. */
  totals: Totals;
  promo: string | null;
  /** What the applied code still needs ("SPRING15 applies to orders of $50 or more."). */
  promoNote: string | null;
  /** A code that was just refused, with what was typed. */
  promoError: { message: string; code: string } | null;
  /** A one-time note ("WELCOME10 is applied to your order."). */
  notice: string | null;
  /** A line held at its most after more was asked ("We have only 4 of … in stock, so your cart has 4."). */
  limit: string | null;
  /** An add-to-cart that was refused (a form post without JavaScript), and the product to go back to. */
  error: { message: string; product?: { name: string; url: string } } | null;
};

function line(ctx: StoreCtx, l: CartPageLine, i: number): string {
  const qid = `cart-qty-${i}`;
  return `<li class="cart-item" data-cart-line="${esc(l.key)}">
<a class="cart-item__media" href="${esc(l.url)}" tabindex="-1" aria-hidden="true">${l.image ? `<img src="${esc(l.image)}" alt="">` : ""}</a>
<div class="cart-item__info">
<a class="cart-item__name" href="${esc(l.url)}">${esc(l.name)}</a>
${l.optionsLabel ? `<p class="cart-item__opts">${esc(l.optionsLabel)}</p>` : ""}
<p class="cart-item__unit">${esc(money(l.unitCents))} each</p>
<div class="cart-item__controls">
<form class="cart-item__qty" method="post" action="${esc(href(ctx, "/cart/update"))}">
<input type="hidden" name="key" value="${esc(l.key)}">
<label class="cart-item__qty-label" for="${qid}">Qty</label>
<input class="cart-item__qty-input" id="${qid}" type="number" name="qty" value="${l.qty}" min="0" max="${l.maxQty}" step="1" inputmode="numeric">
<button class="btn btn--secondary btn--sm" type="submit">Update<span class="visually-hidden"> quantity of ${esc(l.name)}</span></button>
</form>
<form class="cart-item__remove" method="post" action="${esc(href(ctx, "/cart/remove"))}">
<input type="hidden" name="key" value="${esc(l.key)}">
<button class="link-btn" type="submit">Remove<span class="visually-hidden"> ${esc(l.name)}</span></button>
</form>
</div>
</div>
<p class="cart-item__total">${esc(money(l.totalCents))}</p>
</li>`;
}

/** The free-shipping nudge, when the store has a threshold. */
function freeShipping(ctx: StoreCtx, subtotal: number): string {
  const over = ctx.store.freeShippingOverCents;
  if (!over) return "";
  const left = over - subtotal;
  const pct = Math.max(0, Math.min(100, Math.round((subtotal / over) * 100)));
  return `<div class="free-ship cart-summary__free"><p>${
    left > 0 ? `You're <strong>${esc(money(left))}</strong> away from free standard shipping.` : `Your order ships free with standard shipping (orders of ${esc(dollars(over))} or more).`
  }</p><div class="free-ship__bar" aria-hidden="true"><span style="width:${pct}%"></span></div></div>`;
}

/**
 * The summary beside the lines is ONE form posting to /checkout: its code field travels with
 * "Check out" (a typed code is applied on the way), and "Apply" sends the same form to /cart/promo
 * instead (formaction). Apply comes first, so Enter in the code field applies the code.
 */
function summary(ctx: StoreCtx, v: CartPageView): string {
  const t = v.totals;
  const typed = v.promoError?.code ?? "";
  const promo = `<div class="promo">
<label class="promo__label" for="cart-code">Discount code</label>
<div class="promo__row"><input class="promo__input" id="cart-code" name="code" value="${esc(typed)}" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Enter code"${
    v.promoError ? ' aria-invalid="true" aria-describedby="cart-code-error"' : ""
  }><button class="btn btn--secondary" type="submit" formaction="${esc(href(ctx, "/cart/promo"))}">Apply</button></div>
${v.promoError ? `<p class="promo__error" id="cart-code-error" role="alert">${esc(v.promoError.message)}${v.promoError.code ? ` (${esc(v.promoError.code)})` : ""}</p>` : ""}
${
  v.promo
    ? `<p class="promo__applied">${icon("check")}<span><strong>${esc(v.promo)}</strong> ${v.promoNote ? esc(v.promoNote) : "applied"}</span><button class="link-btn" type="submit" formaction="${esc(
        href(ctx, "/cart/promo"),
      )}" name="remove" value="1">Remove<span class="visually-hidden"> code ${esc(v.promo)}</span></button></p>`
    : ""
}
</div>`;
  return `<aside class="cart-summary" aria-labelledby="cart-summary-title">
<h2 class="cart-summary__title" id="cart-summary-title">Order summary</h2>
<form class="cart-summary__form" method="post" action="${esc(href(ctx, "/checkout"))}">
<dl class="totals">
<div class="totals__row"><dt>Subtotal <span class="totals__method">${esc(plural(v.lines.reduce((a, l) => a + l.qty, 0), "item"))}</span></dt><dd>${esc(money(t.subtotalCents))}</dd></div>
${t.discountCents > 0 ? `<div class="totals__row totals__row--discount"><dt>Discount <span class="totals__code">${esc(v.promo ?? "")}</span></dt><dd>${esc(minus(t.discountCents))}</dd></div>` : ""}
<div class="totals__row totals__row--total"><dt>Estimated total</dt><dd><strong>${esc(money(t.totalCents))}</strong></dd></div>
</dl>
<p class="cart-summary__note">Shipping and taxes are calculated at checkout.</p>
${freeShipping(ctx, t.subtotalCents)}
${promo}
<button class="btn btn--primary btn--lg btn--block cart-summary__checkout" type="submit">${icon("lock")}<span>Check out</span></button>
<p class="cart-summary__guest">No account needed: check out as a guest.</p>
</form>
</aside>`;
}

/** /cart — the lines with their quantities, the code field and the way to checkout; the empty cart says so. */
export function cartPage(ctx: StoreCtx, v: CartPageView): string {
  const alerts = [
    v.error
      ? alertBox("error", `<p>${esc(v.error.message)}</p>${v.error.product ? `<p><a href="${esc(v.error.product.url)}">Back to ${esc(v.error.product.name)}</a></p>` : ""}`)
      : "",
    v.limit ? alertBox("info", `<p>${esc(v.limit)}</p>`, "data-cart-limit") : "",
    v.notice ? alertBox("success", `<p>${esc(v.notice)}</p>`) : "",
  ].join("");
  const content = v.lines.length
    ? `<div class="cart-layout">
<section class="cart-lines" aria-label="Items in your cart">
<ul class="cart-list">${v.lines.map((l, i) => line(ctx, l, i)).join("")}</ul>
<p class="cart-lines__more"><a class="link" href="${esc(href(ctx, "/collections/all"))}">Continue shopping</a></p>
</section>
${summary(ctx, v)}
</div>`
    : `<div class="cart-empty">
<p class="cart-empty__text">Your cart is empty.</p>
<p><a class="btn btn--primary btn--lg" href="${esc(href(ctx, "/collections/all"))}">Continue shopping</a></p>
</div>`;
  const body = `<div class="container">${breadcrumb(ctx, [{ label: "Cart" }])}</div>
<div class="container cart-page">
<h1 class="cart-page__title">Your cart</h1>
${alerts}
${content}
</div>`;
  return layout(ctx, "Your cart", body, { styles: [CHECKOUT_CSS], bodyClass: "page-cart" });
}
