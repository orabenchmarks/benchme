import { DoorSet } from "@benchme/core";
import { appInfo, scenarios } from "@benchme/scenarios";
import Fastify from "fastify";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerPortal } from "../routes/portal.js";
import { mintCommand } from "./cards.js";
import { scenarioPage, taskMatches, type TaskFilters } from "./scenario-page.js";
import type { PublicTask } from "./task-lists.js";
import { BASE, NO_LISTS, PUBLIC_LISTS, ROOT, byId, deployment, esc, runScript, serviceFor, unesc, viewsFor } from "./testing.js";

const views = viewsFor();
const cuj = views.scenarios.get("cuj-v1")!;
const cujTasks = cuj.tasks!;
const page = scenarioPage(cuj);
const taskHtml = (html: string, id: string) => byId(html, "article", `task-${id}`);
/** The tasks a filtered page shows, by id. */
const shownIn = (html: string) => [...html.matchAll(/<article class="task" id="task-([^"]+)"[^>]*>/g)].filter((m) => !m[0].endsWith(" hidden>")).map((m) => m[1]);
const names = new Map([...cuj.sites, ...cuj.missing].map((s) => [s.key, s.name]));
const read = (path: string): unknown => JSON.parse(readFileSync(join(ROOT, path), "utf8"));
const withCorpus = scenarios.list().filter((s) => s.docs.corpus);

/** A task's id and prompts, as a search reads them. */
const said = (t: PublicTask) => [t.id, ...t.steps.map((s) => s.prompt)].join(" ").toLowerCase();

// One filter a case, then two together: each must narrow on its own field.
const CASES: [string, TaskFilters, (t: PublicTask) => boolean][] = [
  ["a site", { site: "pizza" }, (t) => t.sites.includes("pizza")],
  ["a focus area", { area: "price-it" }, (t) => t.area === "price-it"],
  ["hard, the very hard included", { level: "hard" }, (t) => t.level === "hard"],
  ["very hard alone", { level: "very-hard" }, (t) => t.veryHard],
  ["conversations", { steps: "multi" }, (t) => t.steps.length > 1],
  ["one prompt", { steps: "single" }, (t) => t.steps.length === 1],
  ["every word of the query", { q: "TERRACE  Dinner" }, (t) => said(t).includes("terrace") && said(t).includes("dinner")],
  ["a site's name", { q: "marlivo" }, (t) => t.sites.includes("pizza") || said(t).includes("marlivo")],
  ["a task id", { q: "cuj-conv-dinner-long-01" }, (t) => t.id === "cuj-conv-dinner-long-01"],
  ["a site and a level", { site: "dining", level: "very-hard" }, (t) => t.sites.includes("dining") && t.veryHard],
];


describe("a scenario's page", () => {
  it("says what the scenario is, mints it here with a Copy button, links its write-up and its list, and counts its tasks", () => {
    const s = scenarios.get("cuj-v1");
    expect(page).toContain(`<h1 id="page-h">${esc(s.title)}</h1>`);
    expect(page).toContain(`<p class="lede">${esc(s.about)}</p>`);
    expect(page).toContain(`<code id="page-mint">${esc(mintCommand(BASE, { scenario: "cuj-v1", seed: 4242 }))}</code>`);
    expect(page).toMatch(/<button type="button" class="copy" data-copy="page-mint"[^>]*>Copy<\/button>/);
    expect(page).toContain(`<a href="https://github.com/orabenchmarks/benchme/blob/main/${s.docs.page}">The write-up</a>`);
    expect(page).toContain(`<a href="https://github.com/orabenchmarks/benchme/blob/main/${s.docs.corpus!.public}">The task list in the repository</a>`);
    expect(page).toContain('<ul class="stats" aria-label="Critical user journeys in numbers"><li><b>120</b>tasks</li><li><b>26</b>conversations</li><li><b>10</b>focus areas</li><li><b>9</b>sites</li></ul>');
    expect(page).toContain('<p id="count" class="count" aria-live="polite" data-noun="tasks" data-one="task">120 tasks</p>');
  });

  it("shows every task: what the person says, prompt by prompt, what checks each, its judge's criteria, its sites, level and focus area", () => {
    expect(shownIn(page)).toEqual(cujTasks.map((t) => t.id));
    for (const t of cujTasks) {
      const html = taskHtml(page, t.id);
      const said = [...html.matchAll(/<p class="said">([^<]*)<\/p>(?:<p class="how">([^<]*)<\/p>)?/g)].map((m) => [unesc(m[1] ?? ""), m[2]]);
      expect([t.id, said]).toEqual([t.id, t.steps.map((s) => [s.prompt, s.check === "state" ? "Checked by what the sites hold afterwards." : "Checked by the answer in the reply."])]);
      const criteria = t.steps.flatMap((s) => s.rubric);
      expect(html).toContain(`<summary>The judge's criteria (${criteria.length})</summary>`);
      for (const c of criteria) expect(html).toContain(esc(c));
      for (const site of t.sites) expect(html).toContain(`</i>${esc(appInfo(site).name)} <code class="key">${site}</code></li>`);
      expect(html).toContain(t.veryHard ? '<span class="chip lvl lvl-very-hard" title="Very hard: a flagged part of hard">Very hard</span>' : `<span class="chip lvl lvl-${t.level}">`);
    }
    // Spot one conversation whole: six prompts, each with its own criteria.
    const long = taskHtml(page, "cuj-conv-dinner-long-01");
    expect(long).toContain('<span class="chip">6 prompts</span>');
    expect(long).toContain('<span class="chip">Carry a conversation</span>');
    expect(long).toContain("<li><b>Prompt 6.</b> ");
  });

  it("never shows an answer: no task's summary, and nothing of any key in its keyed corpus", () => {
    for (const s of withCorpus) {
      const html = unesc(scenarioPage(views.scenarios.get(s.key)!));
      const pub = readFileSync(join(ROOT, s.docs.corpus!.public), "utf8");
      const keyed = read(s.docs.corpus!.keyed) as { id: string; key: unknown; summary?: string }[];
      for (const r of keyed) if (r.summary) expect([r.id, html.includes(r.summary)]).toEqual([r.id, false]);
      // Every distinctive string of every key (a path, an expected code, a time: one with a digit or a slash) that the
      // public list does not already say: none is on the page. Some there must be, or this proves nothing.
      const leaves = (v: unknown): string[] => (typeof v === "string" ? [v] : Array.isArray(v) ? v.flatMap(leaves) : v && typeof v === "object" ? Object.values(v).flatMap(leaves) : []);
      const secret = [...new Set(keyed.flatMap((r) => leaves(r.key)))].filter((v) => v.length >= 6 && /[\d/]/.test(v) && !pub.includes(JSON.stringify(v).slice(1, -1)));
      expect([s.key, secret.length > 20]).toEqual([s.key, true]);
      for (const v of secret) expect([s.key, v, html.includes(v)]).toEqual([s.key, v, false]);
    }
  });

  it("offers the filters its list has: site, focus area, level (very hard a part of hard) and prompts; a list without areas or levels offers none", () => {
    const options = (html: string, name: string) => [...(html.match(new RegExp(`<select id="f-${name}"[\\s\\S]*?</select>`))?.[0] ?? "").matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]);
    expect(options(page, "site")).toEqual(["", "hotels", "flights", "dining", "pizza", "cinema", "sports", "homes", "clinic", "events"]);
    expect(options(page, "area")).toEqual(["", ...new Set(cujTasks.map((t) => t.area))]);
    expect(options(page, "level")).toEqual(["", "easy", "medium", "hard", "very-hard", "impossible"]);
    expect(options(page, "steps")).toEqual(["", "single", "multi"]);
    const acme = scenarioPage(views.scenarios.get("acme-v1")!);
    expect([options(acme, "site"), options(acme, "area"), options(acme, "level"), options(acme, "steps")]).toEqual([["", "warehouse", "helpdesk", "vaultdocs", "data"], [], [], []]);
  });

    it.each(CASES)("opens filtered by %s from its address, the count said", (_name, filters, expected) => {
    const want = cujTasks.filter(expected).map((t) => t.id);
    expect(want.length).toBeGreaterThan(0);
    expect(want.length).toBeLessThan(cujTasks.length);
    const html = scenarioPage(cuj, filters);
    expect(shownIn(html)).toEqual(want);
    expect(html).toContain(`>${want.length} of 120 tasks</p>`);
    expect(cujTasks.filter((t) => taskMatches(t, filters, names)).map((t) => t.id)).toEqual(want);
  });

  it("says when no task matches", () => {
    const html = scenarioPage(cuj, { site: "pizza", area: "plan-across-sites" });
    expect(html).toContain(">0 of 120 tasks</p>");
    expect(html).toContain('<p id="empty" class="empty">No task matches the search and filters.</p>');
    expect(shownIn(html)).toEqual([]);
  });

  it("says so where it has no list of its own, and where this deployment does not carry its list", () => {
    expect(scenarioPage(views.scenarios.get("shops-v1")!)).toContain("This scenario has no task list of its own. Its write-up says how a run uses it.");
    const bare = scenarioPage(viewsFor({ lists: NO_LISTS }).scenarios.get("cuj-v1")!);
    expect(bare).toContain(`This deployment does not carry the list of its 120 tasks: it is in the repository, <a href="https://github.com/orabenchmarks/benchme/blob/main/compose/specs/cuj-tasks.json">here</a>.`);
    expect(bare).not.toContain('<article class="task"');
  });
});

describe("a scenario page's script", () => {
  it("narrows the list as a person picks and types, as the server does from the address", () => {
    const p = runScript(page);
    expect([p.filters.map((f) => f.attrs["data-filter"]), p.visible().length, p.ids.count?.textContent]).toEqual([["site", "area", "level", "steps"], 120, "120 tasks"]);
    for (const [, filters, expected] of CASES) {
      const fresh = runScript(page);
      for (const [name, value] of Object.entries(filters)) if (name === "q") fresh.type(value as string);
      for (const [name, value] of Object.entries(filters)) if (name !== "q") fresh.pick(name, value as string);
      const want = cujTasks.filter(expected).map((t) => t.id);
      expect([filters, fresh.visible()]).toEqual([filters, want]);
      expect(fresh.ids.count?.textContent).toBe(`${want.length} of 120 tasks`);
    }
    p.pick("site", "pizza");
    p.pick("area", "plan-across-sites");
    expect([p.visible(), p.ids.empty?.hidden]).toEqual([[], false]);
    p.pick("area", "");
    expect([p.visible().length, p.ids.empty?.hidden]).toEqual([cujTasks.filter((t) => t.sites.includes("pizza")).length, true]);
  });

  it("opens filtered by the address's filters", () => {
    const p = runScript(page, { search: "?level=very-hard&site=dining" });
    expect(p.visible()).toEqual(cujTasks.filter((t) => t.veryHard && t.sites.includes("dining")).map((t) => t.id));
  });
});

describe("the routes", () => {
  async function portal() {
    const app = Fastify();
    const apps = deployment();
    registerPortal(app, { apps, scenarios, service: serviceFor(apps, DoorSet.ALL), publicBaseUrl: BASE, doors: DoorSet.ALL, lists: PUBLIC_LISTS });
    await app.ready();
    return app;
  }

  it("serve a scenario's page, filtered by its address, and a 404 page for a scenario there is not", async () => {
    const app = await portal();
    const all = await app.inject("/scenarios/cuj-v1");
    expect([all.statusCode, all.headers["content-type"], shownIn(all.body).length]).toEqual([200, "text/html; charset=utf-8", 120]);
    const some = await app.inject("/scenarios/cuj-v1?level=very-hard&site=dining&q=");
    expect(shownIn(some.body)).toEqual(cujTasks.filter((t) => t.veryHard && t.sites.includes("dining")).map((t) => t.id));
    expect(some.body).toContain('<option value="very-hard" selected>');
    const none = await app.inject("/scenarios/no-such-v9");
    expect([none.statusCode, none.body.includes("No such scenario"), none.body.includes("no-such-v9")]).toEqual([404, true, true]);
    await app.close();
  });

  it("serve no file: no keyed corpus, answer key or list is reachable at any address", async () => {
    const app = await portal();
    const tries = [
      "/compose/specs/cuj-corpus.json",
      "/compose/specs/intent-order-01.json",
      "/compose/specs/cuj-tasks.json",
      "/tasks/cuj-corpus.json",
      "/tasks/cuj-tasks.json",
      "/apps/gateway/tasks/cuj-tasks.json",
      "/scenarios/cuj-corpus.json",
      "/scenarios/intent-order-01.json",
      "/scenarios/..%2Fcompose%2Fspecs%2Fcuj-corpus.json",
      "/scenarios/cuj-v1/../../compose/specs/cuj-corpus.json",
      "/scenarios/cuj-v1/corpus",
    ];
    for (const url of tries) {
      const res = await app.inject(url);
      expect([url, res.statusCode]).toEqual([url, 404]);
      expect([url, /"(oracle|checks|expect|blind)"|&quot;(oracle|checks)&quot;/.test(res.body)]).toEqual([url, false]);
    }
    await app.close();
  });
});
