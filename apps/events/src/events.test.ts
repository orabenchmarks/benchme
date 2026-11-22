import { VERIFIER_SIG_HEADER, WORKSPACE_HEADER, WORKSPACE_SIG_HEADER, createPool, migrate, newWorkspaceId, signVerifierHeader, signWorkspaceHeader, type Pool } from "@benchme/core";
import { webmcpV1, addDays, eventFreeRooms, eventPlacesLeft, eventWeekday, scenarios, type EventRows, type OfficeEvent } from "@benchme/scenarios";
import type { LedgerEntry, Mailer } from "@benchme/site-kit";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { FastifyInstance, InjectOptions } from "fastify";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildEvents } from "./build-app.js";

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
let rows: EventRows;
let bearer = "";
let cookie = "";
let baseUrl = "";
const scoped = (o: InjectOptions & { url: string }, wsId = ws): InjectOptions => ({
  ...o,
  headers: { ...(o.headers ?? {}), [WORKSPACE_HEADER]: wsId, [WORKSPACE_SIG_HEADER]: signWorkspaceHeader(SECRET, wsId), "x-forwarded-prefix": `/w/${wsId}/events` },
});
const get = async (url: string) => (await app.inject(scoped({ method: "GET", url }))).json();
const post = (url: string, payload: unknown, auth = true) => app.inject(scoped({ method: "POST", url, payload: payload as Record<string, unknown>, headers: auth ? { authorization: `Bearer ${bearer}` } : {} }));
/** The site's ledger as the verifier reads it: every entry after `from`. */
const ledger = async (from = 0) => (await app.inject(scoped({ url: `/internal/workspaces/${ws}/ledger?cursor=${from}&limit=1000`, headers: { [VERIFIER_SIG_HEADER]: signVerifierHeader(SECRET, ws) } }))).json().items as LedgerEntry[];
const ledgerEnd = async () => Number((await pool.query("SELECT COALESCE(max(seq), 0) AS seq FROM events.ledger WHERE workspace_id = $1", [ws])).rows[0].seq);
const formPost = (url: string, body: Record<string, string>) => app.inject(scoped({ method: "POST", url, payload: new URLSearchParams(body).toString(), headers: { "content-type": "application/x-www-form-urlencoded", cookie } }));
const served = (e: OfficeEvent) => Object.fromEntries(Object.entries(e).filter(([k]) => k !== "guestEmails"));

async function signIn(wsId: string, email: string): Promise<{ token: string; cookie: string }> {
  const before = mailer.sent.length;
  const enc = encodeURIComponent(email);
  const fh = { "content-type": "application/x-www-form-urlencoded" };
  await app.inject(scoped({ method: "POST", url: "/signup", payload: `name=T&email=${enc}&password=correct-horse-9`, headers: fh }, wsId));
  const code = /code is (\d{6})/.exec(mailer.sent[before]!.body)![1]!;
  await app.inject(scoped({ method: "POST", url: "/verify", payload: `email=${enc}&code=${code}`, headers: fh }, wsId));
  const login = await app.inject(scoped({ method: "POST", url: "/login", payload: `email=${enc}&password=correct-horse-9`, headers: fh }, wsId));
  const session = login.cookies.find((c) => c.name === "ev_session")!.value;
  await app.inject(scoped({ method: "POST", url: "/account/token", headers: { cookie: `ev_session=${session}` } }, wsId));
  const token = /evt_[0-9a-f]+/.exec((await app.inject(scoped({ url: "/account", headers: { cookie: `ev_session=${session}` } }, wsId))).body)![0];
  return { token, cookie: `ev_session=${session}` };
}

/** The first Tuesday from mid-October 2027: no seeded event is after June, and every office is open on a Tuesday. */
let QUIET = "2027-10-12";
while (eventWeekday(QUIET) !== "tue") QUIET = addDays(QUIET, 1);

beforeAll(async () => {
  if (!DB) return;
  pool = createPool(DB, 4);
  await migrate(pool, "core", join(here, "..", "..", "gateway", "migrations"));
  await migrate(pool, "events", join(here, "..", "migrations"));
  mailer = new CapturingMailer();
  app = await buildEvents({ pool, scenarios, mailer, gatewaySecret: SECRET, sessionTtlSeconds: 3600, logLevel: "silent" });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  baseUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  rows = webmcpV1.generate(4242).events;
  ws = newWorkspaceId();
  await pool.query("INSERT INTO core.workspaces (id, scenario, seed, expires_at) VALUES ($1, 'webmcp-v1', 4242, now() + interval '1 hour')", [ws]);
  expect((await app.inject(scoped({ method: "POST", url: `/internal/workspaces/${ws}/seed`, payload: { scenario: "webmcp-v1", seed: 4242 } }))).statusCode).toBe(201);
  ({ token: bearer, cookie } = await signIn(ws, "organiser@example.com"));
});
afterAll(async () => {
  await app?.close();
  await pool?.end();
});

describe.skipIf(!DB)("events (real Postgres)", () => {
  it("serves the WebMCP bridge with the full catalog on the home page", async () => {
    const res = await app.inject(scoped({ method: "GET", url: "/" }));
    expect(res.body).toContain('data-webmcp="bridge"');
    expect(res.body).toContain('"name":"find_free_rooms"');
    expect(res.body).not.toContain('"$ref"');
  });

  it("serves the seeded offices, rooms, people, events and registrations as the generator made them", async () => {
    expect(await get("/api/v1/offices")).toEqual([...rows.offices].sort((x, y) => x.code.localeCompare(y.code)).map((o) => ({ ...o, rooms: rows.rooms.filter((r) => r.officeCode === o.code) })));
    expect((await get("/api/v1/people")).length).toBe(rows.people.length);
    for (const e of [rows.events[0]!, rows.events.find((x) => x.registration === "open")!, rows.events.find((x) => x.status === "cancelled")!]) {
      const got = await get(`/api/v1/events/${e.code}`);
      expect(got).toMatchObject(served(e));
      expect(got.guests.map((g: { email: string }) => g.email)).toEqual(e.guestEmails);
      expect(got.placesLeft).toBe(eventPlacesLeft(rows, e));
    }
    const r = rows.registrations[0]!;
    expect(await get(`/api/v1/registrations/${r.regNo}`)).toMatchObject({ ...r });
    const mine = await get(`/api/v1/registrations?email=${encodeURIComponent(r.email.toUpperCase())}&limit=200`);
    expect(mine.items.map((x: { regNo: string }) => x.regNo)).toEqual(rows.registrations.filter((x) => x.email === r.email).map((x) => x.regNo).sort());
    const all = [];
    for (let cursor: string | null = null, first = true; first || cursor; first = false) {
      const page: { items: { code: string }[]; nextCursor: string | null } = await get(`/api/v1/events?limit=40${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      all.push(...page.items.map((x) => x.code));
      cursor = page.nextCursor;
    }
    expect(all.sort()).toEqual(rows.events.map((e) => e.code).sort());
  });

  it("answers every room search the way eventFreeRooms does, a room booked solid included", async () => {
    // The room with the most scheduled events on one day: booked solid by the generator.
    const days = new Map<string, OfficeEvent[]>();
    for (const e of rows.events.filter((x) => x.status === "scheduled")) days.set(`${e.roomCode}|${e.date}`, [...(days.get(`${e.roomCode}|${e.date}`) ?? []), e]);
    const busiest = [...days.values()].sort((a, b) => b.length - a.length)[0]![0]!;
    const room = rows.rooms.find((r) => r.code === busiest.roomCode)!;
    const office = rows.offices.find((o) => o.code === room.officeCode)!;
    const queries = [
      { officeCode: office.code, date: busiest.date, startTime: busiest.startTime, endTime: busiest.endTime, people: 2, equipment: [] as string[] },
      { officeCode: office.code, date: busiest.date, startTime: "10:00", endTime: "12:00", people: room.capacity, equipment: room.equipment },
      { officeCode: office.code, date: QUIET, startTime: "10:00", endTime: "11:00", people: 4, equipment: ["whiteboard"], accessible: true },
    ];
    for (const q of queries) {
      const qs = new URLSearchParams({ office: q.officeCode, date: q.date, startTime: q.startTime, endTime: q.endTime, people: String(q.people), ...(q.equipment.length ? { equipment: q.equipment.join(",") } : {}), ...(q.accessible ? { accessible: "true" } : {}) });
      const got = await get(`/api/v1/free-rooms?${qs}`);
      expect(got).toEqual(eventFreeRooms(rows, q));
      if (q.date === busiest.date) expect(got.map((x: { roomCode: string }) => x.roomCode)).not.toContain(room.code);
    }
    expect((await get(`/api/v1/free-rooms?office=${encodeURIComponent(office.city)}&date=${QUIET}&startTime=10:00&endTime=11:00&people=2`)).length).toBe(rows.rooms.filter((r) => r.officeCode === office.code).length);
    const sunday = addDays(QUIET, 5);
    expect((await app.inject(scoped({ method: "GET", url: `/api/v1/free-rooms?office=${office.code}&date=${sunday}&startTime=10:00&endTime=11:00&people=2` }))).json().error).toBe("OFFICE_CLOSED");
    expect((await app.inject(scoped({ method: "GET", url: `/api/v1/free-rooms?office=${office.code}&date=${QUIET}&startTime=10:10&endTime=11:00&people=2` }))).statusCode).toBe(400);
  });

  it("creates, refuses what the rules refuse, changes and cancels an event once", async () => {
    const room = rows.rooms.find((r) => r.capacity === 6)!;
    const organiser = rows.people.find((p) => p.officeCode === room.officeCode)!;
    const other = rows.people.find((p) => p.officeCode === room.officeCode && p !== organiser)!;
    const body = { title: "Budget planning", description: "Plan the budget", date: QUIET, startTime: "15:00", endTime: "16:30", roomCode: room.code, organiserEmail: organiser.email.toUpperCase(), guestEmails: ["Ann@Example.com", "bo@example.com", "ann@example.com"] };
    expect((await post("/api/v1/events", body, false)).statusCode).toBe(401);
    const made = await post("/api/v1/events", body);
    expect(made.statusCode).toBe(201);
    expect(made.json()).toMatchObject({ roomCode: room.code, officeCode: room.officeCode, organiserEmail: organiser.email, startTime: "15:00", endTime: "16:30", registration: "invite-only", places: null, status: "scheduled", guestCount: 2, guests: [{ email: "ann@example.com", name: null }, { email: "bo@example.com", name: null }] });
    const code = made.json().code;
    const again = await post("/api/v1/events", { ...body, startTime: "16:00", endTime: "17:00" });
    expect([again.statusCode, again.json().error]).toEqual([409, "ROOM_TAKEN"]);
    expect((await post("/api/v1/events", { ...body, startTime: "16:30", endTime: "17:00" })).statusCode).toBe(201);
    const refusal = async (b: Record<string, unknown>) => {
      const r = await post("/api/v1/events", { ...body, startTime: "10:00", endTime: "11:00", ...b });
      return [r.statusCode, r.json().error];
    };
    expect(await refusal({ guestEmails: ["a@x.example", "b@x.example", "c@x.example", "d@x.example", "e@x.example", "f@x.example"] })).toEqual([422, "OVER_CAPACITY"]);
    expect(await refusal({ organiserEmail: "visitor@example.com" })).toEqual([422, "UNKNOWN_ORGANISER"]);
    expect(await refusal({ startTime: "06:00" })).toEqual([422, "OUTSIDE_HOURS"]);
    expect(await refusal({ guestEmails: ["not-an-email"] })).toEqual([422, "BAD_GUEST_EMAIL"]);
    expect(await refusal({ registration: "open" })).toEqual([422, "BAD_PLACES"]);
    expect(await refusal({ roomCode: "NOPE-R1" })).toEqual([404, "UNKNOWN_ROOM"]);
    expect((await post("/api/v1/events", { ...body, date: "2027-02-30" })).statusCode).toBe(400);

    expect((await post(`/api/v1/events/${code}/change`, { organiserEmail: other.email, startTime: "14:00" })).json().error).toBe("NOT_ORGANISER");
    const moved = await post(`/api/v1/events/${code}/change`, { organiserEmail: organiser.email, startTime: "14:00", endTime: "15:00", addGuestEmails: [other.email], removeGuestEmails: ["bo@example.com"] });
    expect(moved.statusCode).toBe(200);
    expect(moved.json()).toMatchObject({ startTime: "14:00", endTime: "15:00", title: "Budget planning", guests: [{ email: "ann@example.com" }, { email: other.email, name: other.name }] });
    expect((await post(`/api/v1/events/${code}/cancel`, { organiserEmail: other.email })).json().error).toBe("NOT_ORGANISER");
    expect((await post(`/api/v1/events/${code}/cancel`, { organiserEmail: organiser.email })).json().status).toBe("cancelled");
    expect((await post(`/api/v1/events/${code}/cancel`, { organiserEmail: organiser.email })).statusCode).toBe(409);
    expect((await post("/api/v1/events", { ...body, startTime: "14:00", endTime: "15:00" })).statusCode).toBe(201);
  });

  it("registers within the places, refuses a repeat, a full event, an overlap and an invite-only event, and cancels once", async () => {
    const [a, b] = rows.rooms.filter((r) => r.officeCode === "OF-VEL" && r.capacity >= 4);
    const organiser = rows.people.find((p) => p.officeCode === "OF-VEL")!.email;
    const base = { description: "", date: QUIET, roomCode: a!.code, organiserEmail: organiser, registration: "open" };
    const one = (await post("/api/v1/events", { ...base, title: "One place", startTime: "09:00", endTime: "10:00", places: 1 })).json().code;
    const two = (await post("/api/v1/events", { ...base, title: "Two places", roomCode: b!.code, startTime: "09:30", endTime: "10:30", places: 2 })).json().code;
    const x = { name: "Xan Reg", email: "xan@example.com" };
    const y = { name: "Yel Reg", email: "yel@example.com" };
    expect((await post(`/api/v1/events/${one}/register`, x, false)).statusCode).toBe(401);
    const reg = await post(`/api/v1/events/${one}/register`, { ...x, email: "XAN@example.com" });
    expect([reg.statusCode, reg.json()]).toMatchObject([201, { eventCode: one, email: "xan@example.com", status: "registered", eventTitle: "One place" }]);
    expect((await post(`/api/v1/events/${one}/register`, x)).json().error).toBe("ALREADY_REGISTERED");
    expect((await post(`/api/v1/events/${one}/register`, y)).json().error).toBe("FULL");
    expect((await post(`/api/v1/events/${two}/register`, x)).json().error).toBe("OVERLAP");
    expect((await get(`/api/v1/events/${one}`)).placesLeft).toBe(0);
    const seededFull = rows.events.find((e) => e.status === "scheduled" && e.registration === "open" && eventPlacesLeft(rows, e) === 0)!;
    expect([(await post(`/api/v1/events/${seededFull.code}/register`, y)).statusCode]).toEqual([409]);
    const inviteOnly = rows.events.find((e) => e.status === "scheduled" && e.registration === "invite-only")!;
    expect((await post(`/api/v1/events/${inviteOnly.code}/register`, y)).json().error).toBe("INVITE_ONLY");
    expect((await post(`/api/v1/events/${one}/change`, { organiserEmail: organiser, places: null, registration: "invite-only" })).json().error).toBe("PLACES_BELOW_REGISTERED");

    const no = reg.json().regNo;
    expect((await post(`/api/v1/registrations/${no}/cancel`, {})).json().status).toBe("cancelled");
    expect((await post(`/api/v1/registrations/${no}/cancel`, {})).statusCode).toBe(409);
    expect((await post(`/api/v1/events/${one}/register`, y)).statusCode).toBe(201);
    expect((await post(`/api/v1/events/${two}/register`, x)).statusCode).toBe(201);
  });

  it("books through the pages: 303 to the event's page, a refusal shown on the form, register and cancel by form", async () => {
    const room = rows.rooms.find((r) => r.capacity >= 8)!;
    const organiser = rows.people.find((p) => p.officeCode === room.officeCode)!.email;
    const fields = { organiserEmail: organiser, title: "Pages event", description: "By form", roomCode: room.code, date: QUIET, startTime: "12:00", endTime: "12:45", guestEmails: "g1@example.com, g2@example.com", registration: "open", places: "2" };
    const made = await formPost("/events", fields);
    expect(made.statusCode).toBe(303);
    const page = await app.inject(scoped({ method: "GET", url: made.headers.location!.replace(`/w/${ws}/events`, "") }));
    expect(page.body).toContain("Pages event");
    expect(page.body).toContain("g2@example.com");
    expect(page.body).toContain("open: 2 of 2 places left");
    const taken = await formPost("/events", { ...fields, startTime: "12:30", endTime: "13:00" });
    expect(taken.statusCode).toBe(409);
    expect(taken.body).toContain("is taken from 12:00 to 12:45");
    const code = made.headers.location!.split("/").pop()!;
    const reg = await formPost(`/events/${code}/register`, { name: "Form Person", email: "form.person@example.com" });
    expect(reg.statusCode).toBe(303);
    const regNo = reg.headers.location!.split("/").pop()!;
    expect((await formPost(`/registrations/${regNo}/cancel`, {})).statusCode).toBe(303);
    expect((await get(`/api/v1/registrations/${regNo}`)).status).toBe("cancelled");
  });

  it("reads a blank optional query parameter as not given, and still needs the required ones", async () => {
    const office = rows.offices[0]!.code;
    const free = (o: Record<string, string> = {}) => `/api/v1/free-rooms?${new URLSearchParams({ office, date: QUIET, startTime: "10:00", endTime: "11:00", people: "2", ...o })}`;
    const status = async (url: string) => (await app.inject(scoped({ method: "GET", url }))).statusCode;
    // One blank parameter per case, then every one at once: [the query with blanks, the same query without them].
    const same: [string, string][] = [
      ...["date", "from", "to", "status", "registration", "hasPlaces", "limit"].map((p): [string, string] => [`/api/v1/events?${p}=`, "/api/v1/events"]),
      ["/api/v1/events?office=&room=&date=&from=&to=&organiser=&guest=&registrant=&q=&registration=&status=&hasPlaces=&cursor=&limit=", "/api/v1/events"],
      ["/api/v1/events?status=cancelled&date=&hasPlaces=&limit=", "/api/v1/events?status=cancelled"],
      ["/api/v1/rooms?minCapacity=", "/api/v1/rooms"],
      ["/api/v1/rooms?accessible=", "/api/v1/rooms"],
      ["/api/v1/rooms?office=&minCapacity=&equipment=&accessible=", "/api/v1/rooms"],
      ["/api/v1/registrations?status=", "/api/v1/registrations"],
      ["/api/v1/registrations?limit=", "/api/v1/registrations"],
      ["/api/v1/registrations?email=&event=&status=&cursor=&limit=", "/api/v1/registrations"],
      ["/api/v1/people?office=&team=&name=", "/api/v1/people"],
      [free({ accessible: "" }), free()],
      [free({ equipment: "", accessible: "" }), free()],
      [free({ accessible: "" }).replace("/api/v1", ""), free().replace("/api/v1", "")],
    ];
    const got: Record<string, number> = {};
    for (const [blank] of same) got[blank] = await status(blank);
    expect(got).toEqual(Object.fromEntries(same.map(([blank]) => [blank, 200])));
    for (const [blank, bare] of same) expect((await app.inject(scoped({ method: "GET", url: blank }))).body).toBe((await app.inject(scoped({ method: "GET", url: bare }))).body);
    // The default page, not everything: a blank limit is the default limit.
    expect((await get("/api/v1/events?limit=")).items).toHaveLength(50);
    expect((await get("/api/v1/registrations?limit=")).items).toHaveLength(50);
    // Every room, the ones without step-free access included: a blank flag is no filter.
    expect((await get("/api/v1/rooms?minCapacity=&accessible=")).length).toBe(rows.rooms.length);
    const bad = [free({ office: "" }), free({ date: "" }), free({ startTime: "" }), free({ endTime: "" }), free({ people: "" }), free({ accessible: "yes" }), "/api/v1/events?limit=0", "/api/v1/events?status=done", "/api/v1/events?date=2027-02-30", "/api/v1/events?hasPlaces=yes", "/api/v1/rooms?minCapacity=0", "/api/v1/registrations?status=done"];
    for (const url of bad) expect([url, await status(url)]).toEqual([url, 400]);
  });

  it("keeps its ledger: a read through REST and through a page, a write and a refusal, each with its door and who was signed in", async () => {
    const no = [...rows.registrations].reverse().find((x) => x.status === "registered")!.regNo;
    const from = await ledgerEnd();
    await get(`/api/v1/registrations/${no}`);
    await app.inject(scoped({ method: "GET", url: `/registrations/${no}` }));
    expect((await post(`/api/v1/registrations/${no}/cancel`, {})).statusCode).toBe(200);
    expect((await post(`/api/v1/registrations/${no}/cancel`, {})).json().error).toBe("ALREADY_CANCELLED");
    const kept = (await ledger(from)).filter((e) => e.entity.type === "registration");
    expect(kept.map((e) => [e.app, e.kind, e.entity.id, e.action, e.door, e.actor, e.outcome, e.code])).toEqual([
      ["events", "read", no, "read", "rest", null, "ok", null],
      ["events", "read", no, "read", "page", null, "ok", null],
      ["events", "write", no, "cancel", "rest", "organiser@example.com", "ok", null],
      ["events", "write", no, "cancel", "rest", "organiser@example.com", "refused", "ALREADY_CANCELLED"],
    ]);
    // Each is stamped when it happened, in order.
    expect(kept.map((e) => Date.parse(e.at))).toEqual(kept.map((e) => Date.parse(e.at)).sort((a, b) => a - b));
    expect(Math.abs(Date.now() - Date.parse(kept[0]!.at))).toBeLessThan(60_000);
  });

  it("exposes the same tools over MCP", async () => {
    const client = new Client({ name: "test", version: "0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), { requestInit: { headers: { [WORKSPACE_HEADER]: ws, [WORKSPACE_SIG_HEADER]: signWorkspaceHeader(SECRET, ws) } } }));
    try {
      const names = (await client.listTools()).tools.map((t) => t.name).sort();
      expect(names).toEqual(["cancel_event", "cancel_registration", "change_event", "create_event", "find_free_rooms", "get_event", "list_events", "list_offices", "list_people", "register_for_event"]);
      // A seeded day, not QUIET: the tests above booked rooms on QUIET, which the seed rows do not have.
      const e = rows.events.find((x) => x.status === "scheduled")!;
      const res = (await client.callTool({ name: "find_free_rooms", arguments: { office: e.officeCode, date: e.date, startTime: e.startTime, endTime: e.endTime, people: 3 } })) as { content: { text: string }[] };
      expect(JSON.parse(res.content[0]!.text)).toEqual(eventFreeRooms(rows, { officeCode: e.officeCode, date: e.date, startTime: e.startTime, endTime: e.endTime, people: 3 }));
      // A tool call is a door of its own in the ledger.
      const from = await ledgerEnd();
      await client.callTool({ name: "get_event", arguments: { eventCode: rows.events[0]!.code } });
      expect((await ledger(from)).map((e) => [e.kind, e.entity.type, e.entity.id, e.door, e.outcome])).toEqual([["read", "event", rows.events[0]!.code, "mcp", "ok"]]);
    } finally {
      await client.close();
    }
  });
});
