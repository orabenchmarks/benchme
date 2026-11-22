import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import { createApp, type Pool } from "@benchme/core";
import { UnknownScenarioError, type ScenarioRegistry } from "@benchme/scenarios";
import { AuthService, PgLedger, PgUsersRepo, registerDoors, registerMcp, registerWorkspaceScope, type Mailer } from "@benchme/site-kit";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { registerApi } from "./api/routes.js";
import { PgDiningRepo, type DiningRepo } from "./db/dining-repo.js";
import { DINING_LEDGER } from "./db/ledger.js";
import { seedDining } from "./db/seed.js";
import { diningTools } from "./mcp/tools.js";
import { SITE } from "./ui/kit.js";
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
export async function buildDining(d: BuildDeps): Promise<FastifyInstance> {
  const auth = new AuthService({
    users: new PgUsersRepo(d.pool, "dining"),
    mailer: d.mailer,
    sessionTtlSeconds: d.sessionTtlSeconds,
    tokenPrefix: "dnr",
    verification: {
      subject: `Your ${SITE} verification code`,
      body: (code) => `Welcome to ${SITE}.\n\nYour verification code is ${code}. It expires in 30 minutes.\n\nIf you did not sign up, ignore this message.`,
    },
  });

  const app = createApp({ name: "dining", readiness: async () => (await d.pool.query("SELECT 1")).rowCount === 1, ...(d.logLevel ? { logLevel: d.logLevel } : {}) });
  await app.register(cookie);
  await app.register(formbody);
  registerWorkspaceScope(app, d.gatewaySecret);
  const doors = registerDoors(app, { ledger: new PgLedger(d.pool, "dining"), auth, cookie: SESSION_COOKIE, gatewaySecret: d.gatewaySecret });
  const dining = doors.ledgered<DiningRepo>(new PgDiningRepo(d.pool), DINING_LEDGER);

  app.post<{ Params: { id: string } }>("/internal/workspaces/:id/seed", async (req, reply) => {
    if (req.params.id !== req.workspaceId) return reply.code(400).send({ error: "WORKSPACE_MISMATCH" });
    const body = z.object({ scenario: z.string().min(1), seed: z.number().int().positive() }).parse(req.body);
    try {
      const rows = d.scenarios.get(body.scenario).generate(body.seed);
      await seedDining(d.pool, req.workspaceId, rows);
      return reply.code(201).send({ ok: true, restaurants: rows.dining.restaurants.length, reservations: rows.dining.reservations.length });
    } catch (err) {
      if (err instanceof UnknownScenarioError) return reply.code(422).send({ error: "UNKNOWN_SCENARIO", message: err.message });
      throw err;
    }
  });

  const tools = diningTools();
  registerApi(app, { dining, auth });
  registerUi(app, { dining, auth, tools });
  await app.register(async (scope) => registerMcp(scope, { serverName: "benchme-dining", version: "0.1.0", tools, context: (workspaceId) => ({ workspaceId, dining }) }));
  return app;
}
