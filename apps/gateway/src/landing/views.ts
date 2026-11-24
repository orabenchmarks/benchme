import type { DoorSet } from "@benchme/core";
import { appInfo, type ScenarioRegistry } from "@benchme/scenarios";
import type { AppRegistry } from "../app-registry.js";
import type { WorkspaceService } from "../workspace-service.js";
import { scenarioCards, type ScenarioCard } from "./cards.js";
import { heroExample } from "./hero.js";
import type { LandingView } from "./page.js";
import type { ScenarioPageView } from "./scenario-page.js";
import type { ITaskLists } from "./task-lists.js";

export type PortalViewDeps = {
  apps: AppRegistry;
  scenarios: ScenarioRegistry;
  service: Pick<WorkspaceService, "validate" | "urls">;
  /** The deployment's doors. */
  doors: DoorSet;
  publicBaseUrl: string;
  /** The public task lists this deployment carries. */
  lists: ITaskLists;
  /** Whether the registry has anything behind an open door to list (the bar links it only then). */
  registry: boolean;
};

export type PortalViews = { landing: LandingView; scenarios: ReadonlyMap<string, ScenarioPageView> };

/**
 * What the front page and every scenario's page show, computed once: a deployment's doors, apps and task lists do
 * not change while it runs, so only the search a person opens a page with is read per request.
 */
export function portalViews(d: PortalViewDeps): PortalViews {
  const cards = scenarioCards({ scenarios: d.scenarios, apps: d.apps, service: d.service, doors: d.doors, publicBaseUrl: d.publicBaseUrl, lists: d.lists });
  const landing: LandingView = {
    cards,
    apps: d.apps.listed().map((a) => ({ key: a.name, name: appInfo(a.name).name, seeded: a.seeded, mcp: a.mcp })),
    doors: d.doors.list(),
    registry: d.registry,
    publicBaseUrl: d.publicBaseUrl,
    hero: heroExample(cards, d.service),
  };
  return { landing, scenarios: new Map(cards.map((c) => [c.key, scenarioView(c, d)])) };
}

function scenarioView(c: ScenarioCard, d: PortalViewDeps): ScenarioPageView {
  const s = d.scenarios.get(c.key);
  return {
    key: c.key,
    title: c.title,
    about: c.about,
    links: c.links,
    sites: c.sites,
    missing: c.missing,
    doors: c.doors,
    mint: c.mint,
    tasks: d.lists.listOf(s),
    corpusTasks: s.docs.corpus?.tasks ?? null,
    registry: d.registry,
  };
}
