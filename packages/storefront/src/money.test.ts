import { describe, expect, it } from "vitest";
import { applyBp, formatUsd, sumCents } from "./money.js";

describe("money", () => {
  it("formats cents as US dollars with grouping", () => {
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(6499)).toBe("$64.99");
    expect(formatUsd(123456)).toBe("$1,234.56");
  });
  it("sums integer cents", () => expect(sumCents([199, 1, 1000])).toBe(1200));
  it("applies basis points rounding half up", () => {
    expect(applyBp(10000, 725)).toBe(725);
    expect(applyBp(6499, 863)).toBe(561); // 560.86 → 561
    expect(applyBp(100, 50)).toBe(1); // 0.5 → 1
  });
});
