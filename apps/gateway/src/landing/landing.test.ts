import { DOORS, DoorSet, type Door } from "@benchme/core";
import { appInfo, scenarios, sitesOf } from "@benchme/scenarios";
import { createContext, runInContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { AppRegistry } from "../app-registry.js";
import { WorkspaceService, type WorkspaceServiceDeps } from "../workspace-service.js";
import { DOOR_LABELS, SOURCE_URL, normalize, scenarioCards, type ScenarioCard } from "./cards.js";
import { landingPage, type LandingView } from "./page.js";
import { LANDING_SCRIPT } from "./script.js";

const BASE = "https://benchme.test";
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

/** A deployment with the chart's apps and flags (charts/benchme/templates/apps.yaml), or with fewer apps. */
function deployment(names = ["warehouse", "helpdesk", "vaultdocs", "hotels", "flights", "dining", "pizza", "cinema", "sports", "homes", "clinic", "events", "mail", "data", "verify", "wrenfield", "halden", "quillfeather", "paylantern", "wallet", "guide", "web"]) {
  const sites = ["hotels", "flights", "dining", "pizza", "cinema", "sports", "homes", "clinic", "events"];
  const tools = ["warehouse", "helpdesk", "vaultdocs", ...sites, "mail"].filter((n) => names.includes(n));
  return new AppRegistry(
    Object.fromEntries(names.map((n) => [n, `http://${n}`])),
    [],
    tools,
    ["warehouse", "helpdesk", "vaultdocs"].filter((n) => names.includes(n)),
    tools,
    ["paylantern", "wallet", "guide", "web", ...sites].filter((n) => names.includes(n)),
  );
}

function view(doors: DoorSet = DoorSet.ALL, apps = deployment()): LandingView {
  const service = new WorkspaceService({ scenarios, apps, publicBaseUrl: BASE, defaultTtlSeconds: 3600, maxTtlSeconds: 7200, doors } as unknown as WorkspaceServiceDeps);
  return {
    cards: scenarioCards({ scenarios, apps, service, doors, publicBaseUrl: BASE }),
    apps: apps.listed().map((a) => ({ key: a.name, name: appInfo(a.name).name, seeded: a.seeded, mcp: a.mcp })),
    doors: doors.list(),
    registry: doors.list().length > 1,
    publicBaseUrl: BASE,
  };
}

/** The HTML of one scenario's card. */
const cardHtml = (html: string, key: string) => {
  const at = html.indexOf(`data-scenario="${key}"`);
  return html.slice(html.lastIndexOf("<article", at), html.indexOf("</article>", at));
};

describe("the front page's scenario cards", () => {
  const html = landingPage(view());

  it.each(scenarios.list().map((s) => [s.key, s] as const))("%s has a card: its key, title, description and sites, named", (key, s) => {
    const card = cardHtml(html, key);
    expect(card).toContain(`<code class="key">${key}</code>`);
    expect(card).toContain(esc(s.title));
    expect(card).toContain(`<p class="about">${esc(s.about)}</p>`);
    for (const site of sitesOf(s)) expect(card).toContain(`${esc(appInfo(site).name)} <code>${site}</code>`);
  });

  it.each(scenarios.list().map((s) => [s.key, s] as const))("%s links its write-up and corpus files, counts its tasks, and mints at its corpus's seed", (key, s) => {
    const card = cardHtml(html, key);
    expect(card).toContain(`href="${SOURCE_URL}/blob/main/${s.docs.page}"`);
    const corpus = s.docs.corpus;
    if (corpus) {
      for (const path of [corpus.public, corpus.keyed, corpus.derivations]) expect(card).toContain(`href="${SOURCE_URL}/blob/main/${path}"`);
      expect(card).toContain(`${corpus.tasks} in its corpus`);
    } else expect(card).not.toContain("in its corpus");
    const body = JSON.stringify(corpus ? { scenario: key, seed: corpus.seed } : { scenario: key });
    expect(card).toContain(esc(`curl -s -X POST ${BASE}/api/workspaces \\\n  -H 'content-type: application/json' \\\n  -d '${body}'`));
    expect(card).toMatch(new RegExp(`<button type="button" class="copy" data-copy="mint-${key}"[^>]*aria-label="Copy the command that mints a ${key} workspace"`));
  });

  it("gives the search box a label, and each card the words it is found by: its key, title, description, sites and doors", () => {
    expect(html).toMatch(/<label for="q">[^<]+<\/label>\s*<input id="q" name="q" type="search"/);
    expect(html).toContain('<p id="count" class="count" aria-live="polite">6 scenarios</p>');
    expect(html).toMatch(/<p id="empty" class="empty" hidden>/);
    for (const card of view().cards) {
      const s = scenarios.get(card.key);
      const searched = cardHtml(html, card.key).match(/data-search="([^"]*)"/)?.[1] ?? "";
      for (const word of [s.key, s.title, s.description, ...sitesOf(s).flatMap((k) => [k, appInfo(k).name]), ...card.doors.map((d) => DOOR_LABELS[d])]) expect(searched).toContain(esc(normalize(word)));
    }
  });

  it("is one page: no stylesheet, script, font or image from another host, kept out of search indexes, light and dark, phone-wide", () => {
    expect(html).toContain('<meta name="robots" content="noindex,nofollow">');
    expect(html).toContain('<meta name="viewport" content="width=device-width,initial-scale=1">');
    expect(html).toContain("@media (prefers-color-scheme:dark)");
    expect(html).not.toMatch(/<link\b|<script\s+src|<img\b|@import|url\(/i);
    expect([...html.matchAll(/(?:src|action)="([^"]*)"/g)].map((m) => m[1])).toEqual(["/"]);
  });
});

describe("the front page and closed doors", () => {
  const SETS: Door[][] = [[], ["rest"], ["mcp"], ["webmcp"], ["rest", "mcp"], ["rest", "webmcp"], ["mcp", "webmcp"], ["rest", "mcp", "webmcp"]];

  it.each(SETS.map((open) => [open.join(",") || "pages alone", open] as const))("with %s open, names no closed door", (_name, open) => {
    const doors = DoorSet.of(open);
    const html = landingPage(view(doors));
    for (const door of DOORS) expect([door, html.includes(`data-door="${door}"`)]).toEqual([door, doors.has(door)]);
    expect(html.includes("/mcp")).toBe(doors.has("mcp"));
    expect(html.includes("REST")).toBe(doors.has("rest"));
    expect(html.includes("WebMCP")).toBe(doors.has("webmcp"));
    // "MCP" alone only with the MCP door open: WebMCP is its own name.
    expect(html.replaceAll("WebMCP", "").includes("MCP")).toBe(doors.has("mcp"));
    expect(html.includes('href="/registry"')).toBe(open.length > 0);
  });

  it("gives a card only the doors one of its sites has: the stores, the guide and the network are pages alone", () => {
    const cards = Object.fromEntries(view().cards.map((c) => [c.key, c.doors]));
    expect(cards).toEqual({ "acme-v1": [...DOORS], "shops-v1": ["page"], "guide-v1": ["page"], "web-v1": ["page"], "webmcp-v1": [...DOORS], "cuj-v1": [...DOORS] });
  });
});

describe("a scenario this deployment cannot serve", () => {
  it("says so, names the sites it lacks, and offers no command that would be refused", () => {
    const html = landingPage(view(DoorSet.ALL, deployment(["warehouse", "data", "halden", "guide", "web"])));
    for (const key of ["webmcp-v1", "cuj-v1"]) {
      const card = cardHtml(html, key);
      expect(card).toContain("This deployment cannot mint it");
      expect(card).not.toContain("curl");
      expect(card).toContain("Not on this deployment: Larchmere Stays, Tallowmere Flights");
      // None of its sites is here, so none is listed as one of its sites, and nothing but pages is behind its doors.
      expect(card).toContain('<dt>Sites</dt><dd><span class="muted">none on this deployment</span>');
      expect(card).not.toContain("<code>hotels</code>");
      expect(card.match(/data-door="(\w+)"/g)).toEqual(['data-door="page"']);
    }
    // acme-v1 names no apps of its own (it is minted wherever), so it is offered: with the sites this deployment has
    // listed as its sites, and the ones it lacks named apart.
    const acme = cardHtml(html, "acme-v1");
    expect(acme).toContain("curl");
    expect([...acme.matchAll(/<li>[^<]+ <code>(\w+)<\/code><\/li>/g)].map((m) => m[1])).toEqual(["warehouse", "data"]);
    expect(acme).toContain("Not on this deployment: Helpdesk, Document vault and Workspace inbox.");
  });
});

describe("searching the scenarios", () => {
  it("opens filtered by ?q=, every word of it matched, the count and the empty state said", () => {
    const halden = landingPage(view(), "  Halden ");
    expect(halden).toContain('value="  Halden "');
    expect(halden).toContain(">1 of 6 scenarios</p>");
    expect(view().cards.map((c) => [c.key, cardHtml(halden, c.key).includes(" hidden>")])).toEqual([
      ["acme-v1", true],
      ["shops-v1", false],
      ["guide-v1", true],
      ["web-v1", true],
      ["webmcp-v1", true],
      ["cuj-v1", true],
    ]);
    expect(landingPage(view(), "nine journeys")).toContain(">1 of 6 scenarios</p>");
    const none = landingPage(view(), "zebra");
    expect(none).toContain(">0 of 6 scenarios</p>");
    expect(none).toContain('<p id="empty" class="empty">No scenario matches “<span id="empty-q">zebra</span>”');
  });
});

/** The page's script against the least of a DOM it needs: the search box, the count, the empty state, the cards. */
function page(cards: ScenarioCard[], search = "") {
  const node = (props: Record<string, unknown> = {}) => {
    const on: Record<string, ((e: unknown) => void)[]> = {};
    return { textContent: "", hidden: false, value: "", tagName: "P", ...props, on, addEventListener: (type: string, fn: (e: unknown) => void) => (on[type] ??= []).push(fn), focus: vi.fn() };
  };
  const q = node({ tagName: "INPUT" });
  const ids: Record<string, ReturnType<typeof node>> = { q, count: node(), empty: node({ hidden: true }), "empty-q": node(), said: node() };
  const shown = cards.map((c) => ({ key: c.key, hidden: false, getAttribute: (name: string) => (name === "data-search" ? c.search : null) }));
  const doc = node();
  const document = { ...doc, getElementById: (id: string) => ids[id] ?? null, querySelectorAll: () => shown };
  runInContext(LANDING_SCRIPT, createContext({ document, location: { search }, URLSearchParams, navigator: {}, window: {}, setTimeout }));
  const type = (text: string) => {
    q.value = text;
    for (const fn of q.on.input ?? []) fn({});
  };
  const key = (on: { on: Record<string, ((e: unknown) => void)[]> }, k: string, target: unknown = { tagName: "BODY" }) => {
    const e = { key: k, target, preventDefault: vi.fn() };
    for (const fn of on.on.keydown ?? []) fn(e);
    return e;
  };
  return { q, ids, visible: () => shown.filter((c) => !c.hidden).map((c) => c.key), type, keydown: (k: string, target?: unknown) => key(document as never, k, target), keyInBox: (k: string) => key(q, k) };
}

describe("the page's script", () => {
  const cards = view().cards;

  it("filters the cards as a person types, says how many are left, and says when none is", () => {
    const p = page(cards);
    expect([p.visible().length, p.ids.count!.textContent]).toEqual([6, "6 scenarios"]);
    p.type("hotels");
    expect(p.visible()).toEqual(["webmcp-v1", "cuj-v1"]);
    expect(p.ids.count!.textContent).toBe("2 of 6 scenarios");
    p.type("HOTELS   private");
    expect(p.visible()).toEqual(["cuj-v1"]);
    p.type("pages");
    expect(p.visible()).toHaveLength(6);
    p.type("zebra");
    expect([p.visible(), p.ids.count!.textContent, p.ids.empty!.hidden, p.ids["empty-q"]!.textContent]).toEqual([[], "0 of 6 scenarios", false, "zebra"]);
    p.type("");
    expect([p.visible().length, p.ids.empty!.hidden]).toEqual([6, true]);
  });

  it("opens filtered by ?q=, clears on Escape, and jumps to the search box on / unless a person is typing", () => {
    const p = page(cards, "?q=Quillfeather");
    expect([p.q.value, p.visible()]).toEqual(["Quillfeather", ["shops-v1"]]);
    p.keyInBox("Escape");
    expect([p.q.value, p.visible().length]).toEqual(["", 6]);
    const jump = p.keydown("/");
    expect([jump.preventDefault.mock.calls.length, p.q.focus.mock.calls.length]).toEqual([1, 1]);
    const typing = p.keydown("/", { tagName: "INPUT" });
    expect([typing.preventDefault.mock.calls.length, p.q.focus.mock.calls.length]).toEqual([0, 1]);
  });
});
