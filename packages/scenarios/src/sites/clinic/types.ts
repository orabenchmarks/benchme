/**
 * The clinic network site (apps/clinic, "Calvenor Clinics"): clinics with a
 * pharmacy each, doctors, insurance plans, procedures, medications and their
 * pharmacy prices, patients, appointments, prescriptions and refill requests.
 * Every name, plan, procedure and medication is invented, and the site is
 * administrative only: it books, prices and refills; it gives no medical advice.
 * Rules: ./rules.ts.
 */
export type ClinicVisitType = "in-person" | "video";
/** A doctor sees patients either in the morning (09:00–11:30 starts) or the afternoon (13:00–15:30 starts), in 30-minute slots. */
export type ClinicSession = "morning" | "afternoon";

/** A clinic; every clinic runs a pharmacy, addressed by the clinic's code. */
export type Clinic = { code: string; name: string; city: string; address: string; phone: string; pharmacyPhone: string };

export type ClinicDoctor = {
  code: string;
  name: string;
  clinicCode: string;
  specialty: string;
  languages: string[];
  visitTypes: ClinicVisitType[];
  acceptingNewPatients: boolean;
  /** The plans (codes) this doctor is in network for. */
  networkPlans: string[];
  /** What a visit costs a patient the doctor is not in network for; null where the visit type is not offered. */
  inPersonFeeCents: number | null;
  videoFeeCents: number | null;
  /** ISO weekdays the doctor sees patients: 1 = Monday … 5 = Friday. */
  workDays: number[];
  session: ClinicSession;
};

/** An insurance plan: the copay a patient pays for a visit with a doctor in its network. */
export type ClinicPlan = { code: string; name: string; inPersonCopayCents: number; videoCopayCents: number };

export type ClinicProcedure = { code: string; name: string; priceCents: number };
export type ClinicCoverageStatus = "covered" | "prior-authorisation" | "not-covered";
/** One plan's terms for one procedure. `coinsurancePct` is the share of the price the PATIENT pays; null when not covered. */
export type ClinicCoverage = { planCode: string; procedureCode: string; status: ClinicCoverageStatus; coinsurancePct: number | null };

export type ClinicMedication = { code: string; name: string; dosages: string[] };
/** What one clinic's pharmacy charges for one medication at one dosage; a missing row means it does not stock it. */
export type ClinicPharmacyPrice = { clinicCode: string; medicationCode: string; dosage: string; priceCents: number };

export type ClinicPatient = { email: string; name: string; planCode: string };

export type ClinicAppointmentStatus = "booked" | "cancelled";
export type ClinicAppointment = {
  appointmentNo: string;
  doctorCode: string;
  clinicCode: string;
  patientName: string;
  patientEmail: string;
  /** The plan the visit is billed to; null for a patient paying the doctor's fee. */
  planCode: string | null;
  /** "YYYY-MM-DD" and "HH:MM", the start of a 30-minute slot. */
  date: string;
  time: string;
  visitType: ClinicVisitType;
  status: ClinicAppointmentStatus;
  /** What the patient pays for the visit (`clinicVisitCostCents` at booking). */
  costCents: number;
  createdAt: string;
};

export type ClinicPrescription = {
  rxNo: string;
  patientEmail: string;
  patientName: string;
  medicationCode: string;
  dosage: string;
  doctorCode: string;
  /** Refills still allowed; each refill request uses one. */
  refillsLeft: number;
  issuedOn: string;
};

export type ClinicRefillStatus = "requested" | "collected";
/** A refill request, collected at one clinic's pharmacy. At most one `requested` refill per prescription at a time. */
export type ClinicRefill = { refillNo: string; rxNo: string; pharmacyCode: string; status: ClinicRefillStatus; requestedAt: string };

export type ClinicRows = {
  clinics: Clinic[];
  doctors: ClinicDoctor[];
  plans: ClinicPlan[];
  procedures: ClinicProcedure[];
  coverage: ClinicCoverage[];
  medications: ClinicMedication[];
  prices: ClinicPharmacyPrice[];
  patients: ClinicPatient[];
  appointments: ClinicAppointment[];
  prescriptions: ClinicPrescription[];
  refills: ClinicRefill[];
};
