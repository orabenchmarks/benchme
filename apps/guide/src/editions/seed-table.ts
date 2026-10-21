import type { Category, Product } from "../content/types.js";

/** One row of a frozen edition table: [seed, category key, arm key, target product index (0–3, the category's order)]. */
export type SeedRow = readonly [seed: number, category: string, arm: string, target: number];

/** What a table hands its edition factory for one row, every part already looked up and checked. */
export type RowParts<A> = { readonly seed: number; readonly category: Category; readonly arm: A; readonly target: Product; readonly targetIndex: number };

/**
 * A scenario's editions, keyed by the seed that names each one. Every row is checked at construction — a known
 * category and arm, a product at the index, no seed twice, no (category, arm, target) twice — so a bad table never
 * boots. The guide's and the network's tables are both this, over their own arm registries.
 */
export class SeedTable<A extends { readonly key: string }, E> {
  private readonly bySeedMap = new Map<number, E>();

  constructor(
    rows: ReadonlyArray<SeedRow>,
    categories: readonly Category[],
    arms: Readonly<Record<string, A>>,
    make: (parts: RowParts<A>) => E,
  ) {
    const byKey = new Map(categories.map((c) => [c.key, c] as const));
    const seen = new Set<string>();
    for (const [seed, categoryKey, armKey, targetIndex] of rows) {
      const category = byKey.get(categoryKey);
      if (!category) throw new Error(`edition ${seed}: no category "${categoryKey}"`);
      const arm = Object.hasOwn(arms, armKey) ? arms[armKey] : undefined;
      if (!arm) throw new Error(`edition ${seed}: no arm "${armKey}"`);
      const target = category.products[targetIndex];
      if (!target) throw new Error(`edition ${seed}: no product #${targetIndex} in "${categoryKey}"`);
      if (this.bySeedMap.has(seed)) throw new Error(`edition seed ${seed} appears twice`);
      const cell = `${categoryKey}|${armKey}|${targetIndex}`;
      if (seen.has(cell)) throw new Error(`edition ${seed}: (${categoryKey}, ${armKey}, #${targetIndex}) appears twice`);
      seen.add(cell);
      this.bySeedMap.set(seed, make({ seed, category, arm, target, targetIndex }));
    }
  }

  bySeed(seed: number): E | undefined {
    return this.bySeedMap.get(seed);
  }

  all(): E[] {
    return [...this.bySeedMap.values()];
  }
}
