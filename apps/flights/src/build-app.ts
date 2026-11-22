import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import { createApp, type Pool } from "@benchme/core";
import { UnknownScenarioError, type ScenarioRegistry } from "@benchme/scenarios";
import { AuthService, PgLedger, PgUsersRepo, registerDoors, registerMcp, registerWorkspaceScope, type Mailer } from "@benchme/site-kit";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { registerApi } from "./api/routes.js";
import { PgFlightsRepo, type FlightsRepo } from "./db/flights-repo.js";
import { FLIGHTS_LEDGER } from "./db/ledger.js";
import { seedFlights } from "./db/seed.js";
import { flightTools } from "./mcp/tools.js";
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
export async function buildFlights(d: BuildDeps): Promise<FastifyInstance> {
  const accounts = new AuthService({
    users: new PgUsersRepo(d.pool, "flights"),
    mailer: d.mailer,
    sessionTtlSeconds: d.sessionTtlSeconds,
    tokenPrefix: "flt",
    verification: {
      subject: "Your Tallowmere Flights verification code",
      body: (code) => `Welcome to Tallowmere Flights.\n\nYour verification code is ${code}. It expires in 30 minutes.\n\nIf you did not sign up, ignore this message.`,
    },
  });

  const app = createApp({ name: "flights", readiness: async () => (await d.pool.query("SELECT 1")).rowCount === 1, ...(d.logLevel ? { logLevel: d.logLevel } : {}) });
  await app.register(cookie);
  await app.register(formbody);
  registerWorkspaceScope(app, d.gatewaySecret);
  const doors = registerDoors(app, { ledger: new PgLedger(d.pool, "flights"), auth: accounts, cookie: SESSION_COOKIE, gatewaySecret: d.gatewaySecret });
  const auth = doors.auth;
  const flights = doors.ledgered<FlightsRepo>(new PgFlightsRepo(d.pool), FLIGHTS_LEDGER);

  app.post<{ Params: { id: string } }>("/internal/workspaces/:id/seed", async (req, reply) => {
    if (req.params.id !== req.workspaceId) return reply.code(400).send({ error: "WORKSPACE_MISMATCH" });
    const body = z.object({ scenario: z.string().min(1), seed: z.number().int().positive() }).parse(req.body);
    try {
      const rows = d.scenarios.get(body.scenario).generate(body.seed);
      await seedFlights(d.pool, req.workspaceId, rows);
      return reply.code(201).send({ ok: true, flights: rows.flights.flights.length, bookings: rows.flights.bookings.length });
    } catch (err) {
      if (err instanceof UnknownScenarioError) return reply.code(422).send({ error: "UNKNOWN_SCENARIO", message: err.message });
      throw err;
    }
  });

  const tools = doors.withSignIn(flightTools());
  registerApi(app, { flights });
  registerUi(app, { flights, auth, tools });
  await app.register(async (scope) => registerMcp(scope, { serverName: "benchme-flights", version: "0.1.0", tools, context: (workspaceId) => ({ workspaceId, flights }), sessions: true }));
  return app;
}
