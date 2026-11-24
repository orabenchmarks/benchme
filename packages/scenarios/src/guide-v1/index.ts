import { acmeV1 } from "../acme-v1/index.js";
import type { Scenario, ScenarioRows } from "../scenario.js";
import { noSiteRows } from "../sites/rows.js";

/**
 * guide-v1: the buyer's guide (apps/guide). The guide's pages are a pure function of the workspace's seed, which
 * names one edition of it (a category, an arm, a target product — apps/guide's edition table), so the acme apps seed
 * nothing and minting stays cheap. Its workspaces advertise the guide alone: the gateway keeps `guide` UNLISTED, so
 * no other scenario's workspace names it.
 */
export const guideV1: Scenario = {
  key: "guide-v1",
  description: "A buyer's guide to four products in one category — the edition is chosen by the seed (apps/guide)",
  title: "A buyer's guide",
  about:
    "Shortlist, a buyer's guide to four products in one category, with a spec sheet for each and a journal of articles about them. The seed picks one edition: the category, a target product, and an arm that decides which articles the guide serves about the target and how a run reaches them. It is made to study whether what an agent reads changes what it recommends, and it records every page each workspace is served.",
  docs: { page: "README.md#guide" },
  apps: ["guide"],
  generate(): ScenarioRows {
    return {
      company: acmeV1.generate(1).company,
      warehouse: { products: [], locations: [], stock: [], customers: [], orders: [], orderLines: [], transfers: [] },
      helpdesk: { agents: [], tickets: [], comments: [], slaPolicies: [] },
      vault: { documents: [] },
      ...noSiteRows(),
    };
  },
};
