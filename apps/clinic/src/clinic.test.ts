import { VERIFIER_SIG_HEADER, WORKSPACE_HEADER, WORKSPACE_SIG_HEADER, createPool, migrate, newWorkspaceId, signVerifierHeader, signWorkspaceHeader, type Pool } from "@benchme/core";
import {
  webmcpV1,
  addDays,
  clinicFindDoctors,
  clinicFreeSlots,
  clinicPrescriptionPrices,
  clinicSlotTimes,
  clinicVisitCostCents,
  scenarios,
  type ClinicDoctor,
  type ClinicRows,
} from "@benchme/scenarios";
import { SIGN_IN_TOOLS, type LedgerEntry, type Mailer } from "@benchme/site-kit";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { FastifyInstance, InjectOptions } from "fastify";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildClinic } from "./build-app.js";

const DB = process.env.DATABASE_URL;
const SECRET = "gateway-secret-for-tests";
const here = dirname(fileURLToPath(import.meta.url));

class CapturingMailer implements Mailer {
  sent: { ws: string; to: string; subject: string; body: string }[] = [];
  async deliver(ws: string, msg: { to: string; subject: string; body: string }) {
    this.sent.push({ ws, ...msg });
  }
}

let pool: Pool;
let app: FastifyInstance;
let mailer: CapturingMailer;
let ws: string;
let rows: ClinicRows;
let bearer = "";
let cookie = "";
let baseUrl = "";
const scoped = (o: InjectOptions & { url: string }, wsId = ws): InjectOptions => ({
  ...o,
  headers: { ...(o.headers ?? {}), [WORKSPACE_HEADER]: wsId, [WORKSPACE_SIG_HEADER]: signWorkspaceHeader(SECRET, wsId), "x-forwarded-prefix": `/w/${wsId}/clinic` },
});
const get = async (url: string) => (await app.inject(scoped({ method: "GET", url }))).json();
const post = (url: string, payload: unknown, auth = true) => app.inject(scoped({ method: "POST", url, payload: payload as Record<string, unknown>, headers: auth ? { authorization: `Bearer ${bearer}` } : {} }));
/** The site's ledger as the verifier reads it: every entry after `from`. */
const ledger = async (from = 0) => (await app.inject(scoped({ url: `/internal/workspaces/${ws}/ledger?cursor=${from}&limit=1000`, headers: { [VERIFIER_SIG_HEADER]: signVerifierHeader(SECRET, ws) } }))).json().items as LedgerEntry[];
const ledgerEnd = async () => Number((await pool.query("SELECT COALESCE(max(seq), 0) AS seq FROM clinic.ledger WHERE workspace_id = $1", [ws])).rows[0].seq);
const formPost = (url: string, body: Record<string, string>) => app.inject(scoped({ method: "POST", url, payload: new URLSearchParams(body).toString(), headers: { "content-type": "application/x-www-form-urlencoded", cookie } }));

async function signIn(wsId: string, email: string): Promise<{ token: string; cookie: string }> {
  const before = mailer.sent.length;
  const enc = encodeURIComponent(email);
  const fh = { "content-type": "application/x-www-form-urlencoded" };
  await app.inject(scoped({ method: "POST", url: "/signup", payload: `name=T&email=${enc}&password=correct-horse-9`, headers: fh }, wsId));
  const code = /code is (\d{6})/.exec(mailer.sent[before]!.body)![1]!;
  await app.inject(scoped({ method: "POST", url: "/verify", payload: `email=${enc}&code=${code}`, headers: fh }, wsId));
  const login = await app.inject(scoped({ method: "POST", url: "/login", payload: `email=${enc}&password=correct-horse-9`, headers: fh }, wsId));
  const session = `cl_session=${login.cookies.find((c) => c.name === "cl_session")!.value}`;
  await app.inject(scoped({ method: "POST", url: "/account/token", headers: { cookie: session } }, wsId));
  const token = /cln_[0-9a-f]+/.exec((await app.inject(scoped({ url: "/account", headers: { cookie: session } }, wsId))).body)![0];
  return { token, cookie: session };
}

beforeAll(async () => {
  if (!DB) return;
  pool = createPool(DB, 4);
  await migrate(pool, "core", join(here, "..", "..", "gateway", "migrations"));
  await migrate(pool, "clinic", join(here, "..", "migrations"));
  mailer = new CapturingMailer();
  app = await buildClinic({ pool, scenarios, mailer, gatewaySecret: SECRET, sessionTtlSeconds: 3600, logLevel: "silent" });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  baseUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  rows = webmcpV1.generate(4242).clinic;
  ws = newWorkspaceId();
  await pool.query("INSERT INTO core.workspaces (id, scenario, seed, expires_at) VALUES ($1, 'webmcp-v1', 4242, now() + interval '1 hour')", [ws]);
  expect((await app.inject(scoped({ method: "POST", url: `/internal/workspaces/${ws}/seed`, payload: { scenario: "webmcp-v1", seed: 4242 } }))).statusCode).toBe(201);
  ({ token: bearer, cookie } = await signIn(ws, "booker@example.com"));
});
afterAll(async () => {
  await app?.close();
  await pool?.end();
});

/** The first day from `from` the doctor sees patients. Autumn is empty: no seeded appointment is after June. */
const workingDay = (d: ClinicDoctor, from = "2027-10-04") => {
  let day = from;
  while (clinicSlotTimes(d, day).length === 0) day = addDays(day, 1);
  return day;
};
/** A doctor's day with every slot booked in the seed rows. */
const fullDay = () => {
  for (const d of rows.doctors) for (let i = 0; i < 61; i++) {
    const date = addDays("2027-03-01", i);
    if (clinicSlotTimes(d, date).length && clinicFreeSlots(d, rows.appointments, date).length === 0) return { doctor: d, date };
  }
  throw new Error("no fully booked day");
};

describe.skipIf(!DB)("clinic (real Postgres)", () => {
  it("serves the WebMCP bridge with the full catalog, and says on every page that it is fictional and gives no medical advice", async () => {
    for (const url of ["/", "/login", "/plans"]) {
      const res = await app.inject(scoped({ method: "GET", url }));
      expect(res.body).toContain('data-webmcp="bridge"');
      expect(res.body).toContain('"name":"find_doctors"');
      expect(res.body).toContain("It gives no medical advice.");
    }
  });

  it("serves the seeded rows as the generator made them", async () => {
    expect(await get("/api/v1/clinics")).toEqual(rows.clinics);
    const d = rows.doctors[0]!;
    expect(await get(`/api/v1/doctors/${d.code}`)).toMatchObject({ ...d });
    const plan = await get(`/api/v1/plans/${rows.plans[0]!.code}`);
    expect(plan).toMatchObject({ ...rows.plans[0] });
    expect(plan.coverage).toHaveLength(rows.procedures.length);
    const a = rows.appointments[0]!;
    expect(await get(`/api/v1/appointments/${a.appointmentNo}`)).toMatchObject({ ...a });
    const mine = await get(`/api/v1/appointments?patientEmail=${encodeURIComponent(a.patientEmail.toUpperCase())}&limit=200`);
    expect(mine.items.map((x: { appointmentNo: string }) => x.appointmentNo)).toEqual(rows.appointments.filter((x) => x.patientEmail === a.patientEmail).map((x) => x.appointmentNo).sort());
    const rx = rows.prescriptions[0]!;
    expect(await get(`/api/v1/prescriptions/${rx.rxNo}`)).toMatchObject({ ...rx });
    const med = rows.medications[0]!;
    expect(await get(`/api/v1/prices?medication=${encodeURIComponent(med.name)}&dosage=${encodeURIComponent(med.dosages[0]!)}`)).toEqual(clinicPrescriptionPrices(rows, med.name, med.dosages[0]));
  });

  it("answers every doctor search the way clinicFindDoctors does, a fully booked day included", async () => {
    const { doctor, date } = fullDay();
    const city = rows.clinics.find((c) => c.code === doctor.clinicCode)!.city;
    expect((await get(`/api/v1/doctors/${doctor.code}/slots?date=${date}`)).free).toEqual([]);
    const queries = [
      { city, specialty: doctor.specialty, date },
      { city, specialty: doctor.specialty },
      { language: "polish", visitType: "video" as const, planCode: rows.plans[1]!.code, newPatients: true },
      { city, date: "2027-10-06", newPatients: true },
    ];
    for (const q of queries) {
      const qs = new URLSearchParams(Object.entries(q).map(([k, v]) => [k === "planCode" ? "plan" : k, String(v)]));
      expect(await get(`/api/v1/doctors?${qs}`)).toEqual(clinicFindDoctors(rows, q));
    }
    expect(clinicFindDoctors(rows, queries[0]!).map((d) => d.code)).not.toContain(doctor.code);
    expect(clinicFindDoctors(rows, queries[1]!).map((d) => d.code)).toContain(doctor.code);
    expect((await app.inject(scoped({ method: "GET", url: `/api/v1/doctors?date=2027-02-30` }))).statusCode).toBe(400);
  });

  it("books, refuses what the rules refuse, and cancels once", async () => {
    const doctor = rows.doctors.find((d) => d.acceptingNewPatients && d.visitTypes.includes("in-person") && !d.visitTypes.includes("video"))!;
    const date = workingDay(doctor);
    const plan = rows.plans.find((p) => !doctor.networkPlans.includes(p.code))!;
    const time = clinicSlotTimes(doctor, date)[0]!;
    const visit = { doctorCode: doctor.code, date, time, visitType: "in-person", planCode: plan.code, patientName: "Ilsa Voss", patientEmail: "Ilsa.Voss@Example.com" };
    expect((await post("/api/v1/appointments", visit, false)).statusCode).toBe(401);
    const made = await post("/api/v1/appointments", visit);
    expect(made.statusCode).toBe(201);
    expect(made.json()).toMatchObject({ doctorCode: doctor.code, date, time, status: "booked", patientEmail: "ilsa.voss@example.com", costCents: clinicVisitCostCents(doctor, plan, "in-person") });
    const refused = async (body: object) => {
      const r = await post("/api/v1/appointments", { ...visit, ...body });
      return [r.statusCode, r.json().error];
    };
    expect(await refused({ patientEmail: "someone.else@example.com" })).toEqual([409, "SLOT_TAKEN"]);
    const other = rows.doctors.find((d) => d.acceptingNewPatients && d.session === doctor.session && d.visitTypes.includes("in-person") && d.workDays.some((w) => doctor.workDays.includes(w)) && d !== doctor)!;
    const both = workingDay({ ...doctor, workDays: doctor.workDays.filter((w) => other.workDays.includes(w)) }, addDays(date, 1));
    expect((await post("/api/v1/appointments", { ...visit, date: both })).statusCode).toBe(201);
    expect(await refused({ doctorCode: other.code, date: both })).toEqual([409, "PATIENT_BUSY"]);
    expect(await refused({ visitType: "video", time: clinicSlotTimes(doctor, date)[1] })).toEqual([422, "VISIT_TYPE_NOT_OFFERED"]);
    expect(await refused({ time: "12:15" })).toEqual([422, "NO_SUCH_SLOT"]);
    expect(await refused({ date: addDays(date, [1, 2, 3, 4, 5, 6].find((n) => clinicSlotTimes(doctor, addDays(date, n)).length === 0)!) })).toEqual([422, "NOT_WORKING"]);
    expect(await refused({ date: "2028-01-03" })).toEqual([422, "OUTSIDE_WINDOW"]);
    const closed = rows.doctors.find((d) => !d.acceptingNewPatients && d.visitTypes.includes("in-person"))!;
    expect(await refused({ doctorCode: closed.code, date: workingDay(closed), time: clinicSlotTimes(closed, workingDay(closed))[0] })).toEqual([422, "NOT_ACCEPTING_NEW_PATIENTS"]);
    expect((await post("/api/v1/appointments", { ...visit, planCode: "PL-99" })).statusCode).toBe(422);
    const no = made.json().appointmentNo;
    expect((await post(`/api/v1/appointments/${no}/cancel`, {})).json().status).toBe("cancelled");
    expect((await post(`/api/v1/appointments/${no}/cancel`, {})).statusCode).toBe(409);
    expect((await post("/api/v1/appointments", { ...visit, patientEmail: "someone.else@example.com" })).statusCode).toBe(201);
  });

  it("requests a refill once, and refuses one with no refills left or at a pharmacy that does not stock it", async () => {
    const stocks = (rx: { medicationCode: string; dosage: string }) => rows.prices.filter((p) => p.medicationCode === rx.medicationCode && p.dosage === rx.dosage).map((p) => p.clinicCode);
    const open = new Set(rows.refills.filter((r) => r.status === "requested").map((r) => r.rxNo));
    const rx = rows.prescriptions.find((p) => p.refillsLeft > 0 && !open.has(p.rxNo) && stocks(p).length > 0 && stocks(p).length < rows.clinics.length)!;
    const at = stocks(rx)[0]!;
    expect((await post(`/api/v1/prescriptions/${rx.rxNo}/refill`, { pharmacyCode: rows.clinics.find((c) => !stocks(rx).includes(c.code))!.code })).json().error).toBe("NOT_STOCKED");
    const made = await post(`/api/v1/prescriptions/${rx.rxNo}/refill`, { pharmacyCode: at });
    expect([made.statusCode, made.json().status, made.json().pharmacyCode]).toEqual([201, "requested", at]);
    expect(await get(`/api/v1/prescriptions/${rx.rxNo}`)).toMatchObject({ refillsLeft: rx.refillsLeft - 1, refillPending: true });
    const again = await post(`/api/v1/prescriptions/${rx.rxNo}/refill`, { pharmacyCode: at });
    expect([again.statusCode, again.json().error]).toEqual([409, "ALREADY_REQUESTED"]);
    const empty = rows.prescriptions.find((p) => p.refillsLeft === 0)!;
    expect((await post(`/api/v1/prescriptions/${empty.rxNo}/refill`, { pharmacyCode: at })).json().error).toBe("NO_REFILLS_LEFT");
    expect((await get(`/api/v1/refills?rxNo=${rx.rxNo}&status=requested`)).map((r: { refillNo: string }) => r.refillNo)).toEqual([made.json().refillNo]);
  });

  it("books through the page form, shows a refusal's reason on the page, and cancels from the appointment page", async () => {
    const doctor = rows.doctors.find((d) => d.acceptingNewPatients && d.visitTypes.includes("video"))!;
    const date = workingDay(doctor, "2027-11-01");
    const body = { doctorCode: doctor.code, date, time: clinicSlotTimes(doctor, date)[2]!, visitType: "video", planCode: "", patientName: "Page Patient", patientEmail: "page.patient@example.com" };
    const made = await formPost("/appointments", body);
    expect(made.statusCode).toBe(303);
    const page = await app.inject(scoped({ method: "GET", url: made.headers.location!.replace(`/w/${ws}/clinic`, ""), headers: { cookie } }));
    expect(page.body).toContain("booked");
    const taken = await formPost("/appointments", { ...body, patientEmail: "late.patient@example.com" });
    expect(taken.statusCode).toBe(409);
    expect(taken.body).toContain(`slot on ${date} is taken`);
    const no = made.headers.location!.split("/").pop()!;
    expect((await formPost(`/appointments/${no}/cancel`, {})).statusCode).toBe(303);
    expect((await get(`/api/v1/appointments/${no}`)).status).toBe("cancelled");
  });

  it("reads a blank optional query parameter as not given, and still needs the required ones", async () => {
    const doctor = rows.doctors.find((d) => d.visitTypes.includes("in-person"))!;
    const med = encodeURIComponent(rows.medications[0]!.name);
    const cost = `/api/v1/visit-cost?doctor=${doctor.code}`;
    const status = async (url: string) => (await app.inject(scoped({ method: "GET", url }))).statusCode;
    // One blank parameter per case, then every one at once: [the query with blanks, the same query without them].
    const same: [string, string][] = [
      [`${cost}&plan=`, cost],
      [`${cost}&visitType=`, cost],
      [`/api/v1/prices?medication=${med}&dosage=`, `/api/v1/prices?medication=${med}`],
      ["/api/v1/refills?status=", "/api/v1/refills"],
      ["/api/v1/refills?patientEmail=&rxNo=&status=", "/api/v1/refills"],
      ["/api/v1/appointments?limit=", "/api/v1/appointments"],
      ["/api/v1/appointments?patientEmail=&doctor=&date=&status=&cursor=&limit=", "/api/v1/appointments"],
      ["/api/v1/prescriptions?patientEmail=", "/api/v1/prescriptions"],
      ["/api/v1/doctors?city=&specialty=&language=&visitType=&plan=&newPatients=&date=", "/api/v1/doctors"],
    ];
    const got: Record<string, number> = {};
    for (const [blank] of same) got[blank] = await status(blank);
    expect(got).toEqual(Object.fromEntries(same.map(([blank]) => [blank, 200])));
    for (const [blank, bare] of same) expect(await get(blank)).toEqual(await get(bare));
    // No plan is the self-pay price: the doctor's own fee, no copay.
    expect(await get(`${cost}&plan=`)).toMatchObject({ planCode: null, visitType: "in-person", inNetwork: false, copayCents: null, costCents: doctor.inPersonFeeCents });
    // The default page, not everything: a blank limit is the default limit.
    expect((await get("/api/v1/appointments?limit=")).items).toHaveLength(50);
    const bad = ["/api/v1/visit-cost?doctor=", "/api/v1/prices?medication=&dosage=", `/api/v1/coverage?plan=&procedure=${rows.procedures[0]!.code}`, `/api/v1/doctors/${doctor.code}/slots?date=`, "/api/v1/appointments?limit=0", "/api/v1/refills?status=lost", `${cost}&visitType=phone`];
    for (const url of bad) expect([url, await status(url)]).toEqual([url, 400]);
  });

  it("reads a plan code the same way at every door: any letter case, spaces trimmed", async () => {
    const plan = rows.plans.at(-1)!;
    const typed = encodeURIComponent(` ${plan.code.toLowerCase()} `);
    const doctor = rows.doctors.find((d) => d.visitTypes.includes("in-person") && d.networkPlans.includes(plan.code))!;
    const procedure = rows.procedures[0]!.code;
    // [the door with the code as a person types it, the same door with the code as stored]
    const doors: [string, string][] = [
      [`/api/v1/plans/${plan.code.toLowerCase()}`, `/api/v1/plans/${plan.code}`],
      [`/api/v1/plans/${typed}`, `/api/v1/plans/${plan.code}`],
      [`/api/v1/coverage?plan=${typed}&procedure=${procedure}`, `/api/v1/coverage?plan=${plan.code}&procedure=${procedure}`],
      [`/api/v1/visit-cost?doctor=${doctor.code}&plan=${typed}`, `/api/v1/visit-cost?doctor=${doctor.code}&plan=${plan.code}`],
      [`/plans/${plan.code.toLowerCase()}`, `/plans/${plan.code}`],
    ];
    const status = async (url: string) => (await app.inject(scoped({ method: "GET", url }))).statusCode;
    const got: Record<string, number> = {};
    for (const [typedUrl] of doors) got[typedUrl] = await status(typedUrl);
    expect(got).toEqual(Object.fromEntries(doors.map(([typedUrl]) => [typedUrl, 200])));
    for (const [typedUrl, stored] of doors) expect((await app.inject(scoped({ method: "GET", url: typedUrl }))).body).toBe((await app.inject(scoped({ method: "GET", url: stored }))).body);
    // The plan itself with its own coverage, not an empty shell: every line is the plan's, under its stored code.
    const detail = await get(`/api/v1/plans/${plan.code.toLowerCase()}`);
    expect(detail).toMatchObject({ ...plan });
    expect(detail.coverage.map((c: { planCode: string; status: string }) => [c.planCode, c.status])).toEqual(rows.procedures.map((pr) => [plan.code, rows.coverage.find((c) => c.planCode === plan.code && c.procedureCode === pr.code)?.status ?? "not-covered"]));
    for (const unknown of ["/api/v1/plans/pl-99", `/api/v1/coverage?plan=pl-99&procedure=${procedure}`]) expect([unknown, await status(unknown)]).toEqual([unknown, 404]);
  });

  it("keeps its ledger: a read through REST and through a page, a write nobody may make, a write and a rule's refusal, each with its door and who was signed in", async () => {
    const no = [...rows.appointments].reverse().find((x) => x.status === "booked")!.appointmentNo;
    const from = await ledgerEnd();
    await get(`/api/v1/appointments/${no}`);
    await app.inject(scoped({ method: "GET", url: `/appointments/${no}` }));
    // Nobody signed in: REST says 401, the page sends the visitor to sign in, and neither reaches the rules.
    expect((await post(`/api/v1/appointments/${no}/cancel`, {}, false)).json()).toEqual({ error: "UNAUTHORIZED", message: "sign in or send Authorization: Bearer <api token>" });
    const sent = await app.inject(scoped({ method: "POST", url: `/appointments/${no}/cancel` }));
    expect([sent.statusCode, sent.headers.location]).toEqual([302, `/w/${ws}/clinic/login`]);
    expect((await post(`/api/v1/appointments/${no}/cancel`, {})).statusCode).toBe(200);
    expect((await post(`/api/v1/appointments/${no}/cancel`, {})).json().error).toBe("ALREADY_CANCELLED");
    const kept = (await ledger(from)).filter((e) => e.entity.type === "appointment");
    expect(kept.map((e) => [e.app, e.kind, e.entity.id, e.action, e.door, e.actor, e.outcome, e.code])).toEqual([
      ["clinic", "read", no, "read", "rest", null, "ok", null],
      ["clinic", "read", no, "read", "page", null, "ok", null],
      ["clinic", "write", no, "cancel", "rest", null, "refused", "UNAUTHORIZED"],
      ["clinic", "write", no, "cancel", "page", null, "refused", "UNAUTHORIZED"],
      ["clinic", "write", no, "cancel", "rest", "booker@example.com", "ok", null],
      ["clinic", "write", no, "cancel", "rest", "booker@example.com", "refused", "ALREADY_CANCELLED"],
    ]);
    // Each is stamped when it happened, in order.
    expect(kept.map((e) => Date.parse(e.at))).toEqual(kept.map((e) => Date.parse(e.at)).sort((a, b) => a - b));
    expect(Math.abs(Date.now() - Date.parse(kept[0]!.at))).toBeLessThan(60_000);
  });

  it("keeps a write and its ledger entry together: a cancel, or a sign-up, whose entry cannot be kept does not happen", async () => {
    const no = rows.appointments.find((x) => x.status === "booked")!.appointmentNo;
    const email = "unkept@example.com";
    // For this test only, the ledger refuses the entry of a cancel and of a sign-up.
    await pool.query("ALTER TABLE clinic.ledger ADD CONSTRAINT test_unkept CHECK (action NOT IN ('cancel', 'sign_up')) NOT VALID");
    try {
      expect((await post(`/api/v1/appointments/${no}/cancel`, {})).statusCode).toBe(500);
      const signup = await app.inject(scoped({ method: "POST", url: "/signup", payload: `name=U&email=${encodeURIComponent(email)}&password=correct-horse-9`, headers: { "content-type": "application/x-www-form-urlencoded" } }));
      expect(signup.statusCode).toBe(500);
    } finally {
      await pool.query("ALTER TABLE clinic.ledger DROP CONSTRAINT test_unkept");
    }
    expect((await get(`/api/v1/appointments/${no}`)).status).toBe("booked");
    expect((await pool.query("SELECT 1 FROM clinic.users WHERE workspace_id = $1 AND email = $2", [ws, email])).rowCount).toBe(0);
  });

  it("exposes the same tools over MCP", async () => {
    const client = new Client({ name: "test", version: "0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), { requestInit: { headers: { [WORKSPACE_HEADER]: ws, [WORKSPACE_SIG_HEADER]: signWorkspaceHeader(SECRET, ws) } } }));
    try {
      const names = (await client.listTools()).tools.map((t) => t.name).sort();
      // The site's own tools, and the kit's for signing up and in.
      expect(names).toEqual(["book_appointment", "cancel_appointment", "check_visit_cost", "find_doctors", "get_doctor", "get_patient", "get_plan", "get_prescription_prices", "list_clinics", "request_refill", ...SIGN_IN_TOOLS].sort());
      const { doctor, date } = fullDay();
      const city = rows.clinics.find((c) => c.code === doctor.clinicCode)!.city;
      const res = (await client.callTool({ name: "find_doctors", arguments: { city, date } })) as { content: { text: string }[] };
      expect(JSON.parse(res.content[0]!.text)).toEqual(clinicFindDoctors(rows, { city, date }));
      const plan = (await client.callTool({ name: "get_plan", arguments: { planCode: rows.plans[0]!.code.toLowerCase() } })) as { content: { text: string }[] };
      expect(JSON.parse(plan.content[0]!.text)).toEqual(await get(`/api/v1/plans/${rows.plans[0]!.code}`));
      // A tool call is a door of its own in the ledger.
      const from = await ledgerEnd();
      await client.callTool({ name: "get_plan", arguments: { planCode: rows.plans[0]!.code } });
      expect((await ledger(from)).map((e) => [e.kind, e.entity.type, e.entity.id, e.door, e.outcome])).toEqual([["read", "plan", rows.plans[0]!.code, "mcp", "ok"]]);
      // The sign-in the pages and REST ask, asked here too: a write by nobody is refused before the rules are, and the ledger keeps it.
      const mark = await ledgerEnd();
      const refused = (await client.callTool({ name: "cancel_appointment", arguments: { appointmentNo: "NO-SUCH" } })) as { isError?: boolean; content: { text: string }[] };
      expect([refused.isError, JSON.parse(refused.content[0]!.text).error]).toEqual([true, "UNAUTHORIZED"]);
      expect((await ledger(mark)).map((e) => [e.door, e.kind, e.entity.type, e.entity.id, e.action, e.actor, e.outcome, e.code])).toEqual([["mcp", "write", "appointment", "NO-SUCH", "cancel", null, "refused", "UNAUTHORIZED"]]);
    } finally {
      await client.close();
    }
  });
});
