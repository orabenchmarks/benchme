import { describe, expect, it } from "vitest";
import { acmeV1 } from "../acme-v1/index.js";
import { scenarios, shopsV1 } from "../index.js";

describe("shops-v1", () => {
  it("is registered in the default registry", () => {
    expect(scenarios.get("shops-v1")).toBe(shopsV1);
  });

  it("seeds nothing into the acme apps: the stores own their catalogues", () => {
    const rows = scenarios.get("shops-v1").generate(4242);
    expect(rows.warehouse).toEqual({ products: [], locations: [], stock: [], customers: [], orders: [], orderLines: [], transfers: [] });
    expect(rows.helpdesk).toEqual({ agents: [], tickets: [], comments: [], slaPolicies: [] });
    expect(rows.vault).toEqual({ documents: [] });
  });

  it("carries the acme company of seed 1, whatever its own seed", () => {
    expect(shopsV1.generate(4242).company).toEqual(acmeV1.generate(1).company);
  });

  it("is byte-identical for the same seed", () => {
    expect(JSON.stringify(shopsV1.generate(1))).toBe(JSON.stringify(shopsV1.generate(1)));
  });
});
