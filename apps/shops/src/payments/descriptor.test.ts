import { describe, expect, it } from "vitest";
import { STORES } from "../stores/index.js";
import { MAX_DESCRIPTOR_LENGTH, statementDescriptor } from "./descriptor.js";

/** What the buyer's card statement calls each store (Stripe's statement_descriptor_suffix). */
describe("statementDescriptor", () => {
  it("names each store by its brand, short enough for Stripe's 22 characters after the account's prefix", () => {
    expect(statementDescriptor(STORES.wrenfield!.brand.name)).toBe("WRENFIELD");
    expect(statementDescriptor(STORES.halden!.brand.name)).toBe("HALDEN AUDIO");
    expect(statementDescriptor(STORES.quillfeather!.brand.name)).toBe("QUILLFEATHER");
    // "STRIPE* " (the test-mode prefix; the account's own is no longer) plus the descriptor fits in 22.
    expect(MAX_DESCRIPTOR_LENGTH).toBeLessThanOrEqual(22 - "STRIPE* ".length);
  });

  it("keeps to what Stripe accepts: letters first, no <>\\'\"*, never only digits, never longer than the limit", () => {
    expect(statementDescriptor("Fixture & Co")).toBe("FIXTURE & CO");
    expect(statementDescriptor("Fixture & Company")).toBe("FIXTURE");
    expect(statementDescriptor(`Ma"ple <Store> *Shop's`)).toBe("MAPLE STORE");
    expect(statementDescriptor("Supercalifragilisticexpialidocious Coffee")).toBe("SUPERCALIFRA");
    expect(statementDescriptor("  ")).toBe("SHOP");
    expect(statementDescriptor("1234")).toBe("SHOP 1234");
    for (const name of ["Wrenfield Flowers", "A very long store name with many words", "Été Fleurs"]) {
      const d = statementDescriptor(name);
      expect(d.length, d).toBeLessThanOrEqual(MAX_DESCRIPTOR_LENGTH);
      expect(d, d).toMatch(/[A-Z]/);
      expect(d, d).not.toMatch(/[<>\\'"*]/);
    }
  });
});
