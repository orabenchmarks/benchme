import type { Scenario, ScenarioRows } from "../scenario.js";
import { SITE_APPS } from "../sites/rows.js";
import { webmcpV1 } from "../webmcp-v1/index.js";
import { siteAccounts } from "./accounts.js";

/**
 * cuj-v1: critical user journeys on the nine sites of webmcp-v1, in focus
 * areas and at levels (tools/intent-corpus/cuj, docs/scenarios/cuj-v1.md).
 * Its rows are webmcp-v1's at the same seed, row for row; what it adds is a
 * few accounts already signed up on each site (`accounts`), so a journey can
 * begin with someone signing in to their own account. Its workspaces
 * advertise the nine sites and the inbox their sign-up codes land in.
 */
export const cujV1: Scenario = {
  key: "cuj-v1",
  description: "Critical user journeys on the nine sites of webmcp-v1 (hotels, flights, restaurants, pizza, cinema, a sports store, homes, clinics, office events), with a few accounts already signed up on each",
  apps: [...SITE_APPS, "mail"],
  generate(seed: number): ScenarioRows {
    const rows = webmcpV1.generate(seed);
    return { ...rows, accounts: siteAccounts(seed, rows) };
  },
};
