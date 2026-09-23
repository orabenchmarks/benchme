import type { FastifyInstance } from "fastify";
import type { ScenarioRegistry } from "@benchme/scenarios";
import type { AppRegistry } from "../app-registry.js";

export type RobotsDeps = { apps: AppRegistry; scenarios: ScenarioRegistry; publicBaseUrl: string; sharedSeed: number };

/**
 * Host-root /robots.txt. Every minted workspace is per-run and disposable, so
 * the whole /w/ tree is disallowed — except an `Allow:` + `schemamap:` pair per
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
      // A blanket `Disallow: /w/` would also forbid the very schema maps the
      // `schemamap:` lines below advertise. Re-allow each ask app's /schema/
      // path on the shared workspace: robots.txt is LONGEST-MATCH, so the
      // narrower Allow wins over the broad Disallow for well-behaved crawlers.
      for (const a of d.apps.ask()) {
        const shared = `/w/shared-${scenario}-${d.sharedSeed}/${a.name}`;
        lines.push(`Allow: ${shared}/schema/`, `schemamap: ${root}${shared}/schema/map.xml`);
      }
    }
    return reply.type("text/plain").send(`${lines.join("\n")}\n`);
  });
}
