import type { WorkspaceService } from "../workspace-service.js";
import type { ScenarioCard } from "./cards.js";
import type { HeroExample } from "./page.js";
import { EXAMPLE_ID, type VisualApp } from "./visual.js";

/** The scenarios the first screen prefers for its example, in order: the one with the most to show first. */
const FEATURED = ["cuj-v1", "webmcp-v1", "acme-v1"];
/** The sites the picture shows first, where the example has them: ones a reader knows at a glance, and the inbox. */
const PICTURED = ["hotels", "flights", "dining", "pizza", "cinema", "mail"];
/** How many of the answer's app addresses the excerpt shows before it says there are more. */
const SHOWN = 2;

/**
 * The first screen's example, from the scenarios this deployment mints: the first of FEATURED it mints, else the
 * first it mints at all, else none. Its command is the card's (the same body, the same seed), and its answer is an
 * excerpt of what the create call answers, the addresses written by the service itself for an example id, so it
 * names only the apps that scenario's workspaces advertise here.
 */
export function heroExample(cards: readonly ScenarioCard[], service: Pick<WorkspaceService, "urls">): HeroExample | null {
  const minted = cards.filter((c) => c.mint !== null);
  const pick = FEATURED.map((key) => minted.find((c) => c.key === key)).find((c) => c !== undefined) ?? minted[0];
  if (!pick?.mint) return null;
  const apps = Object.entries(service.urls({ id: EXAMPLE_ID, scenario: pick.key, doors: null }).apps);
  const shown = apps.slice(0, SHOWN);
  const more = apps.length - shown.length;
  // The answer's other fields (its doors, its times, the other ways in) are elided where they come: "…".
  const answer = [
    "{",
    `  "id": ${JSON.stringify(EXAMPLE_ID)},`,
    `  "scenario": ${JSON.stringify(pick.key)},`,
    ...(pick.seed === null ? [] : [`  "seed": ${pick.seed},`]),
    `  "urls": {`,
    `    "apps": {`,
    ...shown.map(([name, url], i) => `      ${JSON.stringify(name)}: ${JSON.stringify(url)}${i < shown.length - 1 || more > 0 ? "," : ""}`),
    ...(more > 0 ? [`      … ${more} more`] : []),
    "    }, …",
    "  }, …",
    "}",
  ].join("\n");
  const pictured: VisualApp[] = [...pick.sites].sort((a, b) => rank(a.key) - rank(b.key));
  return { scenario: pick.key, seed: pick.seed, id: EXAMPLE_ID, command: pick.mint, answer, apps: pictured, doors: pick.doors };
}

/** Where a site comes in the picture: PICTURED's first, in its order, then the rest in the scenario's. */
const rank = (key: string): number => {
  const at = PICTURED.indexOf(key);
  return at === -1 ? PICTURED.length : at;
};
