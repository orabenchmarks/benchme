import { articleFor, type Article } from "../content/articles.js";
import type { Category, Product } from "../content/types.js";
import { ARMS, isArmKey, type Arm } from "./arms.js";

/**
 * An EDITION is what one workspace's guide shows: a category, an arm and the arm's target product. The workspace's
 * seed names it (edition-table.ts). Everything a page renders is a pure function of the edition, so two workspaces
 * minted with the same seed see byte-identical pages.
 */
export type Edition = {
  readonly seed: number;
  readonly category: Category;
  readonly arm: Arm;
  readonly target: Product;
  readonly targetIndex: number;
};

export type EditionRow = readonly [seed: number, category: string, arm: string, target: number];

/** The editions of a table of rows over a set of categories — every row checked at construction, so a bad table never boots. */
export class EditionTable {
  private readonly bySeedMap = new Map<number, Edition>();

  constructor(rows: ReadonlyArray<EditionRow>, categories: readonly Category[]) {
    const byKey = new Map(categories.map((c) => [c.key, c] as const));
    const seen = new Set<string>();
    for (const [seed, categoryKey, armKey, targetIndex] of rows) {
      const category = byKey.get(categoryKey);
      if (!category) throw new Error(`edition ${seed}: no category "${categoryKey}"`);
      if (!isArmKey(armKey)) throw new Error(`edition ${seed}: no arm "${armKey}"`);
      const target = category.products[targetIndex];
      if (!target) throw new Error(`edition ${seed}: no product #${targetIndex} in "${categoryKey}"`);
      if (this.bySeedMap.has(seed)) throw new Error(`edition seed ${seed} appears twice`);
      const cell = `${categoryKey}|${armKey}|${targetIndex}`;
      if (seen.has(cell)) throw new Error(`edition ${seed}: (${categoryKey}, ${armKey}, #${targetIndex}) appears twice`);
      seen.add(cell);
      this.bySeedMap.set(seed, { seed, category, arm: ARMS[armKey], target, targetIndex });
    }
  }

  bySeed(seed: number): Edition | undefined {
    return this.bySeedMap.get(seed);
  }

  all(): Edition[] {
    return [...this.bySeedMap.values()];
  }
}

/** The target's journal series an edition serves, in reading order (none for the base arm). */
export function seriesOf(edition: Edition): Article[] {
  const { stance, n } = edition.arm;
  if (!stance) return [];
  return ([1, 2, 3] as const).filter((i) => i <= n).map((i) => articleFor(edition.category, edition.target, stance, i));
}

/** The served article at `slug`, if this edition serves one there. */
export function articleAt(edition: Edition, slug: string): Article | undefined {
  return seriesOf(edition).find((a) => a.slug === slug);
}

/** The guide-relative path of an article ("journal/<slug>"): what a link resolves under the guide's address, and what a reading list names. */
export const journalPath = (slug: string): string => `journal/${slug}`;
