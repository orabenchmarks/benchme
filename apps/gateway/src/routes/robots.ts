import type { FastifyInstance } from "fastify";
import type { ScenarioRegistry } from "@benchme/scenarios";
import type { AppRegistry } from "../app-registry.js";

export type RobotsDeps = { apps: AppRegistry; scenarios: ScenarioRegistry; publicBaseUrl: string; sharedSeed: number };

/**
 * Host-root /robots.txt. Every minted workspace is per-run and disposable, so
 * the whole /w/ tree is disallowed — except a `schemamap:` line per
 * ask-capable app, pointing at its NLWeb schema map on the ONE long-lived
 * SHARED workspace (`shared-<scenario>-<seed>`, see workspace-service.ts
 * resolveShared) so answer engines have a stable, crawlable URL to learn from.
 */
export function registerRobots(app: FastifyInstance, d: RobotsDeps): void {
  app.get("/robots.txt", async (_req, reply) => {
    const root = d.publicBaseUrl.replace(/\/+$/, "");
    const scenario = d.scenarios.list()[0]?.key;
    const lines = ["User-agent: *", "Disallow: /w/"];
    if (scenario) {
      for (const a of d.apps.ask()) {
        lines.push(`schemamap: ${root}/w/shared-${scenario}-${d.sharedSeed}/${a.name}/schema/map.xml`);
      }
    }
    return reply.type("text/plain").send(`${lines.join("\n")}\n`);
  });
}
