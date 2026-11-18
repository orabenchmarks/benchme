import { describe, expect, it } from "vitest";
import { webmcpV1 } from "../../webmcp-v1/index.js";
import { CITY_LIST } from "../../acme-v1/names.js";
import { addDays } from "../../stays.js";
import { CLINIC_BUSY, CLINIC_SIZES, clinicRows } from "./generate.js";
import {
  clinicAppointmentProblem,
  clinicFindDoctors,
  clinicFreeSlots,
  clinicPrescriptionPrices,
  clinicProcedureCostCents,
  clinicRefillProblem,
  clinicSlotTimes,
  clinicVisitCostCents,
} from "./rules.js";
import type { ClinicAppointment, ClinicDoctor, ClinicPlan, ClinicPrescription, ClinicRows } from "./types.js";

describe("webmcp-v1 clinic rows", () => {
  const rows = clinicRows(4242);
  const doctorOf = new Map(rows.doctors.map((d) => [d.code, d]));

  it("is byte-identical for the same seed, and the same rows webmcpV1.generate carries", () => {
    expect(JSON.stringify(clinicRows(4242))).toBe(JSON.stringify(rows));
    expect(JSON.stringify(clinicRows(4243))).not.toBe(JSON.stringify(rows));
    expect(webmcpV1.generate(4242).clinic).toEqual(rows);
  });

  it("has unique natural keys and every reference resolves", () => {
    const keys = <T>(items: T[], key: (x: T) => string) => expect(new Set(items.map(key)).size).toBe(items.length);
    keys(rows.clinics, (c) => c.code);
    keys(rows.clinics, (c) => c.name);
    keys(rows.doctors, (d) => d.code);
    keys(rows.doctors, (d) => d.name);
    keys(rows.plans, (p) => p.code);
    keys(rows.procedures, (p) => p.code);
    keys(rows.medications, (m) => m.name);
    keys(rows.patients, (p) => p.email);
    keys(rows.appointments, (a) => a.appointmentNo);
    keys(rows.prescriptions, (p) => p.rxNo);
    keys(rows.refills, (r) => r.refillNo);
    keys(rows.coverage, (c) => `${c.planCode}/${c.procedureCode}`);
    keys(rows.prices, (p) => `${p.clinicCode}/${p.medicationCode}/${p.dosage}`);
    expect(rows.coverage.length).toBe(rows.plans.length * rows.procedures.length);
    for (const city of CITY_LIST) expect(rows.clinics.some((c) => c.city === city)).toBe(true);
    const clinics = new Set(rows.clinics.map((c) => c.code));
    const plans = new Set(rows.plans.map((p) => p.code));
    const meds = new Map(rows.medications.map((m) => [m.code, m]));
    for (const d of rows.doctors) {
      expect(clinics.has(d.clinicCode)).toBe(true);
      for (const p of d.networkPlans) expect(plans.has(p)).toBe(true);
      expect(d.inPersonFeeCents === null).toBe(!d.visitTypes.includes("in-person"));
      expect(d.videoFeeCents === null).toBe(!d.visitTypes.includes("video"));
    }
    for (const p of rows.patients) expect(plans.has(p.planCode)).toBe(true);
    for (const p of rows.prices) expect(clinics.has(p.clinicCode) && meds.get(p.medicationCode)?.dosages.includes(p.dosage)).toBe(true);
    for (const rx of rows.prescriptions) expect(meds.get(rx.medicationCode)?.dosages.includes(rx.dosage) && doctorOf.has(rx.doctorCode)).toBe(true);
    const rxNos = new Set(rows.prescriptions.map((p) => p.rxNo));
    for (const r of rows.refills) expect(rxNos.has(r.rxNo) && clinics.has(r.pharmacyCode)).toBe(true);
  });

  it("holds every seeded appointment to the booking rules, prices it as the rules do, and books some days out on purpose", () => {
    const planOf = new Map(rows.plans.map((p) => [p.code, p]));
    for (const a of rows.appointments) {
      const d = doctorOf.get(a.doctorCode) as ClinicDoctor;
      expect(a.clinicCode).toBe(d.clinicCode);
      expect(a.costCents).toBe(clinicVisitCostCents(d, a.planCode ? (planOf.get(a.planCode) as ClinicPlan) : null, a.visitType));
      // A booked row is valid against every other row; a cancelled one holds nothing, so only its shape is checked.
      const others = a.status === "booked" ? rows.appointments.filter((x) => x !== a) : [];
      expect(clinicAppointmentProblem(a.status === "booked" ? d : { ...d, acceptingNewPatients: true }, a, others)).toBeNull();
    }
    let full = 0;
    for (const d of rows.doctors) {
      for (let i = 0; i < CLINIC_BUSY.days; i++) {
        const date = addDays(CLINIC_BUSY.from, i);
        if (clinicSlotTimes(d, date).length > 0 && clinicFreeSlots(d, rows.appointments, date).length === 0) full++;
      }
    }
    expect(full).toBeGreaterThanOrEqual(CLINIC_SIZES.fullDays - 2);
    expect(rows.appointments.some((a) => a.status === "cancelled")).toBe(true);
    expect(rows.doctors.some((d) => !d.acceptingNewPatients && rows.appointments.some((a) => a.doctorCode === d.code))).toBe(true);
  });

  it("seeds prescriptions every refill rule bites on: none left, one already requested, two dosages of one medication", () => {
    expect(rows.prescriptions.some((p) => p.refillsLeft === 0)).toBe(true);
    for (const r of rows.refills.filter((x) => x.status === "requested")) {
      const rx = rows.prescriptions.find((p) => p.rxNo === r.rxNo) as ClinicPrescription;
      expect(clinicRefillProblem(rx, r.pharmacyCode, rows.prices, rows.refills)?.code).toBe("ALREADY_REQUESTED");
      expect(rows.refills.filter((x) => x.rxNo === r.rxNo && x.status === "requested")).toHaveLength(1);
    }
    expect(rows.refills.some((r) => r.status === "requested")).toBe(true);
    const pairs = rows.prescriptions.filter((p) => rows.prescriptions.some((q) => q !== p && q.patientEmail === p.patientEmail && q.medicationCode === p.medicationCode));
    expect(pairs.length).toBeGreaterThanOrEqual(4);
  });
});

describe("clinic rules", () => {
  const doctor: ClinicDoctor = {
    code: "DR-1", name: "Dr. One", clinicCode: "CL-1", specialty: "general practice", languages: ["English", "Polish"], visitTypes: ["in-person"], acceptingNewPatients: false,
    networkPlans: ["PL-1"], inPersonFeeCents: 12000, videoFeeCents: null, workDays: [1, 3], session: "morning",
  };
  const other: ClinicDoctor = { ...doctor, code: "DR-2", name: "Dr. Two", languages: ["English"], visitTypes: ["in-person", "video"], acceptingNewPatients: true, networkPlans: ["PL-2"], videoFeeCents: 8000 };
  const plan: ClinicPlan = { code: "PL-1", name: "One", inPersonCopayCents: 2000, videoCopayCents: 1000 };
  const appt = (doctorCode: string, date: string, time: string, email: string, status: ClinicAppointment["status"] = "booked"): ClinicAppointment => ({
    appointmentNo: `AP-${doctorCode}-${date}-${time}`, doctorCode, clinicCode: "CL-1", patientName: "P", patientEmail: email, planCode: null, date, time, visitType: "in-person", status, costCents: 0, createdAt: "",
  });
  // 2027-04-12 is a Monday.
  const req = { date: "2027-04-12", time: "09:30", visitType: "in-person" as const, patientEmail: "known@example.com" };
  const history = [appt("DR-1", "2027-03-01", "09:00", "known@example.com")];

  it("refuses each booking rule on its own", () => {
    expect(clinicAppointmentProblem(doctor, req, history)).toBeNull();
    expect(clinicAppointmentProblem(doctor, { ...req, date: "2027-02-30" }, history)?.code).toBe("BAD_DATE");
    expect(clinicAppointmentProblem(doctor, { ...req, date: "2028-01-03" }, history)?.code).toBe("OUTSIDE_WINDOW");
    expect(clinicAppointmentProblem(doctor, { ...req, date: "2027-04-13" }, history)?.code).toBe("NOT_WORKING");
    expect(clinicAppointmentProblem(doctor, { ...req, time: "13:00" }, history)?.code).toBe("NO_SUCH_SLOT");
    expect(clinicAppointmentProblem(doctor, { ...req, visitType: "video" }, history)?.code).toBe("VISIT_TYPE_NOT_OFFERED");
    expect(clinicAppointmentProblem(doctor, { ...req, patientEmail: "new@example.com" }, history)?.code).toBe("NOT_ACCEPTING_NEW_PATIENTS");
    expect(clinicAppointmentProblem(doctor, req, [appt("DR-1", "2027-03-01", "09:00", "known@example.com", "cancelled")])?.code).toBe("NOT_ACCEPTING_NEW_PATIENTS");
    expect(clinicAppointmentProblem(doctor, req, [...history, appt("DR-1", "2027-04-12", "09:30", "else@example.com")])?.code).toBe("SLOT_TAKEN");
    expect(clinicAppointmentProblem(doctor, req, [...history, appt("DR-1", "2027-04-12", "09:30", "else@example.com", "cancelled")])).toBeNull();
    expect(clinicAppointmentProblem(doctor, req, [...history, appt("DR-2", "2027-04-12", "09:30", "KNOWN@example.com")])?.code).toBe("PATIENT_BUSY");
  });

  it("prices a visit at the copay in network and the fee out of it, and a procedure at the coinsurance share", () => {
    expect(clinicVisitCostCents(doctor, plan, "in-person")).toBe(2000);
    expect(clinicVisitCostCents(other, plan, "in-person")).toBe(12000);
    expect(clinicVisitCostCents(other, null, "video")).toBe(8000);
    expect(() => clinicVisitCostCents(doctor, plan, "video")).toThrow();
    const scan = { code: "PR-1", name: "Scan", priceCents: 45050 };
    expect(clinicProcedureCostCents(scan, { planCode: "PL-1", procedureCode: "PR-1", status: "covered", coinsurancePct: 20 })).toBe(9010);
    expect(clinicProcedureCostCents(scan, { planCode: "PL-1", procedureCode: "PR-1", status: "prior-authorisation", coinsurancePct: 30 })).toBe(13515);
    expect(clinicProcedureCostCents(scan, { planCode: "PL-1", procedureCode: "PR-1", status: "not-covered", coinsurancePct: null })).toBe(45050);
    expect(clinicProcedureCostCents(scan, null)).toBe(45050);
  });

  it("refuses each refill rule on its own", () => {
    const rx: ClinicPrescription = { rxNo: "RX-1", patientEmail: "p@example.com", patientName: "P", medicationCode: "MED-1", dosage: "20 mg", doctorCode: "DR-1", refillsLeft: 1, issuedOn: "2027-01-10" };
    const prices = [{ clinicCode: "CL-1", medicationCode: "MED-1", dosage: "20 mg", priceCents: 900 }];
    expect(clinicRefillProblem(rx, "CL-1", prices, [])).toBeNull();
    expect(clinicRefillProblem({ ...rx, refillsLeft: 0 }, "CL-1", prices, [])?.code).toBe("NO_REFILLS_LEFT");
    expect(clinicRefillProblem(rx, "CL-2", prices, [])?.code).toBe("NOT_STOCKED");
    expect(clinicRefillProblem({ ...rx, dosage: "10 mg" }, "CL-1", prices, [])?.code).toBe("NOT_STOCKED");
    expect(clinicRefillProblem(rx, "CL-1", prices, [{ refillNo: "RF-1", rxNo: "RX-1", pharmacyCode: "CL-1", status: "requested", requestedAt: "" }])?.code).toBe("ALREADY_REQUESTED");
    expect(clinicRefillProblem(rx, "CL-1", prices, [{ refillNo: "RF-1", rxNo: "RX-1", pharmacyCode: "CL-1", status: "collected", requestedAt: "" }])).toBeNull();
  });

  it("finds doctors by every filter, and by a date only when they have a free slot that day", () => {
    const rows: Pick<ClinicRows, "clinics" | "doctors" | "appointments"> = {
      clinics: [{ code: "CL-1", name: "C", city: "Velmora", address: "", phone: "", pharmacyPhone: "" }],
      doctors: [doctor, other],
      appointments: ["09:00", "09:30", "10:00", "10:30", "11:00", "11:30"].map((t) => appt("DR-2", "2027-04-12", t, `${t}@example.com`)),
    };
    const codes = (q: Parameters<typeof clinicFindDoctors>[1]) => clinicFindDoctors(rows, q).map((d) => d.code);
    expect(codes({ city: "velmora" })).toEqual(["DR-1", "DR-2"]);
    expect(codes({ city: "Ostrand" })).toEqual([]);
    expect(codes({ language: "polish" })).toEqual(["DR-1"]);
    expect(codes({ visitType: "video" })).toEqual(["DR-2"]);
    expect(codes({ planCode: "pl-2" })).toEqual(["DR-2"]);
    expect(codes({ newPatients: true })).toEqual(["DR-2"]);
    expect(codes({ date: "2027-04-12" })).toEqual(["DR-1"]);
    expect(codes({ date: "2027-04-14" })).toEqual(["DR-1", "DR-2"]);
    expect(codes({ date: "2027-04-13" })).toEqual([]);
    expect(clinicFindDoctors(rows, { date: "2027-04-14" })[0]?.freeSlots).toEqual(["09:00", "09:30", "10:00", "10:30", "11:00", "11:30"]);
  });

  it("lists pharmacy prices by medication code or name and dosage, cheapest first", () => {
    const rows = {
      clinics: [{ code: "CL-1", name: "A", city: "Velmora", address: "", phone: "", pharmacyPhone: "555-0101" }, { code: "CL-2", name: "B", city: "Ostrand", address: "", phone: "", pharmacyPhone: "555-0103" }],
      medications: [{ code: "MED-1", name: "Kalorex", dosages: ["10 mg", "20 mg"] }],
      prices: [
        { clinicCode: "CL-1", medicationCode: "MED-1", dosage: "20 mg", priceCents: 1200 },
        { clinicCode: "CL-2", medicationCode: "MED-1", dosage: "20 mg", priceCents: 1100 },
        { clinicCode: "CL-1", medicationCode: "MED-1", dosage: "10 mg", priceCents: 700 },
      ],
    };
    expect(clinicPrescriptionPrices(rows, "kalorex", "20mg").map((o) => [o.clinicCode, o.priceCents])).toEqual([["CL-2", 1100], ["CL-1", 1200]]);
    expect(clinicPrescriptionPrices(rows, "MED-1").map((o) => o.dosage)).toEqual(["10 mg", "20 mg", "20 mg"]);
    expect(clinicPrescriptionPrices(rows, "Nothing")).toEqual([]);
  });
});
