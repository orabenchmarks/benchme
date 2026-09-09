import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import { createApp, type Pool } from "@benchme/core";
import { UnknownScenarioError, type ScenarioRegistry } from "@benchme/scenarios";
import { AuthService, PgUsersRepo, registerMcp, registerWorkspaceScope, type Mailer } from "@benchme/site-kit";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { registerApi } from "./api/routes.js";
import { seedHelpdesk } from "./db/seed.js";
import { PgTicketsRepo } from "./db/tickets-repo.js";
import { helpdeskTools } from "./mcp/tools.js";
import { registerUi } from "./ui/routes.js";

export type BuildDeps = { pool: Pool; scenarios: ScenarioRegistry; mailer: Mailer; gatewaySecret: string; sessionTtlSeconds: number; logLevel?: string };

/** Composition root: repos → services → routes. */
export async function buildHelpdesk(d: BuildDeps): Promise<FastifyInstance> {
  const tickets = new PgTicketsRepo(d.pool);
  const auth = new AuthService({
    users: new PgUsersRepo(d.pool, "helpdesk"),
    mailer: d.mailer,
    sessionTtlSeconds: d.sessionTtlSeconds,
    tokenPrefix: "hdk",
    verification: {
      subject: "Your helpdesk verification code",
      body: (code) => `Welcome to the helpdesk.\n\nYour verification code is ${code}. It expires in 30 minutes.\n\nIf you did not sign up, ignore this message.`,
    },
  });

  const app = createApp({ name: "helpdesk", readiness: async () => (await d.pool.query("SELECT 1")).rowCount === 1, ...(d.logLevel ? { logLevel: d.logLevel } : {}) });
  await app.register(cookie);
  await app.register(formbody);
  registerWorkspaceScope(app, d.gatewaySecret);

  app.post<{ Params: { id: string } }>("/internal/workspaces/:id/seed", async (req, reply) => {
    if (req.params.id !== req.workspaceId) return reply.code(400).send({ error: "WORKSPACE_MISMATCH" });
    const body = z.object({ scenario: z.string().min(1), seed: z.number().int().positive() }).parse(req.body);
    try {
      const rows = d.scenarios.get(body.scenario).generate(body.seed);
      await seedHelpdesk(d.pool, req.workspaceId, rows);
      return reply.code(201).send({ ok: true, tickets: rows.helpdesk.tickets.length });
    } catch (err) {
      if (err instanceof UnknownScenarioError) return reply.code(422).send({ error: "UNKNOWN_SCENARIO", message: err.message });
      throw err;
    }
  });

  registerApi(app, { tickets, auth });
  registerUi(app, { tickets, auth });
  await app.register(async (scope) =>
    registerMcp(scope, { serverName: "benchme-helpdesk", version: "0.1.0", tools: helpdeskTools(), context: (workspaceId) => ({ workspaceId, tickets, actor: "agent" }) }),
  );
  return app;
}
