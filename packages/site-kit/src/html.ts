import type { Door, DoorSet } from "@benchme/core";
import { CODE_ATTEMPTS } from "./accounts-schema.js";

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
  /** Extra tags inside <head> (e.g. a rel="nlweb" link, JSON-LD). Rendered verbatim. */
  head?: string;
  /** Scripts rendered verbatim before </body> (the WebMCP bridge lives here). */
  scripts?: string[];
  /** Pages are noindex by default; a surface meant for crawlers opts in. */
  robots?: "noindex" | "index";
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
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="${ctx.robots === "index" ? "index,follow" : "noindex,nofollow"}">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} — ${esc(ctx.site)}</title><style>${STYLE(ctx.accent)}</style>${ctx.head ?? ""}</head>
<body><header><a href="${p}/"><strong>${esc(ctx.site)}</strong></a>${nav}<span class="sp"></span>${who}</header>
<main>${ctx.flash ? `<div class="flash">${esc(ctx.flash)}</div>` : ""}${body}</main>${(ctx.scripts ?? []).join("")}</body></html>`;
}

/**
 * What an api token opens, door by door, in the account page's words. A
 * workspace that is not served through a door is never told the token works
 * there, and one served through neither gets no token at all.
 */
const TOKEN_USES: readonly { door: Door; use: (prefix: string) => string }[] = [
  { door: "rest", use: (p) => `against <code>${esc(p)}/api/v1/…</code>` },
  { door: "mcp", use: (p) => `to connect an MCP client to <code>${esc(p)}/mcp</code>` },
];

/** Whether an api token opens any of the open `doors`: the account page offers one only then. */
export const apiTokenOpens = (doors: DoorSet): boolean => TOKEN_USES.some((u) => doors.has(u.door));

/** The account page's api token section, naming only the open doors; none when the token would open none. */
function apiTokenSection(p: string, apiToken: string | null, doors: DoorSet): string {
  const uses = TOKEN_USES.filter((u) => doors.has(u.door)).map((u) => u.use(p));
  if (uses.length === 0) return "";
  return `<h2>API token</h2><p>Use it as <code>Authorization: Bearer &lt;token&gt;</code> ${uses.join(", or ")}.</p>
<p>${apiToken ? `<code>${esc(apiToken)}</code>` : "<em>none yet</em>"}</p>
<form method="post" action="${p}/account/token"><button>${apiToken ? "Rotate token" : "Create token"}</button></form>`;
}

/** The auth pages every site shares (signup / verify / login / account). */
export const authPages = {
  signup: (p: string, error?: string) => `<h1>Create an account</h1>${error ? `<div class="flash">${esc(error)}</div>` : ""}<form class="card" method="post" action="${p}/signup">
<label>Name</label><input name="name" required><label>Email</label><input name="email" type="email" required><label>Password (8+ characters)</label><input name="password" type="password" required>
<button>Sign up</button></form><p class="muted">A verification code is mailed to the address. The workspace inbox shows mail to an address new to the workspace; enter the code on the next screen.</p>`,
  verify: (p: string, email: string, error?: string) => `<h1>Verify your email</h1>${error ? `<div class="flash">${esc(error)}</div>` : ""}<p>We sent a 6-digit code to <strong>${esc(email)}</strong>. The workspace inbox shows it if that address is new to the workspace.</p>
<form class="card" method="post" action="${p}/verify"><input type="hidden" name="email" value="${esc(email)}"><label>Code</label><input name="code" required pattern="[0-9]{6}"><button>Verify</button></form>
<p class="muted">A code can be tried ${CODE_ATTEMPTS} times. Lost it, or it stopped working? <a href="${p}/signup">Sign up again</a> with the same email to be sent a new one.</p>`,
  login: (p: string, error?: string) => `<h1>Sign in</h1>${error ? `<div class="flash">${esc(error)}</div>` : ""}<form class="card" method="post" action="${p}/login">
<label>Email</label><input name="email" type="email" required><label>Password</label><input name="password" type="password" required><button>Sign in</button></form>
<p class="muted">No account? <a href="${p}/signup">Sign up</a>.</p>`,
  /** `doors`: the request's, so the api token is offered, and named, only for the doors it opens there. */
  account: (p: string, user: { email: string; displayName: string; apiToken: string | null }, doors: DoorSet) =>
    `<h1>Account</h1><p>${esc(user.displayName)} · ${esc(user.email)}</p>
${apiTokenSection(p, user.apiToken, doors)}`,
};
