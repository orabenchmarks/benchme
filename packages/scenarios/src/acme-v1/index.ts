import { minstd } from "../prng.js";
import type { Scenario, ScenarioRows } from "../scenario.js";
import { noSiteRows } from "../sites/rows.js";
import { city, companyName } from "./names.js";
import { documents } from "./documents.js";
import { agents, slaPolicies, tickets } from "./helpdesk.js";
import { customers, locations, orders, products, stock, transfers } from "./warehouse.js";

/**
 * acme-v1: a small industrial-supply company. Sizes are fixed so tasks can
 * assume them; every value is derived from the seed through ONE rng stream in a
 * fixed order (changing that order changes every downstream fixture — bump the
 * scenario key instead). The sites from webmcp-tools are not part of it: they
 * are webmcp-v1's, and an acme-v1 workspace seeds them empty.
 */
export const ACME_V1_SIZES = { products: 120, customers: 40, orders: 300, transfers: 60, agents: 8, tickets: 150 } as const;

export const acmeV1: Scenario = {
  key: "acme-v1",
  description: "Industrial-supply company: 120 products across 4 depots, 40 customers, 300 orders, 60 transfers, a helpdesk with 8 agents and 150 tickets, a document vault of ~40 documents.",
  title: "An industrial-supply company",
  about:
    "A small industrial-supply company and the apps it runs on: a warehouse (products, stock in four depots, customers, orders, transfers), a helpdesk (tickets, agents, SLAs), a document vault and the company's public site. Its tasks are what a person types into those apps: find what is in stock, cancel an order, move stock between depots, reassign or close a ticket, quote a policy. A task that changes something is checked afterwards by what the apps hold, and one that asks for an answer by its answer document.",
  sites: ["warehouse", "helpdesk", "vaultdocs", "data", "mail"],
  docs: {
    page: "compose/specs/README.md#the-intent-corpus-intent-json",
    corpus: { tasks: 163, seed: 4242, public: "compose/specs/intent-tasks.json", keyed: "compose/specs/intent-corpus.json", derivations: "compose/specs/intent-tasks.md" },
  },
  generate(seed: number): ScenarioRows {
    const rng = minstd(seed);
    const company = {
      name: companyName(rng),
      founded: 1987 + Math.floor(rng() * 25),
      headquarters: city(rng),
      employees: 140 + Math.floor(rng() * 900),
      fiscalYearRevenueCents: (12_000_000 + Math.floor(rng() * 80_000_000)) * 100,
    };
    const items = products(rng, ACME_V1_SIZES.products);
    const sites = locations(rng);
    const stockRows = stock(rng, items, sites);
    const custs = customers(rng, ACME_V1_SIZES.customers);
    const { orders: orderRows, lines } = orders(rng, ACME_V1_SIZES.orders, custs, items);
    const transferRows = transfers(rng, ACME_V1_SIZES.transfers, stockRows);
    const ag = agents(rng);
    const hd = tickets(
      rng,
      ACME_V1_SIZES.tickets,
      ag,
      custs.map((c) => c.code),
      orderRows.map((o) => o.orderNo),
      items.map((p) => p.sku),
      transferRows.map((t) => t.transferNo),
    );
    const docs = documents(rng, { company, products: items, locations: sites, customers: custs, sla: slaPolicies() });
    return {
      company,
      warehouse: { products: items, locations: sites, stock: stockRows, customers: custs, orders: orderRows, orderLines: lines, transfers: transferRows },
      helpdesk: { agents: ag, tickets: hd.tickets, comments: hd.comments, slaPolicies: slaPolicies() },
      vault: { documents: docs },
      ...noSiteRows(),
    };
  },
};
