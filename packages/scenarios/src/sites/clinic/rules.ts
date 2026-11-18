import { isDate } from "../../stays.js";
import type {
  Clinic,
  ClinicAppointment,
  ClinicCoverage,
  ClinicDoctor,
  ClinicMedication,
  ClinicPharmacyPrice,
  ClinicPlan,
  ClinicPrescription,
  ClinicProcedure,
  ClinicRefill,
  ClinicSession,
  ClinicVisitType,
} from "./types.js";

/**
 * The clinic site's rules, as pure functions over rows. apps/clinic enforces
 * them on every write (inside the write's transaction) and answers every
 * search with them, and the intent corpus derives its answer keys with them,
 * so the site and the keys cannot disagree about what is bookable, what a
 * visit or procedure costs a patient, or which refill can be requested.
 * Administrative only: nothing here judges symptoms, results or medicines.
 */

/** The dates appointments are taken for. Fixed, not "from today", so a seed means the same diary forever. */
export const CLINIC_WINDOW = { first: "2027-01-01", last: "2027-12-31" } as const;
export const CLINIC_VISIT_TYPES = ["in-person", "video"] as const satisfies readonly ClinicVisitType[];
/** Slot start times per session; every slot is 30 minutes. */
export const CLINIC_SLOT_TIMES: Readonly<Record<ClinicSession, readonly string[]>> = {
  morning: ["09:00", "09:30", "10:00", "10:30", "11:00", "11:30"],
  afternoon: ["13:00", "13:30", "14:00", "14:30", "15:00", "15:30"],
};

export type ClinicProblem = { code: string; message: string };
/** The problems that mean "taken / already done" (409); every other refusal is a rule the caller can fix by asking differently (422). */
const CONFLICTS = new Set(["SLOT_TAKEN", "PATIENT_BUSY", "ALREADY_REQUESTED", "ALREADY_CANCELLED"]);
export const clinicProblemStatus = (code: string): 409 | 422 => (CONFLICTS.has(code) ? 409 : 422);

const lower = (s: string) => s.trim().toLowerCase();
const visitText = (v: ClinicVisitType) => (v === "video" ? "video" : "in-person");

/** ISO weekday of a date: 1 = Monday … 7 = Sunday. */
export function clinicWeekday(date: string): number {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

/** The slot start times a doctor has on a date: none outside the window or on a day they do not see patients. */
export function clinicSlotTimes(doctor: ClinicDoctor, date: string): readonly string[] {
  if (!isDate(date) || date < CLINIC_WINDOW.first || date > CLINIC_WINDOW.last) return [];
  return doctor.workDays.includes(clinicWeekday(date)) ? CLINIC_SLOT_TIMES[doctor.session] : [];
}

/** A doctor's slots on a date that no booked appointment holds, in time order. Cancelled appointments hold nothing. */
export function clinicFreeSlots(doctor: ClinicDoctor, appointments: readonly ClinicAppointment[], date: string): string[] {
  const held = new Set(appointments.filter((a) => a.doctorCode === doctor.code && a.date === date && a.status === "booked").map((a) => a.time));
  return clinicSlotTimes(doctor, date).filter((t) => !held.has(t));
}

/** A patient is an existing patient of a doctor while they hold an appointment with them that is not cancelled. */
export function clinicIsExistingPatient(doctorCode: string, patientEmail: string, appointments: readonly ClinicAppointment[]): boolean {
  const email = lower(patientEmail);
  return appointments.some((a) => a.doctorCode === doctorCode && a.status === "booked" && lower(a.patientEmail) === email);
}

export function clinicFeeCents(doctor: ClinicDoctor, visitType: ClinicVisitType): number | null {
  return visitType === "video" ? doctor.videoFeeCents : doctor.inPersonFeeCents;
}

export function clinicInNetwork(doctor: ClinicDoctor, planCode: string | null | undefined): boolean {
  return !!planCode && doctor.networkPlans.some((p) => p.toUpperCase() === planCode.trim().toUpperCase());
}

/** What a patient pays for one visit: the plan's copay when the doctor is in the plan's network, else the doctor's own fee. */
export function clinicVisitCostCents(doctor: ClinicDoctor, plan: ClinicPlan | null, visitType: ClinicVisitType): number {
  if (!doctor.visitTypes.includes(visitType)) throw new Error(`${doctor.code} does not offer ${visitText(visitType)} visits`);
  if (plan && clinicInNetwork(doctor, plan.code)) return visitType === "video" ? plan.videoCopayCents : plan.inPersonCopayCents;
  return clinicFeeCents(doctor, visitType) ?? 0;
}

/** What a patient pays for a procedure: the coinsurance share of its price when the plan covers it (with or without prior authorisation), else the whole price. */
export function clinicProcedureCostCents(procedure: ClinicProcedure, coverage: ClinicCoverage | null): number {
  if (!coverage || coverage.status === "not-covered" || coverage.coinsurancePct === null) return procedure.priceCents;
  return Math.round((procedure.priceCents * coverage.coinsurancePct) / 100);
}

export type ClinicVisitRequest = { date: string; time: string; visitType: ClinicVisitType; patientEmail: string };

/**
 * Why the doctor cannot see this patient in that slot: the date, the doctor's
 * days and session, the visit type, new patients (only with a doctor accepting
 * them), then whether the slot is free and the patient holds no other booked
 * appointment at the same time. The rule every booking write is held to;
 * `appointments` must hold the doctor's and the patient's appointments.
 */
export function clinicAppointmentProblem(doctor: ClinicDoctor, req: ClinicVisitRequest, appointments: readonly ClinicAppointment[]): ClinicProblem | null {
  if (!isDate(req.date)) return { code: "BAD_DATE", message: `${req.date} is not a date (YYYY-MM-DD)` };
  if (req.date < CLINIC_WINDOW.first || req.date > CLINIC_WINDOW.last) return { code: "OUTSIDE_WINDOW", message: `appointments are taken for dates from ${CLINIC_WINDOW.first} to ${CLINIC_WINDOW.last}` };
  if (!doctor.workDays.includes(clinicWeekday(req.date))) return { code: "NOT_WORKING", message: `${doctor.name} does not see patients on ${req.date}` };
  if (!CLINIC_SLOT_TIMES[doctor.session].includes(req.time)) return { code: "NO_SUCH_SLOT", message: `${doctor.name}'s slots start at ${CLINIC_SLOT_TIMES[doctor.session].join(", ")}` };
  if (!doctor.visitTypes.includes(req.visitType)) return { code: "VISIT_TYPE_NOT_OFFERED", message: `${doctor.name} does not offer ${visitText(req.visitType)} visits` };
  if (!doctor.acceptingNewPatients && !clinicIsExistingPatient(doctor.code, req.patientEmail, appointments)) {
    return { code: "NOT_ACCEPTING_NEW_PATIENTS", message: `${doctor.name} is not accepting new patients` };
  }
  if (appointments.some((a) => a.doctorCode === doctor.code && a.date === req.date && a.time === req.time && a.status === "booked")) {
    return { code: "SLOT_TAKEN", message: `${doctor.name}'s ${req.time} slot on ${req.date} is taken` };
  }
  const email = lower(req.patientEmail);
  const busy = appointments.find((a) => a.status === "booked" && a.date === req.date && a.time === req.time && lower(a.patientEmail) === email);
  if (busy) return { code: "PATIENT_BUSY", message: `${req.patientEmail} already has appointment ${busy.appointmentNo} at ${req.time} on ${req.date}` };
  return null;
}

/** Why a refill of this prescription cannot be requested at that pharmacy: no refills left, the pharmacy does not stock it, or one is already requested. */
export function clinicRefillProblem(rx: ClinicPrescription, pharmacyCode: string, prices: readonly ClinicPharmacyPrice[], refills: readonly ClinicRefill[]): ClinicProblem | null {
  if (rx.refillsLeft < 1) return { code: "NO_REFILLS_LEFT", message: `prescription ${rx.rxNo} has no refills left` };
  if (!prices.some((p) => p.clinicCode === pharmacyCode && p.medicationCode === rx.medicationCode && clinicSameDosage(p.dosage, rx.dosage))) {
    return { code: "NOT_STOCKED", message: `the pharmacy at ${pharmacyCode} does not stock ${rx.medicationCode} ${rx.dosage}` };
  }
  const open = refills.find((r) => r.rxNo === rx.rxNo && r.status === "requested");
  if (open) return { code: "ALREADY_REQUESTED", message: `a refill of ${rx.rxNo} is already requested (${open.refillNo})` };
  return null;
}

/** "20 mg", "20mg" and "20 MG" are one dosage. */
export const clinicDosageKey = (s: string): string => s.replace(/\s+/g, "").toLowerCase();
export const clinicSameDosage = (a: string, b: string): boolean => clinicDosageKey(a) === clinicDosageKey(b);

export type ClinicDoctorQuery = { city?: string; specialty?: string; language?: string; visitType?: ClinicVisitType; planCode?: string; newPatients?: boolean; date?: string };
/** A doctor that fits a query, with its clinic; `freeSlots` are the free slot times on the query's date (null without a date). */
export type ClinicDoctorMatch = ClinicDoctor & { clinicName: string; city: string; freeSlots: string[] | null };

/**
 * Every doctor in the city with the specialty, speaking the language, offering
 * the visit type, in network for the plan, accepting new patients when asked,
 * and — when a date is given — with at least one free slot that day. By code.
 */
export function clinicFindDoctors(rows: { clinics: readonly Clinic[]; doctors: readonly ClinicDoctor[]; appointments: readonly ClinicAppointment[] }, q: ClinicDoctorQuery): ClinicDoctorMatch[] {
  const clinicOf = new Map(rows.clinics.map((c) => [c.code, c]));
  const out: ClinicDoctorMatch[] = [];
  for (const d of rows.doctors) {
    const clinic = clinicOf.get(d.clinicCode);
    if (!clinic) continue;
    if (q.city && lower(clinic.city) !== lower(q.city)) continue;
    if (q.specialty && lower(d.specialty) !== lower(q.specialty)) continue;
    if (q.language && !d.languages.some((l) => lower(l) === lower(q.language as string))) continue;
    if (q.visitType && !d.visitTypes.includes(q.visitType)) continue;
    if (q.planCode && !clinicInNetwork(d, q.planCode)) continue;
    if (q.newPatients && !d.acceptingNewPatients) continue;
    const freeSlots = q.date ? clinicFreeSlots(d, rows.appointments, q.date) : null;
    if (freeSlots && freeSlots.length === 0) continue;
    out.push({ ...d, clinicName: clinic.name, city: clinic.city, freeSlots });
  }
  return out.sort((x, y) => x.code.localeCompare(y.code));
}

export type ClinicPriceOffer = { clinicCode: string; clinicName: string; city: string; pharmacyPhone: string; medicationCode: string; medicationName: string; dosage: string; priceCents: number };

/** What each pharmacy charges for a medication (by code or name), optionally at one dosage — cheapest first. */
export function clinicPrescriptionPrices(
  rows: { clinics: readonly Clinic[]; medications: readonly ClinicMedication[]; prices: readonly ClinicPharmacyPrice[] },
  medication: string,
  dosage?: string,
): ClinicPriceOffer[] {
  const med = rows.medications.find((m) => lower(m.code) === lower(medication) || lower(m.name) === lower(medication));
  if (!med) return [];
  const clinicOf = new Map(rows.clinics.map((c) => [c.code, c]));
  return rows.prices
    .filter((p) => p.medicationCode === med.code && (dosage === undefined || clinicSameDosage(p.dosage, dosage)))
    .flatMap((p) => {
      const c = clinicOf.get(p.clinicCode);
      return c ? [{ clinicCode: c.code, clinicName: c.name, city: c.city, pharmacyPhone: c.pharmacyPhone, medicationCode: med.code, medicationName: med.name, dosage: p.dosage, priceCents: p.priceCents }] : [];
    })
    .sort((x, y) => x.priceCents - y.priceCents || x.dosage.localeCompare(y.dosage) || x.clinicCode.localeCompare(y.clinicCode));
}
