import { WORKSPACE_HEADER, WORKSPACE_SIG_HEADER, signWorkspaceHeader, type Workspace } from "@benchme/core";
import type { ScenarioRegistry } from "@benchme/scenarios";
import type { AppRegistry, AppTarget } from "./app-registry.js";

/**
 * Asks the seeded apps a workspace needs to materialise its rows. Apps own
 * their schema; the gateway only orchestrates and rolls back on any failure.
 */
export interface WorkspaceSeeder {
  seed(workspace: Workspace): Promise<void>;
}

export class SeedFailedError extends Error {
  constructor(
    readonly app: string,
    readonly status: number,
    body: string,
  ) {
    super(`seeding ${app} failed with ${status}: ${body.slice(0, 300)}`);
    this.name = "SeedFailedError";
  }
}

/** The apps to seed for one workspace. */
export type SeedTargets = (workspace: Pick<Workspace, "scenario">) => readonly AppTarget[];

/**
 * A workspace is seeded in the apps its scenario needs (`AppRegistry.seededFor`): a listed app for every scenario, an
 * unlisted one only for the scenarios that name it. Seeding every app for every scenario made each unlisted site a
 * dependency of every workspace: one of them down, or not yet migrated, failed every creation with SEED_FAILED.
 */
export const seedTargetsFor =
  (apps: AppRegistry, scenarios: ScenarioRegistry): SeedTargets =>
  (workspace) =>
    apps.seededFor(scenarios.has(workspace.scenario) ? scenarios.get(workspace.scenario).apps : undefined);

export class HttpWorkspaceSeeder implements WorkspaceSeeder {
  constructor(
    private readonly targets: SeedTargets,
    private readonly gatewaySecret: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async seed(workspace: Workspace): Promise<void> {
    for (const app of this.targets(workspace)) {
      const res = await this.fetchImpl(`${app.baseUrl}/internal/workspaces/${workspace.id}/seed`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [WORKSPACE_HEADER]: workspace.id,
          [WORKSPACE_SIG_HEADER]: signWorkspaceHeader(this.gatewaySecret, workspace.id),
        },
        body: JSON.stringify({ scenario: workspace.scenario, seed: workspace.seed }),
      });
      if (!res.ok) throw new SeedFailedError(app.name, res.status, await res.text().catch(() => ""));
    }
  }
}
