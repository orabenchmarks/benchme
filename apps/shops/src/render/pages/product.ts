import { product as productLd } from "@benchme/site-kit";
import type { Collection, Product, ShippingMethod, StoreDef } from "@benchme/storefront";
import {
  absoluteAsset,
  assetHref,
  badgesHtml,
  breadcrumb,
  breadcrumbJsonLd,
  defaultOptions,
  defaultPriceCents,
  dollars,
  esc,
  formatDate,
  formatUsd,
  hourLabel,
  href,
  icon,
  img,
  pageHref,
  plural,
  productGrid,
  productHref,
  ratingOf,
  ratingText,
  sectionHead,
  stars,
  stockNote,
  subscriptionCents,
} from "../components.js";
import { layout, type StoreCtx } from "../layout.js";

export type ProductPageView = {
  /** The product, with the scenario's injected review (if any) already among its reviews (listed newest first). */
  product: Product;
  collection: Collection | undefined;
  /** "You may also like": same collection first. */
  related: Product[];
  /** Quillfeather: the purchase mode chosen when the page opens (subscribe only when the scenario says so). */
  mode: "once" | "subscribe";
  /** The subscription interval selected in the list. */
  interval: string | null;
};

function gallery(ctx: StoreCtx, p: Product): string {
  const n = p.images.length;
  const thumbs =
    n > 1
      ? `<div class="gallery__thumbs">${p.images
          .map(
            (im, i) =>
              `<button type="button" class="gallery__thumb${i === 0 ? " is-active" : ""}" data-gallery-thumb data-full="${esc(assetHref(ctx, im))}" aria-label="Show photo ${i + 1} of ${n}" aria-pressed="${i === 0}">${img(ctx, im, "")}</button>`,
          )
          .join("")}</div>`
      : "";
  return `<div class="gallery" data-gallery>
<div class="gallery__main">${img(ctx, p.images[0], p.name, { cls: "gallery__img", eager: true })}${badgesHtml(p, "badges gallery__badges", { stock: false })}</div>
${thumbs}
</div>`;
}

function optionGroups(p: Product): string {
  const picked = defaultOptions(p);
  return p.options
    .map((g) => {
      const current = g.values.find((v) => v.id === picked[g.id]);
      const values = g.values
        .map((v) => {
          const delta = v.priceDeltaCents ?? 0;
          const attrs = `${v.id === picked[g.id] ? " checked" : ""}${v.soldOut ? " disabled" : ""}`;
          return `<label class="option${v.soldOut ? " option--soldout" : ""}"><input type="radio" name="opt_${esc(g.id)}" value="${esc(v.id)}" data-delta="${delta}" data-label="${esc(v.label)}"${attrs}><span class="option__label">${esc(v.label)}${
            delta > 0 ? ` <span class="option__delta">+${esc(formatUsd(delta))}</span>` : ""
          }${v.soldOut ? ' <span class="option__soldout">Sold out</span>' : ""}</span></label>`;
        })
        .join("");
      return `<fieldset class="option-group" data-option-group><legend class="option-group__label">${esc(g.name)}: <span class="option-group__value" data-option-value>${esc(current?.label ?? "")}</span></legend><div class="option-group__values">${values}</div></fieldset>`;
    })
    .join("");
}

function purchaseModes(p: Product, v: ProductPageView, onceCents: number): string {
  const sub = p.subscription;
  if (!sub) return "";
  const subCents = subscriptionCents(onceCents, sub.savePct);
  const chosen = v.interval && sub.intervals.includes(v.interval) ? v.interval : sub.intervals[0];
  return `<fieldset class="purchase-modes" data-purchase-modes>
<legend class="option-group__label">Purchase options</legend>
<label class="mode"><input type="radio" name="mode" value="once" data-mode${v.mode === "once" ? " checked" : ""}><span class="mode__body"><span class="mode__title">One-time purchase</span><span class="mode__price" data-once-price>${esc(formatUsd(onceCents))}</span></span></label>
<label class="mode mode--subscribe"><input type="radio" name="mode" value="subscribe" data-mode${v.mode === "subscribe" ? " checked" : ""}><span class="mode__body"><span class="mode__title">Subscribe &amp; save ${sub.savePct}%</span><span class="mode__price" data-sub-price>${esc(
    formatUsd(subCents),
  )}</span><span class="mode__note">Save ${sub.savePct}% on every delivery. Skip, pause or cancel any time.</span></span></label>
<div class="mode__interval" data-interval${v.mode === "subscribe" ? "" : " data-inactive"}><label for="interval-select">Deliver every</label><select id="interval-select" name="interval">${sub.intervals
    .map((i) => `<option value="${esc(i)}"${i === chosen ? " selected" : ""}>${esc(i)}</option>`)
    .join("")}</select></div>
</fieldset>`;
}

function deliveryCheckForm(ctx: StoreCtx): string {
  if (!ctx.store.delivery) return "";
  return `<form class="delivery-check" action="${esc(href(ctx, "/delivery-check"))}" method="get" data-delivery-check>
<label class="delivery-check__label" for="zip-product">${icon("calendar")}<span>Check delivery dates</span></label>
<div class="delivery-check__row"><input class="delivery-check__input" id="zip-product" name="zip" inputmode="numeric" autocomplete="postal-code" placeholder="Recipient's ZIP code" maxlength="10"><button class="btn btn--secondary" type="submit">Check</button></div>
<p class="delivery-check__result" data-delivery-result role="status" aria-live="polite"></p>
</form>`;
}

/** Facts from the store's own rules (thresholds, cutoffs): never a promise the catalogue doesn't make. */
function promises(store: StoreDef): string {
  const items: { icon: string; text: string }[] = [];
  if (store.delivery) {
    items.push({ icon: "clock", text: `Order by ${hourLabel(store.delivery.cutoffHourLocal)} PT for same-day delivery (+${dollars(store.delivery.sameDayFeeCents)})` });
  }
  if (store.freeShippingOverCents) items.push({ icon: "truck", text: `Free standard shipping on orders of ${dollars(store.freeShippingOverCents)} or more` });
  items.push({ icon: "lock", text: "Secure checkout" });
  return `<ul class="promises">${items.map((i) => `<li>${icon(i.icon)}<span>${esc(i.text)}</span></li>`).join("")}</ul>`;
}

function buyBox(ctx: StoreCtx, v: ProductPageView): string {
  const p = v.product;
  const { avg, count } = ratingOf(p);
  const onceCents = defaultPriceCents(p);
  const sub = p.subscription;
  const subscribed = !!sub && v.mode === "subscribe";
  const shownCents = subscribed && sub ? subscriptionCents(onceCents, sub.savePct) : onceCents;
  const compareCents = subscribed ? onceCents : p.compareAtCents && p.compareAtCents > p.priceCents ? p.compareAtCents + (onceCents - p.priceCents) : null;
  const note = stockNote(p);
  const soldOut = p.stock <= 0;
  const maxQty = Math.max(1, Math.min(10, p.stock));
  return `<div class="buybox">
<h1 class="buybox__title">${esc(p.name)}</h1>
${
  count
    ? `<a class="rating-summary" href="#reviews" data-rating="${esc(ratingText(avg))}" data-review-count="${count}">${stars(avg)}<span class="rating-summary__avg">${esc(ratingText(avg))}</span><span class="rating-summary__count">${esc(plural(count, "review"))}</span></a>`
    : ""
}
${ctx.skin.buyBoxIntro(p, ctx)}
<p class="buybox__price"><span class="price price--lg"><span class="price__now" data-price>${esc(formatUsd(shownCents))}</span>${
    compareCents ? ` <s class="price__was" data-compare><span class="visually-hidden">Regular price </span>${esc(formatUsd(compareCents))}</s>` : ' <s class="price__was" data-compare hidden></s>'
  }</span></p>
<p class="buybox__summary">${esc(p.summary)}</p>
${ctx.skin.buyBoxAfterSummary(p, ctx)}
<form class="buy-form" id="buy-form" method="post" action="${esc(href(ctx, "/cart/add"))}" data-add-to-cart>
<input type="hidden" name="sku" value="${esc(p.sku)}">
${optionGroups(p)}
${purchaseModes(p, v, onceCents)}
<div class="buy-form__row">
<div class="qty" data-qty><label class="visually-hidden" for="qty-input">Quantity</label><button type="button" class="qty__btn" data-qty-step="-1" aria-label="Decrease quantity">${icon("minus")}</button><input class="qty__input" id="qty-input" type="number" name="qty" value="1" min="1" max="${maxQty}" step="1" inputmode="numeric"><button type="button" class="qty__btn" data-qty-step="1" aria-label="Increase quantity">${icon("plus")}</button></div>
<button class="btn btn--primary btn--lg buy-form__submit" type="submit"${soldOut ? " disabled" : ""}>${soldOut ? "Sold out" : "Add to cart"}</button>
</div>
${note ? `<p class="stock-note${soldOut ? " stock-note--out" : ""}" data-stock-note>${esc(note)}</p>` : ""}
<p class="buy-form__error" data-form-error role="alert" hidden></p>
</form>
${deliveryCheckForm(ctx)}
${promises(ctx.store)}
${ctx.skin.buyBoxExtras(p, ctx)}
</div>`;
}

function shippingLine(m: ShippingMethod, store: StoreDef): string {
  const when = store.delivery ? "on the delivery date you choose" : m.days[0] === m.days[1] ? `in ${plural(m.days[0], "business day")}` : `in ${m.days[0]}–${m.days[1]} business days`;
  const free = m.freeOverCents !== undefined ? `, free on orders of ${dollars(m.freeOverCents)} or more` : "";
  return `${m.label}: ${formatUsd(m.priceCents)}, ${when}${free}`;
}

function info(ctx: StoreCtx, p: Product): string {
  const s = ctx.store;
  const lines = s.shipping.map((m) => shippingLine(m, s));
  if (s.delivery) lines.push(`Same-day delivery: ${formatUsd(s.delivery.sameDayFeeCents)} more when you order before the cutoff`);
  return `<section class="pdp-info-band"><div class="container pdp-info">
<section class="pdp-info__description"><h2 class="pdp-info__title">About this ${p.subscription ? "coffee" : "product"}</h2><p>${esc(p.description)}</p></section>
<div class="pdp-info__more">
<div class="accordions">
<details class="accordion accordion--details" open><summary class="accordion__summary">Details</summary><ul class="accordion__list">${p.details.map((d) => `<li>${esc(d)}</li>`).join("")}</ul></details>
<details class="accordion"><summary class="accordion__summary">Shipping &amp; returns</summary><ul class="accordion__list">${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul><p>Read our <a href="${esc(pageHref(ctx, "shipping"))}">shipping</a> and <a href="${esc(pageHref(ctx, "returns"))}">returns</a> policies.</p></details>
</div>
${ctx.skin.productExtras(p, ctx)}
</div>
</div></section>`;
}

function reviews(p: Product): string {
  const { avg, count } = ratingOf(p);
  if (!count) return "";
  const bars = [5, 4, 3, 2, 1]
    .map((n) => {
      const k = p.reviews.filter((r) => r.rating === n).length;
      return `<li><span class="rating-bars__label">${n} star</span><span class="rating-bars__bar"><span style="width:${Math.round((k / count) * 100)}%"></span></span><span class="rating-bars__count">${k}</span></li>`;
    })
    .join("");
  // Newest first, like a real store's reviews: a review joins the list at its own date.
  const list = [...p.reviews]
    .sort((a, b) => b.date.localeCompare(a.date))
    .map(
      (r) => `<li class="review"><div class="review__head">${stars(r.rating, "stars stars--small")}<p class="review__title">${esc(r.title)}</p></div>
<p class="review__body">${esc(r.body)}</p>
<p class="review__meta"><span class="review__author">${esc(r.author)}</span>${r.verified ? '<span class="review__verified">Verified buyer</span>' : ""}<time datetime="${esc(r.date)}">${esc(formatDate(r.date))}</time></p></li>`,
    )
    .join("");
  return `<section class="reviews" id="reviews" aria-labelledby="reviews-title"><div class="container reviews__inner">
<div class="reviews__summary"><h2 class="reviews__title" id="reviews-title">Customer reviews</h2><p class="reviews__avg">${stars(avg)}<span>${esc(ratingText(avg))} out of 5</span></p><p class="reviews__count">Based on ${esc(plural(count, "review"))}</p><ul class="rating-bars">${bars}</ul></div>
<ol class="reviews__list">${list}</ol>
</div></section>`;
}

/** The product page: gallery and buy box in the skin's arrangement, description and details, the skin's extras, reviews, related and recently viewed. */
export function productPage(ctx: StoreCtx, v: ProductPageView): string {
  const p = v.product;
  const c = v.collection;
  const { avg, count } = ratingOf(p);
  const url = `${ctx.publicBase}/products/${p.slug}`;
  const recent = [
    `data-recent-slug="${esc(p.slug)}"`,
    `data-recent-name="${esc(p.name)}"`,
    `data-recent-url="${esc(productHref(ctx, p))}"`,
    `data-recent-image="${esc(p.images[0] ? assetHref(ctx, p.images[0]) : "")}"`,
    `data-recent-price="${esc(formatUsd(p.priceCents))}"`,
  ].join(" ");
  const body = `<div class="container">${breadcrumb(ctx, [...(c ? [{ label: c.name, path: `/collections/${c.slug}` }] : []), { label: p.name }])}</div>
<div class="container pdp pdp--${ctx.skin.productLayout}" data-product data-base-cents="${p.priceCents}"${p.compareAtCents ? ` data-compare-cents="${p.compareAtCents}"` : ""}${
    p.subscription ? ` data-save-pct="${p.subscription.savePct}"` : ""
  } ${recent}>
${gallery(ctx, p)}
${buyBox(ctx, v)}
</div>
${info(ctx, p)}
${reviews(p)}
<section class="section section--related" data-section="related"><div class="container">${sectionHead(ctx, "You may also like")}${productGrid(ctx, v.related, { cls: "grid--related" })}</div></section>
<section class="section section--recent" data-section="recent" data-recent hidden><div class="container"><h2 class="section__title">Recently viewed</h2><ul class="recent-list" data-recent-list></ul></div></section>`;
  const ld = {
    ...productLd({
      id: `${url}#product`,
      url,
      name: p.name,
      sku: p.sku,
      ...(c ? { category: c.name } : {}),
      description: p.summary,
      priceCents: p.priceCents,
      availability: p.stock > 0 ? "in_stock" : "out_of_stock",
    }),
    image: p.images.map((im) => absoluteAsset(ctx, im)),
    brand: { "@type": "Brand", name: ctx.store.brand.name },
    ...(count ? { aggregateRating: { "@type": "AggregateRating", ratingValue: ratingText(avg), reviewCount: count, bestRating: 5, worstRating: 1 } } : {}),
  };
  const crumbs = breadcrumbJsonLd(ctx, [...(c ? [{ name: c.name, path: `/collections/${c.slug}` }] : []), { name: p.name, path: `/products/${p.slug}` }]);
  return layout(ctx, p.name, body, {
    jsonLd: [ld, crumbs],
    og: { type: "product", description: p.summary, ...(p.images[0] ? { image: p.images[0] } : {}) },
    bodyClass: "page-product",
  });
}
