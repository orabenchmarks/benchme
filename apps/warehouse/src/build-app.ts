import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import { createApp, type Pool } from "@benchme/core";
import type { ScenarioRegistry } from "@benchme/scenarios";
import { AuthService, PgUsersRepo, registerMcp, registerWorkspaceScope, type Mailer } from "@benchme/site-kit";
import type { FastifyInstance } from "fastify";
import { registerApi } from "./api/routes.js";
import { PgCatalogRepo } from "./db/catalog-repo.js";
import { PgOrdersRepo } from "./db/orders-repo.js";
import { registerSeedRoute } from "./internal/seed-route.js";
import { warehouseTools } from "./mcp/tools.js";
import { registerUi } from "./ui/routes.js";

export type BuildDeps = { pool: Pool; scenarios: ScenarioRegistry; mailer: Mailer; gatewaySecret: string; sessionTtlSeconds: number; logLevel?: string };

/** Composition root: repos → services → routes. Tests inject a capturing mailer. */
export async function buildWarehouse(d: BuildDeps): Promise<FastifyInstance> {
  const catalog = new PgCatalogRepo(d.pool);
  const orders = new PgOrdersRepo(d.pool);
  const auth = new AuthService({
    users: new PgUsersRepo(d.pool, "warehouse"),
    mailer: d.mailer,
    sessionTtlSeconds: d.sessionTtlSeconds,
    tokenPrefix: "whk",
    verification: {
      subject: "Your warehouse verification code",
      body: (code) => `Welcome to the warehouse portal.\n\nYour verification code is ${code}. It expires in 30 minutes.\n\nIf you did not sign up, ignore this message.`,
    },
  });

  const app = createApp({ name: "warehouse", readiness: async () => (await d.pool.query("SELECT 1")).rowCount === 1, ...(d.logLevel ? { logLevel: d.logLevel } : {}) });
  await app.register(cookie);
  await app.register(formbody);
  registerWorkspaceScope(app, d.gatewaySecret);
  registerSeedRoute(app, d.pool, d.scenarios);
  registerApi(app, { catalog, orders, auth });
  registerUi(app, { catalog, orders, auth });
  // MCP lives in its own plugin scope: it replaces the content-type parsers for /mcp only.
  await app.register(async (scope) =>
    registerMcp(scope, { serverName: "benchme-warehouse", version: "0.1.0", tools: warehouseTools(), context: (workspaceId) => ({ workspaceId, catalog, orders }) }),
  );
  return app;
}
