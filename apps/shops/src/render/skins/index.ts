import type { Collection, Product, Review } from "@benchme/storefront";
import type { SiteId } from "../../sites.js";
import type { PageCtx, StoreCtx } from "../layout.js";
import { haldenSkin } from "./halden.js";
import { paylanternSkin } from "./paylantern.js";
import { quillfeatherSkin } from "./quillfeather.js";
import { wrenfieldSkin } from "./wrenfield.js";

/**
 * A skin is what makes a store look like itself: not a palette over one template, but the hook points
 * where the three stores differ in STRUCTURE — header, hero, the home page's sections and their order,
 * the product card, the collection header, the product page's layout and its extras, the footer.
 *
 * The defaults live in ../components.ts (`defaultSkin`, plus every building block they are made of);
 * each skins/<store>.ts spreads them and overrides what makes its store distinct, and
 * public/css/<store>.css styles the result (it is loaded after base.css, on that store's pages only).
 *
 * What the pages and the tests rely on, whatever a skin renders:
 * - announcement(): contains brand.announcement verbatim (escaped);
 * - hero(): one element carrying data-section="hero";
 * - homeSections(): each section is one element carrying data-section="<name>"; every store keeps
 *   "featured-collections", "bestsellers", "story", "reviews" and "newsletter" (order is the skin's);
 * - productCard(): the root carries data-product-slug and data-price-cents (base price, in cents) and
 *   links to the product; it must not render a form;
 * - footer(): contains finePrint(ctx) — "<Brand> is a fictional store operated for research. Orders are
 *   not fulfilled." — on every page;
 * - every link, form action and image goes through the href()/assetHref() helpers (the workspace prefix),
 *   and every interpolated value through esc().
 */

/** A collection as its page and its tiles show it: the catalogue's collection plus how many products it holds. */
export type CollectionView = Collection & { count: number };

/** A collection tile on the home page: its picture is the collection's hero, else its first product's photo. */
export type CollectionTile = { collection: Collection; count: number; image: string | undefined };

/** A review worth quoting on the home page, with the product it is about. */
export type ReviewHighlight = { review: Review; product: Product };

/** What the home page's sections draw from. The route computes it: the scenario's `featured` order is already applied. */
export type HomeData = {
  /** Up to eight products, best first (featured products lead when the scenario names some). */
  bestsellers: Product[];
  collections: CollectionTile[];
  /** Recent five-star reviews from the catalogue, one per product. */
  reviews: ReviewHighlight[];
};

/** One section of the home page. */
export type HomeSection = (ctx: StoreCtx, data: HomeData) => string;

/** Where the product page puts its photos: beside the buy box (left or right), or above it. */
export type ProductLayout = "gallery-left" | "gallery-right" | "stacked";

export interface Skin {
  readonly id: SiteId;
  /** Classes on <body>; public/css/<store>.css keys its variants off them. */
  readonly bodyClass: string;
  /** Font stacks behind the brand's Google fonts, used while they load (or if they never do). */
  readonly fontFallbacks: { display: string; body: string };
  /** The home page's <title>, before " | <Brand>". */
  homeTitle(ctx: StoreCtx): string;
  /** The intro of /collections/all ("Shop all"), which has no catalogue blurb of its own. */
  allProductsBlurb(ctx: StoreCtx): string;
  /** Social networks named in the footer (links go nowhere: href="#"). */
  readonly socials: readonly string[];
  /** The bar above the header. Must contain brand.announcement. */
  announcement(ctx: PageCtx): string;
  /** The site header: logo, collection menu, search, account, cart (and anything above or below them). */
  header(ctx: PageCtx): string;
  /** The home page's opening section. */
  hero(ctx: StoreCtx, data: HomeData): string;
  /** The home page's sections after the hero, in order. */
  homeSections(ctx: StoreCtx): HomeSection[];
  /** A product in a grid (home, collection, search, related). */
  productCard(p: Product, ctx: StoreCtx): string;
  /** The top of a collection page, under the breadcrumb. */
  collectionHeader(c: CollectionView, ctx: StoreCtx): string;
  /** The product page's arrangement of gallery and buy box. */
  readonly productLayout: ProductLayout;
  /** Store-specific product content under the description (a specs table, tasting notes, a care card). */
  productExtras(p: Product, ctx: StoreCtx): string;
  /**
   * What the buy box shows between the rating and the price (a type line, key specs). It is rendered in
   * that place, so the reading and tab order is the order on screen: no CSS `order` needed.
   */
  buyBoxIntro(p: Product, ctx: StoreCtx): string;
  /**
   * What the buy box shows between the summary and the options (a coffee's label: its tasting notes, roast
   * and origin), rendered in that place for the same reason.
   */
  buyBoxAfterSummary(p: Product, ctx: StoreCtx): string;
  /**
   * Anything the buy box adds under the add-to-cart form and the store's promises (a roast-day note, a gift
   * line, a bar that stays on screen). A button outside the form submits it with form="buy-form"; an element
   * carrying data-price shows the price of the chosen options (store.js keeps every one of them current).
   */
  buyBoxExtras(p: Product, ctx: StoreCtx): string;
  /** The newsletter pop-up's headline and pitch, in the store's voice (the code itself is revealed only after signing up). */
  newsletterPitch(ctx: PageCtx): { title: string; text: string };
  /** The pop-up's photograph (a public/ path), when the store wants another than brand.heroImage. */
  readonly newsletterImage?: string;
  /** The phone-width menu: components.ts mobileNav(), with the store's own extra links. */
  mobileNav(ctx: PageCtx): string;
  /** The site footer. Must contain finePrint(ctx). */
  footer(ctx: PageCtx): string;
}

const SKINS: Readonly<Record<SiteId, Skin>> = {
  wrenfield: wrenfieldSkin,
  halden: haldenSkin,
  quillfeather: quillfeatherSkin,
  paylantern: paylanternSkin,
};

/** The skin a site renders with. */
export function skinFor(site: SiteId): Skin {
  return SKINS[site];
}
