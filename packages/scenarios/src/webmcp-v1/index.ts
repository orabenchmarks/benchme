import { acmeV1 } from "../acme-v1/index.js";
import type { Scenario, ScenarioRows } from "../scenario.js";
import { SITE_APPS, siteRows } from "../sites/rows.js";

/**
 * webmcp-v1: the nine sites shaped on GoogleChromeLabs/webmcp-tools — hotels,
 * flights, restaurants, pizza, cinema, a sports store, homes, clinics and
 * office events — in the six cities of the company's depots. The acme apps are
 * empty; `company` is acme-v1's of seed 1, as in shops-v1. Its workspaces
 * advertise the nine sites and the inbox their sign-up codes land in, and no
 * other scenario's workspaces advertise the sites (the gateway lists them as
 * UNLISTED_APPS).
 */
export const webmcpV1: Scenario = {
  key: "webmcp-v1",
  description:
    "Nine sites shaped on GoogleChromeLabs/webmcp-tools: hotels, flights, restaurants, pizza, cinema, a sports store, homes, clinics and office events, in six cities; the acme apps are empty",
  apps: [...SITE_APPS, "mail"],
  generate(seed: number): ScenarioRows {
    return {
      company: acmeV1.generate(1).company,
      warehouse: { products: [], locations: [], stock: [], customers: [], orders: [], orderLines: [], transfers: [] },
      helpdesk: { agents: [], tickets: [], comments: [], slaPolicies: [] },
      vault: { documents: [] },
      ...siteRows(seed),
    };
  },
};
