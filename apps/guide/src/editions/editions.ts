import { articleFor, type Article } from "../content/articles.js";
import type { Category, Product } from "../content/types.js";
import { ARMS, type Arm } from "./arms.js";
import { SeedTable, type SeedRow } from "./seed-table.js";

/** The scenario whose workspaces are guide editions (packages/scenarios guide-v1). */
export const GUIDE_SCENARIO = "guide-v1";

/**
 * An EDITION is what one workspace's guide shows: a category, an arm and the arm's target product. The workspace's
 * seed names it (edition-table.ts). Everything a page renders is a pure function of the edition, so two workspaces
 * minted with the same seed see byte-identical pages.
 */
export type Edition = {
  readonly scenario: typeof GUIDE_SCENARIO;
  readonly seed: number;
  readonly category: Category;
  readonly arm: Arm;
  readonly target: Product;
  readonly targetIndex: number;
};

export type EditionRow = SeedRow;

/** The guide's editions of a table of rows over a set of categories (seed-table.ts checks every row). */
export class EditionTable extends SeedTable<Arm, Edition> {
  constructor(rows: ReadonlyArray<EditionRow>, categories: readonly Category[]) {
    super(rows, categories, ARMS, ({ seed, category, arm, target, targetIndex }) => ({ scenario: GUIDE_SCENARIO, seed, category, arm, target, targetIndex }));
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
