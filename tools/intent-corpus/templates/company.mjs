/**
 * Company-site intent templates: facts from the company's public website
 * (the `data` app) — json only; the site is static.
 *
 * The site is built ONCE, at image build time, from its own seed
 * (DEFAULT_DATA_SEED, or DATA_SEED when the image was built with one) — the
 * same pages for every workspace, whatever the workspace's own seed. So these
 * answers are derived from THAT seed's company, never the corpus seed's (the
 * vault's memos describe the workspace's company; the two need not agree).
 */
import { acmeV1 } from "../../../packages/scenarios/dist/index.js";
import { DEFAULT_DATA_SEED } from "../../../apps/data/dist/site.js";
import { numberIn } from "../kit.mjs";

const site = acmeV1.generate(DEFAULT_DATA_SEED);
const cellOf = (html, header) => new RegExp(`<th>${header}</th><td>([^<]+)</td>`).exec(html)?.[1];

const FACTS = [
  { key: "founded", field: "year", value: site.company.founded, intent: "in what year was the company founded?", read: async (api) => Number(cellOf(await api.text("data", "/about.html"), "Founded")) },
  { key: "headquarters", field: "city", value: site.company.headquarters, intent: "in which city is the company headquartered?", read: async (api) => cellOf(await api.text("data", "/about.html"), "Headquarters") },
  { key: "employees", field: "employees", value: site.company.employees, intent: "how many employees does the company have?", read: async (api) => Number(cellOf(await api.text("data", "/about.html"), "Employees")) },
  { key: "depots", field: "depots", value: site.warehouse.locations.length, intent: "how many depots does the company operate?", read: async (api) => Number(cellOf(await api.text("data", "/about.html"), "Depots")) },
  { key: "customers", field: "customers", value: site.warehouse.customers.length, intent: "how many customers does the company serve?", read: async (api) => Number(cellOf(await api.text("data", "/about.html"), "Customers")) },
  {
    key: "revenue",
    field: "revenue",
    value: { value: site.company.fiscalYearRevenueCents / 100, tolerance: 0.5 },
    intent: "what was the company's total revenue for FY2025, in US dollars, according to its annual report?",
    read: async (api) => numberIn(await api.text("data", "/reports/annual-report.html"), /Total revenue: <strong>\$([\d,.]+)<\/strong>/),
  },
];

export const companyTemplates = [
  {
    key: "company",
    app: "data",
    oracle: "json",
    // Static pages only: the data site has no tools and no /ask index.
    surfaces: ["pages"],
    count: 5,
    about: `A fact from the company's public website — its about page and FY2025 annual report — derived from the seed the site is built from (${DEFAULT_DATA_SEED}), not the workspace's.`,
    candidates: () => FACTS,
    claims: (f) => [`company-read:${f.key}`],
    build(f) {
      const shown = typeof f.value === "object" ? f.value.value : f.value;
      return {
        intent: `According to the company's public website, ${f.intent} Answer as JSON: {"${f.field}": ${typeof shown === "number" ? "<number>" : '"<text>"'}}.`,
        summary: `The company's ${f.key}, as its public site states it.`,
        oracle: { kind: "json", expect: { [f.field]: f.value } },
        note: `${f.key} → ${shown}`,
        answer: async (api) => ({ [f.field]: await f.read(api) }),
      };
    },
  },
];
