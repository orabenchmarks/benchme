import { read, unrecorded, write, type LedgerRules } from "@benchme/site-kit";
import type { AppointmentsRepo } from "./appointments-repo.js";
import type { CatalogRepo } from "./catalog-repo.js";
import type { PrescriptionsRepo } from "./prescriptions-repo.js";

/** What the clinics' ledger keeps of the catalogue: the reads of one clinic, doctor (a day's slots among them), plan (one procedure's coverage among them), medication or patient. A visit's cost is a sum, not an entity. */
export const CATALOG_LEDGER: LedgerRules<CatalogRepo> = {
  clinics: unrecorded,
  findDoctors: unrecorded,
  plans: unrecorded,
  procedures: unrecorded,
  medications: unrecorded,
  prices: unrecorded,
  visitCost: unrecorded,
  getClinic: read("clinic", ([code]) => code),
  getDoctor: read("doctor", ([code]) => code),
  slots: read("doctor", ([doctorCode]) => doctorCode),
  getPlan: read("plan", ([code]) => code),
  coverage: read("plan", ([planCode]) => planCode),
  getMedication: read("medication", ([code]) => code),
  getPatient: read("patient", ([email]) => email),
};

export const APPOINTMENTS_LEDGER: LedgerRules<AppointmentsRepo> = {
  list: unrecorded,
  get: read("appointment", ([no]) => no),
  create: write("appointment", "create", (_args, appointment) => appointment?.appointmentNo),
  cancel: write("appointment", "cancel", ([no]) => no),
};

/** A refill request is its own entity; the prescription it is for is only read. */
export const PRESCRIPTIONS_LEDGER: LedgerRules<PrescriptionsRepo> = {
  list: unrecorded,
  refills: unrecorded,
  get: read("prescription", ([rxNo]) => rxNo),
  requestRefill: write("refill", "create", (_args, refill) => refill?.refillNo),
};
