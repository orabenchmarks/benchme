import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import { createApp, transactions, type Pool } from "@benchme/core";
import { UnknownScenarioError, type ScenarioRegistry } from "@benchme/scenarios";
import { AuthService, PgLedger, PgUsersRepo, registerDoors, registerMcp, registerWorkspaceScope, seedAccounts, type Mailer } from "@benchme/site-kit";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { registerApi } from "./api/routes.js";
import { PgCatalogRepo, type CatalogRepo } from "./db/catalog-repo.js";
import { CATALOG_LEDGER, ORDERS_LEDGER } from "./db/ledger.js";
import { PgOrdersRepo, type OrdersRepo } from "./db/orders-repo.js";
import { seedSports } from "./db/seed.js";
import { sportsTools } from "./mcp/tools.js";
import { SESSION_COOKIE, registerUi } from "./ui/routes.js";

export type BuildDeps = {
  pool: Pool;
  scenarios: ScenarioRegistry;
  mailer: Mailer;
  gatewaySecret: string;
  sessionTtlSeconds: number;
  logLevel?: string;
};

/** Composition root: repos → services → routes. */
export async function buildSports(d: BuildDeps): Promise<FastifyInstance> {
  // One transaction for a write and its ledger entry: the repositories, the accounts and the ledger share its pool.
  const db = transactions(d.pool);
  const accounts = new AuthService({
    users: new PgUsersRepo(db.pool, "sports"),
    mailer: d.mailer,
    sessionTtlSeconds: d.sessionTtlSeconds,
    tokenPrefix: "spt",
    verification: {
      subject: "Your Brackenford Sports verification code",
      body: (code) => `Welcome to Brackenford Sports.\n\nYour verification code is ${code}. It expires in 30 minutes.\n\nIf you did not sign up, ignore this message.`,
    },
  });

  const app = createApp({ name: "sports", readiness: async () => (await d.pool.query("SELECT 1")).rowCount === 1, ...(d.logLevel ? { logLevel: d.logLevel } : {}) });
  await app.register(cookie);
  await app.register(formbody);
  registerWorkspaceScope(app, d.gatewaySecret);
  const doors = registerDoors(app, { ledger: new PgLedger(db, "sports"), transactions: db, auth: accounts, cookie: SESSION_COOKIE, gatewaySecret: d.gatewaySecret });
  const auth = doors.auth;
  const catalog = doors.ledgered<CatalogRepo>(new PgCatalogRepo(db.pool), CATALOG_LEDGER);
  const orders = doors.ledgered<OrdersRepo>(new PgOrdersRepo(db.pool), ORDERS_LEDGER);

  app.post<{ Params: { id: string } }>("/internal/workspaces/:id/seed", async (req, reply) => {
    if (req.params.id !== req.workspaceId) return reply.code(400).send({ error: "WORKSPACE_MISMATCH" });
    const body = z.object({ scenario: z.string().min(1), seed: z.number().int().positive() }).parse(req.body);
    try {
      const rows = d.scenarios.get(body.scenario).generate(body.seed);
      await seedSports(d.pool, req.workspaceId, rows);
      await seedAccounts(d.pool, "sports", req.workspaceId, rows.accounts?.sports ?? []);
      return reply.code(201).send({ ok: true, products: rows.sports.products.length, variants: rows.sports.variants.length, orders: rows.sports.orders.length });
    } catch (err) {
      if (err instanceof UnknownScenarioError) return reply.code(422).send({ error: "UNKNOWN_SCENARIO", message: err.message });
      throw err;
    }
  });

  const tools = doors.withSignIn(sportsTools());
  registerApi(app, { catalog, orders });
  registerUi(app, { catalog, orders, auth, tools });
  await app.register(async (scope) => registerMcp(scope, { serverName: "benchme-sports", version: "0.1.0", tools, context: (workspaceId) => ({ workspaceId, catalog, orders }), sessions: true }));
  return app;
}
