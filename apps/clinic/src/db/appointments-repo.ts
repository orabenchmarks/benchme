import { withTx, type Pool } from "@benchme/core";
import { clinicAppointmentProblem, clinicProblemStatus, clinicVisitCostCents, type ClinicAppointmentStatus, type ClinicVisitType } from "@benchme/scenarios";
import { DomainError } from "@benchme/site-kit";
import type { PgCatalogRepo } from "./catalog-repo.js";
import { APPOINTMENT_COLS, toAppointment, whereOf, type AppointmentRow, type ARow } from "./rows.js";

export type AppointmentFilter = { patientEmail?: string; doctor?: string; date?: string; status?: ClinicAppointmentStatus; cursor?: string; limit: number };
export type NewAppointment = { doctorCode: string; date: string; time: string; visitType: ClinicVisitType; planCode?: string | undefined; patientName: string; patientEmail: string };

/**
 * Appointments. The booking rules (window, the doctor's days and session, visit
 * type, new patients, a free slot, a patient in one place at a time) and the
 * visit's cost are @benchme/scenarios' clinic rules — the same functions the
 * answer keys are derived with — applied inside the write's transaction.
 */
export interface AppointmentsRepo {
  list(ws: string, f: AppointmentFilter): Promise<{ items: AppointmentRow[]; nextCursor: string | null }>;
  get(ws: string, no: string): Promise<AppointmentRow | null>;
  create(ws: string, input: NewAppointment): Promise<AppointmentRow>;
  /** booked → cancelled; a cancelled appointment stays cancelled. */
  cancel(ws: string, no: string): Promise<AppointmentRow>;
}

const UNIQUE_VIOLATION = "23505";

export class PgAppointmentsRepo implements AppointmentsRepo {
  constructor(
    private readonly pool: Pool,
    private readonly catalog: PgCatalogRepo,
  ) {}

  async list(ws: string, f: AppointmentFilter) {
    const w = whereOf([ws, f.limit + 1]);
    if (f.patientEmail) w.add("lower(patient_email) = ?", f.patientEmail.trim().toLowerCase());
    if (f.doctor) w.add("doctor_code = ?", f.doctor);
    if (f.date) w.add("date = ?::date", f.date);
    if (f.status) w.add("status = ?", f.status);
    if (f.cursor) w.add("appointment_no > ?", f.cursor);
    const r = await this.pool.query<ARow>(`SELECT ${APPOINTMENT_COLS} FROM clinic.appointments WHERE ${w.sql()} ORDER BY appointment_no LIMIT $2`, w.params);
    const items = r.rows.slice(0, f.limit).map(toAppointment);
    return { items, nextCursor: r.rows.length > f.limit ? (items[items.length - 1]?.appointmentNo ?? null) : null };
  }

  async get(ws: string, no: string) {
    const r = await this.pool.query<ARow>(`SELECT ${APPOINTMENT_COLS} FROM clinic.appointments WHERE workspace_id = $1 AND appointment_no = $2`, [ws, no]);
    return r.rows[0] ? toAppointment(r.rows[0]) : null;
  }

  async create(ws: string, input: NewAppointment) {
    const patientName = input.patientName.trim();
    const patientEmail = input.patientEmail.trim().toLowerCase();
    if (!patientName) throw new DomainError("NO_PATIENT_NAME", "an appointment needs the patient's name", 422);
    const no = await withTx(this.pool, async (c) => {
      // Locking the doctor serialises bookings with them, so two writers can never both take one slot.
      const doctor = (await this.catalog.doctor(c, ws, input.doctorCode, true)) ?? null;
      if (!doctor) throw new DomainError("UNKNOWN_DOCTOR", `no doctor ${input.doctorCode}`, 404);
      const plan = input.planCode ? await this.catalog.plan(c, ws, input.planCode) : null;
      if (input.planCode && !plan) throw new DomainError("UNKNOWN_PLAN", `no plan ${input.planCode}`, 422);
      const held = await c.query<ARow>(`SELECT ${APPOINTMENT_COLS} FROM clinic.appointments WHERE workspace_id = $1 AND (doctor_code = $2 OR lower(patient_email) = $3)`, [ws, doctor.code, patientEmail]);
      const problem = clinicAppointmentProblem(doctor, { date: input.date, time: input.time, visitType: input.visitType, patientEmail }, held.rows.map(toAppointment));
      if (problem) throw new DomainError(problem.code, problem.message, clinicProblemStatus(problem.code));
      const n = await c.query<{ value: number }>(
        `INSERT INTO clinic.counters (workspace_id, name, value) VALUES ($1, 'appointment', 1)
         ON CONFLICT (workspace_id, name) DO UPDATE SET value = clinic.counters.value + 1 RETURNING value`,
        [ws],
      );
      const apptNo = `AP-${50000 + (n.rows[0]?.value ?? 0)}`;
      try {
        await c.query(
          `INSERT INTO clinic.appointments (workspace_id, appointment_no, doctor_code, clinic_code, patient_name, patient_email, plan_code, date, time, visit_type, status, cost_cents)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'booked', $11)`,
          [ws, apptNo, doctor.code, doctor.clinicCode, patientName, patientEmail, plan?.code ?? null, input.date, input.time, input.visitType, clinicVisitCostCents(doctor, plan, input.visitType)],
        );
      } catch (err) {
        // Only a writer racing for the same patient's time across two doctors reaches the index; the rules caught everything else.
        if ((err as { code?: string }).code === UNIQUE_VIOLATION) throw new DomainError("PATIENT_BUSY", `${patientEmail} already has an appointment at ${input.time} on ${input.date}`, 409);
        throw err;
      }
      return apptNo;
    });
    // Read back after the commit: get() uses the pool, which cannot see the open transaction.
    return (await this.get(ws, no)) as AppointmentRow;
  }

  async cancel(ws: string, no: string) {
    const r = await this.pool.query("UPDATE clinic.appointments SET status = 'cancelled', cancelled_at = now() WHERE workspace_id = $1 AND appointment_no = $2 AND status = 'booked'", [ws, no]);
    if (!r.rowCount) {
      if (!(await this.get(ws, no))) throw new DomainError("UNKNOWN_APPOINTMENT", `no appointment ${no}`, 404);
      throw new DomainError("ALREADY_CANCELLED", `appointment ${no} is already cancelled`, 409);
    }
    return (await this.get(ws, no)) as AppointmentRow;
  }
}
