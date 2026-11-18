import { DomainError, ToolRegistry } from "@benchme/site-kit";
import { z } from "zod";
import { date, time, visitType } from "../api/inputs.js";
import type { AppointmentsRepo } from "../db/appointments-repo.js";
import type { CatalogRepo } from "../db/catalog-repo.js";
import type { PrescriptionsRepo } from "../db/prescriptions-repo.js";

export type ToolContext = { workspaceId: string; catalog: CatalogRepo; appointments: AppointmentsRepo; prescriptions: PrescriptionsRepo };

const notFound = (what: string): never => {
  throw new DomainError("NOT_FOUND", `${what} not found`, 404);
};

/**
 * The clinic site's MCP surface (and, through the bridge, its WebMCP tools):
 * find a doctor, read a diary, price a visit or a procedure under a plan,
 * compare pharmacy prices, book, cancel, request a refill. Administrative
 * only — no tool judges symptoms, results or medicines.
 */
export function clinicTools(): ToolRegistry<ToolContext> {
  return new ToolRegistry<ToolContext>()
    .register({
      name: "list_clinics",
      description: "Every clinic in the network: code (CL-…), name, city, address, phone, and its pharmacy's phone. Every clinic runs a pharmacy, addressed by the clinic's code.",
      input: {},
      handler: (_a, c) => c.catalog.clinics(c.workspaceId),
    })
    .register({
      name: "find_doctors",
      description:
        "Doctors that fit every filter given: city, specialty (general practice, pediatrics, dermatology, cardiology, orthopedics), a language they speak, a visit type they offer (in-person|video), a plan (PL-…) they are in network for, accepting new patients. With a date (YYYY-MM-DD) only doctors with a free slot that day are listed, with those free slot times. Fees are cents.",
      input: {
        city: z.string().optional(),
        specialty: z.string().optional(),
        language: z.string().optional(),
        visitType: visitType.optional(),
        planCode: z.string().optional(),
        newPatients: z.boolean().optional().describe("true: only doctors accepting new patients"),
        date: date.optional(),
      },
      handler: (a, c) =>
        c.catalog.findDoctors(c.workspaceId, {
          ...(a.city ? { city: a.city } : {}),
          ...(a.specialty ? { specialty: a.specialty } : {}),
          ...(a.language ? { language: a.language } : {}),
          ...(a.visitType ? { visitType: a.visitType } : {}),
          ...(a.planCode ? { planCode: a.planCode } : {}),
          ...(a.newPatients ? { newPatients: true } : {}),
          ...(a.date ? { date: a.date } : {}),
        }),
    })
    .register({
      name: "get_doctor",
      description: "One doctor (DR-…): clinic, specialty, languages, visit types, whether accepting new patients, the plans they are in network for, fees in cents, the weekdays and session they see patients. With a date, also that day's 30-minute slots and which are free.",
      input: { doctorCode: z.string(), date: date.optional() },
      handler: async (a, c) => {
        const d = (await c.catalog.getDoctor(c.workspaceId, a.doctorCode)) ?? notFound(`doctor ${a.doctorCode}`);
        return a.date ? { ...d, day: await c.catalog.slots(c.workspaceId, a.doctorCode, a.date) } : d;
      },
    })
    .register({
      name: "get_plan",
      description: "One insurance plan (PL-…): the copay for an in-person and a video visit with an in-network doctor, and its coverage of every procedure — covered, covered with prior authorisation, or not covered — with the coinsurance % the patient pays and the patient's cost in cents.",
      input: { planCode: z.string() },
      handler: async (a, c) => (await c.catalog.getPlan(c.workspaceId, a.planCode)) ?? notFound(`plan ${a.planCode}`),
    })
    .register({
      name: "check_visit_cost",
      description: "Whether a doctor is in network for a plan, and what a visit of that type costs the patient: the plan's copay in network, the doctor's fee out of network or with no plan. Cents.",
      input: { doctorCode: z.string(), planCode: z.string().optional(), visitType },
      handler: (a, c) => c.catalog.visitCost(c.workspaceId, a.doctorCode, a.planCode ?? null, a.visitType),
    })
    .register({
      name: "get_prescription_prices",
      description: "What each clinic pharmacy charges for a medication (name or MED-… code), optionally at one dosage (e.g. \"20 mg\"), cheapest first. Cents. A pharmacy missing from the list does not stock it.",
      input: { medication: z.string(), dosage: z.string().optional() },
      handler: (a, c) => c.catalog.prices(c.workspaceId, a.medication, a.dosage),
    })
    .register({
      name: "get_patient",
      description: "A patient by email: their plan on file (null for someone not on file), every appointment (booked or cancelled), and every prescription with refills left and whether a refill is already requested.",
      input: { patientEmail: z.string() },
      handler: async (a, c) => ({
        patient: await c.catalog.getPatient(c.workspaceId, a.patientEmail),
        appointments: (await c.appointments.list(c.workspaceId, { patientEmail: a.patientEmail, limit: 200 })).items,
        prescriptions: await c.prescriptions.list(c.workspaceId, a.patientEmail),
      }),
    })
    .register({
      name: "book_appointment",
      description:
        "Book a 30-minute slot with a doctor for a patient. Fails if the date is outside 2027, the doctor does not see patients that day or has no slot at that time, the visit type is not offered, the doctor is not accepting new patients and the patient has no booked appointment with them, the slot is taken, or the patient already has an appointment at that time.",
      input: { doctorCode: z.string(), date, time, visitType, planCode: z.string().optional().describe("the plan the visit is billed to; omit to pay the doctor's fee"), patientName: z.string(), patientEmail: z.string().email() },
      handler: (a, c) => c.appointments.create(c.workspaceId, a),
    })
    .register({
      name: "cancel_appointment",
      description: "Cancel a booked appointment (AP-…). A cancelled appointment cannot be restored; book again instead.",
      input: { appointmentNo: z.string() },
      handler: (a, c) => c.appointments.cancel(c.workspaceId, a.appointmentNo),
    })
    .register({
      name: "request_refill",
      description: "Request a refill of a prescription (RX-…), to be collected at a clinic's pharmacy (CL-…). Fails if no refills are left, that pharmacy does not stock the medication at that dosage, or a refill is already requested. Uses one refill.",
      input: { rxNo: z.string(), pharmacyCode: z.string() },
      handler: (a, c) => c.prescriptions.requestRefill(c.workspaceId, a.rxNo, a.pharmacyCode),
    });
}
