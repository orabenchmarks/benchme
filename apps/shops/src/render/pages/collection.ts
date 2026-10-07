import type { Product } from "@benchme/storefront";
import { breadcrumb, breadcrumbJsonLd, esc, formatUsd, href, icon, plural, productGrid } from "../components.js";
import { layout, type StoreCtx } from "../layout.js";
import type { CollectionView } from "../skins/index.js";

export type SortKey = "featured" | "price-asc" | "price-desc" | "rating";

export const SORTS: readonly { key: SortKey; label: string }[] = [
  { key: "featured", label: "Featured" },
  { key: "price-asc", label: "Price, low to high" },
  { key: "price-desc", label: "Price, high to low" },
  { key: "rating", label: "Top rated" },
];

/** One option group as a filter: every value offered in the collection, how many products offer it, whether it is on. */
export type FilterGroup = { id: string; name: string; values: { id: string; label: string; count: number; checked: boolean }[] };

export type CollectionPageView = {
  collection: CollectionView;
  /** The products on this page, sorted. */
  products: Product[];
  /** How many products match the filters, across all pages. */
  total: number;
  page: number;
  pages: number;
  sort: SortKey;
  groups: FilterGroup[];
  /** The price filter as the shopper typed it, in dollars. */
  min: number | null;
  max: number | null;
  /** The query that selects this listing, without the page: [name, value] pairs in a stable order. */
  params: [string, string][];
};

const qs = (params: [string, string][]) => (params.length ? `?${new URLSearchParams(params).toString()}` : "");

function listingHref(ctx: StoreCtx, v: CollectionPageView, page: number, params = v.params): string {
  return href(ctx, `/collections/${encodeURIComponent(v.collection.slug)}${qs(page > 1 ? [...params, ["page", String(page)]] : params)}`);
}

function filtersForm(ctx: StoreCtx, v: CollectionPageView): string {
  const groups = v.groups
    .map(
      (g) => `<fieldset class="filter-group"><legend class="filter-group__title">${esc(g.name)}</legend>${g.values
        .map(
          (x) =>
            `<label class="filter-option"><input type="checkbox" name="opt_${esc(g.id)}" value="${esc(x.id)}"${x.checked ? " checked" : ""}><span>${esc(x.label)}</span><span class="filter-option__count">${x.count}</span></label>`,
        )
        .join("")}</fieldset>`,
    )
    .join("");
  const num = (n: number | null) => (n === null ? "" : String(n));
  return `<form class="filters__form" method="get" action="${esc(href(ctx, `/collections/${encodeURIComponent(v.collection.slug)}`))}">
${v.sort !== "featured" ? `<input type="hidden" name="sort" value="${esc(v.sort)}">` : ""}
${groups}
<fieldset class="filter-group filter-group--price"><legend class="filter-group__title">Price</legend>
<div class="price-range"><label><span>From $</span><input type="number" name="min" min="0" step="1" inputmode="numeric" value="${esc(num(v.min))}" placeholder="0"></label><label><span>To $</span><input type="number" name="max" min="0" step="1" inputmode="numeric" value="${esc(num(v.max))}" placeholder="Any"></label></div>
</fieldset>
<div class="filters__actions"><button class="btn btn--secondary" type="submit">Apply filters</button><a class="link" href="${esc(href(ctx, `/collections/${encodeURIComponent(v.collection.slug)}${v.sort !== "featured" ? `?sort=${v.sort}` : ""}`))}">Clear all</a></div>
</form>`;
}

/** The filters in effect, each with a link that removes it. */
function activeFilters(ctx: StoreCtx, v: CollectionPageView): string {
  const chips: string[] = [];
  for (const g of v.groups) {
    for (const x of g.values.filter((y) => y.checked)) {
      const without = v.params.filter(([k, val]) => !(k === `opt_${g.id}` && val === x.id));
      chips.push(`<a class="filter-chip" href="${esc(listingHref(ctx, v, 1, without))}" aria-label="Remove filter ${esc(g.name)}: ${esc(x.label)}">${esc(x.label)}${icon("close")}</a>`);
    }
  }
  for (const [key, label] of [
    ["min", v.min === null ? null : `From ${formatUsd(Math.round(v.min * 100))}`],
    ["max", v.max === null ? null : `Up to ${formatUsd(Math.round(v.max * 100))}`],
  ] as const) {
    if (label) chips.push(`<a class="filter-chip" href="${esc(listingHref(ctx, v, 1, v.params.filter(([k]) => k !== key)))}" aria-label="Remove filter ${esc(label)}">${esc(label)}${icon("close")}</a>`);
  }
  return chips.length ? `<div class="active-filters">${chips.join("")}</div>` : "";
}

function sortForm(ctx: StoreCtx, v: CollectionPageView): string {
  const keep = v.params.filter(([k]) => k !== "sort").map(([k, val]) => `<input type="hidden" name="${esc(k)}" value="${esc(val)}">`);
  return `<form class="sort" method="get" action="${esc(href(ctx, `/collections/${encodeURIComponent(v.collection.slug)}`))}">
${keep.join("")}
<label class="sort__label" for="sort-select">Sort by</label>
<select class="sort__select" id="sort-select" name="sort" data-autosubmit>${SORTS.map((s) => `<option value="${s.key}"${s.key === v.sort ? " selected" : ""}>${esc(s.label)}</option>`).join("")}</select>
<noscript><button class="btn btn--secondary" type="submit">Sort</button></noscript>
</form>`;
}

function pagination(ctx: StoreCtx, v: CollectionPageView): string {
  if (v.pages <= 1) return "";
  const pages = Array.from({ length: v.pages }, (_, i) => i + 1)
    .map((n) => (n === v.page ? `<span class="pagination__page" aria-current="page">${n}</span>` : `<a class="pagination__page" href="${esc(listingHref(ctx, v, n))}">${n}</a>`))
    .join("");
  const prev = v.page > 1 ? `<a class="pagination__step" rel="prev" href="${esc(listingHref(ctx, v, v.page - 1))}">${icon("chevron-left")}<span>Previous</span></a>` : "";
  const next = v.page < v.pages ? `<a class="pagination__step" rel="next" href="${esc(listingHref(ctx, v, v.page + 1))}"><span>Next</span>${icon("chevron-right")}</a>` : "";
  return `<nav class="pagination" aria-label="Pages">${prev}${pages}${next}</nav>`;
}

/** A collection (or /collections/all): breadcrumb, the skin's header, filters, sort, the grid, pages. */
export function collectionPage(ctx: StoreCtx, v: CollectionPageView): string {
  const c = v.collection;
  const filtered = v.groups.some((g) => g.values.some((x) => x.checked)) || v.min !== null || v.max !== null;
  const empty = `<div class="empty-state"><p class="empty-state__title">No products match these filters.</p><p><a class="btn btn--secondary" href="${esc(
    href(ctx, `/collections/${encodeURIComponent(c.slug)}`),
  )}">Clear filters</a></p></div>`;
  const body = `<div class="container">${breadcrumb(ctx, [{ label: c.name }])}</div>
${ctx.skin.collectionHeader(c, ctx)}
<div class="container collection-layout">
<aside class="filters" aria-label="Filters">
<details class="filters__details" data-filters open><summary class="filters__summary">${icon("filter")}<span>Filter</span></summary>
${filtersForm(ctx, v)}
</details>
</aside>
<div class="collection-main">
<div class="toolbar"><p class="toolbar__count">${esc(filtered ? `${plural(v.total, "product")} found` : plural(v.total, "product"))}</p>${sortForm(ctx, v)}</div>
${activeFilters(ctx, v)}
${productGrid(ctx, v.products, { main: true, cls: "grid--collection" })}
${v.products.length ? "" : empty}
${pagination(ctx, v)}
</div>
</div>`;
  const crumbs = breadcrumbJsonLd(ctx, [{ name: c.name, path: `/collections/${c.slug}` }]);
  return layout(ctx, v.page > 1 ? `${c.name}, page ${v.page}` : c.name, body, {
    jsonLd: [crumbs],
    og: { description: c.blurb, ...(c.hero ? { image: c.hero } : {}) },
    bodyClass: "page-collection",
  });
}
