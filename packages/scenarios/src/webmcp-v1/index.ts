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
  title: "Nine everyday sites",
  about:
    "Nine sites an agent uses on someone's behalf: hotels, flights, restaurants, pizza, cinema, a sports store, homes, clinics and office events, shaped on the GoogleChromeLabs/webmcp-tools demos. Its tasks are errands of six kinds on each site, such as the only option that fits, none that fits and the closest, a total with fees, a booking, and changing or cancelling one of several. An answer is checked against its key and a change against the sites' rows and change ledger; every write asks for a signed-in account, through every door.",
  docs: {
    page: "README.md#sites-from-webmcp-tools",
    corpus: { tasks: 162, seed: 4242, public: "compose/specs/webmcp-tasks.json", keyed: "compose/specs/webmcp-corpus.json", derivations: "compose/specs/webmcp-tasks.md" },
  },
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
