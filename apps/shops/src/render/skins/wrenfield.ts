import type { Product } from "@benchme/storefront";
import {
  ABOUT_PAGES,
  HELP_PAGES,
  accountLink,
  badgesHtml,
  cartButton,
  collectionHref,
  defaultSkin,
  dollars,
  esc,
  finePrint,
  formatUsd,
  hourLabel,
  href,
  icon,
  img,
  logoLink,
  menuButton,
  mobileNav,
  pageHref,
  paymentIcons,
  plural,
  priceHtml,
  primaryNav,
  productHref,
  ratingOf,
  ratingText,
  searchForm,
  sectionHead,
  sections,
  socialLinks,
  stars,
  telHref,
  type CollectionView,
  type HomeSection,
} from "../components.js";
import type { PageCtx, StoreCtx } from "../layout.js";
import type { Skin } from "./index.js";

/**
 * Wrenfield Flowers — a national florist with a boutique's manners. Editorial and calm: one slim fern
 * utility bar (check a ZIP, the same-day cutoff, the florists' phone), a centred masthead over a
 * small-caps menu, a full-bleed photograph with a quiet Fraunces headline, occasion tiles under
 * glasshouse arches, portrait product cards without boxes, a "Why Wrenfield" band, a note from the
 * head florist, and a care card printed like the one in the box. The arch is the one signature shape:
 * occasion tiles, the florist's portrait and the 404 page. Styles: public/css/wrenfield.css.
 */

/** The florists' hours, as the contact page states them. */
const CARE_HOURS = "7 am–7 pm PT";

/** The menu's link to how same-day delivery works (the shipping page's section). */
const SAME_DAY = { label: "Same-day delivery", path: "/pages/shipping#same-day-delivery" };

/** The same-day cutoff as a shopper reads it ("2 pm"), from the catalogue's delivery rules. */
const cutoffOf = (ctx: PageCtx) => hourLabel(ctx.store?.delivery?.cutoffHourLocal ?? 14);

/* ------------------------------------------------------------------ utility bar and masthead */

/** The ZIP check in the utility bar: GET /delivery-check; store.js answers in the little card under it. */
function zipCheck(ctx: PageCtx): string {
  return `<form class="zip-check" action="${esc(href(ctx, "/delivery-check"))}" method="get" data-delivery-check>
<label class="zip-check__label" for="zip-utility">${icon("pin")}<span>Deliver to</span></label>
<input class="zip-check__input" id="zip-utility" name="zip" inputmode="numeric" autocomplete="postal-code" placeholder="ZIP code" maxlength="10">
<button class="zip-check__btn" type="submit">Check</button>
<span class="zip-check__result" data-delivery-result role="status" aria-live="polite"></span>
</form>`;
}

/** One slim bar above the masthead: the announcement (verbatim), the ZIP check and a line to the florists. */
function announcement(ctx: PageCtx): string {
  const phone = ctx.brand.supportPhone;
  return `<div class="wf-utility" role="region" aria-label="Delivery"><div class="container wf-utility__inner">
<p class="wf-utility__note">${esc(ctx.brand.announcement)}</p>
${zipCheck(ctx)}
<p class="wf-utility__help">${icon("phone")}<span>Call a florist</span><a href="${esc(telHref(phone))}">${esc(phone)}</a></p>
</div></div>`;
}

/** Search (a field on wide screens, an icon on phones) and the menu button left, the logo centred, account and cart right; the collections on their own row. */
function header(ctx: PageCtx): string {
  return `<header class="site-header site-header--masthead" data-site-header>
<div class="container site-header__bar">
<div class="site-header__start">${menuButton()}<a class="icon-btn search-link" href="${esc(href(ctx, "/search"))}" aria-label="Search">${icon("search")}</a>${searchForm(ctx, "header", {
    placeholder: "Search flowers and plants",
  })}</div>
${logoLink(ctx)}
<div class="header-actions">${accountLink(ctx)}${cartButton(ctx)}</div>
</div>
<div class="site-header__nav"><div class="container">${primaryNav(ctx, { extra: [SAME_DAY] })}</div></div>
</header>`;
}

/* ------------------------------------------------------------------ home */

function hero(ctx: StoreCtx): string {
  return `<section class="hero hero--wf" data-section="hero">
<div class="hero__media">${img(ctx, ctx.store.brand.heroImage, "A jug of sunflowers, zinnias and grasses on a farmhouse table", { eager: true })}</div>
<div class="container hero__inner"><div class="hero__content">
<h1 class="hero__title">Tied by hand on the morning they’re delivered</h1>
<p class="hero__text">${esc(
    `Seasonal bouquets and easygoing plants, made up by a florist near the people you love. Order by ${cutoffOf(ctx)} Pacific and we’ll deliver today, seven days a week.`,
  )}</p>
<div class="hero__actions"><a class="btn btn--primary btn--lg" href="${esc(href(ctx, "/collections/bestsellers"))}">Shop bestsellers</a><a class="btn btn--ghost btn--lg" href="${esc(
    href(ctx, "/collections/sympathy"),
  )}">Sympathy flowers</a></div>
</div></div>
</section>`;
}

/** What a collection's products are called on its tile. */
function tileNoun(slug: string): [string, string] {
  if (slug === "plants") return ["plant", "plants"];
  if (slug === "sympathy") return ["arrangement", "arrangements"];
  return ["bouquet", "bouquets"];
}

/**
 * The occasions under arches. A tile whose picture is already on the page (the hero's photograph is
 * also the Bestsellers collection's) shows one of its own products instead, one the grid below
 * doesn't show either.
 */
const occasions: HomeSection = (ctx, data) => {
  const hero = ctx.store.brand.heroImage;
  const onPage = new Set<string>([...(hero ? [hero] : []), ...data.bestsellers.flatMap((p) => p.images.slice(0, 1))]);
  const tiles = data.collections
    .map((t) => {
      let image = t.image;
      if (!image || image === hero) {
        const own = ctx.store.products.filter((p) => p.collection === t.collection.slug);
        image = (own.find((p) => p.images[0] !== undefined && !onPage.has(p.images[0])) ?? own[0])?.images[0] ?? image;
      }
      const [one, many] = tileNoun(t.collection.slug);
      return `<li class="arch-tile"><a class="arch-tile__link" href="${esc(collectionHref(ctx, t.collection.slug))}">
<span class="arch-tile__media">${img(ctx, image, "")}</span>
<span class="arch-tile__name">${esc(t.collection.name)}</span>
<span class="arch-tile__count">${esc(plural(t.count, one, many))}</span>
</a></li>`;
    })
    .join("");
  return `<section class="section wf-occasions" data-section="featured-collections"><div class="container">
${sectionHead(ctx, "Flowers for every occasion")}
<ul class="arch-tiles">${tiles}</ul>
</div></section>`;
};

/** Why Wrenfield: four promises, each one the policy pages keep (delivery, freshness guarantee, card messages, packaging). */
const values: HomeSection = (ctx) => {
  const d = ctx.store.delivery;
  const sameDay = d
    ? `Order by ${hourLabel(d.cutoffHourLocal)} Pacific and we’ll deliver today for ${dollars(d.sameDayFeeCents)} more, or choose any date ahead.`
    : "Choose any delivery date ahead, seven days a week.";
  const items = [
    { icon: "pin", title: "Made by a florist near them", text: "Your order goes to the partner studio closest to the recipient and is tied that morning from the week’s best flowers." },
    { icon: "clock", title: "Same day, seven days a week", text: sameDay },
    { icon: "leaf", title: "Fresh for seven days", text: "If your flowers fade within a week of delivery, send us a photo and we’ll replace or refund them." },
    { icon: "gift", title: "Your words, never the price", text: "A printed card carries your message. No receipt goes in the box, and no cellophane either." },
  ];
  return `<section class="section wf-values" data-section="values"><div class="container">
${sectionHead(ctx, "Why Wrenfield")}
<ul class="wf-values__list">${items
    .map((i) => `<li class="wf-value">${icon(i.icon, "icon wf-value__icon")}<h3 class="wf-value__title">${esc(i.title)}</h3><p>${esc(i.text)}</p></li>`)
    .join("")}</ul>
</div></section>`;
};

/** A note from the head florist, beside a bouquet in an arch. */
const floristNote: HomeSection = (ctx) => `<section class="section wf-note" data-section="florist-note" aria-label="A note from our head florist"><div class="container wf-note__inner">
<div class="wf-note__media">${img(ctx, "img/wrenfield/tulips-iris.jpg", "Tulips, iris and lilac loosely tied on a weathered table")}</div>
<figure class="wf-note__quote">
<blockquote><p>We don’t make bouquets from a spreadsheet. Each morning the florist making yours looks at what came in from the growers, picks what’s at its best, and ties it to the colors and shape in the photo. It will look like the picture, and a little like the week it was made in.</p></blockquote>
<figcaption><span class="wf-note__name">June Ferreira</span><span class="wf-note__role">Head florist, Sonoma studio</span></figcaption>
</figure>
</div></section>`;

/* ------------------------------------------------------------------ cards, collections, product page */

/** A portrait card without a box: the photograph, the name in Fraunces, the price with the rating beside it. */
function productCard(p: Product, ctx: StoreCtx): string {
  const { avg, count } = ratingOf(p);
  return `<article class="card card--wf" data-product-slug="${esc(p.slug)}" data-price-cents="${p.priceCents}">
<a class="card__link" href="${esc(productHref(ctx, p))}">
<div class="card__media">${img(ctx, p.images[0], p.name, { cls: "card__img" })}${badgesHtml(p, "card__badges badges")}</div>
<div class="card__body">
<h3 class="card__title">${esc(p.name)}</h3>
<p class="card__meta"><span class="card__price">${priceHtml(p)}</span>${
    count ? `<span class="card__rating">${stars(avg, "stars stars--small")}<span class="card__count">${esc(ratingText(avg))} (${count})</span></span>` : ""
  }</p>
</div>
</a>
</article>`;
}

/** A band of the collection's photograph with the title on a sheet of paper laid over its lower edge. */
function collectionHeader(c: CollectionView, ctx: StoreCtx): string {
  return `<header class="collection-header collection-header--wf${c.hero ? " has-media" : ""}">
${c.hero ? `<div class="collection-header__media">${img(ctx, c.hero, "", { eager: true })}</div>` : ""}
<div class="container"><div class="collection-header__panel">
<h1 class="collection-header__title">${esc(c.name)}</h1>
<p class="collection-header__blurb">${esc(c.blurb)}</p>
</div></div>
</header>`;
}

/** The care card, set like the printed one that travels in the box. Plants carry their own care in their details. */
function careCard(p: Product, ctx: StoreCtx): string {
  const phone = ctx.store.brand.supportPhone;
  const call = (question: string) =>
    `<p class="care-card__note">${esc(question)} Our florists answer at <a class="care-card__phone" href="${esc(telHref(phone))}">${esc(phone)}</a>.</p>`;
  if (p.collection === "plants") {
    return `<aside class="care-card"><h2 class="care-card__title">Arrives ready to set down</h2><p>Every plant travels upright in its pot with a paper sleeve around its leaves. Unbox it on the day it arrives, give it a drink if the soil is dry, and find it a spot that matches the light in its details.</p>${call(
      "Questions about a plant?",
    )}</aside>`;
  }
  const tips = [
    "Unbox on arrival and trim each stem at an angle, about an inch from the end.",
    "Use a clean vase with cool water; strip any leaves below the waterline.",
    "Change the water every two days and keep the flowers away from ripening fruit and radiators.",
  ];
  return `<aside class="care-card"><h2 class="care-card__title">Flower care</h2><ol>${tips.map((t) => `<li>${esc(t)}</li>`).join("")}</ol>${call("Questions when they arrive?")}</aside>`;
}

/** What can travel with it, chosen at checkout (one-off extras only: a membership is not an extra), and the card that always does. */
function extras(p: Product, ctx: StoreCtx): string {
  const list = ctx.store.addOns.filter((a) => !a.recurring && !(p.collection === "plants" && /vase/i.test(a.name)));
  if (!list.length) return "";
  const card = ctx.store.delivery?.giftMessage ? `<p class="wf-extras__note">${icon("mail")}<span>Every order includes a printed card with your message.</span></p>` : "";
  return `<div class="wf-extras">
<h2 class="wf-extras__title">Add a little extra at checkout</h2>
<ul class="wf-extras__list">${list.map((a) => `<li><span>${esc(a.name)}</span><span class="wf-extras__price">${esc(formatUsd(a.priceCents))}</span></li>`).join("")}</ul>
${card}
</div>`;
}

/* ------------------------------------------------------------------ footer */

function footer(ctx: PageCtx): string {
  const store = ctx.store;
  const col = (title: string, links: { label: string; path: string }[]) =>
    `<div class="footer-col"><h2 class="footer-col__title">${esc(title)}</h2><ul>${links.map((l) => `<li><a href="${esc(href(ctx, l.path))}">${esc(l.label)}</a></li>`).join("")}</ul></div>`;
  const shop = store ? [...store.collections.map((c) => ({ label: c.name, path: `/collections/${c.slug}` })), { label: "Shop all", path: "/collections/all" }] : [];
  const phone = ctx.brand.supportPhone;
  return `<footer class="site-footer site-footer--wf">
<div class="container">
<div class="wf-footer__top">
<div class="wf-footer__brand">${logoLink(ctx, "logo logo--footer")}<p>${esc(ctx.brand.tagline)}</p></div>
<div class="wf-footer__cols">
${shop.length ? col("Shop", shop) : ""}
${col(
  "Help",
  HELP_PAGES.map(([k, l]) => ({ label: l, path: `/pages/${k}` })),
)}
${col(
  "About",
  ABOUT_PAGES.map(([k, l]) => ({ label: l, path: `/pages/${k}` })),
)}
</div>
<div class="wf-footer__care">
<h2 class="footer-col__title">Florists on call</h2>
<p>Every day, ${esc(CARE_HOURS)}</p>
<p><a href="${esc(telHref(phone))}">${esc(phone)}</a></p>
<p><a href="mailto:${esc(ctx.brand.supportEmail)}">${esc(ctx.brand.supportEmail)}</a></p>
<p><a class="wf-footer__link" href="${esc(pageHref(ctx, "contact"))}">More ways to reach us</a></p>
</div>
</div>
<div class="site-footer__bottom">
<p class="copyright">© 2026 ${esc(ctx.brand.name)}</p>
${socialLinks(ctx.skin.socials)}
${paymentIcons()}
</div>
${finePrint(ctx)}
</div>
</footer>`;
}

/* ------------------------------------------------------------------ the skin */

export const wrenfieldSkin: Skin = {
  ...defaultSkin,
  id: "wrenfield",
  bodyClass: "skin-wrenfield",
  fontFallbacks: { display: "Georgia, 'Times New Roman', serif", body: defaultSkin.fontFallbacks.body },
  homeTitle: () => "Flower delivery, hand-tied and seasonal",
  allProductsBlurb: () => "Every bouquet, sympathy arrangement and plant we deliver, tied or potted by a florist near the person you're sending to.",
  socials: ["Instagram", "Pinterest", "Facebook"],
  announcement,
  header,
  hero,
  homeSections: () => [
    occasions,
    sections.bestsellers({ title: "Our bestsellers", link: { label: "Shop all bestsellers", path: "/collections/bestsellers" } }),
    values,
    sections.storyBand({
      title: "From a cutting garden in Sonoma",
      image: "img/wrenfield/white-spray-roses.jpg",
      imageAlt: "White garden roses in flower on the bush",
      cls: "story--wf",
    }),
    floristNote,
    sections.reviewsBand({ title: "What our customers say", cls: "reviews--wf" }),
    sections.newsletterBlock({
      title: "Get 10% off your first order",
      text: "Seasonal picks, care notes and the occasional offer from our florists, about twice a month. Your code appears the moment you sign up.",
    }),
  ],
  productCard,
  collectionHeader,
  productLayout: "gallery-left",
  productExtras: careCard,
  buyBoxExtras: extras,
  newsletterPitch: () => ({
    title: "10% off your first order",
    text: "Seasonal picks and care notes from our florists, about twice a month. Sign up and we'll show your code right away.",
  }),
  // The utility bar's florists' line is for wide screens: on a phone the menu carries it, with same-day delivery.
  mobileNav: (ctx) => mobileNav(ctx, { extra: [SAME_DAY, { label: "Call a florist", tel: ctx.brand.supportPhone }] }),
  footer,
};
