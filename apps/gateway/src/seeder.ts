import { WORKSPACE_HEADER, WORKSPACE_SIG_HEADER, signWorkspaceHeader, type Workspace } from "@benchme/core";
import type { AppTarget } from "./app-registry.js";

/**
 * Asks every seeded app to materialise a workspace's rows. Apps own their
 * schema; the gateway only orchestrates and rolls back on any failure.
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

export class HttpWorkspaceSeeder implements WorkspaceSeeder {
  constructor(
    private readonly apps: readonly AppTarget[],
    private readonly gatewaySecret: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async seed(workspace: Workspace): Promise<void> {
    for (const app of this.apps) {
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
