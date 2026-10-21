import { acmeV1 } from "../acme-v1/index.js";
import type { Scenario, ScenarioRows } from "../scenario.js";

/**
 * web-v1: the site network (apps/guide, under /web) — a start page listing four fictional products of one category,
 * each product's own site, and a chain of recommendation sites. Its pages are a pure function of the workspace's seed,
 * which names one edition (a category, an arm, a target product — apps/guide's network edition table), so the acme
 * apps seed nothing and minting stays cheap. Its workspaces advertise the network alone: the gateway keeps `web`
 * UNLISTED, so no other scenario's workspace names it.
 */
export const webV1: Scenario = {
  key: "web-v1",
  description: "A small web of sites about four fictional products in one category — the edition is chosen by the seed (apps/guide, /web)",
  apps: ["web"],
  generate(): ScenarioRows {
    return {
      company: acmeV1.generate(1).company,
      warehouse: { products: [], locations: [], stock: [], customers: [], orders: [], orderLines: [], transfers: [] },
      helpdesk: { agents: [], tickets: [], comments: [], slaPolicies: [] },
      vault: { documents: [] },
    };
  },
};
