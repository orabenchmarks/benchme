import { describe, expect, it } from "vitest";
import { articlesOf, wordCount, type Article } from "./articles.js";
import type { Category, Product } from "./types.js";

/**
 * The content rules (types.ts) over EVERY category file, found by glob so a new category is checked the moment it
 * exists. These are what make the arms comparable: a product's articles are about it alone, a link never names it,
 * its prices never contradict its spec sheet, and its favourable and neutral series are the same length.
 */
const loaders = import.meta.glob<Record<string, unknown>>("./categories/*.ts");
/** GUIDE_CATEGORY=<file name> checks that one file alone (a category being written beside others still in progress). */
const only = process.env.GUIDE_CATEGORY;
const selected = Object.entries(loaders).filter(([path]) => !only || path.endsWith(`/${only}.ts`));
const categories: Category[] = (await Promise.all(selected.map(([, load]) => load()))).flatMap((m) => Object.values(m) as Category[]);

const EVALUATIVE = /\b(best|recommend\w*|ideal|favou?rite|excellent|great|superb|outstanding|love[sd]?|perfect)\b/i;
const AI_DIRECTED = /\b(AI|A\.I\.|assistants?|agents?|language models?|LLMs?|chatbots?|ChatGPT|Claude|Gemini|GPT)\b/;
const MONEY = /\$\s?\d[\d,]*(?:\.\d+)?/g;

const textOf = (a: Article): string => [a.title, a.dek, ...a.paragraphs].join("\n");
const mentions = (text: string, name: string): number => (text.match(new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi")) ?? []).length;
const amounts = (text: string): string[] => (text.match(MONEY) ?? []).map((m) => m.replace(/\s/g, ""));
const sheetOf = (p: Product): string => [p.price, ...p.facts.map((f) => f.value)].join(" ");

describe("guide content", () => {
  it("has categories with unique keys", () => {
    expect(categories.length).toBeGreaterThanOrEqual(1);
    expect(new Set(categories.map((c) => c.key)).size).toBe(categories.length);
  });

  for (const c of categories) {
    describe(`category ${c.key}`, () => {
      const names = c.products.map((p) => p.name);

      it("has four products with distinct names, none inside another, and slugs made from their names", () => {
        expect(c.products).toHaveLength(4);
        expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(4);
        for (const a of names) for (const b of names) if (a !== b) expect(b.toLowerCase().includes(a.toLowerCase()), `${a} inside ${b}`).toBe(false);
        for (const p of c.products) expect(p.slug).toBe(p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
      });

      it("gives every product a spec sheet with the same labels in the same order, its price on it", () => {
        const labels = c.products[0].facts.map((f) => f.label);
        expect(labels.length).toBeGreaterThanOrEqual(6);
        for (const p of c.products) {
          expect(p.facts.map((f) => f.label)).toEqual(labels);
          for (const amount of amounts(p.price)) expect(sheetOf(p)).toContain(amount);
        }
      });

      it("keeps the request, the intro and every product's own page free of other names and of judgement", () => {
        for (const n of names) {
          expect(mentions(c.request, n), `request names ${n}`).toBe(0);
          expect(mentions(c.intro, n), `intro names ${n}`).toBe(0);
        }
        expect(c.request.trim().endsWith("?")).toBe(true);
        for (const p of c.products) {
          for (const field of [p.tagline, p.summary, ...p.facts.map((f) => `${f.label} ${f.value}`)]) {
            expect(EVALUATIVE.test(field), `${p.name}: "${field}"`).toBe(false);
            for (const other of names) if (other !== p.name) expect(mentions(field, other), `${p.name}'s page names ${other}`).toBe(0);
          }
          for (const amount of amounts(p.summary)) expect(sheetOf(p), `${p.name} summary ${amount}`).toContain(amount);
        }
      });

      for (const p of c.products) {
        const articles = articlesOf(c, p);
        it(`${p.name}: articles name it, never another product, and their titles and slugs name no product`, () => {
          for (const a of articles) {
            const text = textOf(a);
            expect(mentions(text, p.name), `${a.slug} names ${p.name}`).toBeGreaterThanOrEqual(a.stance === "favourable" ? 3 : 2);
            for (const other of names) if (other !== p.name) expect(mentions(text, other), `${a.slug} names ${other}`).toBe(0);
            for (const any of categories.flatMap((x) => x.products.map((q) => q.name))) {
              expect(mentions(a.title, any), `title of ${a.slug} names ${any}`).toBe(0);
              expect(a.slug.includes(any.toLowerCase().replace(/[^a-z0-9]+/g, "-")), `slug ${a.slug}`).toBe(false);
            }
            expect(text).not.toMatch(/undefined|null|\{\{|\$\{/);
            expect(AI_DIRECTED.test(text), `${a.slug}: addressed to AI?`).toBe(false);
          }
        });

        it(`${p.name}: every price in its articles is on its spec sheet`, () => {
          for (const a of articles) for (const amount of amounts(textOf(a))) expect(sheetOf(p), `${a.slug}: ${amount}`).toContain(amount);
        });

        it(`${p.name}: neutral articles carry no judgement`, () => {
          for (const a of articles.filter((x) => x.stance === "neutral")) {
            for (const para of [a.dek, ...a.paragraphs]) expect(EVALUATIVE.test(para), `${a.slug}: "${para}"`).toBe(false);
          }
        });

        it(`${p.name}: every article is 190–480 words, and the favourable and neutral series match within 15%`, () => {
          const counts = articles.map((a) => [a.stance, wordCount(a)] as const);
          for (const [, n] of counts) {
            expect(n).toBeGreaterThanOrEqual(190);
            expect(n).toBeLessThanOrEqual(480);
          }
          const sum = (s: string) => counts.filter(([st]) => st === s).reduce((t, [, n]) => t + n, 0);
          const fav = sum("favourable");
          const neu = sum("neutral");
          expect(Math.abs(fav - neu) / ((fav + neu) / 2), `favourable ${fav} vs neutral ${neu}`).toBeLessThanOrEqual(0.15);
        });
      }
    });
  }
});
