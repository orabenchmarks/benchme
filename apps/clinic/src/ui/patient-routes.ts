import { DomainError, shell } from "@benchme/site-kit";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { appointmentsQuery, refillSchema, toAppointmentFilter } from "../api/inputs.js";
import type { AppointmentsRepo } from "../db/appointments-repo.js";
import type { CatalogRepo } from "../db/catalog-repo.js";
import type { PrescriptionsRepo } from "../db/prescriptions-repo.js";
import * as pages from "./pages/patient.js";
import { form, html, query, type Ctx } from "./shell.js";

export type PatientUiDeps = { catalog: CatalogRepo; appointments: AppointmentsRepo; prescriptions: PrescriptionsRepo; ctx: Ctx };
type N = { Params: { no: string } };

/** A patient's appointments (with cancel) and prescriptions (with the refill request). */
export function registerPatientUi(app: FastifyInstance, d: PatientUiDeps): void {
  const missing = async (req: FastifyRequest, what: string) => ({ status: 404, body: shell(await d.ctx(req), "Not found", `<h1>No such ${what}</h1>`) });
  const send = (reply: FastifyReply, page: { status: number; body: string }, status = page.status) => html(reply, page.body, page.status === 404 ? 404 : status);

  app.get("/appointments", async (req, reply) => {
    const f = query(req);
    const parsed = appointmentsQuery.safeParse({ ...f, limit: 25 });
    const page = parsed.success ? await d.appointments.list(req.workspaceId, toAppointmentFilter(parsed.data)) : { items: [], nextCursor: null };
    const flash = parsed.success ? undefined : `Check the filter: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`;
    return html(reply, shell(await d.ctx(req, flash), "Appointments", pages.appointmentsList(req.prefix, page.items, page.nextCursor, { patientEmail: f.patientEmail, doctor: f.doctor, date: f.date })), parsed.success ? 200 : 400);
  });

  const appointmentPage = async (req: FastifyRequest, no: string, flash?: string) => {
    const c = await d.ctx(req, flash);
    const a = await d.appointments.get(req.workspaceId, no);
    if (!a) return missing(req, "appointment");
    const doctor = await d.catalog.getDoctor(req.workspaceId, a.doctorCode);
    return { status: 200, body: shell(c, a.appointmentNo, pages.appointmentDetail(req.prefix, a, doctor?.name ?? a.doctorCode, !!c.user)) };
  };
  app.get<N>("/appointments/:no", async (req, reply) => send(reply, await appointmentPage(req, req.params.no)));
  app.post<N>("/appointments/:no/cancel", async (req, reply) => {
    try {
      await d.appointments.cancel(req.workspaceId, req.params.no);
      return reply.redirect(`${req.prefix}/appointments/${req.params.no}`, 303);
    } catch (err) {
      if (!(err instanceof DomainError)) throw err;
      return send(reply, await appointmentPage(req, req.params.no, err.message), err.status);
    }
  });

  app.get("/prescriptions", async (req, reply) => {
    const email = query(req).patientEmail;
    return html(reply, shell(await d.ctx(req), "Prescriptions", pages.prescriptionsList(req.prefix, await d.prescriptions.list(req.workspaceId, email || undefined), { patientEmail: email })));
  });

  const prescriptionPage = async (req: FastifyRequest, no: string, flash?: string) => {
    const c = await d.ctx(req, flash);
    const rx = await d.prescriptions.get(req.workspaceId, no);
    if (!rx) return missing(req, "prescription");
    const offers = await d.catalog.prices(req.workspaceId, rx.medicationCode, rx.dosage);
    return { status: 200, body: shell(c, rx.rxNo, pages.prescriptionDetail(req.prefix, rx, offers, !!c.user)) };
  };
  app.get<N>("/prescriptions/:no", async (req, reply) => send(reply, await prescriptionPage(req, req.params.no)));
  app.post<N>("/prescriptions/:no/refill", async (req, reply) => {
    const parsed = refillSchema.safeParse(form(req));
    if (!parsed.success) return send(reply, await prescriptionPage(req, req.params.no, "Choose the pharmacy to collect the refill at"), 400);
    try {
      await d.prescriptions.requestRefill(req.workspaceId, req.params.no, parsed.data.pharmacyCode);
      return reply.redirect(`${req.prefix}/prescriptions/${req.params.no}`, 303);
    } catch (err) {
      if (!(err instanceof DomainError)) throw err;
      return send(reply, await prescriptionPage(req, req.params.no, err.message), err.status);
    }
  });
}
