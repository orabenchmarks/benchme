import type { Door } from "@benchme/core";
import { DOOR_LABELS, matches, mintsWhat, queryTerms, type ScenarioCard } from "./cards.js";
import { esc, spoken, tiles } from "./html.js";
import { bar, shell, terminal } from "./layout.js";
import { EXAMPLE_ID, workspaceVisual, type VisualApp } from "./visual.js";

/** An app of the deployment as the page names it. */
export type AppView = { key: string; name: string; seeded: boolean; mcp: boolean };

/**
 * The first screen's example: a real scenario this deployment mints, the command that mints it, and an excerpt of the
 * answer, its addresses as this deployment gives them. The picture beside it shows the same workspace: its id, its
 * seed, its apps (the first few by name) and the doors its sites are served through.
 */
export type HeroExample = { scenario: string; seed: number | null; id: string; command: string; answer: string; apps: VisualApp[]; doors: Door[] };

export type LandingView = {
  cards: ScenarioCard[];
  /** Every listed app. */
  apps: AppView[];
  /** The deployment's open doors. */
  doors: Door[];
  /** Whether the registry has anything behind an open door to list. */
  registry: boolean;
  publicBaseUrl: string;
  /** Null when this deployment mints no scenario at all. */
  hero: HeroExample | null;
};

/** The JSON of an answer, coloured as a terminal would: keys, strings, numbers, and dimmed where it is elided ("…", "… 8 more"). Escaped first. */
export function colourJson(json: string): string {
  return esc(json).replace(/(&quot;(?:[^&]|&(?!quot;))*?&quot;)(\s*:)?|(-?\d+(?:\.\d+)?)|(…(?: \d+ more)?)/g, (_m, str: string | undefined, colon: string | undefined, num: string | undefined, more: string | undefined) => {
    if (str) return colon ? `<span class="k">${str}</span>${colon}` : `<span class="s">${str}</span>`;
    if (num) return `<span class="n">${num}</span>`;
    return `<span class="d">${more}</span>`;
  });
}

/** "their pages", "their pages and MCP", "their pages, REST, MCP and WebMCP": the ways in, said in a sentence. */
export const waysIn = (doors: readonly Door[]): string => spoken(["their pages", ...doors.filter((d) => d !== "page").map((d) => DOOR_LABELS[d])]);

function hero(v: LandingView): string {
  const h = v.hero;
  const example = h
    ? `${terminal(1, "Mint a workspace", `<code id="hero-mint">${esc(h.command)}</code>`, { id: "hero-mint", what: mintsWhat(h.scenario) })}
${terminal(2, "The answer: your workspace's addresses", colourJson(h.answer))}
<p class="next"><b>3. Point your agent at those addresses.</b> It uses the sites through ${esc(waysIn(h.doors))}, and nothing it does reaches another workspace.</p>`
    : `<p class="next">This deployment serves no scenario's sites yet.</p>`;
  const apps = h?.apps ?? v.apps.filter((a) => a.seeded).map((a) => ({ key: a.key, name: a.name }));
  const doorNames = (h?.doors ?? v.doors).map((d) => DOOR_LABELS[d]);
  return `<section class="hero" aria-labelledby="hero-h"><div class="wrap">
<div class="hero-head">
<p class="eyebrow">Benchmark environments for AI agents</p>
<h1 id="hero-h">Predictable, seeded web apps for benchmarking AI agents</h1>
<p class="lede">Every run gets its own workspace: a private copy of realistic web apps, built from a seed, so the same seed always starts from the same data and no run sees another's.</p>
</div>
<div class="hero-grid">
<div class="hero-example">
${example}
</div>
<figure class="visual-wrap">${workspaceVisual(apps, doorNames, h ? { id: h.id, seed: h.seed } : { id: EXAMPLE_ID, seed: null })}</figure>
</div>
</div></section>`;
}

function how(v: LandingView): string {
  const more = v.doors.some((d) => d !== "page");
  const mint = `POST a scenario and a seed to <code>/api/workspaces</code>: the same seed gives the same rows, every time. The answer lists every app's address under <code>/w/&lt;id&gt;/</code>.${
    more ? ` Add <code>"doors":["page"]</code> to serve one through its pages alone.` : ""
  }`;
  const mcp = v.doors.includes("mcp") ? ` (an app's MCP server is at <code>/w/&lt;id&gt;/&lt;app&gt;/mcp</code>)` : "";
  const work = `It uses the apps through ${esc(waysIn(v.doors))}${mcp}: searching, booking, signing up with the code mailed to the workspace's inbox. What it changes stays in its workspace.`;
  const checked = "Each task's outcome is checked: a change by what the apps hold afterwards, an answer against its key.";
  const check = v.apps.some((a) => a.key === "verify")
    ? `${checked} The workspace's verifier does it at <code>/w/&lt;id&gt;/verify/v1/submit/&lt;task&gt;</code>, for the tasks it holds keys for, and signs each verdict.`
    : checked;
  return `<section class="block" id="how" aria-labelledby="how-h"><div class="wrap">
<h2 id="how-h">How it works</h2>
<p class="section-lede">A scenario is a set of web apps and the rows they hold. A seed picks the rows. A workspace is one run's private copy of them.</p>
<ol class="steps3">
<li><span class="num">01</span><h3>Mint a workspace</h3><p>${mint}</p></li>
<li><span class="num">02</span><h3>Let the agent work</h3><p>${work}</p></li>
<li><span class="num">03</span><h3>Check what happened</h3><p>${check}</p></li>
</ol></div></section>`;
}

function card(c: ScenarioCard, shown: boolean): string {
  const lacking = esc(spoken(c.missing.map((s) => s.name)));
  const sites = c.sites.length ? tiles(c.sites, undefined, false) : `<p class="missing">None of its sites is on this deployment: ${lacking}.</p>`;
  const missing = c.missing.length && c.sites.length ? `<p class="missing">Not on this deployment: ${lacking}.</p>` : "";
  const doors = `<ul class="doors" aria-label="Ways in">${c.doors.map((d) => `<li data-door="${d}">${DOOR_LABELS[d]}</li>`).join("")}</ul>`;
  const tasks =
    c.tasks === null
      ? `<a class="tasks-link" href="${esc(c.page)}">About this scenario <span aria-hidden="true">→</span></a>`
      : `<a class="tasks-link" href="${esc(c.page)}"><b>${c.tasks}</b> tasks <span aria-hidden="true">→</span></a>`;
  const id = `mint-${c.key}`;
  const mint = c.mint
    ? `<code class="mint-code" id="${id}" hidden>${esc(c.mint)}</code><button type="button" class="copy light" data-copy="${id}" data-label="Copy curl" data-what="${esc(mintsWhat(c.key))}" aria-label="Copy ${esc(mintsWhat(c.key))}">Copy curl</button>`
    : `<p class="unavailable">This deployment cannot mint it: it does not serve the sites it needs.</p>`;
  return `<article class="card" id="scenario-${esc(c.key)}" data-scenario="${esc(c.key)}" data-search="${esc(c.search)}" aria-labelledby="title-${esc(c.key)}"${shown ? "" : " hidden"}>
<div class="card-head"><h3 id="title-${esc(c.key)}"><a href="${esc(c.page)}">${esc(c.title)}</a></h3><code class="key">${esc(c.key)}</code></div>
<p class="about">${esc(c.lead)}</p>
${sites}${missing}
${doors}
<div class="card-foot">${tasks}${mint}</div>
</article>`;
}

/**
 * The deployment's front page, for people choosing a scenario: what benchme is and a copyable example on the first
 * screen, beside a picture of an agent reaching its own workspace; how it works; and the scenarios, searchable, each
 * with how many tasks it has and a page of its own that lists them. It names no door this deployment keeps closed.
 *
 * `query` is the search the page opens with (`/?q=`): the cards it does not match are rendered hidden, so a filtered
 * page can be linked, and the search works where the script does not run.
 */
export function landingPage(v: LandingView, query = ""): string {
  const total = v.cards.length;
  const terms = queryTerms(query);
  const shown = v.cards.map((c) => matches(c, terms));
  const left = shown.filter(Boolean).length;
  return shell(
    "benchme: predictable, seeded web apps for benchmarking AI agents",
    `<a class="skip" href="#q">Skip to the scenarios</a>
${bar(v.registry, true)}
<main>
${hero(v)}
${how(v)}
<section class="block" aria-labelledby="scenarios-h"><div class="wrap">
<h2 id="scenarios-h">Scenarios</h2>
<p class="section-lede">Each scenario is its own set of apps and data, most with a corpus of tasks and their checks. Open one to read its tasks.</p>
<form class="search" role="search" action="/" method="get">
<div class="field grow"><label for="q">Search the scenarios</label>
<input id="q" name="q" type="search" value="${esc(query)}" autocomplete="off" spellcheck="false" placeholder="a site, a word, a scenario…" aria-describedby="count" aria-controls="scenarios" aria-keyshortcuts="/"></div>
</form>
<p class="hint">Matches each scenario's key, title, description, sites and ways in. Press <kbd>/</kbd> to search, <kbd>Esc</kbd> to clear.</p>
<p id="count" class="count" aria-live="polite" data-noun="scenarios" data-one="scenario">${terms.length ? `${left} of ${total}` : total} ${total === 1 ? "scenario" : "scenarios"}</p>
<p id="empty" class="empty"${terms.length && left === 0 ? "" : " hidden"}>No scenario matches “<span id="empty-q">${esc(query.trim())}</span>”. Try a site’s name or a word from a description.</p>
<div id="scenarios" class="cards">
${v.cards.map((c, i) => card(c, shown[i] ?? true)).join("\n")}
</div></div></section>
</main>`,
  );
}
