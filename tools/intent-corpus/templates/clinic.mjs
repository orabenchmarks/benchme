/**
 * Clinic network intent templates (apps/clinic, "Calvenor Clinics"). Shaped on
 * the healthcare eval suite in GoogleChromeLabs/webmcp-tools' webmcp-evals
 * (Apache-2.0; tool schemas only, no demo site): find a doctor, check a
 * provider's network and a procedure's coverage, book an appointment, request a
 * medication refill, compare prescription prices. Those evals grade the tool
 * calls an agent makes; these grade the answer or the site's end state, so an
 * agent may use the pages, REST, MCP or WebMCP. Administrative only: no task
 * asks for, or depends on, medical advice. See ./index.mjs for the contract.
 *
 * The diary is what most of these turn on: the generator books some doctors'
 * days out on purpose (packages/scenarios/src/sites/clinic/generate.ts), and the
 * search tasks are built around one such day — that doctor would fit every
 * requirement if a slot were free. Every answer key is derived with
 * @benchme/scenarios' clinic rules, the same functions the site enforces.
 *
 * Claims: a booking or a cancellation changes which slots are free, so every
 * task that depends on, or changes, a day's diary claims that day in its city
 * (`clinic:day:<city>:<date>`). Prices and coverage never change.
 */
import { CLINIC_BUSY, addDays, clinicFindDoctors, clinicFreeSlots, clinicPrescriptionPrices, clinicProcedureCostCents, clinicSlotTimes, shuffle } from "../../../packages/scenarios/dist/index.js";
import { pick, usd } from "../kit.mjs";

const APP = "clinic";
const PAGES_AND_TOOLS = ["pages", "tools"];
/** New patients the booking tasks book for: names no seeded patient has, at a domain no seeded email uses. */
const NEW_FIRST = ["Aurelio", "Brisa", "Caspian", "Dorotea", "Evander", "Fiorella", "Gideon", "Henrike"];
const NEW_LAST = ["Abernathy", "Blackwood", "Calloway", "Dunmore", "Everhart", "Fairbanks", "Greenhalgh", "Holloway"];

const index = new WeakMap();
/** The clinic rows indexed once per seed (kit.mjs knows nothing of this site). */
function ix(ctx) {
  let x = index.get(ctx.rows);
  if (!x) {
    const r = ctx.rows.clinic;
    const clinic = new Map(r.clinics.map((c) => [c.code, c]));
    x = { r, clinic, doctor: new Map(r.doctors.map((d) => [d.code, d])), plan: new Map(r.plans.map((p) => [p.code, p])), medication: new Map(r.medications.map((m) => [m.code, m])), cityOf: (d) => clinic.get(d.clinicCode).city };
    index.set(ctx.rows, x);
  }
  return x;
}

const dayClaim = (city, date) => `clinic:day:${city.toLowerCase()}:${date}`;
const and = (parts) => (parts.length < 2 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`);
const dollars = (cents) => cents / 100;
const newPatient = (i) => {
  const first = NEW_FIRST[i % NEW_FIRST.length];
  const last = NEW_LAST[Math.floor(i / NEW_FIRST.length) % NEW_LAST.length];
  return { name: `${first} ${last}`, email: `${first}.${last}@patient.example`.toLowerCase() };
};
const doctorsPath = (q) =>
  `/api/v1/doctors?${new URLSearchParams(Object.entries({ city: q.city, specialty: q.specialty, language: q.language, visitType: q.visitType, plan: q.planCode, newPatients: q.newPatients ? "true" : undefined, date: q.date }).filter(([, v]) => v !== undefined))}`;
const without = (q, key) => Object.fromEntries(Object.entries(q).filter(([k]) => k !== key));
const feeOf = (d, visitType) => (visitType === "video" ? d.videoFeeCents : d.inPersonFeeCents);

/** What a query asks of a doctor, beyond city, specialty and date, in words. */
function asked(q, plan) {
  return [
    q.language && `speaks ${q.language}`,
    q.visitType && `offers ${q.visitType === "video" ? "video" : "in-person"} visits`,
    q.planCode && `is in network for the ${plan.name} plan (${plan.code})`,
    q.newPatients && "is accepting new patients",
  ].filter(Boolean);
}

/** Every doctor's day with every slot booked: (doctor, date). The search tasks are built around one. */
function fullDays(ctx) {
  const { r } = ix(ctx);
  const out = [];
  for (const doctor of r.doctors) {
    for (let i = 0; i < CLINIC_BUSY.days; i++) {
      const date = addDays(CLINIC_BUSY.from, i);
      if (clinicSlotTimes(doctor, date).length > 0 && clinicFreeSlots(doctor, r.appointments, date).length === 0) out.push({ doctor, date });
    }
  }
  return out;
}

/**
 * The requirement sets a fully booked doctor meets: always a plan they are in
 * network for, with or without one of their languages, a visit type they
 * offer, accepting new patients. Most requirements first.
 */
function requirementSets(doctor, rng, { visitAlways = false } = {}) {
  const sets = [];
  for (const language of [undefined, ...doctor.languages.filter((l) => l !== "English")]) {
    for (const planCode of doctor.networkPlans) {
      for (const visitType of [...(visitAlways ? [] : [undefined]), ...doctor.visitTypes]) {
        for (const newPatients of doctor.acceptingNewPatients ? [false, true] : [false]) {
          sets.push({ ...(language ? { language } : {}), planCode, ...(visitType ? { visitType } : {}), ...(newPatients ? { newPatients: true } : {}) });
        }
      }
    }
  }
  return shuffle(rng, sets).sort((a, b) => Object.keys(b).length - Object.keys(a).length);
}

export const clinicTemplates = [
  {
    key: "clinic-only-doctor",
    app: APP,
    oracle: "json",
    surfaces: PAGES_AND_TOOLS,
    count: 3,
    about:
      "Which doctor of a specialty in a city meets every requirement — a plan's network and at least one of: a language, a visit type, accepting new patients — and has a free appointment on a date. Exactly one does (`clinicFindDoctors`), and the requirements matter: without them, two or more doctors of that specialty in that city have a free slot that day. One more doctor meets every requirement but has no free slot that day (the seed books their day out). The miss names that doctor.",
    candidates: fullDays,
    claims: (s, ctx) => [dayClaim(ix(ctx).cityOf(s.doctor), s.date)],
    build({ doctor, date }, ctx, rng) {
      const { r, plan } = ix(ctx);
      const base = { city: ix(ctx).cityOf(doctor), specialty: doctor.specialty, date };
      for (const set of requirementSets(doctor, rng)) {
        const q = { ...base, ...set };
        const matches = clinicFindDoctors(r, q);
        if (Object.keys(set).length < 2 || matches.length !== 1 || matches[0].code === doctor.code || clinicFindDoctors(r, base).length < 2) continue;
        const p = plan.get(set.planCode);
        return {
          intent: `On the clinic network site, which ${doctor.specialty} doctor in ${base.city} ${and([...asked(set, p), `has a free appointment on ${date}`])}? Answer as JSON: {"doctor": "<the doctor's code, DR-…>"}.`,
          summary: `The one ${doctor.specialty} doctor in ${base.city} who meets every requirement and has a free slot that day.`,
          oracle: { kind: "json", expect: { doctor: matches[0].code } },
          note: `${base.city} ${doctor.specialty} ${date}, ${Object.entries(set).map(([k, v]) => `${k}=${v}`).join(", ")} → ${matches[0].code}; ${doctor.code} meets every requirement but is fully booked`,
          answer: async (api) => ({ doctor: api.only(await api.get(APP, doctorsPath(q))).code }),
          miss: async () => ({ doctor: doctor.code }),
        };
      }
      return null;
    },
  },
  {
    key: "clinic-no-doctor",
    app: APP,
    oracle: "json",
    surfaces: PAGES_AND_TOOLS,
    count: 3,
    about:
      "Whether any doctor of a specialty in a city meets every requirement — a plan's network, a visit type, and some of: a language, accepting new patients — and has a free appointment on a date. None does, and which doctor comes closest: of those meeting every requirement except the plan's network, the one with the lowest fee for that visit type (no tie for lowest). One doctor meets every requirement but has no free slot that day. The miss says one exists and names that doctor.",
    candidates: fullDays,
    claims: (s, ctx) => [dayClaim(ix(ctx).cityOf(s.doctor), s.date)],
    build({ doctor, date }, ctx, rng) {
      const { r, plan } = ix(ctx);
      const base = { city: ix(ctx).cityOf(doctor), specialty: doctor.specialty, date };
      for (const set of requirementSets(doctor, rng, { visitAlways: true })) {
        const q = { ...base, ...set };
        if (clinicFindDoctors(r, q).length > 0) continue;
        const pool = clinicFindDoctors(r, without(q, "planCode")).sort((a, b) => feeOf(a, set.visitType) - feeOf(b, set.visitType));
        const [closest, next] = pool;
        if (!closest || (next && feeOf(next, set.visitType) === feeOf(closest, set.visitType))) continue;
        const p = plan.get(set.planCode);
        const visit = set.visitType === "video" ? "video" : "in-person";
        return {
          intent: `On the clinic network site, is there a ${doctor.specialty} doctor in ${base.city} who ${and([...asked(set, p), `has a free appointment on ${date}`])}? Also name the doctor who comes closest: of the ${doctor.specialty} doctors in ${base.city} who meet every one of those requirements except being in network for the ${p.name} plan, the one with the lowest ${visit} visit fee. Answer as JSON: {"exists": <true or false>, "closest": "<the doctor's code, DR-…>"}.`,
          summary: `No ${doctor.specialty} doctor in ${base.city} meets every requirement that day; the closest is the cheapest one outside the plan's network.`,
          oracle: { kind: "json", expect: { exists: false, closest: closest.code } },
          note: `${base.city} ${doctor.specialty} ${date}, ${Object.entries(set).map(([k, v]) => `${k}=${v}`).join(", ")} → none; closest ${closest.code} at ${usd(feeOf(closest, set.visitType))}; ${doctor.code} meets every requirement but is fully booked`,
          answer: async (api) => ({
            exists: (await api.get(APP, doctorsPath(q))).length > 0,
            closest: (await api.get(APP, doctorsPath(without(q, "planCode")))).sort((a, b) => feeOf(a, set.visitType) - feeOf(b, set.visitType))[0]?.code ?? "",
          }),
          miss: async () => ({ exists: true, closest: doctor.code }),
        };
      }
      return null;
    },
  },
  {
    key: "clinic-visit-cost",
    app: APP,
    oracle: "json",
    surfaces: PAGES_AND_TOOLS,
    count: 3,
    about:
      "What a patient on a plan pays in total for an in-person visit with a named doctor and a named procedure, and whether the plan requires prior authorisation for it. The doctor is not in the plan's network, so the visit costs the doctor's fee, not the copay (`clinicVisitCostCents`); the procedure is covered, with or without prior authorisation, so it costs the coinsurance share of its price (`clinicProcedureCostCents`); ±0.01. The miss takes the plan's copay for the visit.",
    candidates: (ctx) => {
      const { r } = ix(ctx);
      return r.doctors
        .filter((d) => d.visitTypes.includes("in-person"))
        .flatMap((doctor) => r.coverage.filter((c) => c.status !== "not-covered" && !doctor.networkPlans.includes(c.planCode)).map((cov) => ({ doctor, cov })));
    },
    claims: (s) => [`clinic:cost:${s.doctor.code}`],
    build({ doctor, cov }, ctx) {
      const { r, plan } = ix(ctx);
      const p = plan.get(cov.planCode);
      const procedure = r.procedures.find((x) => x.code === cov.procedureCode);
      const share = clinicProcedureCostCents(procedure, cov);
      const total = dollars(doctor.inPersonFeeCents + share);
      const prior = cov.status === "prior-authorisation";
      const live = async (api) => {
        const [d, pl] = await Promise.all([api.get(APP, `/api/v1/doctors/${doctor.code}`), api.get(APP, `/api/v1/plans/${p.code}`)]);
        const line = pl.coverage.find((c) => c.procedureCode === procedure.code);
        const cost = line.status === "not-covered" ? line.priceCents : Math.round((line.priceCents * line.coinsurancePct) / 100);
        return { d, pl, line, cost };
      };
      return {
        intent: `On the clinic network site, a patient on the ${p.name} plan (${p.code}) has an in-person visit with ${doctor.name} (${doctor.code}) and, at that visit, the ${procedure.name} (${procedure.code}). What do they pay in total for the visit and the procedure, and does their plan require prior authorisation for the procedure? Assume any prior authorisation the plan requires is given. Answer as JSON: {"total": <dollars>, "priorAuthorisation": <true or false>}.`,
        summary: `The visit at the price the plan's network sets for this doctor, plus the patient's share of the procedure under the plan, and whether the plan requires prior authorisation for it.`,
        oracle: { kind: "json", expect: { total: { value: total, tolerance: 0.01 }, priorAuthorisation: prior } },
        note: `${doctor.code} is out of network for ${p.code}: fee ${usd(doctor.inPersonFeeCents)} (copay would be ${usd(p.inPersonCopayCents)}) + ${procedure.code} ${cov.coinsurancePct}% of ${usd(procedure.priceCents)} = ${usd(share)}${prior ? ", prior authorisation" : ""} → $${total.toFixed(2)}`,
        answer: async (api) => {
          const { d, pl, line, cost } = await live(api);
          const visit = d.networkPlans.includes(pl.code) ? pl.inPersonCopayCents : d.inPersonFeeCents;
          return { total: dollars(visit + cost), priorAuthorisation: line.status === "prior-authorisation" };
        },
        miss: async (api) => {
          const { pl, line, cost } = await live(api);
          return { total: dollars(pl.inPersonCopayCents + cost), priorAuthorisation: line.status === "prior-authorisation" };
        },
      };
    },
  },
  {
    key: "clinic-book-earliest",
    app: APP,
    oracle: "state",
    surfaces: PAGES_AND_TOOLS,
    count: 3,
    about:
      "Book a new patient (a name and email no seeded appointment has) on a named plan into the earliest free slot with a named doctor, accepting new patients, on a date at or after a time. The slot at that time is taken, a slot earlier in the day is free. The check reads the patient's appointments: exactly one booked, with that doctor, date, time, visit type and plan. The miss books the day's first free slot, before the time asked.",
    candidates: (ctx) => {
      const { r } = ix(ctx);
      const out = [];
      for (const doctor of r.doctors.filter((d) => d.acceptingNewPatients)) {
        for (let i = 0; i < CLINIC_BUSY.days; i++) {
          const date = addDays(CLINIC_BUSY.from, i);
          const free = clinicFreeSlots(doctor, r.appointments, date);
          for (const after of clinicSlotTimes(doctor, date).filter((t) => !free.includes(t))) {
            const earliest = free.find((t) => t > after);
            if (earliest && free[0] < after) out.push({ doctor, date, after, earliest, first: free[0], patient: newPatient(out.length) });
          }
        }
      }
      return out;
    },
    claims: (s, ctx) => [dayClaim(ix(ctx).cityOf(s.doctor), s.date), `clinic:patient:${s.patient.email}`],
    build({ doctor, date, after, earliest, first, patient }, ctx, rng) {
      const { r } = ix(ctx);
      const visitType = pick(rng, doctor.visitTypes);
      const plan = pick(rng, r.plans);
      const body = (time) => ({ doctorCode: doctor.code, date, time, visitType, planCode: plan.code, patientName: patient.name, patientEmail: patient.email });
      const freeOn = async (api) => (await api.get(APP, `/api/v1/doctors/${doctor.code}/slots?date=${date}`)).free;
      const visit = visitType === "video" ? "video" : "in-person";
      return {
        intent: `On the clinic network site, book ${patient.name} (${patient.email}), a new patient on the ${plan.name} plan (${plan.code}), into the earliest free ${visit} appointment with ${doctor.name} (${doctor.code}) on ${date} that starts at ${after} or later.`,
        summary: `${patient.email} has one booked ${visit} appointment with ${doctor.code} on ${date}: the earliest free slot from the time asked, billed to the plan.`,
        oracle: {
          kind: "state",
          checks: [
            {
              name: "booked-earliest",
              app: APP,
              path: `/api/v1/appointments?patientEmail=${encodeURIComponent(patient.email)}`,
              where: { status: "booked" },
              count: { min: 1, max: 1 },
              expect: { doctorCode: doctor.code, date, time: earliest, visitType, planCode: plan.code },
            },
          ],
        },
        note: `${patient.email} → ${doctor.code} ${date} ${visit}, ${plan.code}: ${after} is taken, earliest free after it ${earliest}; ${first} is free but earlier`,
        solve: async (api) => api.post(APP, "/api/v1/appointments", body((await freeOn(api)).find((t) => t >= after))),
        miss: async (api) => api.post(APP, "/api/v1/appointments", body((await freeOn(api))[0])),
      };
    },
  },
  {
    key: "clinic-cancel-one",
    app: APP,
    oracle: "state",
    surfaces: PAGES_AND_TOOLS,
    count: 3,
    about:
      "Cancel one of a seeded patient's booked appointments, named by its doctor and date, and leave the patient's other appointments alone. Asked of a patient who has another booked appointment with the same doctor on another date, and no other appointment with that doctor on that date. One check per booked appointment of the patient: `cancelled` for the one named, `booked` for the rest. The miss cancels the other appointment with the same doctor.",
    candidates: (ctx) => {
      const byPatient = new Map();
      for (const a of ix(ctx).r.appointments) byPatient.set(a.patientEmail, [...(byPatient.get(a.patientEmail) ?? []), a]);
      return [...byPatient.values()].flatMap((all) => {
        const live = all.filter((a) => a.status === "booked");
        return live
          .filter((t) => all.filter((a) => a.doctorCode === t.doctorCode && a.date === t.date).length === 1)
          .flatMap((target) => {
            const sibling = live.find((a) => a !== target && a.doctorCode === target.doctorCode);
            return sibling ? [{ target, sibling, live }] : [];
          });
      });
    },
    claims: ({ target }, ctx) => [`clinic:patient:${target.patientEmail}`, dayClaim(ix(ctx).cityOf(ix(ctx).doctor.get(target.doctorCode)), target.date)],
    build({ target, sibling, live }, ctx) {
      const doctor = ix(ctx).doctor.get(target.doctorCode);
      const status = (a) => (a.appointmentNo === target.appointmentNo ? "cancelled" : "booked");
      const cancel = (api, no) => api.post(APP, `/api/v1/appointments/${no}/cancel`, {});
      return {
        intent: `On the clinic network site, ${target.patientName} (${target.patientEmail}) has several appointments. Cancel only their appointment with ${doctor.name} on ${target.date}, and leave their other appointments as they are.`,
        summary: `${target.patientEmail}'s appointment with ${doctor.code} on ${target.date} is cancelled; their other booked appointments are still booked.`,
        oracle: { kind: "state", checks: live.map((a) => ({ name: `${a.appointmentNo}-${status(a)}`, app: APP, path: `/api/v1/appointments/${a.appointmentNo}`, expect: { status: status(a) } })) },
        note: `${target.patientEmail}: ${target.appointmentNo} (${doctor.code}, ${target.date}) → cancelled; ${live.filter((a) => a !== target).map((a) => a.appointmentNo).join(", ")} stay booked (${sibling.appointmentNo} is with ${doctor.code} on ${sibling.date})`,
        solve: async (api) => {
          const mine = await api.list(APP, `/api/v1/appointments?patientEmail=${encodeURIComponent(target.patientEmail)}`);
          await cancel(api, api.only(mine.filter((a) => a.doctorCode === doctor.code && a.date === target.date && a.status === "booked")).appointmentNo);
        },
        miss: (api) => cancel(api, sibling.appointmentNo),
      };
    },
  },
  {
    key: "clinic-refill-cheapest",
    app: APP,
    oracle: "state",
    surfaces: PAGES_AND_TOOLS,
    count: 3,
    about:
      "Request a refill of one of a seeded patient's prescriptions, named by medication and dosage, to be collected at the pharmacy that charges the least for that medication at that dosage (`clinicPrescriptionPrices`, first offer; strictly cheaper than the next). The patient also holds a prescription of the same medication at another dosage; both have refills left and no refill requested. The checks: exactly one requested refill of the named prescription, at that pharmacy; its refills left down by one; the other dosage's refills left unchanged. The miss requests the other dosage's refill.",
    candidates: (ctx) => {
      const { r } = ix(ctx);
      const open = new Set(r.refills.filter((f) => f.status === "requested").map((f) => f.rxNo));
      const refillable = (p) => p.refillsLeft > 0 && !open.has(p.rxNo);
      return r.prescriptions.filter(refillable).flatMap((rx) => {
        const other = r.prescriptions.find((p) => p !== rx && p.patientEmail === rx.patientEmail && p.medicationCode === rx.medicationCode && refillable(p));
        return other ? [{ rx, other }] : [];
      });
    },
    claims: ({ rx, other }) => [`clinic:rx:${rx.rxNo}`, `clinic:rx:${other.rxNo}`],
    build({ rx, other }, ctx) {
      const { r, medication } = ix(ctx);
      const med = medication.get(rx.medicationCode);
      const [best, next] = clinicPrescriptionPrices(r, med.code, rx.dosage);
      if (!best || !next || next.priceCents === best.priceCents || clinicPrescriptionPrices(r, med.code, other.dosage).length === 0) return null;
      const cheapestFor = async (api, dosage) => (await api.get(APP, `/api/v1/prices?medication=${med.code}&dosage=${encodeURIComponent(dosage)}`))[0].clinicCode;
      const refill = async (api, dosage) => {
        const mine = await api.get(APP, `/api/v1/prescriptions?patientEmail=${encodeURIComponent(rx.patientEmail)}`);
        const target = api.only(mine.filter((p) => p.medicationCode === med.code && p.dosage === dosage));
        return api.post(APP, `/api/v1/prescriptions/${target.rxNo}/refill`, { pharmacyCode: await cheapestFor(api, dosage) });
      };
      return {
        intent: `On the clinic network site, request a refill of ${rx.patientName}'s (${rx.patientEmail}) ${med.name} ${rx.dosage} prescription, to be collected at the pharmacy in the network that charges the least for ${med.name} ${rx.dosage}.`,
        summary: `${rx.patientEmail}'s ${med.name} ${rx.dosage} prescription has one refill requested, at the cheapest pharmacy for it; their other ${med.name} prescription is untouched.`,
        oracle: {
          kind: "state",
          checks: [
            { name: "refill-requested", app: APP, path: `/api/v1/refills?rxNo=${rx.rxNo}`, where: { status: "requested" }, count: { min: 1, max: 1 }, expect: { pharmacyCode: best.clinicCode } },
            { name: "refills-left", app: APP, path: `/api/v1/prescriptions/${rx.rxNo}`, expect: { refillsLeft: rx.refillsLeft - 1 } },
            { name: `${other.rxNo}-untouched`, app: APP, path: `/api/v1/prescriptions/${other.rxNo}`, expect: { refillsLeft: other.refillsLeft, refillPending: false } },
          ],
        },
        note: `${rx.patientEmail}: ${rx.rxNo} (${med.code} ${rx.dosage}) → refill at ${best.clinicCode} ${usd(best.priceCents)} (next ${next.clinicCode} ${usd(next.priceCents)}); ${other.rxNo} (${other.dosage}) untouched`,
        solve: (api) => refill(api, rx.dosage),
        miss: (api) => refill(api, other.dosage),
      };
    },
  },
];
