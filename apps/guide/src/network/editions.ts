import { SITES, type Site } from "../content/sites.js";
import type { Category, Product } from "../content/types.js";
import { SeedTable, type SeedRow } from "../editions/seed-table.js";
import { NETWORK_ARMS, type NetworkArm } from "./arms.js";

/** The scenario whose workspaces are network editions (packages/scenarios web-v1). */
export const NETWORK_SCENARIO = "web-v1";

/**
 * A NETWORK EDITION is what one workspace's web shows: the start page and the four vendor sites of a category, and —
 * unless the arm is base — the first n recommendation sites of the target's chain, every one recommending the target.
 * The workspace's seed names it (edition-table.ts). Every page is a pure function of the edition, so two workspaces
 * minted with the same seed see byte-identical pages.
 */
export type NetworkEdition = {
  readonly scenario: typeof NETWORK_SCENARIO;
  readonly seed: number;
  readonly category: Category;
  readonly arm: NetworkArm;
  readonly target: Product;
  readonly targetIndex: number;
  /** The recommendation sites it serves, in hop order (hop 1 first); none for base. */
  readonly chain: readonly Site[];
};

/** The categories in the order a unit's chain offset counts them. Frozen: append only. */
const UNIT_ORDER = ["pm", "passwords", "espresso", "ebike"];

/**
 * Where a (category, target) unit's chain starts in SITES: (2 × target index + category position) mod 8. Over the
 * sixteen units every site starts a chain exactly twice, and within one category the four chains of two sites cover
 * all eight — so a chain of n sites is, on average over the units, every site equally, not the same n sites each time.
 */
export function offsetOf(categoryKey: string, targetIndex: number): number {
  const position = UNIT_ORDER.indexOf(categoryKey);
  if (position < 0) throw new Error(`category "${categoryKey}" has no place in the network's unit order`);
  return (2 * targetIndex + position) % SITES.length;
}

/** The first n sites of a unit's chain, in hop order. */
export function chainFor(categoryKey: string, targetIndex: number, n: number): Site[] {
  const start = offsetOf(categoryKey, targetIndex);
  return Array.from({ length: n }, (_, k) => SITES[(start + k) % SITES.length] as Site);
}

/** The network's editions of a table of rows over a set of categories (seed-table.ts checks every row). */
export class NetworkEditionTable extends SeedTable<NetworkArm, NetworkEdition> {
  constructor(rows: ReadonlyArray<SeedRow>, categories: readonly Category[]) {
    super(rows, categories, NETWORK_ARMS, ({ seed, category, arm, target, targetIndex }) => ({
      scenario: NETWORK_SCENARIO,
      seed,
      category,
      arm,
      target,
      targetIndex,
      chain: chainFor(category.key, targetIndex, arm.n),
    }));
  }
}

/** The 1-based hop at which the edition serves the site `key`; undefined when it does not serve it. */
export function hopOf(e: NetworkEdition, key: string): number | undefined {
  const i = e.chain.findIndex((s) => s.key === key);
  return i < 0 ? undefined : i + 1;
}

/** A site's path under the network's address ("tested-and-told/"): what a pointer resolves under the prefix, and what a reading list names. */
export const sitePath = (key: string): string => `${key}/`;
