import { CLINIC_VISIT_TYPES, isDate, type ClinicDoctorQuery } from "@benchme/scenarios";
import { z } from "zod";

/**
 * The input shapes REST, MCP and the pages share, so every door accepts the
 * same thing. Every amount the site returns is cents (`inPersonFeeCents`,
 * `costCents`, `priceCents`); none of its inputs is money.
 */
/** A form or query string sends "" for a field left empty: that is "not given", not an empty value. */
const blank = (v: unknown) => (v === "" ? undefined : v);
const optional = <S extends z.ZodTypeAny>(s: S) => z.preprocess(blank, s.optional());

export const date = z.string().refine(isDate, "a date as YYYY-MM-DD");
export const time = z.string().regex(/^\d{2}:\d{2}$/, "a slot start time as HH:MM");
export const visitType = z.enum(CLINIC_VISIT_TYPES);
const flag = z.union([z.boolean(), z.enum(["true", "false", "1", "0", "on"])]).transform((v) => v === true || v === "true" || v === "1" || v === "on");

export const doctorQueryInput = {
  city: optional(z.string()),
  specialty: optional(z.string()),
  language: optional(z.string()),
  visitType: optional(visitType),
  plan: optional(z.string()),
  newPatients: optional(flag),
  date: optional(date),
};
export const doctorQuerySchema = z.object(doctorQueryInput);
export type DoctorQueryInput = z.infer<typeof doctorQuerySchema>;

export const toDoctorQuery = (q: DoctorQueryInput): ClinicDoctorQuery => ({
  ...(q.city ? { city: q.city } : {}),
  ...(q.specialty ? { specialty: q.specialty } : {}),
  ...(q.language ? { language: q.language } : {}),
  ...(q.visitType ? { visitType: q.visitType } : {}),
  ...(q.plan ? { planCode: q.plan } : {}),
  ...(q.newPatients ? { newPatients: true } : {}),
  ...(q.date ? { date: q.date } : {}),
});

export const appointmentInput = {
  doctorCode: z.string().min(1),
  date,
  time,
  visitType,
  planCode: optional(z.string().min(1)),
  patientName: z.string().min(1),
  patientEmail: z.string().email(),
};
export const appointmentSchema = z.object(appointmentInput);

export const refillInput = { pharmacyCode: z.string().min(1) };
export const refillSchema = z.object(refillInput);

export const appointmentsQuery = z.object({
  patientEmail: optional(z.string()),
  doctor: optional(z.string()),
  date: optional(date),
  status: optional(z.enum(["booked", "cancelled"])),
  cursor: optional(z.string()),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type AppointmentsQuery = z.infer<typeof appointmentsQuery>;
export const toAppointmentFilter = (f: AppointmentsQuery) => ({
  ...(f.patientEmail ? { patientEmail: f.patientEmail } : {}),
  ...(f.doctor ? { doctor: f.doctor } : {}),
  ...(f.date ? { date: f.date } : {}),
  ...(f.status ? { status: f.status } : {}),
  ...(f.cursor ? { cursor: f.cursor } : {}),
  limit: f.limit,
});
