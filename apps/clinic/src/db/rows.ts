import type {
  Clinic,
  ClinicAppointment,
  ClinicAppointmentStatus,
  ClinicCoverage,
  ClinicCoverageStatus,
  ClinicDoctor,
  ClinicMedication,
  ClinicPharmacyPrice,
  ClinicPlan,
  ClinicPrescription,
  ClinicProcedure,
  ClinicRefill,
  ClinicRefillStatus,
  ClinicSession,
  ClinicVisitType,
} from "@benchme/scenarios";

/** Database rows (snake_case) and their mapping to the scenario row shapes the API serves. */
export type CRow = { code: string; name: string; city: string; address: string; phone: string; pharmacy_phone: string };
export type DRow = {
  code: string; name: string; clinic_code: string; specialty: string; languages: string[]; visit_types: ClinicVisitType[]; accepting_new_patients: boolean;
  network_plans: string[]; in_person_fee_cents: number | null; video_fee_cents: number | null; work_days: number[]; session: ClinicSession;
};
export type PlRow = { code: string; name: string; in_person_copay_cents: number; video_copay_cents: number };
export type PrRow = { code: string; name: string; price_cents: number };
export type CovRow = { plan_code: string; procedure_code: string; status: ClinicCoverageStatus; coinsurance_pct: number | null };
export type MRow = { code: string; name: string; dosages: string[] };
export type PriceRow = { clinic_code: string; medication_code: string; dosage: string; price_cents: number };
export type ARow = {
  appointment_no: string; doctor_code: string; clinic_code: string; patient_name: string; patient_email: string; plan_code: string | null; date: string; time: string;
  visit_type: ClinicVisitType; status: ClinicAppointmentStatus; cost_cents: number; created_at: Date; cancelled_at: Date | null;
};
export type RxRow = { rx_no: string; patient_email: string; patient_name: string; medication_code: string; dosage: string; doctor_code: string; refills_left: number; issued_on: string };
export type RfRow = { refill_no: string; rx_no: string; pharmacy_code: string; status: ClinicRefillStatus; requested_at: Date };

export type AppointmentRow = ClinicAppointment & { cancelledAt: string | null };

export const toClinic = (r: CRow): Clinic => ({ code: r.code, name: r.name, city: r.city, address: r.address, phone: r.phone, pharmacyPhone: r.pharmacy_phone });
export const toDoctor = (r: DRow): ClinicDoctor => ({
  code: r.code, name: r.name, clinicCode: r.clinic_code, specialty: r.specialty, languages: r.languages, visitTypes: r.visit_types, acceptingNewPatients: r.accepting_new_patients,
  networkPlans: r.network_plans, inPersonFeeCents: r.in_person_fee_cents, videoFeeCents: r.video_fee_cents, workDays: r.work_days, session: r.session,
});
export const toPlan = (r: PlRow): ClinicPlan => ({ code: r.code, name: r.name, inPersonCopayCents: r.in_person_copay_cents, videoCopayCents: r.video_copay_cents });
export const toProcedure = (r: PrRow): ClinicProcedure => ({ code: r.code, name: r.name, priceCents: r.price_cents });
export const toCoverage = (r: CovRow): ClinicCoverage => ({ planCode: r.plan_code, procedureCode: r.procedure_code, status: r.status, coinsurancePct: r.coinsurance_pct });
export const toMedication = (r: MRow): ClinicMedication => ({ code: r.code, name: r.name, dosages: r.dosages });
export const toPrice = (r: PriceRow): ClinicPharmacyPrice => ({ clinicCode: r.clinic_code, medicationCode: r.medication_code, dosage: r.dosage, priceCents: r.price_cents });
export const toAppointment = (r: ARow): AppointmentRow => ({
  appointmentNo: r.appointment_no, doctorCode: r.doctor_code, clinicCode: r.clinic_code, patientName: r.patient_name, patientEmail: r.patient_email, planCode: r.plan_code,
  date: r.date, time: r.time, visitType: r.visit_type, status: r.status, costCents: r.cost_cents, createdAt: r.created_at.toISOString(), cancelledAt: r.cancelled_at?.toISOString() ?? null,
});
export const toPrescription = (r: RxRow): ClinicPrescription => ({
  rxNo: r.rx_no, patientEmail: r.patient_email, patientName: r.patient_name, medicationCode: r.medication_code, dosage: r.dosage, doctorCode: r.doctor_code, refillsLeft: r.refills_left, issuedOn: r.issued_on,
});
export const toRefill = (r: RfRow): ClinicRefill => ({ refillNo: r.refill_no, rxNo: r.rx_no, pharmacyCode: r.pharmacy_code, status: r.status, requestedAt: r.requested_at.toISOString() });

// DATE columns read as text: node-postgres turns a DATE into a local-midnight Date, which shifts a day in any zone west of UTC.
export const APPOINTMENT_COLS =
  "appointment_no, doctor_code, clinic_code, patient_name, patient_email, plan_code, to_char(date, 'YYYY-MM-DD') AS date, time, visit_type, status, cost_cents, created_at, cancelled_at";
export const RX_COLS = "rx_no, patient_email, patient_name, medication_code, dosage, doctor_code, refills_left, to_char(issued_on, 'YYYY-MM-DD') AS issued_on";

/** A tiny WHERE builder: `add("lower(x) = ?", v)` appends a numbered parameter. */
export function whereOf(first: unknown[]): { params: unknown[]; sql: () => string; add: (cond: string, v: unknown) => void } {
  const params = [...first];
  const parts = ["workspace_id = $1"];
  return {
    params,
    sql: () => parts.join(" AND "),
    add(cond, v) {
      params.push(v);
      parts.push(cond.replace("?", `$${params.length}`));
    },
  };
}
