import { collectionHref, esc, href, searchForm } from "../components.js";
import { layout, type PageCtx } from "../layout.js";

/**
 * The 404 page of a site: in the store's own look, with its search and collections; plain on
 * paylantern, which has no catalogue to point to.
 */
export function notFoundPage(ctx: PageCtx): string {
  const store = ctx.store;
  if (!store) {
    return layout(
      ctx,
      "Page not found",
      `<div class="container not-found not-found--plain"><h1 class="not-found__title">Page not found</h1><p>There is nothing at this address.</p></div>`,
      { bodyClass: "page-not-found" },
    );
  }
  const body = `<div class="container not-found">
<h1 class="not-found__title">Page not found</h1>
<p class="not-found__text">The page you were looking for isn't here. It may have moved, or the link may be mistyped.</p>
${searchForm(ctx, "not-found", { cls: "search search--page" })}
<ul class="not-found__links">${store.collections.map((c) => `<li><a class="btn btn--secondary" href="${esc(collectionHref(ctx, c.slug))}">${esc(c.name)}</a></li>`).join("")}</ul>
<p><a class="btn btn--primary" href="${esc(href(ctx, "/"))}">Back to the home page</a></p>
</div>`;
  return layout(ctx, "Page not found", body, { bodyClass: "page-not-found" });
}
