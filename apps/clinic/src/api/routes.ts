import { DomainError, apiUser, type AuthService } from "@benchme/site-kit";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppointmentsRepo } from "../db/appointments-repo.js";
import type { CatalogRepo } from "../db/catalog-repo.js";
import type { PrescriptionsRepo } from "../db/prescriptions-repo.js";
import { SESSION_COOKIE } from "../ui/shell.js";
import { appointmentSchema, appointmentsQuery, date, defaulted, doctorQuerySchema, optional, refillSchema, toAppointmentFilter, toDoctorQuery, visitType } from "./inputs.js";

export type ApiDeps = { catalog: CatalogRepo; appointments: AppointmentsRepo; prescriptions: PrescriptionsRepo; auth: AuthService };

const slotsQuery = z.object({ date });
const coverageQuery = z.object({ plan: z.string().min(1), procedure: z.string().min(1) });
const visitCostQuery = z.object({ doctor: z.string().min(1), plan: optional(z.string().min(1)), visitType: defaulted(visitType.default("in-person")) });
const pricesQuery = z.object({ medication: z.string().min(1), dosage: optional(z.string().min(1)) });
const rxQuery = z.object({ patientEmail: z.string().optional() });
const refillsQuery = z.object({ patientEmail: z.string().optional(), rxNo: z.string().optional(), status: optional(z.enum(["requested", "collected"])) });

/** REST under /api/v1. Reads are open inside the workspace; booking, cancelling and refill requests need a bearer token or a session. */
export function registerApi(app: FastifyInstance, d: ApiDeps): void {
  const caller = apiUser(d.auth, SESSION_COOKIE);
  const authed = async (req: FastifyRequest, reply: FastifyReply): Promise<boolean> => {
    if (await caller(req)) return true;
    reply.code(401).send({ error: "UNAUTHORIZED", message: "sign in or send Authorization: Bearer <api token>" });
    return false;
  };
  const run = async (reply: FastifyReply, fn: () => Promise<unknown>, code = 200) => {
    try {
      return reply.code(code).send(await fn());
    } catch (err) {
      if (err instanceof DomainError) return reply.code(err.status).send({ error: err.code, message: err.message });
      throw err;
    }
  };
  /** A bad query is the caller's to fix: 400 with zod's own words, not a 500. */
  const parse = <S extends z.ZodTypeAny>(schema: S, data: unknown, reply: FastifyReply): z.output<S> | null => {
    const r = schema.safeParse(data);
    if (r.success) return r.data;
    reply.code(400).send({ error: "BAD_REQUEST", message: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
    return null;
  };
  const found = (reply: FastifyReply, v: unknown) => v ?? reply.code(404).send({ error: "NOT_FOUND" });
  type P = { Params: { code: string } };

  app.get("/api/v1/clinics", async (req) => d.catalog.clinics(req.workspaceId));
  app.get<P>("/api/v1/clinics/:code", async (req, reply) => found(reply, await d.catalog.getClinic(req.workspaceId, req.params.code)));
  app.get("/api/v1/doctors", async (req, reply) => {
    const q = parse(doctorQuerySchema, req.query, reply);
    if (!q) return;
    return d.catalog.findDoctors(req.workspaceId, toDoctorQuery(q));
  });
  app.get<P>("/api/v1/doctors/:code", async (req, reply) => found(reply, await d.catalog.getDoctor(req.workspaceId, req.params.code)));
  app.get<P>("/api/v1/doctors/:code/slots", async (req, reply) => {
    const q = parse(slotsQuery, req.query, reply);
    if (!q) return;
    return run(reply, () => d.catalog.slots(req.workspaceId, req.params.code, q.date));
  });
  app.get("/api/v1/plans", async (req) => d.catalog.plans(req.workspaceId));
  app.get<P>("/api/v1/plans/:code", async (req, reply) => found(reply, await d.catalog.getPlan(req.workspaceId, req.params.code)));
  app.get("/api/v1/procedures", async (req) => d.catalog.procedures(req.workspaceId));
  app.get("/api/v1/coverage", async (req, reply) => {
    const q = parse(coverageQuery, req.query, reply);
    if (!q) return;
    return run(reply, () => d.catalog.coverage(req.workspaceId, q.plan, q.procedure));
  });
  app.get("/api/v1/visit-cost", async (req, reply) => {
    const q = parse(visitCostQuery, req.query, reply);
    if (!q) return;
    return run(reply, () => d.catalog.visitCost(req.workspaceId, q.doctor, q.plan ?? null, q.visitType));
  });
  app.get("/api/v1/medications", async (req) => d.catalog.medications(req.workspaceId));
  app.get<P>("/api/v1/medications/:code", async (req, reply) => found(reply, await d.catalog.getMedication(req.workspaceId, req.params.code)));
  app.get("/api/v1/prices", async (req, reply) => {
    const q = parse(pricesQuery, req.query, reply);
    if (!q) return;
    return d.catalog.prices(req.workspaceId, q.medication, q.dosage);
  });
  app.get<{ Params: { email: string } }>("/api/v1/patients/:email", async (req, reply) => found(reply, await d.catalog.getPatient(req.workspaceId, req.params.email)));

  app.get("/api/v1/appointments", async (req, reply) => {
    const f = parse(appointmentsQuery, req.query, reply);
    if (!f) return;
    return d.appointments.list(req.workspaceId, toAppointmentFilter(f));
  });
  app.get<{ Params: { no: string } }>("/api/v1/appointments/:no", async (req, reply) => found(reply, await d.appointments.get(req.workspaceId, req.params.no)));
  app.post("/api/v1/appointments", async (req, reply) => {
    if (!(await authed(req, reply))) return;
    const b = parse(appointmentSchema, req.body, reply);
    if (!b) return;
    return run(reply, () => d.appointments.create(req.workspaceId, b), 201);
  });
  app.post<{ Params: { no: string } }>("/api/v1/appointments/:no/cancel", async (req, reply) => {
    if (!(await authed(req, reply))) return;
    return run(reply, () => d.appointments.cancel(req.workspaceId, req.params.no));
  });

  app.get("/api/v1/prescriptions", async (req, reply) => {
    const q = parse(rxQuery, req.query, reply);
    if (!q) return;
    return d.prescriptions.list(req.workspaceId, q.patientEmail || undefined);
  });
  app.get<{ Params: { no: string } }>("/api/v1/prescriptions/:no", async (req, reply) => found(reply, await d.prescriptions.get(req.workspaceId, req.params.no)));
  app.post<{ Params: { no: string } }>("/api/v1/prescriptions/:no/refill", async (req, reply) => {
    if (!(await authed(req, reply))) return;
    const b = parse(refillSchema, req.body, reply);
    if (!b) return;
    return run(reply, () => d.prescriptions.requestRefill(req.workspaceId, req.params.no, b.pharmacyCode), 201);
  });
  app.get("/api/v1/refills", async (req, reply) => {
    const q = parse(refillsQuery, req.query, reply);
    if (!q) return;
    return d.prescriptions.refills(req.workspaceId, { ...(q.patientEmail ? { patientEmail: q.patientEmail } : {}), ...(q.rxNo ? { rxNo: q.rxNo } : {}), ...(q.status ? { status: q.status } : {}) });
  });
}
