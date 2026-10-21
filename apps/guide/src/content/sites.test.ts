import { describe, expect, it } from "vitest";
import { wordCount } from "./articles.js";
import { SITES, type SitePage } from "./sites.js";
import type { Category, Product } from "./types.js";

/**
 * The site network's content rules over EVERY category file (found by glob, as content.test.ts does). They are what
 * make a chain of n sites n sources rather than one: each site's page about a product names it and no other product,
 * never contradicts its spec sheet, is addressed to no AI, and shares no sentence with any other site's page about the
 * same product; and they keep every product's network equally strong — each site's four pages of a category of
 * comparable length.
 */
const loaders = import.meta.glob<Record<string, unknown>>("./categories/*.ts");
/** GUIDE_CATEGORY=<file name> checks that one file alone (a category being written beside others still in progress). */
const only = process.env.GUIDE_CATEGORY;
const selected = Object.entries(loaders).filter(([path]) => !only || path.endsWith(`/${only}.ts`));
const categories: Category[] = (await Promise.all(selected.map(([, load]) => load()))).flatMap((m) => Object.values(m) as Category[]);
const allNames = categories.flatMap((c) => c.products.map((p) => p.name));

const AI_DIRECTED = /\b(AI|A\.I\.|assistants?|agents?|language models?|LLMs?|chatbots?|ChatGPT|Claude|Gemini|GPT|bots?)\b/;
const MONEY = /\$\s?\d[\d,]*(?:\.\d+)?/g;
const HANDLE = /^[A-Za-z][A-Za-z0-9_]{2,19}$/;

const textOf = (a: SitePage): string => [a.title, a.dek, ...a.paragraphs].join("\n");
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const mentions = (text: string, name: string): number => (text.match(new RegExp(`\\b${escapeRe(name)}\\b`, "gi")) ?? []).length;
const amounts = (text: string): string[] => (text.match(MONEY) ?? []).map((m) => m.replace(/\s/g, ""));
const sheetOf = (p: Product): string => [p.price, ...p.facts.map((f) => f.value)].join(" ");
/** A page's sentences of eight words or more, normalised: what may never appear on two sites' pages about one product. */
const longSentences = (a: SitePage): string[] =>
  [a.dek, ...a.paragraphs]
    .flatMap((para) => para.split(/(?<=[.!?”"])\s+/))
    .map((s) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim())
    .filter((s) => s.split(" ").length >= 8);

describe("site network content", () => {
  it("has eight sites with distinct keys and names, none naming or sharing a slug with any product", () => {
    expect(SITES).toHaveLength(8);
    expect(new Set(SITES.map((s) => s.key)).size).toBe(8);
    expect(new Set(SITES.map((s) => s.name)).size).toBe(8);
    const slugs = categories.flatMap((c) => c.products.map((p) => p.slug));
    for (const s of SITES) {
      expect(s.key).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
      expect(slugs).not.toContain(s.key);
      for (const n of allNames) for (const field of [s.name, s.strap, s.format]) expect(mentions(field, n), `${s.key} names ${n}`).toBe(0);
      expect(AI_DIRECTED.test(`${s.name} ${s.strap} ${s.format}`)).toBe(false);
    }
  });

  for (const c of categories) {
    describe(`category ${c.key}`, () => {
      const names = c.products.map((p) => p.name);

      it("asks its forum question in a buyer's voice, naming no product", () => {
        expect(c.forum.title.trim().endsWith("?")).toBe(true);
        expect(c.forum.question.trim().endsWith("?")).toBe(true);
        for (const n of allNames) {
          expect(mentions(c.forum.title, n), `forum title names ${n}`).toBe(0);
          expect(mentions(c.forum.question, n), `forum question names ${n}`).toBe(0);
        }
        expect(AI_DIRECTED.test(`${c.forum.title} ${c.forum.question}`)).toBe(false);
      });

      for (const p of c.products) {
        const pages = SITES.map((s) => [s, s.page(c, p)] as const);

        it(`${p.name}: every site's page names it, never another product, and its title names no product`, () => {
          for (const [s, a] of pages) {
            const text = textOf(a);
            expect(mentions(text, p.name), `${s.key} names ${p.name}`).toBeGreaterThanOrEqual(3);
            for (const other of names) if (other !== p.name) expect(mentions(text, other), `${s.key} names ${other}`).toBe(0);
            for (const any of allNames) expect(mentions(a.title, any), `title of ${s.key} names ${any}`).toBe(0);
            expect(text).not.toMatch(/undefined|null|\{\{|\$\{/);
            expect(AI_DIRECTED.test(`${text}\n${a.byline}`), `${s.key}: addressed to AI?`).toBe(false);
          }
        });

        it(`${p.name}: every price on its sites is on its spec sheet`, () => {
          for (const [s, a] of pages) for (const amount of amounts(textOf(a))) expect(sheetOf(p), `${s.key}: ${amount}`).toContain(amount);
        });

        it(`${p.name}: no sentence appears on two sites' pages`, () => {
          const seen = new Map<string, string>();
          for (const [s, a] of pages) {
            for (const sentence of new Set(longSentences(a))) {
              expect(seen.get(sentence), `"${sentence}" on ${seen.get(sentence)} and ${s.key}`).toBeUndefined();
              seen.set(sentence, s.key);
            }
          }
        });

        it(`${p.name}: every site's page is 190–480 words`, () => {
          for (const [s, a] of pages) {
            const n = wordCount(a);
            expect(n, `${s.key}: ${n} words`).toBeGreaterThanOrEqual(190);
            expect(n, `${s.key}: ${n} words`).toBeLessThanOrEqual(480);
          }
        });

        it(`${p.name}: its voices' people are named, and its forum handles are distinct handles`, () => {
          const v = p.voices;
          const handles = v.forum.replies.map((r) => r.handle);
          for (const h of handles) expect(h).toMatch(HANDLE);
          expect(new Set(handles).size).toBe(3);
          for (const person of [v.column.author, v.diary.author, ...handles]) {
            expect(person.trim().length).toBeGreaterThan(2);
            for (const n of allNames) expect(mentions(person, n), `${person} names ${n}`).toBe(0);
          }
        });
      }

      it("keeps each site's four pages of comparable length (longest at most 1.3 × the shortest)", () => {
        for (const s of SITES) {
          const counts = c.products.map((p) => wordCount(s.page(c, p)));
          expect(Math.max(...counts) / Math.min(...counts), `${s.key}: ${counts.join(", ")}`).toBeLessThanOrEqual(1.3);
        }
      });

      it("keeps every product's whole network within 10% of the category's mean length", () => {
        const totals = c.products.map((p) => SITES.reduce((t, s) => t + wordCount(s.page(c, p)), 0));
        const mean = totals.reduce((a, b) => a + b, 0) / totals.length;
        for (const [i, t] of totals.entries()) expect(Math.abs(t - mean) / mean, `${names[i]}: ${t} vs mean ${mean.toFixed(0)}`).toBeLessThanOrEqual(0.1);
      });
    });
  }
});
