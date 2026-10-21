import { acmeV1 } from "../acme-v1/index.js";
import type { Scenario, ScenarioRows } from "../scenario.js";

/**
 * guide-v1: the buyer's guide (apps/guide). The guide's pages are a pure function of the workspace's seed, which
 * names one edition of it (a category, an arm, a target product — apps/guide's edition table), so the acme apps seed
 * nothing and minting stays cheap. Its workspaces advertise the guide alone: the gateway keeps `guide` UNLISTED, so
 * no other scenario's workspace names it.
 */
export const guideV1: Scenario = {
  key: "guide-v1",
  description: "A buyer's guide to four fictional products in one category — the edition is chosen by the seed (apps/guide)",
  apps: ["guide"],
  generate(): ScenarioRows {
    return {
      company: acmeV1.generate(1).company,
      warehouse: { products: [], locations: [], stock: [], customers: [], orders: [], orderLines: [], transfers: [] },
      helpdesk: { agents: [], tickets: [], comments: [], slaPolicies: [] },
      vault: { documents: [] },
    };
  },
};
