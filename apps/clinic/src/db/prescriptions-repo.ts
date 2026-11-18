import { withTx, type Pool } from "@benchme/core";
import { clinicProblemStatus, clinicRefillProblem, type ClinicPrescription, type ClinicRefill, type ClinicRefillStatus } from "@benchme/scenarios";
import { DomainError } from "@benchme/site-kit";
import { RX_COLS, toPrescription, toPrice, toRefill, whereOf, type PriceRow, type RfRow, type RxRow } from "./rows.js";

export type PrescriptionRow = ClinicPrescription & { medicationName: string; refillPending: boolean };
export type PrescriptionDetail = PrescriptionRow & { refills: ClinicRefill[] };
export type RefillRow = ClinicRefill & { patientEmail: string; medicationCode: string; dosage: string };
export type RefillFilter = { patientEmail?: string; rxNo?: string; status?: ClinicRefillStatus };

/** Prescriptions and refill requests. A refill request is held to @benchme/scenarios' `clinicRefillProblem` inside its transaction and uses one refill. */
export interface PrescriptionsRepo {
  list(ws: string, patientEmail?: string): Promise<PrescriptionRow[]>;
  get(ws: string, rxNo: string): Promise<PrescriptionDetail | null>;
  refills(ws: string, f: RefillFilter): Promise<RefillRow[]>;
  requestRefill(ws: string, rxNo: string, pharmacyCode: string): Promise<RefillRow>;
}

const REFILL_COLS = "f.refill_no, f.rx_no, f.pharmacy_code, f.status, f.requested_at, p.patient_email, p.medication_code, p.dosage";
type RefillJoin = RfRow & { patient_email: string; medication_code: string; dosage: string };
const toRefillRow = (r: RefillJoin): RefillRow => ({ ...toRefill(r), patientEmail: r.patient_email, medicationCode: r.medication_code, dosage: r.dosage });

export class PgPrescriptionsRepo implements PrescriptionsRepo {
  constructor(private readonly pool: Pool) {}

  async list(ws: string, patientEmail?: string) {
    const w = whereOf([ws]);
    if (patientEmail) w.add("lower(patient_email) = ?", patientEmail.trim().toLowerCase());
    const rx = await this.pool.query<RxRow>(`SELECT ${RX_COLS} FROM clinic.prescriptions WHERE ${w.sql()} ORDER BY rx_no`, w.params);
    return this.decorate(ws, rx.rows.map(toPrescription));
  }

  async get(ws: string, rxNo: string) {
    const rx = (await this.pool.query<RxRow>(`SELECT ${RX_COLS} FROM clinic.prescriptions WHERE workspace_id = $1 AND rx_no = $2`, [ws, rxNo])).rows[0];
    if (!rx) return null;
    const [row] = await this.decorate(ws, [toPrescription(rx)]);
    const refills = await this.pool.query<RfRow>("SELECT * FROM clinic.refills WHERE workspace_id = $1 AND rx_no = $2 ORDER BY refill_no", [ws, rxNo]);
    return { ...(row as PrescriptionRow), refills: refills.rows.map(toRefill) };
  }

  async refills(ws: string, f: RefillFilter) {
    const params: unknown[] = [ws];
    let where = "f.workspace_id = $1";
    const add = (cond: string, v: unknown) => {
      params.push(v);
      where += ` AND ${cond.replace("?", `$${params.length}`)}`;
    };
    if (f.patientEmail) add("lower(p.patient_email) = ?", f.patientEmail.trim().toLowerCase());
    if (f.rxNo) add("f.rx_no = ?", f.rxNo);
    if (f.status) add("f.status = ?", f.status);
    const r = await this.pool.query<RefillJoin>(`SELECT ${REFILL_COLS} FROM clinic.refills f JOIN clinic.prescriptions p ON p.workspace_id = f.workspace_id AND p.rx_no = f.rx_no WHERE ${where} ORDER BY f.refill_no`, params);
    return r.rows.map(toRefillRow);
  }

  async requestRefill(ws: string, rxNo: string, pharmacyCode: string) {
    const no = await withTx(this.pool, async (c) => {
      // Locking the prescription serialises refill requests for it: never two open ones, never below zero refills.
      const row = (await c.query<RxRow>(`SELECT ${RX_COLS} FROM clinic.prescriptions WHERE workspace_id = $1 AND rx_no = $2 FOR UPDATE`, [ws, rxNo])).rows[0];
      if (!row) throw new DomainError("UNKNOWN_PRESCRIPTION", `no prescription ${rxNo}`, 404);
      const pharmacy = (await c.query("SELECT 1 FROM clinic.clinics WHERE workspace_id = $1 AND code = $2", [ws, pharmacyCode])).rowCount;
      if (!pharmacy) throw new DomainError("UNKNOWN_PHARMACY", `no pharmacy ${pharmacyCode}`, 404);
      const rx = toPrescription(row);
      const prices = await c.query<PriceRow>("SELECT * FROM clinic.prices WHERE workspace_id = $1 AND medication_code = $2", [ws, rx.medicationCode]);
      const refills = await c.query<RfRow>("SELECT * FROM clinic.refills WHERE workspace_id = $1 AND rx_no = $2", [ws, rxNo]);
      const problem = clinicRefillProblem(rx, pharmacyCode, prices.rows.map(toPrice), refills.rows.map(toRefill));
      if (problem) throw new DomainError(problem.code, problem.message, clinicProblemStatus(problem.code));
      const n = await c.query<{ value: number }>(
        `INSERT INTO clinic.counters (workspace_id, name, value) VALUES ($1, 'refill', 1)
         ON CONFLICT (workspace_id, name) DO UPDATE SET value = clinic.counters.value + 1 RETURNING value`,
        [ws],
      );
      const refillNo = `RF-${80000 + (n.rows[0]?.value ?? 0)}`;
      await c.query("INSERT INTO clinic.refills (workspace_id, refill_no, rx_no, pharmacy_code, status) VALUES ($1, $2, $3, $4, 'requested')", [ws, refillNo, rxNo, pharmacyCode]);
      await c.query("UPDATE clinic.prescriptions SET refills_left = refills_left - 1 WHERE workspace_id = $1 AND rx_no = $2", [ws, rxNo]);
      return refillNo;
    });
    return (await this.refills(ws, { rxNo })).find((r) => r.refillNo === no) as RefillRow;
  }

  private async decorate(ws: string, rx: ClinicPrescription[]): Promise<PrescriptionRow[]> {
    if (rx.length === 0) return [];
    const meds = await this.pool.query<{ code: string; name: string }>("SELECT code, name FROM clinic.medications WHERE workspace_id = $1", [ws]);
    const open = await this.pool.query<{ rx_no: string }>("SELECT rx_no FROM clinic.refills WHERE workspace_id = $1 AND status = 'requested' AND rx_no = ANY($2::text[])", [ws, rx.map((r) => r.rxNo)]);
    const name = new Map(meds.rows.map((m) => [m.code, m.name]));
    const pending = new Set(open.rows.map((r) => r.rx_no));
    return rx.map((r) => ({ ...r, medicationName: name.get(r.medicationCode) ?? r.medicationCode, refillPending: pending.has(r.rxNo) }));
  }
}
