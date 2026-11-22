import { DomainError, shell } from "@benchme/site-kit";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { appointmentSchema, date, doctorQuerySchema, toDoctorQuery } from "../api/inputs.js";
import type { AppointmentsRepo } from "../db/appointments-repo.js";
import type { CatalogRepo } from "../db/catalog-repo.js";
import * as catalogPages from "./pages/catalog.js";
import * as doctorPages from "./pages/doctor.js";
import * as findPages from "./pages/find.js";
import { form, html, query, type Ctx } from "./shell.js";

export type CatalogUiDeps = { catalog: CatalogRepo; appointments: AppointmentsRepo; ctx: Ctx };
type P = { Params: { code: string } };

/** Find a doctor, a doctor's page (with the day's slots and the booking form), clinics, plans, prescription prices. */
export function registerCatalogUi(app: FastifyInstance, d: CatalogUiDeps): void {
  const notFound = async (req: FastifyRequest, what: string) => ({ status: 404, body: shell(await d.ctx(req), "Not found", `<h1>No such ${what}</h1>`) });

  const doctorPage = async (req: FastifyRequest, code: string, b: doctorPages.BookParams, flash?: string) => {
    const c = await d.ctx(req, flash);
    const doc = await d.catalog.getDoctor(req.workspaceId, code);
    if (!doc) return notFound(req, "doctor");
    const day = b.date && date.safeParse(b.date).success ? await d.catalog.slots(req.workspaceId, code, b.date) : null;
    return { status: 200, body: shell(c, doc.name, doctorPages.doctorDetail(req.prefix, doc, await d.catalog.plans(req.workspaceId), day, !!c.user, b)) };
  };

  app.get("/", async (req, reply) => {
    const [clinics, plans] = await Promise.all([d.catalog.clinics(req.workspaceId), d.catalog.plans(req.workspaceId)]);
    return html(reply, shell(await d.ctx(req), "Find a doctor", findPages.home(req.prefix, clinics, plans, query(req))));
  });

  app.get("/doctors", async (req, reply) => {
    const f = query(req);
    const parsed = doctorQuerySchema.safeParse(f);
    if (!parsed.success) {
      const [clinics, plans] = await Promise.all([d.catalog.clinics(req.workspaceId), d.catalog.plans(req.workspaceId)]);
      return html(reply, shell(await d.ctx(req, `Check the search: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`), "Find a doctor", findPages.home(req.prefix, clinics, plans, f)), 400);
    }
    const doctors = await d.catalog.findDoctors(req.workspaceId, toDoctorQuery(parsed.data));
    return html(reply, shell(await d.ctx(req), "Doctors", findPages.doctorResults(req.prefix, f, doctors)));
  });

  app.get<P>("/doctors/:code", async (req, reply) => {
    const page = await doctorPage(req, req.params.code, { date: query(req).date });
    return html(reply, page.body, page.status);
  });

  app.post("/appointments", async (req, reply) => {
    const f = form(req);
    const keep: doctorPages.BookParams = { date: f.date, time: f.time, visitType: f.visitType, planCode: f.planCode, patientName: f.patientName, patientEmail: f.patientEmail };
    const parsed = appointmentSchema.safeParse(f);
    if (!parsed.success) {
      const page = await doctorPage(req, f.doctorCode ?? "", keep, `Check the booking: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`);
      return html(reply, page.body, page.status === 404 ? 404 : 400);
    }
    try {
      const a = await d.appointments.create(req.workspaceId, parsed.data);
      return reply.redirect(`${req.prefix}/appointments/${a.appointmentNo}`, 303);
    } catch (err) {
      if (!(err instanceof DomainError)) throw err;
      const page = await doctorPage(req, parsed.data.doctorCode, keep, err.message);
      return html(reply, page.body, page.status === 404 ? 404 : err.status);
    }
  });

  app.get("/clinics", async (req, reply) => html(reply, shell(await d.ctx(req), "Clinics", findPages.clinicsList(req.prefix, await d.catalog.clinics(req.workspaceId)))));
  app.get<P>("/clinics/:code", async (req, reply) => {
    const c = await d.catalog.getClinic(req.workspaceId, req.params.code);
    const page = c ? { status: 200, body: shell(await d.ctx(req), c.name, findPages.clinicDetail(req.prefix, c)) } : await notFound(req, "clinic");
    return html(reply, page.body, page.status);
  });

  app.get("/plans", async (req, reply) => {
    const [plans, procedures] = await Promise.all([d.catalog.plans(req.workspaceId), d.catalog.procedures(req.workspaceId)]);
    return html(reply, shell(await d.ctx(req), "Plans & coverage", catalogPages.plansList(req.prefix, plans, procedures)));
  });
  app.get<P>("/plans/:code", async (req, reply) => {
    const plan = await d.catalog.getPlan(req.workspaceId, req.params.code);
    const page = plan ? { status: 200, body: shell(await d.ctx(req), plan.name, catalogPages.planDetail(req.prefix, plan)) } : await notFound(req, "plan");
    return html(reply, page.body, page.status);
  });

  app.get("/medications", async (req, reply) => {
    const f = query(req);
    const offers = f.medication ? await d.catalog.prices(req.workspaceId, f.medication, f.dosage || undefined) : null;
    return html(reply, shell(await d.ctx(req), "Prescription prices", catalogPages.medicationsList(req.prefix, await d.catalog.medications(req.workspaceId), f, offers)));
  });
  app.get<P>("/medications/:code", async (req, reply) => {
    const m = await d.catalog.getMedication(req.workspaceId, req.params.code);
    const page = m ? { status: 200, body: shell(await d.ctx(req), m.name, catalogPages.medicationDetail(req.prefix, m)) } : await notFound(req, "medication");
    return html(reply, page.body, page.status);
  });
}
