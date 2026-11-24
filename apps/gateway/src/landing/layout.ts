/** The frame every page of the site shares: the bar, the shell around a page's body, and the terminal card. */
import { SOURCE_URL } from "./cards.js";
import { esc } from "./html.js";
import { LANDING_SCRIPT } from "./script.js";
import { LANDING_CSS } from "./style.js";

/** The bar: the brand, and where to go (from the front page, its own sections; from another page, the front page's). */
export function bar(registry: boolean, home: boolean): string {
  const links = [
    `<li class="opt"><a href="${home ? "" : "/"}#how">How it works</a></li>`,
    `<li><a href="${home ? "" : "/"}#scenarios-h">Scenarios</a></li>`,
    ...(registry ? [`<li><a href="/registry">Registry</a></li>`] : []),
    `<li class="opt"><a href="${SOURCE_URL}">GitHub</a></li>`,
  ].join("");
  return `<header class="bar"><div class="wrap"><a class="brand" href="/"><span class="brand-mark" aria-hidden="true"></span>benchme</a><nav aria-label="Site"><ul>${links}</ul></nav></div></header>`;
}

/** The shell every page of the site shares: one stylesheet, one script, kept out of search indexes. */
export function shell(title: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>${LANDING_CSS}</style></head>
<body>
${body}
<footer class="foot"><div class="wrap"><p>benchme is open source (MIT): <a href="${SOURCE_URL}">github.com/orabenchmarks/benchme</a>.</p><p>Same seed, same data: every workspace starts from the rows its seed derives.</p></div></footer>
<p id="said" class="sr" aria-live="polite"></p>
<script>${LANDING_SCRIPT}</script>
</body></html>`;
}

/** A terminal card: its step's number (if it is one of several), its title, an optional Copy button for the code it holds, and the code. */
export function terminal(step: number | null, title: string, body: string, copy?: { id: string; what: string }): string {
  const button = copy
    ? `<button type="button" class="copy" data-copy="${copy.id}" data-what="${esc(copy.what)}" data-label="Copy" aria-label="Copy ${esc(copy.what)}">Copy</button>`
    : "";
  return `<div class="term"><div class="term-head">${step === null ? "" : `<span class="step">${step}</span>`}<span class="title">${esc(title)}</span>${button}</div><pre>${body}</pre></div>`;
}
