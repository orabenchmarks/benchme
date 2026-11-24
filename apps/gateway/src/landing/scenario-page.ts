import type { Door } from "@benchme/core";
import { DOOR_LABELS, mintsWhat, normalize, queryTerms, type LinkView } from "./cards.js";
import { esc, spoken, tiles, type Tile } from "./html.js";
import { bar, shell, terminal } from "./layout.js";
import type { PublicTask } from "./task-lists.js";

/** One scenario's page as a deployment shows it: what it is, how to mint it here, and its public tasks. */
export type ScenarioPageView = {
  key: string;
  title: string;
  about: string;
  /** Its write-up and its public task list, in the repository. */
  links: LinkView[];
  /** Its sites this deployment serves. */
  sites: Tile[];
  /** Its sites this deployment does not. */
  missing: Tile[];
  /** The doors its sites are served through here (pages, and each open door one of its sites has). */
  doors: Door[];
  /** The command that mints it here, or null where this deployment cannot. */
  mint: string | null;
  /** Its public tasks, or null when it has no list or this deployment does not carry it. */
  tasks: readonly PublicTask[] | null;
  /** How many tasks its corpus holds by its own metadata, where it has a corpus: said when the list is not here. */
  corpusTasks: number | null;
  registry: boolean;
};

/** What a person picked to narrow the list (`?q=&site=&area=&level=&steps=`). */
export type TaskFilters = { q?: string; site?: string; area?: string; level?: string; steps?: string };
export const FILTER_NAMES = ["q", "site", "area", "level", "steps"] as const satisfies readonly (keyof TaskFilters)[];

/** The four levels, and "very hard", the flagged part of hard: a very hard task is hard too, and a filter for hard finds it. */
const LEVELS: Record<string, string> = { easy: "Easy", medium: "Medium", hard: "Hard", "very-hard": "Very hard", impossible: "Impossible" };
const LEVEL_ORDER = Object.keys(LEVELS);
const levelsOf = (t: PublicTask): string[] => (t.level ? [t.level, ...(t.veryHard ? ["very-hard"] : [])] : []);

/** A focus area's key as a person reads it: "act-as-yourself" → "Act as yourself". */
export const areaLabel = (key: string): string => key.charAt(0).toUpperCase() + key.slice(1).replace(/-/g, " ");
const CHECKS = { state: "Checked by what the sites hold afterwards.", json: "Checked by the answer in the reply." } as const;
const stepsOf = (t: PublicTask) => (t.steps.length > 1 ? "multi" : "single");

/** Everything a task is found by, as the search box reads it: its id, prompts, sites, focus area and level. */
function searchOf(t: PublicTask, names: ReadonlyMap<string, string>): string {
  const words = [t.id, ...t.steps.map((s) => s.prompt), ...t.sites.flatMap((k) => [k, names.get(k) ?? k]), t.area ? areaLabel(t.area) : "", ...levelsOf(t).map((l) => LEVELS[l] ?? l)];
  return normalize(words.join(" "));
}

/** Whether a task stays under the filters: every word of the query, and each picked filter. The page's script asks the same. */
export function taskMatches(t: PublicTask, f: TaskFilters, names: ReadonlyMap<string, string>): boolean {
  const hay = searchOf(t, names);
  if (!queryTerms(f.q ?? "").every((term) => hay.includes(term))) return false;
  if (f.site && !t.sites.includes(f.site)) return false;
  if (f.area && t.area !== f.area) return false;
  if (f.level && !levelsOf(t).includes(f.level)) return false;
  if (f.steps && stepsOf(t) !== f.steps) return false;
  return true;
}

function select(name: Exclude<keyof TaskFilters, "q">, label: string, options: [string, string][], picked: string | undefined): string {
  const opts = options.map(([value, text]) => `<option value="${esc(value)}"${picked === value ? " selected" : ""}>${esc(text)}</option>`).join("");
  return `<div class="field"><label for="f-${name}">${esc(label)}</label><select id="f-${name}" name="${name}" data-filter="${name}"><option value="">Any</option>${opts}</select></div>`;
}

function task(t: PublicTask, names: ReadonlyMap<string, string>, order: readonly string[], shown: boolean): string {
  const level = t.veryHard ? "very-hard" : t.level;
  const head = [
    `<code class="task-id">${esc(t.id)}</code>`,
    level ? `<span class="chip lvl lvl-${esc(level)}"${t.veryHard ? ' title="Very hard: a flagged part of hard"' : ""}>${esc(LEVELS[level] ?? level)}</span>` : "",
    t.area ? `<span class="chip">${esc(areaLabel(t.area))}</span>` : "",
    t.steps.length > 1 ? `<span class="chip">${t.steps.length} prompts</span>` : "",
  ].join("");
  const many = t.steps.length > 1;
  const said = t.steps.map((s, i) => `<li${many ? "" : ' class="one"'}>${many ? `<span class="n" aria-hidden="true">${i + 1}</span>` : ""}<div><p class="said">${esc(s.prompt)}</p>${s.check ? `<p class="how">${CHECKS[s.check]}</p>` : ""}</div></li>`);
  const criteria = t.steps.flatMap((s, i) => s.rubric.map((c) => `<li>${many ? `<b>Prompt ${i + 1}.</b> ` : ""}${esc(c)}</li>`));
  const rubric = criteria.length ? `<details class="rubric"><summary>The judge's criteria (${criteria.length})</summary><ul>${criteria.join("")}</ul></details>` : "";
  const attrs = `data-search="${esc(searchOf(t, names))}" data-site="${esc(t.sites.join(" "))}" data-area="${esc(t.area ?? "")}" data-level="${esc(levelsOf(t).join(" "))}" data-steps="${stepsOf(t)}"`;
  const foot = rubric ? `<div class="task-foot">${rubric}</div>` : "";
  return `<article class="task" id="task-${esc(t.id)}" ${attrs}${shown ? "" : " hidden"}>
<div class="task-meta"><div class="task-head">${head}</div>${tiles(t.sites.map((k) => ({ key: k, name: names.get(k) ?? k })), order)}</div>
<ol class="convo" aria-label="${many ? "What the person says, prompt by prompt" : "What the person says"}">${said.join("")}</ol>
${foot}
</article>`;
}

function taskList(v: ScenarioPageView, tasks: readonly PublicTask[], f: TaskFilters): string {
  const order = [...v.sites, ...v.missing].map((s) => s.key);
  const names = new Map([...v.sites, ...v.missing].map((s) => [s.key, s.name]));
  const shown = tasks.map((t) => taskMatches(t, f, names));
  const left = shown.filter(Boolean).length;
  const narrowed = queryTerms(f.q ?? "").length > 0 || Boolean(f.site || f.area || f.level || f.steps);
  const used = new Set(tasks.flatMap((t) => t.sites));
  const sites = [...order.filter((k) => used.has(k)), ...[...used].filter((k) => !order.includes(k))];
  const areas = [...new Set(tasks.map((t) => t.area).filter((a): a is string => Boolean(a)))];
  const levels = LEVEL_ORDER.filter((l) => tasks.some((t) => levelsOf(t).includes(l)));
  const multi = tasks.some((t) => t.steps.length > 1);
  const noun = (n: number) => (n === 1 ? "task" : "tasks");
  return `<form class="search" role="search" action="/scenarios/${encodeURIComponent(v.key)}" method="get">
<div class="field grow"><label for="q">Search the tasks</label><input id="q" name="q" type="search" value="${esc(f.q ?? "")}" autocomplete="off" spellcheck="false" placeholder="a site, a word, a task id…" aria-describedby="count" aria-controls="tasks" aria-keyshortcuts="/"></div>
${sites.length > 1 ? select("site", "Site", sites.map((k) => [k, names.get(k) ?? k]), f.site) : ""}
${areas.length ? select("area", "Focus area", areas.map((a) => [a, areaLabel(a)]), f.area) : ""}
${levels.length ? select("level", "Level", levels.map((l) => [l, l === "very-hard" ? "Very hard (part of hard)" : (LEVELS[l] as string)]), f.level) : ""}
${multi ? select("steps", "Prompts", [["single", "One prompt"], ["multi", "A conversation"]], f.steps) : ""}
<noscript><button type="submit" class="copy light">Filter</button></noscript>
</form>
<p class="hint">Press <kbd>/</kbd> to search, <kbd>Esc</kbd> to clear. A filtered list keeps its address, to link.</p>
<p id="count" class="count" aria-live="polite" data-noun="tasks" data-one="task">${narrowed ? `${left} of ${tasks.length}` : tasks.length} ${noun(tasks.length)}</p>
<p id="empty" class="empty"${narrowed && left === 0 ? "" : " hidden"}>No task matches the search and filters.</p>
<div id="tasks" class="tasks">
${tasks.map((t, i) => task(t, names, order, shown[i] ?? true)).join("\n")}
</div>`;
}

function stats(v: ScenarioPageView, tasks: readonly PublicTask[]): string {
  const conversations = tasks.filter((t) => t.steps.length > 1).length;
  const areas = new Set(tasks.map((t) => t.area).filter(Boolean)).size;
  const sites = new Set(tasks.flatMap((t) => t.sites)).size;
  const items = [
    [tasks.length, tasks.length === 1 ? "task" : "tasks"],
    ...(conversations ? [[conversations, conversations === 1 ? "conversation" : "conversations"]] : []),
    ...(areas ? [[areas, areas === 1 ? "focus area" : "focus areas"]] : []),
    [sites, sites === 1 ? "site" : "sites"],
  ] as [number, string][];
  return `<ul class="stats" aria-label="${esc(v.title)} in numbers">${items.map(([n, what]) => `<li><b>${n}</b>${what}</li>`).join("")}</ul>`;
}

/**
 * A scenario's own page: what it is, the command that mints it on this deployment, and its public tasks, each with
 * what the person says (prompt by prompt for a conversation), what checks each prompt's outcome, and the judge's
 * criteria where the list has them. Never an answer: the page is built from the public list alone. Searchable and
 * filterable (by site, and by focus area, level and prompts where the list has them), server-side from the address
 * so it works without the script, live with it. Like the front page, it names no door this deployment keeps closed.
 */
export function scenarioPage(v: ScenarioPageView, f: TaskFilters = {}): string {
  const tasks = v.tasks ?? [];
  const where = v.links[1];
  const body = v.tasks
    ? taskList(v, v.tasks, f)
    : `<p class="empty">${
        v.corpusTasks === null
          ? "This scenario has no task list of its own. Its write-up says how a run uses it."
          : `This deployment does not carry the list of its ${v.corpusTasks} tasks${where ? `: it is in the repository, <a href="${esc(where.href)}">here</a>` : ""}.`
      }</p>`;
  const mint = v.mint
    ? `${terminal(null, "Mint a workspace of it", `<code id="page-mint">${esc(v.mint)}</code>`, { id: "page-mint", what: mintsWhat(v.key) })}
<p class="next">The answer gives every site's address under <code>/w/&lt;id&gt;/</code>. Point your agent there${v.tasks?.length ? ", and give it a task below" : ""}.</p>`
    : `<p class="unavailable">This deployment cannot mint it: it does not serve the sites it needs.</p>`;
  const missing = v.missing.length ? `<p class="missing">Not on this deployment: ${esc(spoken(v.missing.map((s) => s.name)))}.</p>` : "";
  const doors = `<ul class="doors" aria-label="Ways in">${v.doors.map((d) => `<li data-door="${d}">${DOOR_LABELS[d]}</li>`).join("")}</ul>`;
  const links = v.links.map((l) => `<a href="${esc(l.href)}">${esc(l.label)}</a>`).join(" · ");
  return shell(
    `${v.title} (${v.key}) · benchme`,
    `<a class="skip" href="${v.tasks ? "#q" : "#tasks-h"}">Skip to the tasks</a>
${bar(v.registry, false)}
<main>
<section class="page-head" aria-labelledby="page-h"><div class="wrap">
<div>
<p class="crumbs"><a href="/#scenarios-h"><span aria-hidden="true">←</span> All scenarios</a></p>
<p class="eyebrow">Scenario <code>${esc(v.key)}</code></p>
<h1 id="page-h">${esc(v.title)}</h1>
<p class="lede">${esc(v.about)}</p>
${v.sites.length ? tiles(v.sites, [...v.sites, ...v.missing].map((s) => s.key)) : ""}${missing}
${doors}
${v.tasks ? stats(v, tasks) : ""}
</div>
<div class="page-side">${mint}<p class="sources">${links}</p></div>
</div></section>
<section class="block" aria-labelledby="tasks-h"><div class="wrap">
<h2 id="tasks-h">Tasks</h2>
${v.tasks ? `<p class="section-lede">Each task is what a person asks the agent, word for word, and how its outcome is checked. The answers are not on this page.</p>\n` : ""}${body}
</div></section>
</main>`,
  );
}

/** The page for a scenario this deployment does not know. */
export function unknownScenarioPage(key: string, registry: boolean): string {
  return shell(
    "No such scenario · benchme",
    `${bar(registry, false)}
<main><section class="page-head"><div class="wrap"><div>
<p class="crumbs"><a href="/#scenarios-h"><span aria-hidden="true">←</span> All scenarios</a></p>
<h1>No such scenario</h1>
<p class="lede">This deployment has no scenario <code>${esc(key)}</code>.</p>
</div></div></section></main>`,
  );
}
