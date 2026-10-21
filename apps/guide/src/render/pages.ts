import type { Article } from "../content/articles.js";
import type { Product } from "../content/types.js";
import { journalPath, seriesOf, type Edition } from "../editions/editions.js";
import { esc, page } from "./layout.js";

/**
 * The guide's pages, each a pure function of (edition, prefix). Every edition renders the category page and the four
 * product pages identically; the arm changes only (a) whether the category page carries the "From the journal" link
 * and (b) which journal articles exist. The link's text is the article's title, which never names a product.
 */

const back = (e: Edition, prefix: string): string => `<p class="back"><a href="${esc(prefix)}/">← All ${esc(e.category.wording.nounPlural)}</a></p>`;

export function homePage(e: Edition, prefix: string): string {
  const cards = e.category.products
    .map(
      (p) => `<article class="card">
<h2><a href="${esc(prefix)}/products/${esc(p.slug)}">${esc(p.name)}</a></h2>
<p class="tagline">${esc(p.tagline)}</p>
<p class="price">${esc(p.price)}</p>
<p><a href="${esc(prefix)}/products/${esc(p.slug)}">Full details →</a></p>
</article>`,
    )
    .join("\n");
  const first = seriesOf(e)[0];
  const journal =
    e.arm.linked && first
      ? `<section class="journal">
<h2>From the journal</h2>
<p><a href="${esc(prefix)}/${esc(journalPath(first.slug))}">${esc(first.title)}</a></p>
</section>`
      : "";
  return page({
    title: e.category.title,
    prefix,
    body: `<h1>${esc(e.category.title)}</h1>
<p class="intro">${esc(e.category.intro)}</p>
<section class="cards">
${cards}
</section>
${journal}`,
  });
}

export function productPage(e: Edition, p: Product, prefix: string): string {
  const rows = p.facts.map((f) => `<tr><th scope="row">${esc(f.label)}</th><td>${esc(f.value)}</td></tr>`).join("\n");
  return page({
    title: p.name,
    prefix,
    body: `${back(e, prefix)}
<h1>${esc(p.name)}</h1>
<p class="tagline">${esc(p.tagline)}</p>
<h2>In short</h2>
<p>${esc(p.summary)}</p>
<h2>Specifications</h2>
<table>
${rows}
</table>`,
  });
}

/** An article of the edition's series; it links the next one in the series whenever the edition serves it. */
export function articlePage(e: Edition, a: Article, prefix: string): string {
  const series = seriesOf(e);
  const next = series[a.index];
  const nextLink = next
    ? `<p class="next">Next: <a href="${esc(prefix)}/${esc(journalPath(next.slug))}">${esc(next.title)}</a></p>`
    : "";
  return page({
    title: a.title,
    prefix,
    body: `${back(e, prefix)}
<article>
<h1>${esc(a.title)}</h1>
<p class="byline">${esc(a.byline)}</p>
<p class="dek">${esc(a.dek)}</p>
${a.paragraphs.map((para) => `<p>${esc(para)}</p>`).join("\n")}
${nextLink}
</article>`,
  });
}

export function notFoundPage(prefix: string): string {
  return page({ title: "Not found", prefix, body: `<h1>Page not found</h1>\n<p><a href="${esc(prefix)}/">Back to the guide</a></p>` });
}

/** A workspace whose seed names no edition (or that is not a guide workspace at all). */
export function noEditionPage(prefix: string): string {
  return page({ title: "No guide", prefix, body: `<h1>No guide is published for this workspace</h1>` });
}
