/** A deterministic random source in [0, 1). Same seed, same sequence, on every runtime. */
export type Rng = () => number;

const MODULUS = 2147483647; // 2^31 - 1
const MULTIPLIER = 48271;

/**
 * MINSTD (Park–Miller) — chosen for being trivially re-implementable in a
 * single `node -e` line inside a sandbox, so a task can regenerate the exact
 * fixture an oracle was derived from.
 */
export function minstd(seed: number): Rng {
  let state = seed % MODULUS;
  if (state <= 0) state += MODULUS - 1;
  return () => {
    state = (state * MULTIPLIER) % MODULUS;
    return (state - 1) / (MODULUS - 1);
  };
}

/**
 * A stream of its own for one part of a scenario: same (seed, key) → same
 * sequence, and drawing from it never moves a value drawn from `minstd(seed)`.
 * Lets a scenario grow a part (acme-v1's hotels) without changing a single
 * row it generated before.
 */
export function substream(seed: number, key: string): Rng {
  let h = 2166136261;
  for (const ch of `${seed}:${key}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return minstd((h % 2147483646) + 1);
}

/** Integer in [min, max] inclusive. */
export function int(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) throw new Error("pick from empty list");
  return items[int(rng, 0, items.length - 1)] as T;
}

/** Fisher–Yates on a copy. */
export function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = int(rng, 0, i);
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}
