import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import { createApp, type Pool } from "@benchme/core";
import { UnknownScenarioError, type ScenarioRegistry } from "@benchme/scenarios";
import { AuthService, PgLedger, PgUsersRepo, registerDoors, registerMcp, registerWorkspaceScope, type Mailer } from "@benchme/site-kit";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { registerApi } from "./api/routes.js";
import { PgEventsRepo, type EventsRepo } from "./db/events-repo.js";
import { EVENTS_LEDGER, OFFICES_LEDGER, REGISTRATIONS_LEDGER } from "./db/ledger.js";
import { PgOfficesRepo, type OfficesRepo } from "./db/offices-repo.js";
import { PgRegistrationsRepo, type RegistrationsRepo } from "./db/registrations-repo.js";
import { seedEvents } from "./db/seed.js";
import { eventTools } from "./mcp/tools.js";
import { SESSION_COOKIE, SITE_NAME } from "./ui/shell.js";
import { registerUi } from "./ui/routes.js";

export type BuildDeps = {
  pool: Pool;
  scenarios: ScenarioRegistry;
  mailer: Mailer;
  gatewaySecret: string;
  sessionTtlSeconds: number;
  logLevel?: string;
};

/** Composition root: repos → services → routes. */
export async function buildEvents(d: BuildDeps): Promise<FastifyInstance> {
  const accounts = new AuthService({
    users: new PgUsersRepo(d.pool, "events"),
    mailer: d.mailer,
    sessionTtlSeconds: d.sessionTtlSeconds,
    tokenPrefix: "evt",
    verification: {
      subject: `Your ${SITE_NAME} verification code`,
      body: (code) => `Welcome to ${SITE_NAME}.\n\nYour verification code is ${code}. It expires in 30 minutes.\n\nIf you did not sign up, ignore this message.`,
    },
  });

  const app = createApp({ name: "events", readiness: async () => (await d.pool.query("SELECT 1")).rowCount === 1, ...(d.logLevel ? { logLevel: d.logLevel } : {}) });
  await app.register(cookie);
  await app.register(formbody);
  registerWorkspaceScope(app, d.gatewaySecret);
  const doors = registerDoors(app, { ledger: new PgLedger(d.pool, "events"), auth: accounts, cookie: SESSION_COOKIE, gatewaySecret: d.gatewaySecret });
  const auth = doors.auth;
  const repos = {
    offices: doors.ledgered<OfficesRepo>(new PgOfficesRepo(d.pool), OFFICES_LEDGER),
    events: doors.ledgered<EventsRepo>(new PgEventsRepo(d.pool), EVENTS_LEDGER),
    registrations: doors.ledgered<RegistrationsRepo>(new PgRegistrationsRepo(d.pool), REGISTRATIONS_LEDGER),
  };

  app.post<{ Params: { id: string } }>("/internal/workspaces/:id/seed", async (req, reply) => {
    if (req.params.id !== req.workspaceId) return reply.code(400).send({ error: "WORKSPACE_MISMATCH" });
    const body = z.object({ scenario: z.string().min(1), seed: z.number().int().positive() }).parse(req.body);
    try {
      const rows = d.scenarios.get(body.scenario).generate(body.seed);
      await seedEvents(d.pool, req.workspaceId, rows);
      return reply.code(201).send({ ok: true, rooms: rows.events.rooms.length, events: rows.events.events.length, registrations: rows.events.registrations.length });
    } catch (err) {
      if (err instanceof UnknownScenarioError) return reply.code(422).send({ error: "UNKNOWN_SCENARIO", message: err.message });
      throw err;
    }
  });

  const tools = doors.withSignIn(eventTools());
  registerApi(app, { ...repos });
  registerUi(app, { ...repos, auth, tools });
  await app.register(async (scope) => registerMcp(scope, { serverName: "benchme-events", version: "0.1.0", tools, context: (workspaceId) => ({ workspaceId, ...repos }), sessions: true }));
  return app;
}
