import type { Pool, PoolClient } from "@benchme/core";
import {
  clinicFeeCents,
  clinicFindDoctors,
  clinicFreeSlots,
  clinicInNetwork,
  clinicPrescriptionPrices,
  clinicProcedureCostCents,
  clinicSlotTimes,
  clinicVisitCostCents,
  type Clinic,
  type ClinicAppointment,
  type ClinicCoverageStatus,
  type ClinicDoctor,
  type ClinicDoctorMatch,
  type ClinicDoctorQuery,
  type ClinicMedication,
  type ClinicPatient,
  type ClinicPlan,
  type ClinicPriceOffer,
  type ClinicProcedure,
  type ClinicVisitType,
} from "@benchme/scenarios";
import { DomainError } from "@benchme/site-kit";
import {
  APPOINTMENT_COLS,
  toAppointment,
  toClinic,
  toCoverage,
  toDoctor,
  toMedication,
  toPlan,
  toPrice,
  toProcedure,
  type ARow,
  type CovRow,
  type CRow,
  type DRow,
  type MRow,
  type PlRow,
  type PriceRow,
  type PrRow,
} from "./rows.js";

export type DoctorDetail = ClinicDoctor & { clinicName: string; city: string };
export type ClinicDetail = Clinic & { doctors: ClinicDoctor[] };
export type CoverageLine = { planCode: string; planName: string; procedureCode: string; procedureName: string; priceCents: number; status: ClinicCoverageStatus; coinsurancePct: number | null; priorAuthorisation: boolean; patientCostCents: number };
export type PlanDetail = ClinicPlan & { coverage: CoverageLine[] };
export type DaySlots = { doctorCode: string; date: string; slots: { time: string; free: boolean }[]; free: string[] };
export type VisitCost = { doctorCode: string; planCode: string | null; visitType: ClinicVisitType; inNetwork: boolean; feeCents: number | null; copayCents: number | null; costCents: number };
export type MedicationDetail = ClinicMedication & { prices: ClinicPriceOffer[] };

/** Everything a patient reads before acting: clinics, doctors and their diaries, plans and coverage, medications and pharmacy prices. */
export interface CatalogRepo {
  clinics(ws: string): Promise<Clinic[]>;
  getClinic(ws: string, code: string): Promise<ClinicDetail | null>;
  findDoctors(ws: string, q: ClinicDoctorQuery): Promise<ClinicDoctorMatch[]>;
  getDoctor(ws: string, code: string): Promise<DoctorDetail | null>;
  slots(ws: string, doctorCode: string, date: string): Promise<DaySlots>;
  plans(ws: string): Promise<ClinicPlan[]>;
  getPlan(ws: string, code: string): Promise<PlanDetail | null>;
  procedures(ws: string): Promise<ClinicProcedure[]>;
  coverage(ws: string, planCode: string, procedureCode: string): Promise<CoverageLine>;
  visitCost(ws: string, doctorCode: string, planCode: string | null, visitType: ClinicVisitType): Promise<VisitCost>;
  medications(ws: string): Promise<ClinicMedication[]>;
  getMedication(ws: string, code: string): Promise<MedicationDetail | null>;
  prices(ws: string, medication: string, dosage?: string): Promise<ClinicPriceOffer[]>;
  getPatient(ws: string, email: string): Promise<ClinicPatient | null>;
}

type Q = Pool | PoolClient;
const one = async <R>(c: Q, sql: string, params: unknown[]): Promise<R | undefined> => (await c.query(sql, params)).rows[0] as R | undefined;
const all = async <R>(c: Q, sql: string, params: unknown[]): Promise<R[]> => (await c.query(sql, params)).rows as R[];
const notFound = (what: string): never => {
  throw new DomainError("NOT_FOUND", `${what} not found`, 404);
};

export class PgCatalogRepo implements CatalogRepo {
  constructor(private readonly pool: Pool) {}

  async clinics(ws: string) {
    return (await all<CRow>(this.pool, "SELECT * FROM clinic.clinics WHERE workspace_id = $1 ORDER BY code", [ws])).map(toClinic);
  }

  async getClinic(ws: string, code: string) {
    const c = await one<CRow>(this.pool, "SELECT * FROM clinic.clinics WHERE workspace_id = $1 AND code = $2", [ws, code]);
    if (!c) return null;
    const doctors = await all<DRow>(this.pool, "SELECT * FROM clinic.doctors WHERE workspace_id = $1 AND clinic_code = $2 ORDER BY code", [ws, code]);
    return { ...toClinic(c), doctors: doctors.map(toDoctor) };
  }

  async findDoctors(ws: string, q: ClinicDoctorQuery) {
    const [clinics, doctors] = await Promise.all([this.clinics(ws), this.doctors(this.pool, ws)]);
    const appointments = q.date ? await this.bookedOn(this.pool, ws, q.date) : [];
    return clinicFindDoctors({ clinics, doctors, appointments }, q);
  }

  async getDoctor(ws: string, code: string) {
    const d = await this.doctor(this.pool, ws, code);
    if (!d) return null;
    const c = (await one<CRow>(this.pool, "SELECT * FROM clinic.clinics WHERE workspace_id = $1 AND code = $2", [ws, d.clinicCode])) as CRow;
    return { ...d, clinicName: c.name, city: c.city };
  }

  async slots(ws: string, doctorCode: string, date: string) {
    const d = (await this.doctor(this.pool, ws, doctorCode)) ?? notFound(`doctor ${doctorCode}`);
    const free = clinicFreeSlots(d, await this.bookedOn(this.pool, ws, date, doctorCode), date);
    return { doctorCode, date, slots: clinicSlotTimes(d, date).map((time) => ({ time, free: free.includes(time) })), free };
  }

  async plans(ws: string) {
    return (await all<PlRow>(this.pool, "SELECT * FROM clinic.plans WHERE workspace_id = $1 ORDER BY code", [ws])).map(toPlan);
  }

  async getPlan(ws: string, code: string) {
    // Found through plan(), so a plan's page, its coverage and a visit's cost all read a code the same way: "pl-14" is PL-14.
    const plan = await this.plan(this.pool, ws, code);
    if (!plan) return null;
    const procedures = await this.procedures(ws);
    const cov = (await all<CovRow>(this.pool, "SELECT * FROM clinic.coverage WHERE workspace_id = $1 AND plan_code = $2", [ws, plan.code])).map(toCoverage);
    return { ...plan, coverage: procedures.map((pr) => this.line(plan, pr, cov.find((c) => c.procedureCode === pr.code) ?? null)) };
  }

  async procedures(ws: string) {
    return (await all<PrRow>(this.pool, "SELECT * FROM clinic.procedures WHERE workspace_id = $1 ORDER BY code", [ws])).map(toProcedure);
  }

  async coverage(ws: string, planCode: string, procedureCode: string) {
    const plan = (await this.getPlan(ws, planCode)) ?? notFound(`plan ${planCode}`);
    return plan.coverage.find((c) => c.procedureCode === procedureCode) ?? notFound(`procedure ${procedureCode}`);
  }

  async visitCost(ws: string, doctorCode: string, planCode: string | null, visitType: ClinicVisitType) {
    const d = (await this.doctor(this.pool, ws, doctorCode)) ?? notFound(`doctor ${doctorCode}`);
    const plan = planCode ? ((await this.plan(this.pool, ws, planCode)) ?? notFound(`plan ${planCode}`)) : null;
    if (!d.visitTypes.includes(visitType)) throw new DomainError("VISIT_TYPE_NOT_OFFERED", `${d.name} does not offer ${visitType} visits`, 422);
    const inNetwork = clinicInNetwork(d, plan?.code);
    return {
      doctorCode, planCode: plan?.code ?? null, visitType, inNetwork, feeCents: clinicFeeCents(d, visitType),
      copayCents: plan ? (visitType === "video" ? plan.videoCopayCents : plan.inPersonCopayCents) : null, costCents: clinicVisitCostCents(d, plan, visitType),
    };
  }

  async medications(ws: string) {
    return (await all<MRow>(this.pool, "SELECT * FROM clinic.medications WHERE workspace_id = $1 ORDER BY code", [ws])).map(toMedication);
  }

  async getMedication(ws: string, code: string) {
    const m = await one<MRow>(this.pool, "SELECT * FROM clinic.medications WHERE workspace_id = $1 AND code = $2", [ws, code]);
    return m ? { ...toMedication(m), prices: await this.prices(ws, m.code) } : null;
  }

  async prices(ws: string, medication: string, dosage?: string) {
    const [clinics, medications, prices] = await Promise.all([
      this.clinics(ws),
      this.medications(ws),
      all<PriceRow>(this.pool, "SELECT * FROM clinic.prices WHERE workspace_id = $1", [ws]).then((r) => r.map(toPrice)),
    ]);
    return clinicPrescriptionPrices({ clinics, medications, prices }, medication, dosage);
  }

  async getPatient(ws: string, email: string) {
    const p = await one<{ email: string; name: string; plan_code: string }>(this.pool, "SELECT * FROM clinic.patients WHERE workspace_id = $1 AND email = $2", [ws, email.trim().toLowerCase()]);
    return p ? { email: p.email, name: p.name, planCode: p.plan_code } : null;
  }

  // Shared with the write repos, so a booking reads the doctor exactly as a search does.
  async doctor(c: Q, ws: string, code: string, lock = false): Promise<ClinicDoctor | null> {
    const d = await one<DRow>(c, `SELECT * FROM clinic.doctors WHERE workspace_id = $1 AND code = $2${lock ? " FOR UPDATE" : ""}`, [ws, code]);
    return d ? toDoctor(d) : null;
  }

  async plan(c: Q, ws: string, code: string): Promise<ClinicPlan | null> {
    const p = await one<PlRow>(c, "SELECT * FROM clinic.plans WHERE workspace_id = $1 AND code = $2", [ws, code.trim().toUpperCase()]);
    return p ? toPlan(p) : null;
  }

  private async doctors(c: Q, ws: string) {
    return (await all<DRow>(c, "SELECT * FROM clinic.doctors WHERE workspace_id = $1 ORDER BY code", [ws])).map(toDoctor);
  }

  private async bookedOn(c: Q, ws: string, date: string, doctorCode?: string): Promise<ClinicAppointment[]> {
    const rows = await all<ARow>(c, `SELECT ${APPOINTMENT_COLS} FROM clinic.appointments WHERE workspace_id = $1 AND date = $2::date AND status = 'booked'${doctorCode ? " AND doctor_code = $3" : ""}`, doctorCode ? [ws, date, doctorCode] : [ws, date]);
    return rows.map(toAppointment);
  }

  private line(plan: ClinicPlan, pr: ClinicProcedure, cov: ReturnType<typeof toCoverage> | null): CoverageLine {
    return {
      planCode: plan.code, planName: plan.name, procedureCode: pr.code, procedureName: pr.name, priceCents: pr.priceCents, status: cov?.status ?? "not-covered",
      coinsurancePct: cov?.coinsurancePct ?? null, priorAuthorisation: cov?.status === "prior-authorisation", patientCostCents: clinicProcedureCostCents(pr, cov),
    };
  }
}
