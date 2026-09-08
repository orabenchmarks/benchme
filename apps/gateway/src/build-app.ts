import { PgWorkspaceRepo, createApp, type Pool, type ReceiptSigner } from "@benchme/core";
import type { FastifyInstance } from "fastify";
import type { ScenarioRegistry } from "@benchme/scenarios";
import { AppRegistry } from "./app-registry.js";
import type { RateLimiter } from "./rate-limit.js";
import { registerPortal } from "./routes/portal.js";
import { registerProxy } from "./routes/proxy.js";
import { registerWorkspaceRoutes } from "./routes/workspaces.js";
import type { WorkspaceSeeder } from "./seeder.js";
import { WorkspaceService } from "./workspace-service.js";

export type BuildDeps = {
  pool: Pool;
  scenarios: ScenarioRegistry;
  apps: AppRegistry;
  seeder: WorkspaceSeeder;
  receipts: ReceiptSigner;
  limiter: RateLimiter;
  gatewaySecret: string;
  operatorKey: string;
  publicBaseUrl: string;
  internalBaseUrl: string;
  defaultTtlSeconds: number;
  maxTtlSeconds: number;
  logLevel?: string;
};

/** Composition root shared by server.ts and the tests (which inject a stub seeder + memory limiter). */
export async function buildGateway(d: BuildDeps): Promise<{ app: FastifyInstance; service: WorkspaceService }> {
  const service = new WorkspaceService({
    repo: new PgWorkspaceRepo(d.pool),
    pool: d.pool,
    scenarios: d.scenarios,
    apps: d.apps,
    seeder: d.seeder,
    receipts: d.receipts,
    publicBaseUrl: d.publicBaseUrl,
    internalBaseUrl: d.internalBaseUrl,
    defaultTtlSeconds: d.defaultTtlSeconds,
    maxTtlSeconds: d.maxTtlSeconds,
  });
  const app = createApp({
    name: "gateway",
    readiness: async () => (await d.pool.query("SELECT 1")).rowCount === 1,
    ...(d.logLevel ? { logLevel: d.logLevel } : {}),
  });
  // The gateway must forward ANY body byte-for-byte (form posts, MCP JSON-RPC,
  // uploads): parse JSON for its own API, hand everything else to reply-from
  // as a raw buffer instead of answering 415 for content types it never reads.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    try {
      done(null, (body as string).length ? JSON.parse(body as string) : {});
    } catch (err) {
      done(err as Error);
    }
  });
  app.addContentTypeParser("*", { parseAs: "buffer" }, (_req, body, done) => done(null, body));
  registerWorkspaceRoutes(app, { service, limiter: d.limiter, operatorKey: d.operatorKey });
  registerPortal(app, { apps: d.apps, scenarios: d.scenarios, service, publicBaseUrl: d.publicBaseUrl });
  await registerProxy(app, { apps: d.apps, service, gatewaySecret: d.gatewaySecret });
  return { app, service };
}
