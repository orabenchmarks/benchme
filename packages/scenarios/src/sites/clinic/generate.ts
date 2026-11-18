import { CITY_LIST, FIRST_NAMES, LAST_NAMES, word } from "../../acme-v1/names.js";
import { type Rng, int, pick, shuffle, substream } from "../../prng.js";
import { addDays } from "../../stays.js";
import { clinicAppointmentProblem, clinicFreeSlots, clinicIsExistingPatient, clinicSameDosage, clinicSlotTimes, clinicVisitCostCents } from "./rules.js";
import type {
  Clinic,
  ClinicAppointment,
  ClinicCoverage,
  ClinicDoctor,
  ClinicMedication,
  ClinicPatient,
  ClinicPharmacyPrice,
  ClinicPlan,
  ClinicPrescription,
  ClinicProcedure,
  ClinicRefill,
  ClinicRows,
  ClinicVisitType,
} from "./types.js";

/**
 * The clinic network site's rows, drawn from a stream of their own
 * (`substream(seed, "clinic")`), so adding the site moved no other row. Every
 * city has general practitioners and pediatricians enough that a search has
 * several candidates; some doctors' days are fully booked on purpose (a search
 * has to read the diary, not just the profile), cancelled appointments hold no
 * slot, and some patients hold two prescriptions of one medication at two
 * dosages, or a refill already requested.
 */
export const CLINIC_SIZES = { doctorsPerCity: [6, 7], patients: 30, partialDays: 24, fullDays: 10, followUps: 10, doseChanges: 10, medications: 8, procedures: 8 } as const;
export const CLINIC_SPECIALTIES = ["general practice", "pediatrics", "dermatology", "cardiology", "orthopedics"] as const;
export const CLINIC_LANGUAGES = ["English", "Spanish", "Polish", "Arabic", "Vietnamese"] as const;
/** Part- and fully booked days fall in March and April 2027, follow-ups up to five weeks later; the rest of the year's diary is empty. */
export const CLINIC_BUSY = { from: "2027-03-01", days: 61 } as const;

const MIX = ["general practice", "general practice", "general practice", "pediatrics", "pediatrics", "dermatology"] as const;
const EXTRA = ["cardiology", "orthopedics", "dermatology"] as const;
const PLAN_TIERS = ["Basic", "Standard", "Plus", "Select"] as const;
const PROCEDURE_KINDS = ["scan", "screening", "assessment", "imaging", "panel"] as const;
const MED_ENDINGS = ["ex", "ol", "ane", "ira", "ostat", "idine"] as const;
const DOSAGE_LADDERS = [["5 mg", "10 mg"], ["10 mg", "20 mg"], ["25 mg", "50 mg"], ["250 mg", "500 mg"], ["10 mg", "20 mg", "40 mg"]] as const;

function uniqueName(rng: Rng, taken: Set<string>, make: () => string): string {
  let name = "";
  do name = make();
  while (taken.has(name));
  taken.add(name);
  return name;
}

function makeClinics(rng: Rng): Clinic[] {
  const names = new Set<string>();
  const out: Clinic[] = [];
  for (const city of CITY_LIST) {
    const count = int(rng, 1, 2);
    for (let i = 0; i < count; i++) {
      const n = out.length;
      out.push({
        code: `CL-${11 + n}`,
        name: uniqueName(rng, names, () => `${word(rng)} ${pick(rng, ["Clinic", "Medical Centre", "Health Centre"])}`),
        city,
        address: `${int(rng, 2, 180)} ${word(rng)} ${pick(rng, ["Road", "Street", "Lane", "Avenue"])}, ${city}`,
        phone: `555-01${String(10 + 2 * n).padStart(2, "0")}`,
        pharmacyPhone: `555-01${String(11 + 2 * n).padStart(2, "0")}`,
      });
    }
  }
  return out;
}

function makePlans(rng: Rng): ClinicPlan[] {
  const names = new Set<string>();
  return PLAN_TIERS.map((tier, i) => ({
    code: `PL-${11 + i}`,
    name: uniqueName(rng, names, () => `${word(rng, 2)} ${tier}`),
    inPersonCopayCents: int(rng, 2, 6) * 500,
    videoCopayCents: int(rng, 1, 3) * 500,
  }));
}

function makeProcedures(rng: Rng, plans: ClinicPlan[]): { procedures: ClinicProcedure[]; coverage: ClinicCoverage[] } {
  const names = new Set<string>();
  const procedures = Array.from({ length: CLINIC_SIZES.procedures }, (_, i) => ({
    code: `PR-${301 + i}`,
    name: uniqueName(rng, names, () => `${word(rng)} ${pick(rng, PROCEDURE_KINDS)}`),
    priceCents: int(rng, 16, 240) * 500,
  }));
  const coverage = plans.flatMap((plan) =>
    procedures.map((p): ClinicCoverage => {
      const r = rng();
      if (r < 0.5) return { planCode: plan.code, procedureCode: p.code, status: "covered", coinsurancePct: pick(rng, [10, 20, 30]) };
      if (r < 0.8) return { planCode: plan.code, procedureCode: p.code, status: "prior-authorisation", coinsurancePct: pick(rng, [20, 30, 40]) };
      return { planCode: plan.code, procedureCode: p.code, status: "not-covered", coinsurancePct: null };
    }),
  );
  return { procedures, coverage };
}

function makeDoctors(rng: Rng, clinics: Clinic[], plans: ClinicPlan[]): ClinicDoctor[] {
  const names = new Set<string>();
  const out: ClinicDoctor[] = [];
  for (const city of CITY_LIST) {
    const here = clinics.filter((c) => c.city === city);
    const specialties = [...shuffle(rng, MIX), ...(int(rng, CLINIC_SIZES.doctorsPerCity[0], CLINIC_SIZES.doctorsPerCity[1]) > 6 ? [pick(rng, EXTRA)] : [])];
    for (const specialty of specialties) {
      const r = rng();
      const visitTypes: ClinicVisitType[] = r < 0.6 ? ["in-person", "video"] : r < 0.88 ? ["in-person"] : ["video"];
      const extra = rng();
      const fee = int(rng, 16, 40) * 500;
      out.push({
        code: `DR-${201 + out.length}`,
        name: uniqueName(rng, names, () => `Dr. ${pick(rng, FIRST_NAMES)} ${word(rng)}`),
        clinicCode: pick(rng, here).code,
        specialty,
        languages: ["English", ...shuffle(rng, CLINIC_LANGUAGES.slice(1)).slice(0, extra < 0.3 ? 0 : extra < 0.8 ? 1 : 2).sort()],
        visitTypes,
        acceptingNewPatients: rng() < 0.65,
        networkPlans: shuffle(rng, plans.map((p) => p.code)).slice(0, int(rng, 1, 3)).sort(),
        inPersonFeeCents: visitTypes.includes("in-person") ? fee : null,
        videoFeeCents: visitTypes.includes("video") ? Math.round((fee * 0.7) / 500) * 500 : null,
        workDays: shuffle(rng, [1, 2, 3, 4, 5]).slice(0, int(rng, 3, 4)).sort(),
        session: pick(rng, ["morning", "afternoon"] as const),
      });
    }
  }
  return out;
}

function makeMedications(rng: Rng, clinics: Clinic[]): { medications: ClinicMedication[]; prices: ClinicPharmacyPrice[] } {
  const names = new Set<string>();
  const medications = Array.from({ length: CLINIC_SIZES.medications }, (_, i) => ({
    code: `MED-${41 + i}`,
    name: uniqueName(rng, names, () => `${word(rng, 2)}${pick(rng, MED_ENDINGS)}`),
    dosages: [...pick(rng, DOSAGE_LADDERS)],
  }));
  const prices: ClinicPharmacyPrice[] = [];
  for (const m of medications) {
    const base = int(rng, 8, 60) * 50;
    m.dosages.forEach((dosage, i) => {
      for (const c of clinics) {
        if (rng() >= 0.6) continue;
        prices.push({ clinicCode: c.code, medicationCode: m.code, dosage, priceCents: Math.max(200, Math.round((base * (1 + 0.5 * i)) / 25) * 25 + int(rng, -8, 8) * 25) });
      }
    });
  }
  return { medications, prices };
}

function makePatients(rng: Rng, plans: ClinicPlan[]): ClinicPatient[] {
  const out = new Map<string, ClinicPatient>();
  while (out.size < CLINIC_SIZES.patients) {
    const first = pick(rng, FIRST_NAMES);
    const last = pick(rng, LAST_NAMES);
    const email = `${first}.${last}${int(rng, 1, 9)}@example.com`.toLowerCase();
    if (!out.has(email)) out.set(email, { email, name: `${first} ${last}`, planCode: pick(rng, plans).code });
  }
  return [...out.values()];
}

export function clinicRows(seed: number): ClinicRows {
  const rng = substream(seed, "clinic");
  const clinics = makeClinics(rng);
  const plans = makePlans(rng);
  const { procedures, coverage } = makeProcedures(rng, plans);
  const doctors = makeDoctors(rng, clinics, plans);
  const { medications, prices } = makeMedications(rng, clinics);
  const patients = makePatients(rng, plans);
  const appointments = makeAppointments(rng, doctors, patients, plans);
  const { prescriptions, refills } = makePrescriptions(rng, { doctors, medications, prices, patients, appointments });
  return { clinics, doctors, plans, procedures, coverage, medications, prices, patients, appointments, prescriptions, refills };
}

function makeAppointments(rng: Rng, doctors: ClinicDoctor[], patients: ClinicPatient[], plans: ClinicPlan[]): ClinicAppointment[] {
  const out: ClinicAppointment[] = [];
  const planOf = new Map(plans.map((p) => [p.code, p]));
  const push = (doctor: ClinicDoctor, patient: ClinicPatient, date: string, time: string, visitType: ClinicVisitType, status: ClinicAppointment["status"]) => {
    out.push({
      appointmentNo: `AP-${30001 + out.length}`, doctorCode: doctor.code, clinicCode: doctor.clinicCode, patientName: patient.name, patientEmail: patient.email, planCode: patient.planCode,
      date, time, visitType, status, costCents: clinicVisitCostCents(doctor, planOf.get(patient.planCode) ?? null, visitType),
      createdAt: new Date(Date.UTC(2027, 0, 2 + int(rng, 0, 50), int(rng, 7, 21), int(rng, 0, 59))).toISOString(),
    });
  };
  const open = (d: ClinicDoctor) => ({ ...d, acceptingNewPatients: true });
  /** A later slot with the same doctor that the patient is free for, 2–5 weeks on. */
  const followUpOf = (doctor: ClinicDoctor, patient: ClinicPatient, date: string, visitType: ClinicVisitType): [string, string] | null => {
    for (const weeks of shuffle(rng, [2, 3, 4, 5])) {
      const later = addDays(date, weeks * 7 + int(rng, 0, 2));
      for (const time of shuffle(rng, clinicFreeSlots(doctor, out, later))) {
        if (!clinicAppointmentProblem(open(doctor), { date: later, time, visitType, patientEmail: patient.email }, out)) return [later, time];
      }
    }
    return null;
  };
  /**
   * Book one patient into a slot, held to the rules. A doctor not accepting new
   * patients only takes someone already theirs — so a first visit with one comes
   * with its follow-up, and each of the two makes the other's patient existing.
   */
  const book = (doctor: ClinicDoctor, date: string, time: string, patient: ClinicPatient, status: ClinicAppointment["status"] = "booked"): boolean => {
    const visitType = pick(rng, doctor.visitTypes);
    const req = { date, time, visitType, patientEmail: patient.email };
    if (status === "cancelled") {
      if (!doctor.acceptingNewPatients || clinicAppointmentProblem(doctor, req, [])) return false;
      push(doctor, patient, date, time, visitType, status);
      return true;
    }
    if (doctor.acceptingNewPatients || clinicIsExistingPatient(doctor.code, patient.email, out)) {
      if (clinicAppointmentProblem(doctor, req, out)) return false;
      push(doctor, patient, date, time, visitType, "booked");
      return true;
    }
    if (clinicAppointmentProblem(open(doctor), req, out)) return false;
    const later = followUpOf(doctor, patient, date, visitType);
    if (!later) return false;
    push(doctor, patient, date, time, visitType, "booked");
    push(doctor, patient, later[0], later[1], visitType, "booked");
    return true;
  };
  const workingDay = (doctor: ClinicDoctor): string | null => {
    for (let i = 0; i < 40; i++) {
      const d = addDays(CLINIC_BUSY.from, int(rng, 0, CLINIC_BUSY.days - 1));
      if (clinicSlotTimes(doctor, d).length) return d;
    }
    return null;
  };
  const fill = (doctor: ClinicDoctor, date: string, time: string, status: ClinicAppointment["status"] = "booked") => {
    for (const patient of shuffle(rng, patients).slice(0, 12)) if (book(doctor, date, time, patient, status)) return;
  };

  // Part-booked days: a few slots taken, some of them by an appointment since cancelled.
  for (let k = 0; k < CLINIC_SIZES.partialDays; k++) {
    const doctor = pick(rng, doctors);
    const date = workingDay(doctor);
    if (!date) continue;
    for (const time of shuffle(rng, clinicFreeSlots(doctor, out, date)).slice(0, int(rng, 2, 4))) fill(doctor, date, time, doctor.acceptingNewPatients && rng() < 0.15 ? "cancelled" : "booked");
  }
  // Follow-ups: the same patient back with the same doctor a few weeks later.
  for (let k = 0; k < CLINIC_SIZES.followUps; k++) {
    const first = pick(rng, out);
    const doctor = doctors.find((d) => d.code === first.doctorCode) as ClinicDoctor;
    const patient = patients.find((p) => p.email === first.patientEmail) as ClinicPatient;
    if (first.status !== "booked") continue;
    const later = followUpOf(doctor, patient, first.date, first.visitType);
    if (later) book(doctor, later[0], later[1], patient);
  }
  // Fully booked on purpose, last, so nothing frees a slot of these days afterwards.
  const searched = doctors.filter((d) => d.specialty === "general practice" || d.specialty === "pediatrics");
  for (let k = 0; k < CLINIC_SIZES.fullDays; k++) {
    const doctor = rng() < 0.75 ? pick(rng, searched) : pick(rng, doctors);
    const date = workingDay(doctor);
    if (!date) continue;
    for (const time of clinicFreeSlots(doctor, out, date)) fill(doctor, date, time);
  }
  return out;
}

function makePrescriptions(
  rng: Rng,
  r: { doctors: ClinicDoctor[]; medications: ClinicMedication[]; prices: ClinicPharmacyPrice[]; patients: ClinicPatient[]; appointments: ClinicAppointment[] },
): { prescriptions: ClinicPrescription[]; refills: ClinicRefill[] } {
  const prescriptions: ClinicPrescription[] = [];
  const holds = (email: string, med: string, dosage: string) => prescriptions.some((p) => p.patientEmail === email && p.medicationCode === med && clinicSameDosage(p.dosage, dosage));
  const add = (patient: ClinicPatient, med: ClinicMedication, dosage: string, refillsLeft: number, issuedOn: string) => {
    const seen = r.appointments.filter((a) => a.patientEmail === patient.email && a.status === "booked").map((a) => a.doctorCode);
    prescriptions.push({ rxNo: `RX-${60001 + prescriptions.length}`, patientEmail: patient.email, patientName: patient.name, medicationCode: med.code, dosage, doctorCode: seen.length ? pick(rng, seen) : pick(rng, r.doctors).code, refillsLeft, issuedOn });
  };
  for (const patient of r.patients) {
    for (let i = int(rng, 1, 3); i > 0; i--) {
      const med = pick(rng, r.medications);
      const dosage = pick(rng, med.dosages);
      if (!holds(patient.email, med.code, dosage)) add(patient, med, dosage, int(rng, 0, 3), addDays("2027-01-04", int(rng, 0, 40)));
    }
  }
  // A dose change: a newer prescription of the same medication at another dosage, the older one kept.
  for (const patient of shuffle(rng, r.patients).slice(0, CLINIC_SIZES.doseChanges)) {
    const had = prescriptions.find((p) => p.patientEmail === patient.email);
    const med = r.medications.find((m) => m.code === had?.medicationCode);
    if (!had || !med) continue;
    const other = med.dosages.find((d) => !holds(patient.email, med.code, d));
    if (other) add(patient, med, other, int(rng, 1, 3), addDays(had.issuedOn, int(rng, 7, 30)));
  }
  const refills: ClinicRefill[] = [];
  for (const rx of prescriptions) {
    const stocking = r.prices.filter((p) => p.medicationCode === rx.medicationCode && clinicSameDosage(p.dosage, rx.dosage)).map((p) => p.clinicCode);
    const roll = rng();
    if (stocking.length === 0 || roll >= 0.4) continue;
    const status = roll < 0.25 || rx.refillsLeft === 0 ? "collected" : "requested";
    refills.push({ refillNo: `RF-${70001 + refills.length}`, rxNo: rx.rxNo, pharmacyCode: pick(rng, stocking), status, requestedAt: new Date(Date.UTC(2027, 1, 1 + int(rng, 0, 26), int(rng, 8, 18), int(rng, 0, 59))).toISOString() });
  }
  return { prescriptions, refills };
}
