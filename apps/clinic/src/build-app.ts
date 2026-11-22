import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import { createApp, type Pool } from "@benchme/core";
import { UnknownScenarioError, type ScenarioRegistry } from "@benchme/scenarios";
import { AuthService, PgLedger, PgUsersRepo, registerDoors, registerMcp, registerWorkspaceScope, type Mailer } from "@benchme/site-kit";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { registerApi } from "./api/routes.js";
import { PgAppointmentsRepo, type AppointmentsRepo } from "./db/appointments-repo.js";
import { PgCatalogRepo, type CatalogRepo } from "./db/catalog-repo.js";
import { APPOINTMENTS_LEDGER, CATALOG_LEDGER, PRESCRIPTIONS_LEDGER } from "./db/ledger.js";
import { PgPrescriptionsRepo, type PrescriptionsRepo } from "./db/prescriptions-repo.js";
import { seedClinic } from "./db/seed.js";
import { clinicTools } from "./mcp/tools.js";
import { registerUi } from "./ui/routes.js";
import { SESSION_COOKIE, SITE } from "./ui/shell.js";

export type BuildDeps = {
  pool: Pool;
  scenarios: ScenarioRegistry;
  mailer: Mailer;
  gatewaySecret: string;
  sessionTtlSeconds: number;
  logLevel?: string;
};

/** Composition root: repos → services → routes. */
export async function buildClinic(d: BuildDeps): Promise<FastifyInstance> {
  const accounts = new AuthService({
    users: new PgUsersRepo(d.pool, "clinic"),
    mailer: d.mailer,
    sessionTtlSeconds: d.sessionTtlSeconds,
    tokenPrefix: "cln",
    verification: {
      subject: `Your ${SITE} verification code`,
      body: (code) => `Welcome to ${SITE}.\n\nYour verification code is ${code}. It expires in 30 minutes.\n\nIf you did not sign up, ignore this message.`,
    },
  });

  const app = createApp({ name: "clinic", readiness: async () => (await d.pool.query("SELECT 1")).rowCount === 1, ...(d.logLevel ? { logLevel: d.logLevel } : {}) });
  await app.register(cookie);
  await app.register(formbody);
  registerWorkspaceScope(app, d.gatewaySecret);
  const doors = registerDoors(app, { ledger: new PgLedger(d.pool, "clinic"), auth: accounts, cookie: SESSION_COOKIE, gatewaySecret: d.gatewaySecret });
  const auth = doors.auth;
  // The appointments' rules look doctors and plans up in the catalogue themselves: those are not a door's reads, so they get the catalogue as it is.
  const rawCatalog = new PgCatalogRepo(d.pool);
  const catalog = doors.ledgered<CatalogRepo>(rawCatalog, CATALOG_LEDGER);
  const appointments = doors.ledgered<AppointmentsRepo>(new PgAppointmentsRepo(d.pool, rawCatalog), APPOINTMENTS_LEDGER);
  const prescriptions = doors.ledgered<PrescriptionsRepo>(new PgPrescriptionsRepo(d.pool), PRESCRIPTIONS_LEDGER);

  app.post<{ Params: { id: string } }>("/internal/workspaces/:id/seed", async (req, reply) => {
    if (req.params.id !== req.workspaceId) return reply.code(400).send({ error: "WORKSPACE_MISMATCH" });
    const body = z.object({ scenario: z.string().min(1), seed: z.number().int().positive() }).parse(req.body);
    try {
      const rows = d.scenarios.get(body.scenario).generate(body.seed);
      await seedClinic(d.pool, req.workspaceId, rows);
      return reply.code(201).send({ ok: true, doctors: rows.clinic.doctors.length, appointments: rows.clinic.appointments.length, prescriptions: rows.clinic.prescriptions.length });
    } catch (err) {
      if (err instanceof UnknownScenarioError) return reply.code(422).send({ error: "UNKNOWN_SCENARIO", message: err.message });
      throw err;
    }
  });

  const tools = doors.withSignIn(clinicTools());
  registerApi(app, { catalog, appointments, prescriptions });
  registerUi(app, { catalog, appointments, prescriptions, auth, tools });
  await app.register(async (scope) => registerMcp(scope, { serverName: "benchme-clinic", version: "0.1.0", tools, context: (workspaceId) => ({ workspaceId, catalog, appointments, prescriptions }), sessions: true }));
  return app;
}
