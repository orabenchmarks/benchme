import type { FastifyInstance } from "fastify";
import type { ScenarioRegistry } from "@benchme/scenarios";
import type { AppRegistry } from "../app-registry.js";

export type RobotsDeps = { apps: AppRegistry; scenarios: ScenarioRegistry; publicBaseUrl: string; sharedSeed: number };

/**
 * Host-root /robots.txt: every path may be fetched (`Allow: /`) — the stores' pages and their checkouts included, so
 * an agent that honours robots.txt on a shopper's behalf meets no directive against buying, the same for every way
 * it is given to pay — plus a `schemamap:` line per listed ask-capable app, pointing at its NLWeb schema map on the
 * ONE long-lived SHARED workspace (`shared-<scenario>-<seed>`, see workspace-service.ts resolveShared), so answer
 * engines have a stable URL to learn from. Fetching is not indexing: every per-run page stays out of search indexes
 * by its own `noindex` (the stores' meta tag and X-Robots-Tag), as the static `data` site already does.
 */
export function registerRobots(app: FastifyInstance, d: RobotsDeps): void {
  app.get("/robots.txt", async (_req, reply) => {
    const root = d.publicBaseUrl.replace(/\/+$/, "");
    const scenario = d.scenarios.list()[0]?.key;
    const lines = ["User-agent: *", "Allow: /"];
    if (scenario) {
      for (const a of d.apps.ask().filter((x) => x.listed)) lines.push(`schemamap: ${root}/w/shared-${scenario}-${d.sharedSeed}/${a.name}/schema/map.xml`);
    }
    return reply.type("text/plain").send(`${lines.join("\n")}\n`);
  });
}
