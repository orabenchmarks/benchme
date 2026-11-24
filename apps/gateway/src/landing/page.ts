import type { Door } from "@benchme/core";
import { DOOR_LABELS, SOURCE_URL, matches, mintCommand, queryTerms, type ScenarioCard } from "./cards.js";
import { LANDING_SCRIPT } from "./script.js";
import { LANDING_CSS } from "./style.js";

/** An app of the deployment as the page's list of every app shows it. */
export type AppView = { key: string; name: string; seeded: boolean; mcp: boolean };

export type LandingView = {
  cards: ScenarioCard[];
  /** Every listed app. */
  apps: AppView[];
  /** The deployment's open doors. */
  doors: Door[];
  /** Whether the registry has anything behind an open door to list. */
  registry: boolean;
  publicBaseUrl: string;
};

/** Escape for HTML text and attribute values. */
const esc = (s: unknown): string => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

/** "a", "a and b", "a, b and c". */
const spoken = (items: readonly string[]): string => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);

const chips = (items: string[], cls = "chips") => `<ul class="${cls}">${items.join("")}</ul>`;

function card(c: ScenarioCard, shown: boolean): string {
  const sites = c.sites.length
    ? chips(c.sites.map((s) => `<li>${esc(s.name)} <code>${esc(s.key)}</code></li>`))
    : `<span class="muted">none on this deployment</span>`;
  const missing = c.missing.length ? `<p class="missing">Not on this deployment: ${esc(spoken(c.missing.map((s) => s.name)))}.</p>` : "";
  const doors = chips(
    c.doors.map((d) => `<li data-door="${d}">${DOOR_LABELS[d]}</li>`),
    "chips doors",
  );
  const tasks = c.tasks === null ? "" : `<dt>Tasks</dt><dd>${c.tasks} in its corpus</dd>`;
  const links = `<ul class="links">${c.links.map((l) => `<li><a href="${esc(l.href)}">${esc(l.label)}</a></li>`).join("")}</ul>`;
  const id = `mint-${c.key}`;
  const mint = c.mint
    ? `<div class="mint"><div class="mint-head"><span>Mint a workspace</span><button type="button" class="copy" data-copy="${id}" data-what="the command that mints a ${esc(c.key)} workspace" aria-label="Copy the command that mints a ${esc(c.key)} workspace">Copy</button></div><pre><code id="${id}">${esc(c.mint)}</code></pre></div>`
    : `<p class="unavailable">This deployment cannot mint it: it does not serve the sites it needs.</p>`;
  return `<article class="card" id="scenario-${esc(c.key)}" data-scenario="${esc(c.key)}" data-search="${esc(c.search)}" aria-labelledby="title-${esc(c.key)}"${shown ? "" : " hidden"}>
<div class="card-head"><h3 id="title-${esc(c.key)}">${esc(c.title)}</h3><code class="key">${esc(c.key)}</code></div>
<p class="about">${esc(c.about)}</p>
<dl class="facts"><dt>Sites</dt><dd>${sites}${missing}</dd><dt>Doors</dt><dd>${doors}</dd>${tasks}</dl>
${links}
${mint}
</article>`;
}

function appItem(a: AppView, mcpOpen: boolean): string {
  return `<li>${esc(a.name)} <code>${esc(a.key)}</code>${a.seeded ? " · per-workspace data" : ""}${mcpOpen && a.mcp ? " · MCP at <code>/mcp</code>" : ""}</li>`;
}

/**
 * The deployment's front page, for people choosing a scenario: what benchme is, a search box over the scenarios, a
 * card for each, how to mint a workspace, and every app the deployment lists. Self-contained (inline style and
 * script, nothing from another host), light and dark, one column at phone width, usable from the keyboard, and kept
 * out of search indexes. It names no door this deployment keeps closed.
 *
 * `query` is the search the page opens with (`/?q=`): the cards it does not match are rendered hidden, so a filtered
 * page can be linked, and the search works where the script does not run.
 */
export function landingPage(v: LandingView, query = ""): string {
  const total = v.cards.length;
  const terms = queryTerms(query);
  const shown = v.cards.map((c) => matches(c, terms));
  const left = shown.filter(Boolean).length;
  // In a sentence: "its pages, REST and MCP", or "its pages alone".
  const others = v.doors.filter((d) => d !== "page").map((d) => DOOR_LABELS[d]);
  const doors = others.length ? spoken(["its pages", ...others]) : "its pages alone";
  const example = mintCommand(v.publicBaseUrl, { scenario: v.cards[0]?.key ?? "acme-v1", seed: 4242, doors: ["page"] });
  const nav = [
    `<li><a href="#scenarios-h">Scenarios</a></li>`,
    `<li><a href="#mint-h">Mint a workspace</a></li>`,
    ...(v.registry ? [`<li><a href="/registry">Registry</a></li>`] : []),
    `<li><a href="${SOURCE_URL}">Source</a></li>`,
  ].join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>benchme</title>
<style>${LANDING_CSS}</style></head>
<body>
<a class="skip" href="#q">Skip to the search</a>
<header class="top"><div class="wrap">
<p class="brand">benchme</p>
<h1>Fictional sites to test agents on, a fresh copy for every run</h1>
<p class="lede">benchme serves fictional websites, the apps behind them and a verifier for agent benchmarks. Every run gets its own workspace: an isolated, deterministically seeded copy of the sites, so runs never see each other and two runs at one seed start from the same state.</p>
<nav aria-label="On this page"><ul class="nav">${nav}</ul></nav>
</div></header>
<main class="wrap">
<section aria-labelledby="scenarios-h">
<h2 id="scenarios-h">Choose a scenario</h2>
<form class="search" role="search" action="/" method="get">
<label for="q">Search the scenarios</label>
<input id="q" name="q" type="search" value="${esc(query)}" autocomplete="off" spellcheck="false" placeholder="a site, a door, a word…" aria-describedby="count" aria-controls="scenarios" aria-keyshortcuts="/">
<p class="hint">Matches each scenario's key, title, description, sites and doors. Press <kbd>/</kbd> to search, <kbd>Esc</kbd> to clear.</p>
</form>
<p id="count" class="count" aria-live="polite">${terms.length ? `${left} of ${total}` : total} ${total === 1 ? "scenario" : "scenarios"}</p>
<p id="empty" class="empty"${terms.length && left === 0 ? "" : " hidden"}>No scenario matches “<span id="empty-q">${esc(query.trim())}</span>”. Try a site’s name, a door, or a word from a description.</p>
<div id="scenarios" class="cards">
${v.cards.map((c, i) => card(c, shown[i] ?? true)).join("\n")}
</div>
</section>
<section aria-labelledby="mint-h">
<h2 id="mint-h">Mint a workspace</h2>
<p>POST a scenario, and a seed for the same rows every time, to <code>/api/workspaces</code>. The answer lists the address of every app the workspace serves, under <code>/w/&lt;id&gt;/&lt;app&gt;/</code>, and the workspace expires after its time to live. This deployment serves a workspace through ${esc(doors)}, unless it is created with doors of its own: <code>"doors":["page"]</code> serves it through its pages alone.</p>
<pre class="example"><code>${esc(example)}</code></pre>
</section>
<section aria-labelledby="apps-h">
<h2 id="apps-h">Every app</h2>
<ul class="apps">${v.apps.map((a) => appItem(a, v.doors.includes("mcp"))).join("")}</ul>
</section>
</main>
<footer class="wrap"><p>benchme is open source (MIT). Every name, place and product on its sites is invented.</p></footer>
<p id="said" class="sr" aria-live="polite"></p>
<script>${LANDING_SCRIPT}</script>
</body></html>`;
}
