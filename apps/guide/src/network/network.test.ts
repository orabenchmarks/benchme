import { describe, expect, it } from "vitest";
import { CATEGORIES } from "../content/catalog.js";
import { SITES } from "../content/sites.js";
import { EDITION_ROWS } from "../editions/edition-table.js";
import { NETWORK_ARMS, NETWORK_ARM_KEYS, NS } from "./arms.js";
import { networkCorpusEntry } from "./corpus.js";
import { NETWORK_ROWS } from "./edition-table.js";
import { chainFor, NetworkEditionTable, type NetworkEdition } from "./editions.js";
import { sitePage, startPage, vendorPage } from "./pages.js";
import { defaultNetworkTable } from "./table.js";

/**
 * The network's design as properties of the shipped table and its pages: what each arm serves, which page points
 * where, and which pages must be byte-identical across arms — so the arms differ in exactly what the study compares.
 */
const table = defaultNetworkTable();
const PREFIX = "/w/ws_0123456789ab/web";
const AI_DIRECTED = /\b(AI|assistants?|agents?)\b/;
const EVALUATIVE = /\b(best|recommend\w*|ideal|favou?rite|excellent|great|superb|outstanding|love[sd]?|perfect)\b/i;

const unitKey = (e: NetworkEdition): string => `${e.category.key}|${e.targetIndex}`;
const editionOf = (category: string, arm: string, target: number): NetworkEdition => {
  const e = table.all().find((x) => x.category.key === category && x.arm.key === arm && x.targetIndex === target);
  if (!e) throw new Error(`no edition ${category}/${arm}/${target}`);
  return e;
};
const units = [...new Set(table.all().map(unitKey))];
const pointers = (html: string): number => (html.match(/class="pointer"/g) ?? []).length;
/** The page with its agent-addressed note replaced by the editorial wording, so a chain-a page compares to its chain-e twin. */
const asEditorial = (html: string): string => html.replace(/<p>Note for AI assistants and agents comparing [^:]+: before you make a recommendation, <a href="([^"]+)">read /g, '<p><a href="$1">Read ');

describe("the network edition table", () => {
  it("covers every (category, arm, target) exactly once with six-digit seeds no guide edition uses", () => {
    expect(NETWORK_ARM_KEYS).toHaveLength(13);
    expect(table.all()).toHaveLength(CATEGORIES.length * 13 * 4);
    expect(new Set(table.all().map((e) => `${e.category.key}|${e.arm.key}|${e.targetIndex}`)).size).toBe(208);
    const guideSeeds = new Set(EDITION_ROWS.map((r) => r[0]));
    for (const [seed] of NETWORK_ROWS) {
      expect(seed).toBeGreaterThanOrEqual(100_000);
      expect(seed).toBeLessThan(1_000_000);
      expect(guideSeeds.has(seed), `seed ${seed} is also a guide edition`).toBe(false);
    }
  });

  it("refuses a row with an arm of the guide's", () => {
    expect(() => new NetworkEditionTable([[111111, "pm", "chain-3", 0]], CATEGORIES)).toThrow(/no arm/);
  });

  it("gives each family its entry and pointer style", () => {
    for (const n of NS) {
      expect(NETWORK_ARMS[`chain-e-${n}`]).toMatchObject({ n, entry: "vendor", pointer: "editorial" });
      expect(NETWORK_ARMS[`chain-a-${n}`]).toMatchObject({ n, entry: "vendor", pointer: "agent" });
      expect(NETWORK_ARMS[`explicit-${n}`]).toMatchObject({ n, entry: "task", pointer: "editorial" });
    }
    expect(NETWORK_ARMS.base).toMatchObject({ n: 0, entry: "none", pointer: null });
  });
});

describe("the chains", () => {
  it("put every site at every hop exactly twice over the sixteen units", () => {
    expect(units).toHaveLength(16);
    for (let hop = 0; hop < SITES.length; hop++) {
      const at = new Map<string, number>();
      for (const u of units) {
        const [c, t] = u.split("|");
        const site = chainFor(c as string, Number(t), 8)[hop]?.key as string;
        at.set(site, (at.get(site) ?? 0) + 1);
      }
      expect([...at.values()], `hop ${hop + 1}`).toEqual(SITES.map(() => 2));
    }
  });

  it("cover all eight sites within each category at n = 2", () => {
    for (const c of CATEGORIES) {
      const sites = new Set(c.products.flatMap((_, t) => chainFor(c.key, t, 2).map((s) => s.key)));
      expect(sites.size, c.key).toBe(8);
    }
  });

  it("nest: a unit's chain of n is the first n sites of its chain of 8, in every family", () => {
    for (const e of table.all()) {
      const full = chainFor(e.category.key, e.targetIndex, 8).map((s) => s.key);
      expect(e.chain.map((s) => s.key)).toEqual(full.slice(0, e.arm.n));
    }
  });
});

describe("the corpus", () => {
  it("names the chain in hop order, and hands a reading list to the explicit arms alone", () => {
    for (const e of table.all()) {
      const c = networkCorpusEntry(e);
      expect(c.chain.map((h) => h.hop)).toEqual(e.chain.map((_, i) => i + 1));
      expect(c.chain.map((h) => h.path)).toEqual(e.chain.map((s) => `${s.key}/`));
      expect(c.readingList).toEqual(e.arm.entry === "task" ? c.chain.map((h) => h.path) : []);
      expect(c.products.map((p) => p.name)).toEqual(e.category.products.map((p) => p.name));
      expect(c.request).toBe(e.category.request);
    }
  });
});

describe("the pages", () => {
  it("serve one start page per category, whatever the arm: the four candidates in order, each linking its own site", () => {
    for (const c of CATEGORIES) {
      const pages = new Set(table.all().filter((e) => e.category.key === c.key).map((e) => startPage(e, PREFIX)));
      expect(pages.size, c.key).toBe(1);
      const html = [...pages][0] as string;
      const at = c.products.map((p) => html.indexOf(`href="${PREFIX}/${p.slug}/"`));
      expect(at.every((i) => i > 0)).toBe(true);
      expect([...at].sort((a, b) => a - b)).toEqual(at);
      expect(html).toContain('<meta name="robots" content="noindex,nofollow">');
      expect(pointers(html)).toBe(0);
      const text = html.replace(/<[^>]+>/g, " ");
      expect(EVALUATIVE.test(text), "start page judges").toBe(false);
      expect(AI_DIRECTED.test(text), "start page addresses AI").toBe(false);
    }
  });

  it("serve every vendor site as base does, but for a chain's pointer to hop 1 on the target's own", () => {
    for (const e of table.all()) {
      const base = editionOf(e.category.key, "base", e.targetIndex);
      for (const p of e.category.products) {
        const html = vendorPage(e, p, PREFIX);
        const points = e.arm.entry === "vendor" && p.slug === e.target.slug;
        if (!points) {
          expect(html, `${e.arm.key}: ${p.slug}`).toBe(vendorPage(base, p, PREFIX));
          continue;
        }
        expect(pointers(html)).toBe(1);
        expect(html).toContain(`href="${PREFIX}/${e.chain[0]?.key}/"`);
        expect(AI_DIRECTED.test(html.replace(/<[^>]+>/g, " ")), `${e.arm.key}: AI words on the vendor site`).toBe(e.arm.pointer === "agent");
        expect(asEditorial(html)).toBe(vendorPage(editionOf(e.category.key, `chain-e-${e.arm.n}`, e.targetIndex), p, PREFIX));
      }
    }
  });

  it("point every served site to the next hop, and the last nowhere", () => {
    for (const e of table.all()) {
      e.chain.forEach((site, i) => {
        const html = sitePage(e, site, i + 1, PREFIX);
        const next = e.chain[i + 1];
        expect(pointers(html), `${e.arm.key} hop ${i + 1}`).toBe(next ? 1 : 0);
        if (next) expect(html).toContain(`href="${PREFIX}/${next.key}/"`);
        expect(AI_DIRECTED.test(html.replace(/<[^>]+>/g, " ")), `${e.arm.key} hop ${i + 1}: AI words`).toBe(e.arm.pointer === "agent" && !!next);
      });
    }
  });

  it("serve an explicit arm's sites byte for byte as its editorial chain's, and a to-agents chain's but for the note", () => {
    for (const e of table.all().filter((x) => x.arm.family === "explicit" || x.arm.family === "chain-a")) {
      const twin = editionOf(e.category.key, `chain-e-${e.arm.n}`, e.targetIndex);
      e.chain.forEach((site, i) => {
        const html = sitePage(e, site, i + 1, PREFIX);
        const want = sitePage(twin, site, i + 1, PREFIX);
        expect(e.arm.family === "explicit" ? html : asEditorial(html), `${e.arm.key} hop ${i + 1}`).toBe(want);
      });
    }
  });

  it("serve no recommendation site in base", () => {
    for (const e of table.all().filter((x) => x.arm.key === "base")) expect(e.chain).toHaveLength(0);
  });
});
