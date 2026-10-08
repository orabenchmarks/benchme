import { acmeV1 } from "../acme-v1/index.js";
import type { Scenario, ScenarioRows } from "../scenario.js";

/**
 * shops-v1: the consumer stores. Each store owns its catalogue (apps/shops),
 * so the acme apps seed nothing and minting stays cheap; `company` is acme-v1's
 * of seed 1, the same in every shops-v1 workspace whatever its seed.
 */
export const shopsV1: Scenario = {
  key: "shops-v1",
  description: "Consumer stores (Wrenfield, Halden, Quillfeather) — catalogues live in apps/shops; the acme apps are empty",
  generate(): ScenarioRows {
    return {
      company: acmeV1.generate(1).company,
      warehouse: { products: [], locations: [], stock: [], customers: [], orders: [], orderLines: [], transfers: [] },
      helpdesk: { agents: [], tickets: [], comments: [], slaPolicies: [] },
      vault: { documents: [] },
    };
  },
};
