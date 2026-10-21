import { describe, expect, it } from "vitest";
import { CATEGORIES } from "../content/catalog.js";
import { pm } from "../content/categories/pm.js";
import { ARM_KEYS } from "./arms.js";
import { corpusEntry } from "./corpus.js";
import { EDITION_ROWS } from "./edition-table.js";
import { EditionTable, type EditionRow } from "./editions.js";
import { defaultEditionTable } from "./resolver.js";

describe("the edition table", () => {
  it("covers every (category, arm, target) exactly once, with unguessable six-digit seeds", () => {
    const table = defaultEditionTable();
    expect(table.all()).toHaveLength(CATEGORIES.length * ARM_KEYS.length * 4);
    const cells = new Set(table.all().map((e) => `${e.category.key}|${e.arm.key}|${e.targetIndex}`));
    expect(cells.size).toBe(96);
    for (const [seed] of EDITION_ROWS) expect(seed).toBeGreaterThanOrEqual(100_000);
    for (const [seed] of EDITION_ROWS) expect(seed).toBeLessThan(1_000_000);
  });

  it("refuses a table with a repeated seed, an unknown category or arm, a missing product, or a repeated cell", () => {
    const ok: EditionRow = [111111, "pm", "base", 0];
    expect(() => new EditionTable([ok, [111111, "pm", "base", 1]], [pm])).toThrow(/twice/);
    expect(() => new EditionTable([[111112, "nope", "base", 0]], [pm])).toThrow(/no category/);
    expect(() => new EditionTable([[111113, "pm", "nope", 0]], [pm])).toThrow(/no arm/);
    expect(() => new EditionTable([[111114, "pm", "base", 7]], [pm])).toThrow(/no product/);
    expect(() => new EditionTable([ok, [222222, "pm", "base", 0]], [pm])).toThrow(/appears twice/);
  });

  it("gives a reading list exactly to the explicit and neutral arms, in reading order", () => {
    for (const e of defaultEditionTable().all()) {
      const c = corpusEntry(e);
      expect(c.readingList.length).toBe(e.arm.readingList ? e.arm.n : 0);
      expect(c.servedJournal.length).toBe(e.arm.n);
      expect(c.request).toBe(e.category.request);
      expect(c.products.map((p) => p.name)).toEqual(e.category.products.map((p) => p.name));
    }
  });
});
