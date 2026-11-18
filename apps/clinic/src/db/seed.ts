import { withTx, type Pool } from "@benchme/core";
import type { ScenarioRows } from "@benchme/scenarios";

async function bulk(client: { query: (sql: string, params: unknown[]) => Promise<unknown> }, table: string, columns: string[], rows: unknown[][]) {
  if (rows.length === 0) return;
  const perRow = columns.length;
  const chunk = Math.floor(60_000 / perRow);
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    const placeholders = slice.map((_, r) => `(${columns.map((__, c) => `$${r * perRow + c + 1}`).join(",")})`).join(",");
    await client.query(`INSERT INTO ${table} (${columns.join(",")}) VALUES ${placeholders}`, slice.flat());
  }
}

/** Children before parents, so clearing a workspace never trips a foreign key. */
const TABLES = ["refills", "prescriptions", "appointments", "patients", "prices", "medications", "coverage", "procedures", "doctors", "plans", "clinics", "counters", "sessions", "verification_codes", "users"];

/** Materialise a scenario's clinic rows under one workspace, atomically. Idempotent: a re-seed replaces. */
export async function seedClinic(pool: Pool, ws: string, rows: ScenarioRows): Promise<void> {
  const r = rows.clinic;
  await withTx(pool, async (c) => {
    for (const t of TABLES) await c.query(`DELETE FROM clinic.${t} WHERE workspace_id = $1`, [ws]);
    await bulk(c, "clinic.clinics", ["workspace_id", "code", "name", "city", "address", "phone", "pharmacy_phone"], r.clinics.map((x) => [ws, x.code, x.name, x.city, x.address, x.phone, x.pharmacyPhone]));
    await bulk(c, "clinic.plans", ["workspace_id", "code", "name", "in_person_copay_cents", "video_copay_cents"], r.plans.map((x) => [ws, x.code, x.name, x.inPersonCopayCents, x.videoCopayCents]));
    await bulk(
      c,
      "clinic.doctors",
      ["workspace_id", "code", "name", "clinic_code", "specialty", "languages", "visit_types", "accepting_new_patients", "network_plans", "in_person_fee_cents", "video_fee_cents", "work_days", "session"],
      r.doctors.map((d) => [ws, d.code, d.name, d.clinicCode, d.specialty, d.languages, d.visitTypes, d.acceptingNewPatients, d.networkPlans, d.inPersonFeeCents, d.videoFeeCents, d.workDays, d.session]),
    );
    await bulk(c, "clinic.procedures", ["workspace_id", "code", "name", "price_cents"], r.procedures.map((x) => [ws, x.code, x.name, x.priceCents]));
    await bulk(c, "clinic.coverage", ["workspace_id", "plan_code", "procedure_code", "status", "coinsurance_pct"], r.coverage.map((x) => [ws, x.planCode, x.procedureCode, x.status, x.coinsurancePct]));
    await bulk(c, "clinic.medications", ["workspace_id", "code", "name", "dosages"], r.medications.map((x) => [ws, x.code, x.name, x.dosages]));
    await bulk(c, "clinic.prices", ["workspace_id", "clinic_code", "medication_code", "dosage", "price_cents"], r.prices.map((x) => [ws, x.clinicCode, x.medicationCode, x.dosage, x.priceCents]));
    await bulk(c, "clinic.patients", ["workspace_id", "email", "name", "plan_code"], r.patients.map((x) => [ws, x.email, x.name, x.planCode]));
    await bulk(
      c,
      "clinic.appointments",
      ["workspace_id", "appointment_no", "doctor_code", "clinic_code", "patient_name", "patient_email", "plan_code", "date", "time", "visit_type", "status", "cost_cents", "created_at"],
      r.appointments.map((a) => [ws, a.appointmentNo, a.doctorCode, a.clinicCode, a.patientName, a.patientEmail, a.planCode, a.date, a.time, a.visitType, a.status, a.costCents, a.createdAt]),
    );
    await bulk(
      c,
      "clinic.prescriptions",
      ["workspace_id", "rx_no", "patient_email", "patient_name", "medication_code", "dosage", "doctor_code", "refills_left", "issued_on"],
      r.prescriptions.map((p) => [ws, p.rxNo, p.patientEmail, p.patientName, p.medicationCode, p.dosage, p.doctorCode, p.refillsLeft, p.issuedOn]),
    );
    await bulk(c, "clinic.refills", ["workspace_id", "refill_no", "rx_no", "pharmacy_code", "status", "requested_at"], r.refills.map((f) => [ws, f.refillNo, f.rxNo, f.pharmacyCode, f.status, f.requestedAt]));
  });
}
