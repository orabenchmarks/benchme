import type { PolicyKey } from "@benchme/storefront";
import { anchor, breadcrumb, esc, pageHref } from "../components.js";
import { layout, type StoreCtx } from "../layout.js";

export const POLICY_KEYS: readonly PolicyKey[] = ["shipping", "returns", "faq", "contact", "about", "privacy", "terms"];

export const POLICY_TITLES: Readonly<Record<PolicyKey, string>> = {
  shipping: "Shipping",
  returns: "Returns",
  faq: "Frequently asked questions",
  contact: "Contact us",
  about: "Our story",
  privacy: "Privacy policy",
  terms: "Terms of service",
};

export const isPolicyKey = (s: string): s is PolicyKey => (POLICY_KEYS as readonly string[]).includes(s);

/**
 * A policy page's plain text as HTML: blocks are separated by blank lines; a block starting with
 * "## " opens with a subheading (anchored, so other pages can link to a question); the rest of a
 * block is one paragraph. Everything is escaped.
 */
export function renderPolicyText(text: string): string {
  return text
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean)
    .map((block) => {
      if (!block.startsWith("## ")) return `<p>${esc(block)}</p>`;
      const nl = block.indexOf("\n");
      const heading = (nl < 0 ? block : block.slice(0, nl)).slice(3).trim();
      const rest = nl < 0 ? "" : block.slice(nl + 1).trim();
      return `<h2 id="${esc(anchor(heading))}">${esc(heading)}</h2>${rest ? `<p>${esc(rest)}</p>` : ""}`;
    })
    .join("\n");
}

/** /pages/<key>: the page in the store's own words, with the other help pages beside it. */
export function policyPage(ctx: StoreCtx, key: PolicyKey): string {
  const title = POLICY_TITLES[key];
  const nav = POLICY_KEYS.map(
    (k) => `<li><a href="${esc(pageHref(ctx, k))}"${k === key ? ' aria-current="page"' : ""}>${esc(POLICY_TITLES[k])}</a></li>`,
  ).join("");
  const body = `<div class="container">${breadcrumb(ctx, [{ label: title }])}</div>
<div class="container policy">
<nav class="policy__nav" aria-label="Help and policies"><ul>${nav}</ul></nav>
<article class="policy__body prose">
<h1 class="policy__title">${esc(title)}</h1>
${renderPolicyText(ctx.store.policies[key])}
</article>
</div>`;
  return layout(ctx, title, body, { bodyClass: `page-policy page-policy--${key}` });
}
