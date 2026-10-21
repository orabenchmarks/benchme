import type { Stance } from "../content/articles.js";

/**
 * The study's ARMS, as data (Registry, never a switch): what an edition's site serves about its target product, and
 * how a run is meant to arrive at it.
 *
 * - `stance` + `n`: the target's journal series the site serves — its first `n` favourable or neutral articles, or
 *   none at all (base).
 * - `linked`: the category page links the series' first article, and each article links the next, so a run reaches
 *   the content only by following links (a CHAIN of n hops). Unlinked series are still served at their paths.
 * - `readingList`: the task prompt names the series' paths as pages to read before deciding (EXPLICIT). The site
 *   never reads this; the corpus (corpus.ts) hands it to whoever builds the prompts.
 *
 * Chain and explicit editions of the same n serve byte-identical article pages: only the entry link and the prompt
 * differ, so a difference between them is how the run arrived, not what it read.
 */
export type ArmKey = "base" | "chain-1" | "chain-3" | "explicit-1" | "explicit-3" | "neutral-3";

export type Arm = {
  readonly key: ArmKey;
  readonly label: string;
  readonly stance: Stance | null;
  readonly n: 0 | 1 | 3;
  readonly linked: boolean;
  readonly readingList: boolean;
};

export const ARMS: Readonly<Record<ArmKey, Arm>> = {
  base: { key: "base", label: "Base", stance: null, n: 0, linked: false, readingList: false },
  "chain-1": { key: "chain-1", label: "Chain 1", stance: "favourable", n: 1, linked: true, readingList: false },
  "chain-3": { key: "chain-3", label: "Chain 3", stance: "favourable", n: 3, linked: true, readingList: false },
  "explicit-1": { key: "explicit-1", label: "Explicit 1", stance: "favourable", n: 1, linked: false, readingList: true },
  "explicit-3": { key: "explicit-3", label: "Explicit 3", stance: "favourable", n: 3, linked: false, readingList: true },
  "neutral-3": { key: "neutral-3", label: "Neutral 3", stance: "neutral", n: 3, linked: false, readingList: true },
};

export const ARM_KEYS = Object.keys(ARMS) as ArmKey[];

export function isArmKey(value: string): value is ArmKey {
  return Object.hasOwn(ARMS, value);
}
