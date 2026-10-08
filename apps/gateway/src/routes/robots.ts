import type { FastifyInstance } from "fastify";
import type { ScenarioRegistry } from "@benchme/scenarios";
import type { AppRegistry } from "../app-registry.js";

export type RobotsDeps = { apps: AppRegistry; scenarios: ScenarioRegistry; publicBaseUrl: string; sharedSeed: number };

/**
 * The crawlers that gather pages to train a model or build an index, by the product token each documents. They honour a
 * robots.txt `Disallow`, and most never read a page's `noindex`, so the per-run tree is closed to them here: a per-run URL
 * that leaks (a published trajectory, within the workspace's lifetime) never becomes training or index material. Agents
 * fetching on a person's behalf use other tokens (or a browser's) and fall under `User-agent: *`.
 */
export const TRAINING_CRAWLERS = ["GPTBot", "ClaudeBot", "anthropic-ai", "CCBot", "Google-Extended", "Applebot-Extended", "PerplexityBot", "Bytespider", "meta-externalagent"] as const;

/**
 * Host-root /robots.txt, two groups. Everyone (`User-agent: *`) may fetch every path (`Allow: /`) — the stores' pages
 * and their checkouts included — so an agent that honours robots.txt on a shopper's behalf meets no directive against
 * buying, the same for every way it is given to pay. The training crawlers (TRAINING_CRAWLERS) may not fetch the per-run
 * `/w/` tree, except each listed ask-capable app's schema on the ONE long-lived SHARED workspace
 * (`shared-<scenario>-<seed>`, see workspace-service.ts resolveShared), which a `schemamap:` line per app advertises so
 * answer engines have a stable URL to learn from. Every per-run response also carries `X-Robots-Tag: noindex, nofollow`
 * (routes/proxy.ts), whatever app answers it.
 */
export function registerRobots(app: FastifyInstance, d: RobotsDeps): void {
  app.get("/robots.txt", async (_req, reply) => {
    const root = d.publicBaseUrl.replace(/\/+$/, "");
    const scenario = d.scenarios.list()[0]?.key;
    const shared = scenario ? d.apps.ask().filter((x) => x.listed).map((a) => `/w/shared-${scenario}-${d.sharedSeed}/${a.name}`) : [];
    const training = [...TRAINING_CRAWLERS.map((bot) => `User-agent: ${bot}`), "Disallow: /w/", ...shared.map((p) => `Allow: ${p}/schema/`)];
    const everyone = ["User-agent: *", "Allow: /"];
    const maps = shared.map((p) => `schemamap: ${root}${p}/schema/map.xml`);
    return reply.type("text/plain").send([training, everyone, maps].filter((g) => g.length).map((g) => `${g.join("\n")}\n`).join("\n"));
  });
}
