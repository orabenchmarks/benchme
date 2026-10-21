/** The page shell every guide page shares: noindex, one stylesheet inline, the site's name and its footer. */

export const SITE_NAME = "Shortlist";

/** Shown on every page, in every edition alike (constant across arms by construction). */
export const FOOTER = "Shortlist is a research site. The products, companies and people on it are fictional.";

const ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** HTML-escapes text for an element body or an attribute value. */
export const esc = (s: unknown): string => String(s).replace(/[&<>"']/g, (c) => ENTITIES[c] as string);

const STYLE = `
:root{--ink:#1d1f23;--muted:#5d636d;--line:#e3e5e8;--accent:#1f5f8b;--bg:#fbfbf9}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 Georgia,"Times New Roman",serif}
header,main,footer{max-width:46rem;margin:0 auto;padding:0 1.25rem}
header{display:flex;align-items:baseline;gap:.75rem;padding-top:1.5rem;padding-bottom:1rem;border-bottom:1px solid var(--line)}
.brand{font:700 1.25rem/1 system-ui,sans-serif;color:var(--ink);text-decoration:none;letter-spacing:.02em}
.strap{font:.85rem system-ui,sans-serif;color:var(--muted)}
main{padding-top:1.5rem;padding-bottom:2rem}
h1{font-size:1.9rem;line-height:1.25;margin:.25rem 0 .75rem}
h2{font:600 1.15rem/1.3 system-ui,sans-serif;margin:1.75rem 0 .5rem}
a{color:var(--accent)}
.intro,.dek{color:var(--muted)}
.cards{display:grid;gap:1rem;grid-template-columns:repeat(auto-fit,minmax(18rem,1fr))}
.card{border:1px solid var(--line);border-radius:6px;padding:1rem;background:#fff}
.card h2{margin:0 0 .25rem}
.tagline{margin:.25rem 0}
.price{font:600 .95rem system-ui,sans-serif;margin:.25rem 0 .5rem}
table{border-collapse:collapse;width:100%;background:#fff;font:.95rem/1.45 system-ui,sans-serif}
th,td{border:1px solid var(--line);padding:.5rem .65rem;text-align:left;vertical-align:top}
th{width:30%;background:#f4f5f6;font-weight:600}
.byline{font:.85rem system-ui,sans-serif;color:var(--muted);margin:0 0 .5rem}
.next{border-top:1px solid var(--line);padding-top:1rem;margin-top:1.5rem}
.back{font:.9rem system-ui,sans-serif;margin:0 0 .5rem}
footer{border-top:1px solid var(--line);padding-top:1rem;padding-bottom:2rem;font:.8rem system-ui,sans-serif;color:var(--muted)}
`;

/** A whole page. `prefix` is the guide's public path ("/w/<id>/guide"): every link is built on it. */
export function page(o: { title: string; prefix: string; body: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex,nofollow">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(o.title)} — ${SITE_NAME}</title>
<style>${STYLE}</style>
</head>
<body>
<header><a class="brand" href="${esc(o.prefix)}/">${SITE_NAME}</a><span class="strap">Independent buyer's guides</span></header>
<main>
${o.body}
</main>
<footer><p>${esc(FOOTER)}</p></footer>
</body>
</html>`;
}
