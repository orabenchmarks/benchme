import { describe, expect, it } from "vitest";
import { normalizeZip, stateForZip, taxCents, zipMatchesState, US_STATES } from "./tax.js";

describe("tax", () => {
  it("normalises ZIP and ZIP+4 with stray spaces", () => {
    expect(normalizeZip(" 94107-1234 ")).toBe("94107");
    expect(normalizeZip("02139")).toBe("02139");
    expect(normalizeZip("9410")).toBeNull();
    expect(normalizeZip("ABCDE")).toBeNull();
  });
  it("maps ZIP prefixes to states", () => {
    expect(stateForZip("94107")).toBe("CA");
    expect(stateForZip("10001")).toBe("NY");
    expect(stateForZip("02139")).toBe("MA");
    expect(stateForZip("78701")).toBe("TX");
    expect(stateForZip("98101")).toBe("WA");
    expect(stateForZip("00001")).toBeNull();
  });
  it("checks a ZIP against a state", () => {
    expect(zipMatchesState("94107", "CA")).toBe(true);
    expect(zipMatchesState("94107", "NY")).toBe(false);
  });
  it("taxes by state, zero where there is no sales tax", () => {
    expect(taxCents(10000, "CA")).toBe(725);
    expect(taxCents(10000, "OR")).toBe(0);
  });
  it("lists every state with a rate", () => {
    expect(US_STATES).toHaveLength(51);
    for (const s of US_STATES) expect(taxCents(10000, s.code)).toBeGreaterThanOrEqual(0);
  });
});
