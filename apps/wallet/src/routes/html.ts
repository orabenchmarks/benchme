/** HTML-escapes text for the wallet's pages. */
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The wallet's page frame (noindex, one card in the middle, the research notice under it). */
export const page = (title: string, body: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f7f9;color:#1b1f24}
main{max-width:30rem;margin:1rem;padding:1.75rem;background:#fff;border:1px solid #e3e6ea;border-radius:12px}h1{font-size:1.3rem;margin:0 0 .75rem}
dl{display:grid;grid-template-columns:auto 1fr;gap:.25rem 1rem;margin:1rem 0}dt{color:#5b6470}dd{margin:0}small{color:#5b6470}</style>
</head><body><main>${body}<p><small>A wallet simulator operated for research. It issues test cards only.</small></p></main></body></html>`;
