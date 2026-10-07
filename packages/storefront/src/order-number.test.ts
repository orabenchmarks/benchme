import { describe, expect, it } from "vitest";
import { OUTCOME_CLASSES } from "./outcome.js";
import { newOrderNumber, parseOrderNumber, suffixTable } from "./order-number.js";

describe("order numbers", () => {
  it("gives every class of a scenario a distinct two-character suffix, stable per key", () => {
    const t = suffixTable("k".repeat(32), "fixture-a");
    expect(new Set(OUTCOME_CLASSES.map((c) => t[c])).size).toBe(OUTCOME_CLASSES.length);
    for (const c of OUTCOME_CLASSES) expect(t[c]).toMatch(/^[0-9A-HJKMNP-TV-Z]{2}$/);
    expect(suffixTable("k".repeat(32), "fixture-a")).toEqual(t);
    expect(suffixTable("j".repeat(32), "fixture-a")).not.toEqual(t);
  });
  it("differs across scenarios under one key", () => {
    expect(suffixTable("k".repeat(32), "fixture-a")).not.toEqual(suffixTable("k".repeat(32), "fixture-b"));
  });
  it("formats and parses", () => {
    const n = newOrderNumber("QF", "K7", () => 0.482913); // floor(0.482913 × 900000) + 100000
    expect(n).toBe("QF-534621-K7");
    expect(parseOrderNumber(n)).toEqual({ prefix: "QF", digits: "534621", suffix: "K7" });
    expect(parseOrderNumber("QF-1-K7")).toBeNull();
    expect(newOrderNumber("WF", "AB", () => 0.999999)).toMatch(/^WF-\d{6}-AB$/);
  });
});
