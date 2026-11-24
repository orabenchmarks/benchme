import { DOORS, DoorSet, type Door } from "@benchme/core";
import { appInfo, scenarios, sitesOf } from "@benchme/scenarios";
import { describe, expect, it } from "vitest";
import { DOOR_LABELS, firstSentence, mintCommand, mintsWhat, normalize } from "./cards.js";
import { landingPage } from "./page.js";
import { scenarioPage } from "./scenario-page.js";
import { BASE, NO_LISTS, byId, deployment, esc, runScript, serviceFor, unesc, viewsFor } from "./testing.js";
import { EXAMPLE_ID } from "./visual.js";

const views = viewsFor();
const html = landingPage(views.landing);
/** The HTML of one scenario's card. */
const cardOf = (page: string, key: string) => byId(page, "article", `scenario-${key}`);
/** The first screen's HTML. */
const heroOf = (page: string) => page.slice(page.indexOf('<section class="hero"'), page.indexOf("</section>"));
/** What a person reads in some HTML: its text, tags dropped. */
const textOf = (part: string) => unesc(part.replace(/<[^>]+>/g, ""));

describe("the front page's first screen", () => {
  const hero = heroOf(html);

  it("says what benchme is: the headline and the sentence under it", () => {
    expect(hero).toContain('<h1 id="hero-h">Predictable, seeded web apps for benchmarking AI agents</h1>');
    expect(textOf(hero)).toContain("Every run gets its own workspace: a private copy of realistic web apps, built from a seed, so the same seed always starts from the same data and no run sees another's.");
  });

  it("gives the command that mints cuj-v1 on this deployment, with a Copy button, and an excerpt of its answer as the service writes it", () => {
    const command = mintCommand(BASE, { scenario: "cuj-v1", seed: 4242 });
    expect(hero).toContain(`<code id="hero-mint">${esc(command)}</code>`);
    expect(hero).toMatch(/<button type="button" class="copy" data-copy="hero-mint"[^>]*aria-label="Copy the command that mints a cuj-v1 workspace">Copy<\/button>/);
    const answer = textOf(hero.slice(hero.indexOf("The answer: your workspace&#39;s addresses")));
    const urls = serviceFor(deployment(), DoorSet.ALL).urls({ id: EXAMPLE_ID, scenario: "cuj-v1", doors: null }).apps;
    const [first, second] = Object.entries(urls);
    for (const line of [`"id": "${EXAMPLE_ID}",`, '"scenario": "cuj-v1",', '"seed": 4242,', `"${first?.[0]}": "${first?.[1]}",`, `"${second?.[0]}": "${second?.[1]}",`, `… ${Object.keys(urls).length - 2} more`]) expect(answer).toContain(line);
    expect(first).toEqual(["hotels", `${BASE}/w/${EXAMPLE_ID}/hotels`]);
    expect(hero).toContain("<b>3. Point your agent at those addresses.</b> It uses the sites through their pages, REST, MCP and WebMCP");
  });

  it("draws the agent reaching its own workspace through the gateway: an image with words, the example's id and apps, the doors open here", () => {
    const svg = hero.slice(hero.indexOf("<svg"), hero.indexOf("</svg>"));
    expect(svg).toMatch(/^<svg class="visual" viewBox="[^"]+" role="img" aria-label="Your agent goes through the gateway into its own workspace, ws_3f9c2a71b0d4, a copy of Larchmere Stays, Tallowmere Flights, Thistlecombe Tables, Marlivo Pizza, Orrowen Cinemas, Workspace inbox and 4 more, through Pages, REST, MCP, WebMCP\./);
    expect(svg).toContain("ws_3f9c2a… · seed 4242");
    for (const key of ["hotels", "flights", "dining", "pizza", "cinema", "mail"]) expect(svg).toContain(`>/${key}</text>`);
    expect(svg).toContain("+ 4 more apps");
    // One moving thing, and only where motion is welcome: complete at rest.
    expect(html).toMatch(/@media \(prefers-reduced-motion:no-preference\)\{\.v-flow\{opacity:1;animation:/);
    expect(html.match(/animation:/g)).toHaveLength(1);
  });

  it("features the next scenario this deployment mints when it cannot mint cuj-v1", () => {
    const small = landingPage(viewsFor({ apps: deployment(["warehouse", "helpdesk", "vaultdocs", "mail", "data", "verify"]) }).landing);
    expect(small).toContain(`<code id="hero-mint">${esc(mintCommand(BASE, { scenario: "acme-v1", seed: 4242 }))}</code>`);
    expect(textOf(heroOf(small))).toContain('"scenario": "acme-v1",');
    expect(textOf(heroOf(small))).not.toContain("cuj-v1");
  });
});

describe("the front page's scenario cards", () => {
  it.each(scenarios.list().map((s) => [s.key, s] as const))("%s: its title, its first sentence, its sites by name, its doors, its tasks' page and a Copy curl", (key, s) => {
    const card = cardOf(html, key);
    expect(card).toContain(`<code class="key">${key}</code>`);
    expect(card).toContain(`<a href="/scenarios/${key}">${esc(s.title)}</a>`);
    expect(card).toContain(`<p class="about">${esc(firstSentence(s.about))}</p>`);
    for (const site of sitesOf(s)) expect(card).toContain(`<li title="${site}">`);
    for (const site of sitesOf(s)) expect(card).toContain(`</i>${esc(appInfo(site).name)}</li>`);
    const corpus = s.docs.corpus;
    // The count is the public list's own, which agrees with the scenario's metadata.
    if (corpus) expect(card).toContain(`<a class="tasks-link" href="/scenarios/${key}"><b>${corpus.tasks}</b> tasks`);
    else expect(card).toContain(`<a class="tasks-link" href="/scenarios/${key}">About this scenario`);
    const command = mintCommand(BASE, corpus ? { scenario: key, seed: corpus.seed } : { scenario: key });
    expect(card).toContain(`<code class="mint-code" id="mint-${key}" hidden>${esc(command)}</code>`);
    expect(card).toMatch(new RegExp(`<button type="button" class="copy light" data-copy="mint-${key}"[^>]*aria-label="Copy ${mintsWhat(key)}">Copy curl</button>`));
  });

  it("gives the search box a label, and each card the words it is found by: its key, title, description, sites and doors", () => {
    expect(html).toMatch(/<label for="q">[^<]+<\/label>\s*<input id="q" name="q" type="search"/);
    expect(html).toContain('<p id="count" class="count" aria-live="polite" data-noun="scenarios" data-one="scenario">6 scenarios</p>');
    expect(html).toMatch(/<p id="empty" class="empty" hidden>/);
    for (const card of views.landing.cards) {
      const s = scenarios.get(card.key);
      const searched = cardOf(html, card.key).match(/data-search="([^"]*)"/)?.[1] ?? "";
      for (const word of [s.key, s.title, s.description, ...sitesOf(s).flatMap((k) => [k, appInfo(k).name]), ...card.doors.map((d) => DOOR_LABELS[d])]) expect(searched).toContain(esc(normalize(word)));
    }
  });

  it("gives a card only the doors one of its sites has: the stores, the guide and the network are pages alone", () => {
    const cards = Object.fromEntries(views.landing.cards.map((c) => [c.key, c.doors]));
    expect(cards).toEqual({ "acme-v1": [...DOORS], "shops-v1": ["page"], "guide-v1": ["page"], "web-v1": ["page"], "webmcp-v1": [...DOORS], "cuj-v1": [...DOORS] });
  });
});

describe("every page of the site", () => {
  const pages = [["the front page", html] as const, ...[...views.scenarios].map(([key, v]) => [key, scenarioPage(v)] as const)];

  it.each(pages)("%s is one page: no stylesheet, script, font or image from elsewhere, kept out of search indexes, light and dark, phone-wide", (_name, page) => {
    expect(page).toContain('<meta name="robots" content="noindex,nofollow">');
    expect(page).toContain('<meta name="viewport" content="width=device-width,initial-scale=1">');
    expect(page).toContain("@media (prefers-color-scheme:dark)");
    expect(page).not.toMatch(/<link\b|<script\s+src|<img\b|<iframe\b|@import|@font-face/i);
    expect(page.replaceAll("url(#v-arrow)", "")).not.toMatch(/url\(/i);
    expect(page).not.toMatch(/\ssrc="/);
    expect([...page.matchAll(/action="([^"]*)"/g)].every((m) => m[1] === "/" || m[1]?.startsWith("/scenarios/"))).toBe(true);
  });

  it.each(pages)("%s never calls the sites fictional", (_name, page) => {
    expect(page.toLowerCase()).not.toContain("fictional");
  });
});

describe("the pages and closed doors", () => {
  const SETS: Door[][] = [[], ["rest"], ["mcp"], ["webmcp"], ["rest", "mcp"], ["rest", "webmcp"], ["mcp", "webmcp"], ["rest", "mcp", "webmcp"]];

  it.each(SETS.map((open) => [open.join(",") || "pages alone", open] as const))("with %s open, no page names a closed door", (_name, open) => {
    const doors = DoorSet.of(open);
    const v = viewsFor({ doors });
    for (const [name, page] of [["/", landingPage(v.landing)] as const, ...[...v.scenarios].map(([key, view]) => [key, scenarioPage(view)] as const)]) {
      for (const door of DOORS) if (!doors.has(door)) expect([name, door, page.includes(`data-door="${door}"`)]).toEqual([name, door, false]);
      // Where an app's MCP server is: the front page says, and only with the MCP door open.
      expect([name, "/mcp", page.includes("/mcp")]).toEqual([name, "/mcp", name === "/" && doors.has("mcp")]);
      if (!doors.has("rest")) expect([name, "REST", page.includes("REST")]).toEqual([name, "REST", false]);
      if (!doors.has("webmcp")) expect([name, "WebMCP", page.includes("WebMCP")]).toEqual([name, "WebMCP", false]);
      // "MCP" alone only with the MCP door open: WebMCP is its own name.
      if (!doors.has("mcp")) expect([name, "MCP", page.replaceAll("WebMCP", "").includes("MCP")]).toEqual([name, "MCP", false]);
      expect([name, page.includes('href="/registry"')]).toEqual([name, open.length > 0]);
    }
    // And the front page names each open one.
    const home = landingPage(v.landing);
    for (const door of DOORS) expect([door, home.includes(`data-door="${door}"`)]).toEqual([door, doors.has(door)]);
  });
});

describe("a scenario this deployment cannot serve", () => {
  const small = viewsFor({ apps: deployment(["warehouse", "data", "halden", "guide", "web"]) });
  const page = landingPage(small.landing);

  it("says so, names the sites it lacks, and offers no command that would be refused", () => {
    for (const key of ["webmcp-v1", "cuj-v1"]) {
      const card = cardOf(page, key);
      expect(card).toContain("This deployment cannot mint it");
      expect(card).not.toContain("curl");
      // None of its sites is here, so none is listed as one of its sites, and nothing but pages is behind its doors.
      expect(card).toContain('<p class="missing">None of its sites is on this deployment: Larchmere Stays, Tallowmere Flights, ');
      expect(card).not.toContain('title="hotels"');
      expect(card.match(/data-door="(\w+)"/g)).toEqual(['data-door="page"']);
    }
    // acme-v1 names no apps of its own (it is minted wherever), so it is offered: with the sites this deployment has
    // listed as its sites, and the ones it lacks named apart.
    const acme = cardOf(page, "acme-v1");
    expect(acme).toContain("curl");
    expect([...acme.matchAll(/<li title="(\w+)">/g)].map((m) => m[1])).toEqual(["warehouse", "data"]);
    expect(acme).toContain("Not on this deployment: Helpdesk, Document vault and Workspace inbox.");
  });

  it("says so on its own page too, and still lists its tasks", () => {
    const own = scenarioPage(small.scenarios.get("cuj-v1")!);
    expect(own).toContain("This deployment cannot mint it");
    expect(own).not.toContain("curl");
    expect(own).toContain('<p id="count" class="count" aria-live="polite" data-noun="tasks" data-one="task">120 tasks</p>');
  });
});

describe("searching the scenarios", () => {
  it("opens filtered by ?q=, every word of it matched, the count and the empty state said", () => {
    const halden = landingPage(views.landing, "  Halden ");
    expect(halden).toContain('value="  Halden "');
    expect(halden).toContain(">1 of 6 scenarios</p>");
    expect(views.landing.cards.map((c) => [c.key, cardOf(halden, c.key).includes(" hidden>\n<div class=\"card-head\">")])).toEqual([
      ["acme-v1", true],
      ["shops-v1", false],
      ["guide-v1", true],
      ["web-v1", true],
      ["webmcp-v1", true],
      ["cuj-v1", true],
    ]);
    expect(landingPage(views.landing, "nine journeys")).toContain(">1 of 6 scenarios</p>");
    const none = landingPage(views.landing, "zebra");
    expect(none).toContain(">0 of 6 scenarios</p>");
    expect(none).toContain('<p id="empty" class="empty">No scenario matches “<span id="empty-q">zebra</span>”');
  });
});

describe("the front page's script", () => {
  it("filters the cards as a person types, says how many are left, and says when none is", () => {
    const p = runScript(html);
    expect([p.visible().length, p.ids.count?.textContent]).toEqual([6, "6 scenarios"]);
    p.type("hotels");
    expect(p.visible()).toEqual(["webmcp-v1", "cuj-v1"]);
    expect(p.ids.count?.textContent).toBe("2 of 6 scenarios");
    p.type("HOTELS   private");
    expect(p.visible()).toEqual(["cuj-v1"]);
    p.type("pages");
    expect(p.visible()).toHaveLength(6);
    p.type("zebra");
    expect([p.visible(), p.ids.count?.textContent, p.ids.empty?.hidden, p.ids["empty-q"]?.textContent]).toEqual([[], "0 of 6 scenarios", false, "zebra"]);
    p.type("");
    expect([p.visible().length, p.ids.empty?.hidden]).toEqual([6, true]);
  });

  it("opens filtered by ?q=, clears on Escape, and jumps to the search box on / unless a person is typing", () => {
    const p = runScript(html, { search: "?q=Quillfeather" });
    expect([p.ids.q?.value, p.visible()]).toEqual(["Quillfeather", ["shops-v1"]]);
    p.keyInBox("Escape");
    expect([p.ids.q?.value, p.visible().length]).toEqual(["", 6]);
    expect([p.keydown("/"), p.ids.q?.focused]).toEqual([true, 1]);
    expect([p.keydown("/", { tagName: "INPUT" }), p.ids.q?.focused]).toEqual([false, 1]);
  });

  it("copies the command a Copy button names, and says so", async () => {
    const p = runScript(html, { clipboard: "ok" });
    const button = await p.copy("hero-mint");
    expect(p.copied).toEqual([mintCommand(BASE, { scenario: "cuj-v1", seed: 4242 })]);
    expect([button.textContent, p.ids.said?.textContent]).toEqual(["Copied", "Copied the command that mints a cuj-v1 workspace."]);
  });

  it("shows and selects a card's hidden command where the clipboard is refused, so it can be copied by hand", async () => {
    for (const clipboard of ["refused", "none"] as const) {
      const p = runScript(html, { clipboard });
      expect(p.ids["mint-acme-v1"]?.hidden).toBe(true);
      const button = await p.copy("mint-acme-v1");
      expect([clipboard, p.ids["mint-acme-v1"]?.hidden, p.selected.map((n) => n.textContent), button.textContent]).toEqual([clipboard, false, [mintCommand(BASE, { scenario: "acme-v1", seed: 4242 })], "Selected"]);
      expect(p.ids.said?.textContent).toBe("Selected the command that mints an acme-v1 workspace: copy it with your keyboard.");
    }
  });
});

it("the no-list fallback is a list source of its own: the cards count from the scenarios' metadata", () => {
  const cards = viewsFor({ lists: NO_LISTS }).landing.cards;
  expect(Object.fromEntries(cards.map((c) => [c.key, c.tasks]))).toEqual({ "acme-v1": 163, "shops-v1": null, "guide-v1": null, "web-v1": null, "webmcp-v1": 162, "cuj-v1": 120 });
});
