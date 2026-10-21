import type { Look } from "../content/sites.js";
import { esc } from "../render/layout.js";

/** Shown on every page of the network, in every edition alike (constant across arms by construction). */
export const NETWORK_FOOTER = "This page is part of a research web. The products, companies and people on it are fictional.";

/** A site's masthead: its name (linking its own home), the line under it, and its look. */
export type Masthead = { readonly name: string; readonly strap: string; readonly home: string; readonly look: Look };

/** The start page's and the not-found page's plain look. */
export const PLAIN: Look = { accent: "#3d4550", font: "system-ui, -apple-system, 'Segoe UI', sans-serif", paper: "#fafafa" };

const style = (l: Look): string => `
:root{--ink:#1d1f23;--muted:#5d636d;--line:#e3e5e8;--accent:${l.accent};--paper:${l.paper}}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.6 ${l.font}}
header,main,footer{max-width:46rem;margin:0 auto;padding:0 1.25rem}
header{padding-top:1.5rem;padding-bottom:1rem;border-bottom:3px solid var(--accent)}
.brand{font-weight:700;font-size:1.4rem;color:var(--accent);text-decoration:none}
.strap{display:block;font-size:.9rem;color:var(--muted)}
main{padding-top:1.5rem;padding-bottom:2rem}
h1{font-size:1.8rem;line-height:1.25;margin:.25rem 0 .75rem}
h2{font-size:1.15rem;line-height:1.3;margin:1.75rem 0 .5rem}
a{color:var(--accent)}
.intro,.dek,.tagline{color:var(--muted)}
.byline{font-size:.85rem;color:var(--muted);margin:0 0 .5rem}
.candidates{list-style:none;padding:0;display:grid;gap:1rem}
.candidates li{border:1px solid var(--line);border-radius:6px;padding:1rem;background:#fff}
.candidates h2{margin:0 0 .25rem}
table{border-collapse:collapse;width:100%;background:#fff;font-size:.95rem;line-height:1.45}
th,td{border:1px solid var(--line);padding:.5rem .65rem;text-align:left;vertical-align:top}
th{width:30%;background:#f4f5f6;font-weight:600}
.pointer{border-top:1px solid var(--line);margin-top:1.75rem;padding-top:.25rem}
footer{border-top:1px solid var(--line);padding-top:1rem;padding-bottom:2rem;font-size:.8rem;color:var(--muted)}
`;

/** A whole page of one site of the network: noindex, its own masthead and look, the network's footer. */
export function networkPage(o: { title: string; masthead: Masthead; body: string }): string {
  const m = o.masthead;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex,nofollow">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(o.title === m.name ? m.name : `${o.title} — ${m.name}`)}</title>
<style>${style(m.look)}</style>
</head>
<body>
<header><a class="brand" href="${esc(m.home)}">${esc(m.name)}</a><span class="strap">${esc(m.strap)}</span></header>
<main>
${o.body}
</main>
<footer><p>${esc(NETWORK_FOOTER)}</p></footer>
</body>
</html>`;
}
