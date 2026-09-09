/** Escape for HTML text and attribute values. */
export function esc(s: unknown): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

export function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export type NavLink = { href: string; label: string };
export type ShellCtx = {
  /** The site's name in the header. */
  site: string;
  /** Header colour, so each site looks like its own product. */
  accent: string;
  prefix: string;
  nav: NavLink[];
  user: { email: string; displayName: string } | null;
  flash?: string | undefined;
};

const STYLE = (accent: string) => `body{font:15px/1.5 system-ui,sans-serif;margin:0;color:#1b1b1b;background:#fafafa}
header{background:${accent};color:#fff;padding:.6rem 1rem;display:flex;gap:1rem;align-items:center;flex-wrap:wrap}
header a{color:#fff;text-decoration:none}header .sp{flex:1}
main{max-width:64rem;margin:1.5rem auto;padding:0 1rem}
table{border-collapse:collapse;width:100%;background:#fff}td,th{border:1px solid #ddd;padding:.35em .6em;text-align:left;vertical-align:top}th{background:#eef2f7}
form.card{background:#fff;border:1px solid #ddd;padding:1rem;max-width:28rem}label{display:block;margin:.5rem 0 .2rem}input,select,textarea{width:100%;padding:.4em;box-sizing:border-box}
button{margin-top:.8rem;padding:.5em 1em;background:${accent};color:#fff;border:0;border-radius:4px;cursor:pointer}
.flash{background:#fff4d6;border:1px solid #e6c97a;padding:.5rem .8rem;margin-bottom:1rem}.muted{color:#666}code{background:#eee;padding:.1em .3em;border-radius:3px}
nav.pager a{margin-right:1rem}.tag{display:inline-block;padding:0 .4em;border-radius:3px;background:#e8edf3;font-size:.9em}`;

/** The page shell every site shares: header with nav + auth links, flash, main. */
export function shell(ctx: ShellCtx, title: string, body: string): string {
  const p = ctx.prefix;
  const nav = ctx.nav.map((n) => `<a href="${p}${n.href}">${esc(n.label)}</a>`).join("");
  const who = ctx.user
    ? `<span>${esc(ctx.user.displayName)}</span><a href="${p}/account">Account</a><form method="post" action="${p}/logout" style="margin:0"><button style="margin:0;padding:.3em .7em">Sign out</button></form>`
    : `<a href="${p}/login">Sign in</a><a href="${p}/signup">Sign up</a>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} — ${esc(ctx.site)}</title><style>${STYLE(ctx.accent)}</style></head>
<body><header><a href="${p}/"><strong>${esc(ctx.site)}</strong></a>${nav}<span class="sp"></span>${who}</header>
<main>${ctx.flash ? `<div class="flash">${esc(ctx.flash)}</div>` : ""}${body}</main></body></html>`;
}

/** The auth pages every site shares (signup / verify / login / account). */
export const authPages = {
  signup: (p: string, error?: string) => `<h1>Create an account</h1>${error ? `<div class="flash">${esc(error)}</div>` : ""}<form class="card" method="post" action="${p}/signup">
<label>Name</label><input name="name" required><label>Email</label><input name="email" type="email" required><label>Password (8+ characters)</label><input name="password" type="password" required>
<button>Sign up</button></form><p class="muted">A verification code is sent to the workspace inbox; enter it on the next screen.</p>`,
  verify: (p: string, email: string, error?: string) => `<h1>Verify your email</h1>${error ? `<div class="flash">${esc(error)}</div>` : ""}<p>We sent a 6-digit code to <strong>${esc(email)}</strong>. Check the workspace inbox.</p>
<form class="card" method="post" action="${p}/verify"><input type="hidden" name="email" value="${esc(email)}"><label>Code</label><input name="code" required pattern="[0-9]{6}"><button>Verify</button></form>`,
  login: (p: string, error?: string) => `<h1>Sign in</h1>${error ? `<div class="flash">${esc(error)}</div>` : ""}<form class="card" method="post" action="${p}/login">
<label>Email</label><input name="email" type="email" required><label>Password</label><input name="password" type="password" required><button>Sign in</button></form>
<p class="muted">No account? <a href="${p}/signup">Sign up</a>.</p>`,
  account: (p: string, user: { email: string; displayName: string; apiToken: string | null }) => `<h1>Account</h1><p>${esc(user.displayName)} · ${esc(user.email)}</p>
<h2>API token</h2><p>Use it as <code>Authorization: Bearer &lt;token&gt;</code> against <code>${esc(p)}/api/v1/…</code>.</p>
<p>${user.apiToken ? `<code>${esc(user.apiToken)}</code>` : "<em>none yet</em>"}</p>
<form method="post" action="${p}/account/token"><button>${user.apiToken ? "Rotate token" : "Create token"}</button></form>`,
};
