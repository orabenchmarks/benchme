export function esc(s: unknown): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

export function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export type LayoutCtx = { prefix: string; user: { email: string; displayName: string } | null; flash?: string | undefined };

const STYLE = `body{font:15px/1.5 system-ui,sans-serif;margin:0;color:#1b1b1b;background:#fafafa}
header{background:#1f3a5f;color:#fff;padding:.6rem 1rem;display:flex;gap:1rem;align-items:center}
header a{color:#fff;text-decoration:none}header .sp{flex:1}
main{max-width:64rem;margin:1.5rem auto;padding:0 1rem}
table{border-collapse:collapse;width:100%;background:#fff}td,th{border:1px solid #ddd;padding:.35em .6em;text-align:left}th{background:#eef2f7}
form.card{background:#fff;border:1px solid #ddd;padding:1rem;max-width:26rem}label{display:block;margin:.5rem 0 .2rem}input,select{width:100%;padding:.4em;box-sizing:border-box}
button{margin-top:.8rem;padding:.5em 1em;background:#1f3a5f;color:#fff;border:0;border-radius:4px;cursor:pointer}
.flash{background:#fff4d6;border:1px solid #e6c97a;padding:.5rem .8rem;margin-bottom:1rem}.muted{color:#666}code{background:#eee;padding:.1em .3em;border-radius:3px}
nav.pager a{margin-right:1rem}`;

export function layout(ctx: LayoutCtx, title: string, body: string): string {
  const p = ctx.prefix;
  const who = ctx.user
    ? `<span>${esc(ctx.user.displayName)}</span><a href="${p}/account">Account</a><form method="post" action="${p}/logout" style="margin:0"><button style="margin:0;padding:.3em .7em">Sign out</button></form>`
    : `<a href="${p}/login">Sign in</a><a href="${p}/signup">Sign up</a>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} — Warehouse</title><style>${STYLE}</style></head>
<body><header><a href="${p}/"><strong>Warehouse</strong></a><a href="${p}/products">Products</a><a href="${p}/orders">Orders</a><a href="${p}/transfers">Transfers</a><a href="${p}/customers">Customers</a><span class="sp"></span>${who}</header>
<main>${ctx.flash ? `<div class="flash">${esc(ctx.flash)}</div>` : ""}${body}</main></body></html>`;
}
