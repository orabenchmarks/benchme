import type { DoorSet } from "@benchme/core";
import { appInfo, type ScenarioRegistry } from "@benchme/scenarios";
import type { AppRegistry } from "../app-registry.js";
import type { WorkspaceService } from "../workspace-service.js";
import { scenarioCards } from "./cards.js";
import { heroExample } from "./hero.js";
import type { LandingView } from "./page.js";

export type PortalViewDeps = {
  apps: AppRegistry;
  scenarios: ScenarioRegistry;
  service: Pick<WorkspaceService, "validate" | "urls">;
  /** The deployment's doors. */
  doors: DoorSet;
  publicBaseUrl: string;
  /** Whether the registry has anything behind an open door to list (the bar links it only then). */
  registry: boolean;
};

export type PortalViews = { landing: LandingView };

/**
 * What the front page shows, computed once: a deployment's doors and apps do not change while it runs, so only the
 * search a person opens the page with is read per request.
 */
export function portalViews(d: PortalViewDeps): PortalViews {
  const cards = scenarioCards({ scenarios: d.scenarios, apps: d.apps, service: d.service, doors: d.doors, publicBaseUrl: d.publicBaseUrl });
  const landing: LandingView = {
    cards,
    apps: d.apps.listed().map((a) => ({ key: a.name, name: appInfo(a.name).name, seeded: a.seeded, mcp: a.mcp })),
    doors: d.doors.list(),
    registry: d.registry,
    publicBaseUrl: d.publicBaseUrl,
    hero: heroExample(cards, d.service),
  };
  return { landing };
}
