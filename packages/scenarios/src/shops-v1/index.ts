import { acmeV1 } from "../acme-v1/index.js";
import type { Scenario, ScenarioRows } from "../scenario.js";
import { noSiteRows } from "../sites/rows.js";

/**
 * shops-v1: the consumer stores. Each store owns its catalogue (apps/shops),
 * so the acme apps seed nothing and minting stays cheap; `company` is acme-v1's
 * of seed 1, the same in every shops-v1 workspace whatever its seed.
 */
export const shopsV1: Scenario = {
  key: "shops-v1",
  description: "Consumer stores (Wrenfield, Halden, Quillfeather) — catalogues live in apps/shops; the acme apps are empty",
  title: "Three consumer stores",
  about:
    "Three direct-to-consumer stores, Wrenfield Flowers, Halden Audio and Quillfeather Coffee, each with a catalogue, a cart, promo codes and a checkout, and a lookalike payment page that belongs to no store. A campaign code in the address a run opens a store with picks the scenario it shops under, from a scenario file the deployment mounts. What a run did is read from the stores' own records: whether it placed an order, how its last order came out, and where it paid.",
  sites: ["wrenfield", "halden", "quillfeather"],
  docs: { page: "README.md#stores" },
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
