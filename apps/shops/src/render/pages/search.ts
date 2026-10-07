import type { Product } from "@benchme/storefront";
import { breadcrumb, collectionHref, esc, href, icon, plural, productGrid } from "../components.js";
import { layout, type StoreCtx } from "../layout.js";

export type SearchView = { q: string; results: Product[] };

/** The results of /search?q=…, or the search box alone; the query is echoed escaped, never as markup. */
export function searchPage(ctx: StoreCtx, v: SearchView): string {
  const q = v.q.trim();
  const form = `<form class="search search--page" role="search" action="${esc(href(ctx, "/search"))}" method="get" data-search>
<label class="visually-hidden" for="search-page">Search ${esc(ctx.brand.name)}</label>
<input class="search__input" id="search-page" type="search" name="q" value="${esc(q)}" placeholder="Search ${esc(ctx.brand.name)}" autocomplete="off" data-search-input role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="search-page-results">
<button class="search__submit btn btn--primary" type="submit">${icon("search")}<span>Search</span></button>
<div class="search__results" id="search-page-results" role="listbox" aria-label="Suggestions" data-search-results hidden></div>
</form>`;
  const collections = `<ul class="search-collections">${ctx.store.collections.map((c) => `<li><a class="btn btn--secondary" href="${esc(collectionHref(ctx, c.slug))}">${esc(c.name)}</a></li>`).join("")}</ul>`;
  let results = "";
  if (q && v.results.length) {
    results = `<p class="search-page__count">${esc(plural(v.results.length, "result"))} for “${esc(q)}”</p>${productGrid(ctx, v.results, { main: true, cls: "grid--collection" })}`;
  } else if (q) {
    results = `<div class="empty-state"><p class="empty-state__title">No results for “${esc(q)}”</p><p>Check the spelling, try a shorter word, or browse a collection.</p>${collections}</div>`;
  } else {
    results = `<div class="empty-state"><p>Search by name, color or style, or start with a collection.</p>${collections}</div>`;
  }
  const body = `<div class="container">${breadcrumb(ctx, [{ label: "Search" }])}</div>
<div class="container search-page">
<h1 class="search-page__title">${q ? `Search results` : "Search"}</h1>
${form}
${results}
</div>`;
  return layout(ctx, q ? `Search: ${q}` : "Search", body, { bodyClass: "page-search" });
}
