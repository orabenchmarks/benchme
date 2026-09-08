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
