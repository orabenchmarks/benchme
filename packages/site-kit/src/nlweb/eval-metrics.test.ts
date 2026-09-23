import { describe, expect, it } from "vitest";
import { highConfidenceMisses, ndcgAt, percentile, precisionAt } from "./eval-metrics.js";

// Each `it` below changes exactly ONE field from the base case in its
// `describe` block, so a broken metric points at the field that broke it
// rather than a fixture that varies everything at once.

describe("ndcgAt", () => {
  const base = { ranked: ["a", "b", "c"], relevant: ["a"], k: 3 };

  it("hit at rank 0 (base case): perfect score", () => {
    expect(ndcgAt(base.ranked, base.relevant, base.k)).toBeCloseTo(1, 10);
  });

  it("vary rankedIds: hit at rank 1 discounts by 1/log2(3)", () => {
    expect(ndcgAt(["b", "a", "c"], base.relevant, base.k)).toBeCloseTo(1 / Math.log2(3), 10);
  });

  it("vary rankedIds: no hit anywhere scores 0", () => {
    expect(ndcgAt(["b", "c", "d"], base.relevant, base.k)).toBe(0);
  });

  it("vary relevant: nothing relevant to find scores 1, not 0/0", () => {
    expect(ndcgAt(base.ranked, [], base.k)).toBe(1);
  });

  it("vary k: the hit falls outside the window", () => {
    expect(ndcgAt(["b", "a", "c"], base.relevant, 1)).toBe(0);
  });
});

describe("precisionAt", () => {
  const base = { ranked: ["a", "b", "c"], relevant: ["a", "c"], k: 3 };

  it("two of three top results relevant (base case)", () => {
    expect(precisionAt(base.ranked, base.relevant, base.k)).toBeCloseTo(2 / 3, 10);
  });

  it("vary k: only the first result is in the window and it's relevant", () => {
    expect(precisionAt(base.ranked, base.relevant, 1)).toBe(1);
  });

  it("vary relevant: no overlap at all", () => {
    expect(precisionAt(base.ranked, ["x"], base.k)).toBe(0);
  });

  it("vary rankedIds: an empty result set is 0, not NaN", () => {
    expect(precisionAt([], base.relevant, base.k)).toBe(0);
  });
});

describe("percentile", () => {
  const base = { values: [1, 2, 3, 4, 5], p: 50 };

  it("p50 of an odd-length series lands exactly on the middle value (base case)", () => {
    expect(percentile(base.values, base.p)).toBe(3);
  });

  it("vary p: p95 interpolates between the top two values", () => {
    expect(percentile(base.values, 95)).toBeCloseTo(4.8, 10);
  });

  it("vary values: a single value is its own percentile at any p", () => {
    expect(percentile([10], 95)).toBe(10);
  });

  it("vary values: no data is 0, not NaN", () => {
    expect(percentile([], base.p)).toBe(0);
  });
});

describe("highConfidenceMisses", () => {
  const results = [
    { id: "a", score: 0.9 },
    { id: "b", score: 0.5 },
    { id: "c", score: 0.8 },
  ];
  const base = { relevant: ["a"], threshold: 0.75 };

  it("one confident, non-relevant result (base case)", () => {
    expect(highConfidenceMisses(results, base.relevant, base.threshold)).toBe(1);
  });

  it("vary threshold: raising it above every score finds no miss", () => {
    expect(highConfidenceMisses(results, base.relevant, 0.95)).toBe(0);
  });

  it("vary relevant: the confident result is actually relevant", () => {
    expect(highConfidenceMisses(results, ["a", "c"], base.threshold)).toBe(0);
  });

  it("vary results: no results means no misses", () => {
    expect(highConfidenceMisses([], base.relevant, base.threshold)).toBe(0);
  });
});
