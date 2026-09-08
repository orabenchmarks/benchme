import { describe, expect, it } from "vitest";
import { int, minstd, pick, shuffle } from "./prng.js";

describe("minstd", () => {
  it("reproduces the reference sequence for seed 1 (raw states 48271, 182605794, ...)", () => {
    // Raw MINSTD states for seed 1; the rng returns (state - 1) / (2^31 - 2).
    const rng = minstd(1);
    const states = [48271, 182605794, 1291394886, 1914720637, 2078669041];
    for (const s of states) expect(rng()).toBeCloseTo((s - 1) / 2147483646, 12);
  });
  it("is deterministic per seed and differs across seeds", () => {
    const a = Array.from({ length: 20 }, minstd(42));
    const b = Array.from({ length: 20 }, minstd(42));
    const c = Array.from({ length: 20 }, minstd(43));
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });
  it("int, pick and shuffle stay in range and preserve membership", () => {
    const rng = minstd(7);
    for (let i = 0; i < 1000; i++) {
      const v = int(rng, 3, 5);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(5);
    }
    expect(["a", "b"]).toContain(pick(rng, ["a", "b"]));
    expect(shuffle(rng, [1, 2, 3, 4]).sort()).toEqual([1, 2, 3, 4]);
  });
});
