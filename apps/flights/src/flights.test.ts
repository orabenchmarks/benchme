import { VERIFIER_SIG_HEADER, WORKSPACE_HEADER, WORKSPACE_SIG_HEADER, createPool, migrate, newWorkspaceId, signVerifierHeader, signWorkspaceHeader, type Pool } from "@benchme/core";
import { webmcpV1, flightSeatsLeft, scenarios, searchFlights, type FlightCabin, type FlightRows } from "@benchme/scenarios";
import { SIGN_IN_TOOLS, type LedgerEntry, type Mailer } from "@benchme/site-kit";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { FastifyInstance, InjectOptions } from "fastify";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildFlights } from "./build-app.js";

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
let rows: FlightRows;
let bearer = "";
let cookie = "";
let baseUrl = "";
const scoped = (o: InjectOptions & { url: string }, wsId = ws): InjectOptions => ({
  ...o,
  headers: { ...(o.headers ?? {}), [WORKSPACE_HEADER]: wsId, [WORKSPACE_SIG_HEADER]: signWorkspaceHeader(SECRET, wsId), "x-forwarded-prefix": `/w/${wsId}/flights` },
});
const get = async (url: string) => (await app.inject(scoped({ method: "GET", url }))).json();
const post = (url: string, payload: unknown, auth = true) => app.inject(scoped({ method: "POST", url, payload: payload as Record<string, unknown>, headers: auth ? { authorization: `Bearer ${bearer}` } : {} }));
/** The site's ledger as the verifier reads it: every entry after `from`. */
const ledger = async (from = 0) => (await app.inject(scoped({ url: `/internal/workspaces/${ws}/ledger?cursor=${from}&limit=1000`, headers: { [VERIFIER_SIG_HEADER]: signVerifierHeader(SECRET, ws) } }))).json().items as LedgerEntry[];
const ledgerEnd = async () => Number((await pool.query("SELECT COALESCE(max(seq), 0) AS seq FROM flights.ledger WHERE workspace_id = $1", [ws])).rows[0].seq);
const form = (url: string, body: Record<string, string>) => app.inject(scoped({ method: "POST", url, payload: new URLSearchParams(body).toString(), headers: { "content-type": "application/x-www-form-urlencoded", cookie: `fl_session=${cookie}` } }));

async function signIn(wsId: string, email: string): Promise<{ token: string; cookie: string }> {
  const before = mailer.sent.length;
  const enc = encodeURIComponent(email);
  const fh = { "content-type": "application/x-www-form-urlencoded" };
  await app.inject(scoped({ method: "POST", url: "/signup", payload: `name=T&email=${enc}&password=correct-horse-9`, headers: fh }, wsId));
  const code = /code is (\d{6})/.exec(mailer.sent[before]!.body)![1]!;
  await app.inject(scoped({ method: "POST", url: "/verify", payload: `email=${enc}&code=${code}`, headers: fh }, wsId));
  const login = await app.inject(scoped({ method: "POST", url: "/login", payload: `email=${enc}&password=correct-horse-9`, headers: fh }, wsId));
  const session = login.cookies.find((c) => c.name === "fl_session")!.value;
  await app.inject(scoped({ method: "POST", url: "/account/token", headers: { cookie: `fl_session=${session}` } }, wsId));
  const token = /flt_[0-9a-f]+/.exec((await app.inject(scoped({ url: "/account", headers: { cookie: `fl_session=${session}` } }, wsId))).body)![0];
  return { token, cookie: session };
}

beforeAll(async () => {
  if (!DB) return;
  pool = createPool(DB, 4);
  await migrate(pool, "core", join(here, "..", "..", "gateway", "migrations"));
  await migrate(pool, "flights", join(here, "..", "migrations"));
  mailer = new CapturingMailer();
  app = await buildFlights({ pool, scenarios, mailer, gatewaySecret: SECRET, sessionTtlSeconds: 3600, logLevel: "silent" });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  baseUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  rows = webmcpV1.generate(4242).flights;
  ws = newWorkspaceId();
  await pool.query("INSERT INTO core.workspaces (id, scenario, seed, expires_at) VALUES ($1, 'webmcp-v1', 4242, now() + interval '1 hour')", [ws]);
  expect((await app.inject(scoped({ method: "POST", url: `/internal/workspaces/${ws}/seed`, payload: { scenario: "webmcp-v1", seed: 4242 } }))).statusCode).toBe(201);
  ({ token: bearer, cookie } = await signIn(ws, "booker@example.com"));
});
afterAll(async () => {
  await app?.close();
  await pool?.end();
});

/** A sold-out departure the seed made: every seat of the cabin taken that day. */
const soldOut = () => {
  for (const b of rows.bookings) {
    const cabin = rows.cabins.find((c) => c.flightNo === b.flightNo && c.cabin === b.cabin) as FlightCabin;
    if (b.status === "confirmed" && flightSeatsLeft(cabin, rows.bookings, b.date) === 0) return { cabin, date: b.date, flight: rows.flights.find((f) => f.flightNo === b.flightNo)! };
  }
  throw new Error("no sold-out departure");
};
const cityOf = (code: string) => rows.airports.find((a) => a.code === code)!.city;
/** No seeded booking departs in May or June: every seat of every flight is free. */
const QUIET = "2027-05-17";

describe.skipIf(!DB)("flights (real Postgres)", () => {
  it("serves the WebMCP bridge with the full catalog on the home page", async () => {
    const res = await app.inject(scoped({ method: "GET", url: "/" }));
    expect(res.body).toContain('data-webmcp="bridge"');
    expect(res.body).toContain('"name":"search_flights"');
    expect(res.body).not.toContain('"$ref"');
  });

  it("serves the seeded airports, carriers, flights and bookings as the generator made them", async () => {
    expect((await get("/api/v1/airports")).length).toBe(rows.airports.length);
    expect(await get("/api/v1/carriers")).toEqual([...rows.carriers].sort((a, b) => a.code.localeCompare(b.code)));
    expect((await get("/api/v1/flights")).length).toBe(rows.flights.length);
    const f = rows.flights[0]!;
    const detail = await get(`/api/v1/flights/${f.flightNo.toLowerCase()}`);
    expect(detail).toMatchObject({ ...f, carrier: rows.carriers.find((c) => c.code === f.carrierCode) });
    expect(detail.cabins).toEqual(rows.cabins.filter((c) => c.flightNo === f.flightNo));
    const route = await get(`/api/v1/flights?origin=${encodeURIComponent(cityOf(f.origin))}&destination=${f.destination}`);
    expect(route.map((x: { flightNo: string }) => x.flightNo).sort()).toEqual(rows.flights.filter((x) => x.origin === f.origin && x.destination === f.destination).map((x) => x.flightNo).sort());
    const b = rows.bookings[0]!;
    expect(await get(`/api/v1/bookings/${b.bookingNo}`)).toMatchObject({ ...b, passengerCount: b.passengers.length, origin: rows.flights.find((x) => x.flightNo === b.flightNo)!.origin });
    const mine = await get(`/api/v1/bookings?contactEmail=${encodeURIComponent(b.contactEmail.toUpperCase())}&limit=200`);
    expect(mine.items.map((x: { bookingNo: string }) => x.bookingNo)).toEqual(rows.bookings.filter((x) => x.contactEmail === b.contactEmail).map((x) => x.bookingNo).sort());
  });

  it("answers every search the way searchFlights does, a sold-out cabin included", async () => {
    const out = soldOut();
    const base = { origin: cityOf(out.flight.origin), destination: out.flight.destination, date: out.date, passengers: 1, cabin: out.cabin.cabin };
    const qs = (q: Record<string, string | number>) => new URLSearchParams(Object.entries(q).map(([k, v]) => [k, String(v)]));
    const plain = await get(`/api/v1/search?${qs(base)}`);
    expect(plain).toEqual({ tripType: "one-way", outbound: searchFlights(rows, base), inbound: [] });
    expect(plain.outbound.map((o: { flightNo: string }) => o.flightNo)).not.toContain(out.flight.flightNo);
    const carriers = rows.carriers.slice(0, 2).map((c) => c.code);
    const filtered = { ...base, passengers: 2, maxStops: 0, departAfter: "07:00", departBefore: "20:00" };
    expect((await get(`/api/v1/search?${qs({ ...filtered, carriers: carriers.join(","), maxPrice: 400 })}`)).outbound).toEqual(searchFlights(rows, { ...filtered, carriers, maxPriceCents: 40000 }));
    const trip = await get(`/api/v1/search?${qs({ ...base, returnDate: QUIET })}`);
    expect(trip.tripType).toBe("round-trip");
    expect(trip.inbound).toEqual(searchFlights(rows, { ...base, origin: base.destination, destination: base.origin, date: QUIET }));
    expect((await get(`/api/v1/search?${qs({ ...base, tripType: "one-way", returnDate: QUIET })}`)).inbound).toEqual([]);
    expect(await get(`/api/v1/flights/${out.flight.flightNo}/seats?date=${out.date}`)).toMatchObject({ cabins: expect.arrayContaining([expect.objectContaining({ cabin: out.cabin.cabin, seatsLeft: 0 })]) });
    for (const bad of [`date=2027-02-30`, `date=${QUIET}&returnDate=2027-05-01`, `date=${QUIET}&tripType=round-trip`, `date=${QUIET}&passengers=10`, `date=${QUIET}&departAfter=9am`]) {
      expect((await app.inject(scoped({ method: "GET", url: `/api/v1/search?origin=${base.origin}&destination=${base.destination}&${bad}` }))).statusCode).toBe(400);
    }
  });

  it("books, refuses what the rules refuse, and cancels once", async () => {
    const f = rows.flights.find((x) => rows.cabins.some((c) => c.flightNo === x.flightNo && c.cabin === "business") && !rows.cabins.some((c) => c.flightNo === x.flightNo && c.cabin === "premium"))!;
    const business = rows.cabins.find((c) => c.flightNo === f.flightNo && c.cabin === "business")!;
    const carrier = rows.carriers.find((c) => c.code === f.carrierCode)!;
    const party = Array.from({ length: business.seats - 1 }, (_, i) => `Traveller ${i + 1}`);
    const body = { flightNo: f.flightNo, date: QUIET, cabin: "business", passengers: party, bags: 1, contactEmail: "Ilsa.Voss@Example.com" };
    expect((await post("/api/v1/bookings", body, false)).statusCode).toBe(401);
    const made = await post("/api/v1/bookings", body);
    expect(made.statusCode).toBe(201);
    expect(made.json()).toMatchObject({ flightNo: f.flightNo, date: QUIET, cabin: "business", contactEmail: "ilsa.voss@example.com", status: "confirmed", passengerCount: party.length, totalCents: party.length * business.priceCents + party.length * carrier.bagFeeCents });
    const two = await post("/api/v1/bookings", { ...body, passengers: ["A B", "C D"] });
    expect([two.statusCode, two.json().error]).toEqual([409, "NOT_ENOUGH_SEATS"]);
    expect((await post("/api/v1/bookings", { ...body, passengers: ["A B"] })).statusCode).toBe(201);
    const full = await post("/api/v1/bookings", { ...body, passengers: ["E F"] });
    expect([full.statusCode, full.json().error]).toEqual([409, "SOLD_OUT"]);
    const refused = async (patch: Record<string, unknown>) => (await post("/api/v1/bookings", { ...body, cabin: "economy", passengers: ["G H"], ...patch })).json().error;
    expect(await refused({ cabin: "premium" })).toBe("NO_CABIN");
    expect(await refused({ bags: carrier.maxBags + 1 })).toBe("TOO_MANY_BAGS");
    expect(await refused({ date: "2027-07-02" })).toBe("OUTSIDE_WINDOW");
    expect(await refused({ passengers: Array.from({ length: 10 }, (_, i) => `P ${i}`) })).toBe("TOO_MANY_PASSENGERS");
    expect(await refused({ passengers: ["G H", " "] })).toBe("NO_PASSENGER_NAME");
    expect(await refused({ passengers: [] })).toBe("NO_PASSENGERS");
    expect((await post("/api/v1/bookings", { ...body, cabin: "first" })).statusCode).toBe(400);
    const no = made.json().bookingNo;
    expect((await post(`/api/v1/bookings/${no}/cancel`, {})).json().status).toBe("cancelled");
    expect((await post(`/api/v1/bookings/${no}/cancel`, {})).statusCode).toBe(409);
    expect((await post("/api/v1/bookings", { ...body, passengers: ["E F"] })).statusCode).toBe(201);
  });

  it("books from the flight page, shows a refusal's reason there, and cancels from the booking page", async () => {
    const f = rows.flights[1]!;
    const economy = rows.cabins.find((c) => c.flightNo === f.flightNo && c.cabin === "economy")!;
    const page = await app.inject(scoped({ method: "GET", url: `/flights/${f.flightNo}?date=2027-06-01`, headers: { cookie: `fl_session=${cookie}` } }));
    expect(page.body).toContain(`Seats left on 2027-06-01`);
    expect(page.body).toContain(`action="/w/${ws}/flights/bookings"`);
    const booked = await form("/bookings", { flightNo: f.flightNo, date: "2027-06-01", cabin: "economy", passengers: "Maren Halvard\r\nBram Halvard\r\n", bags: "0", contactEmail: "maren.h@example.com" });
    expect(booked.statusCode).toBe(303);
    const no = booked.headers.location!.split("/").pop()!;
    const shown = await app.inject(scoped({ method: "GET", url: `/bookings/${no}` }));
    expect(shown.body).toContain("Bram Halvard");
    expect(shown.body).toContain(`$${((2 * economy.priceCents) / 100).toFixed(2)}`);
    const big = await form("/bookings", { flightNo: f.flightNo, date: "2027-06-01", cabin: "economy", passengers: Array.from({ length: economy.seats }, (_, i) => `Guest ${i}`).join("\n"), contactEmail: "maren.h@example.com" });
    expect(big.statusCode).toBe(409);
    expect(big.body).toContain("fewer than");
    expect((await form(`/bookings/${no}/cancel`, {})).statusCode).toBe(303);
    expect((await get(`/api/v1/bookings/${no}`)).status).toBe("cancelled");
  });

  it("keeps its ledger: a read through REST and through a page, a write nobody may make, a write and a rule's refusal, each with its door and who was signed in", async () => {
    const no = [...rows.bookings].reverse().find((x) => x.status === "confirmed")!.bookingNo;
    const from = await ledgerEnd();
    await get(`/api/v1/bookings/${no}`);
    await app.inject(scoped({ method: "GET", url: `/bookings/${no}` }));
    // Nobody signed in: REST says 401, the page sends the visitor to sign in, and neither reaches the rules.
    expect((await post(`/api/v1/bookings/${no}/cancel`, {}, false)).json()).toEqual({ error: "UNAUTHORIZED", message: "sign in or send Authorization: Bearer <api token>" });
    const sent = await app.inject(scoped({ method: "POST", url: `/bookings/${no}/cancel` }));
    expect([sent.statusCode, sent.headers.location]).toEqual([302, `/w/${ws}/flights/login`]);
    expect((await post(`/api/v1/bookings/${no}/cancel`, {})).statusCode).toBe(200);
    expect((await post(`/api/v1/bookings/${no}/cancel`, {})).json().error).toBe("ALREADY_CANCELLED");
    const kept = (await ledger(from)).filter((e) => e.entity.type === "booking");
    expect(kept.map((e) => [e.app, e.kind, e.entity.id, e.action, e.door, e.actor, e.outcome, e.code])).toEqual([
      ["flights", "read", no, "read", "rest", null, "ok", null],
      ["flights", "read", no, "read", "page", null, "ok", null],
      ["flights", "write", no, "cancel", "rest", null, "refused", "UNAUTHORIZED"],
      ["flights", "write", no, "cancel", "page", null, "refused", "UNAUTHORIZED"],
      ["flights", "write", no, "cancel", "rest", "booker@example.com", "ok", null],
      ["flights", "write", no, "cancel", "rest", "booker@example.com", "refused", "ALREADY_CANCELLED"],
    ]);
    // Each is stamped when it happened, in order.
    expect(kept.map((e) => Date.parse(e.at))).toEqual(kept.map((e) => Date.parse(e.at)).sort((a, b) => a - b));
    expect(Math.abs(Date.now() - Date.parse(kept[0]!.at))).toBeLessThan(60_000);
  });

  it("keeps a write and its ledger entry together: a cancel, or a sign-up, whose entry cannot be kept does not happen", async () => {
    const no = rows.bookings.find((x) => x.status === "confirmed")!.bookingNo;
    const email = "unkept@example.com";
    // For this test only, the ledger refuses the entry of a cancel and of a sign-up.
    await pool.query("ALTER TABLE flights.ledger ADD CONSTRAINT test_unkept CHECK (action NOT IN ('cancel', 'sign_up')) NOT VALID");
    try {
      expect((await post(`/api/v1/bookings/${no}/cancel`, {})).statusCode).toBe(500);
      const signup = await app.inject(scoped({ method: "POST", url: "/signup", payload: `name=U&email=${encodeURIComponent(email)}&password=correct-horse-9`, headers: { "content-type": "application/x-www-form-urlencoded" } }));
      expect(signup.statusCode).toBe(500);
    } finally {
      await pool.query("ALTER TABLE flights.ledger DROP CONSTRAINT test_unkept");
    }
    expect((await get(`/api/v1/bookings/${no}`)).status).toBe("confirmed");
    expect((await pool.query("SELECT 1 FROM flights.users WHERE workspace_id = $1 AND email = $2", [ws, email])).rowCount).toBe(0);
  });

  it("names what a refused create was about: it has no entity id yet, and its subject says which one it was for", async () => {
    const flight = rows.flights[0]!.flightNo;
    const from = await ledgerEnd();
    const res = await post("/api/v1/bookings", { flightNo: flight, date: "2027-07-02", cabin: "economy", passengers: ["Subject Test"], bags: 0, contactEmail: "subject@example.com" });
    expect([res.statusCode >= 400 && res.statusCode < 500 && res.statusCode !== 400, res.json().error]).toEqual([true, "OUTSIDE_WINDOW"]);
    expect((await ledger(from)).map((e) => [e.kind, e.entity, e.subject, e.outcome, e.code])).toEqual([["write", { type: "booking", id: null }, { type: "flight", id: flight }, "refused", "OUTSIDE_WINDOW"]]);
  });

  it("exposes the same tools over MCP", async () => {
    const client = new Client({ name: "test", version: "0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), { requestInit: { headers: { [WORKSPACE_HEADER]: ws, [WORKSPACE_SIG_HEADER]: signWorkspaceHeader(SECRET, ws) } } }));
    try {
      const names = (await client.listTools()).tools.map((t) => t.name).sort();
      // The site's own tools, and the kit's for signing up and in.
      expect(names).toEqual(["cancel_booking", "check_seats", "create_booking", "get_booking", "get_flight", "list_airports", "list_bookings", "list_carriers", "list_flights", "search_flights", ...SIGN_IN_TOOLS].sort());
      const out = soldOut();
      const q = { origin: out.flight.origin, destination: cityOf(out.flight.destination), date: out.date, passengers: 1, cabin: out.cabin.cabin };
      const res = (await client.callTool({ name: "search_flights", arguments: q })) as { content: { text: string }[] };
      expect(JSON.parse(res.content[0]!.text).outbound).toEqual(searchFlights(rows, q));
      // A tool call is a door of its own in the ledger.
      const from = await ledgerEnd();
      await client.callTool({ name: "get_flight", arguments: { flightNo: rows.flights[0]!.flightNo } });
      expect((await ledger(from)).map((e) => [e.kind, e.entity.type, e.entity.id, e.door, e.outcome])).toEqual([["read", "flight", rows.flights[0]!.flightNo, "mcp", "ok"]]);
      // The sign-in the pages and REST ask, asked here too: a write by nobody is refused before the rules are, and the ledger keeps it.
      const mark = await ledgerEnd();
      const refused = (await client.callTool({ name: "cancel_booking", arguments: { bookingNo: "NO-SUCH" } })) as { isError?: boolean; content: { text: string }[] };
      expect([refused.isError, JSON.parse(refused.content[0]!.text).error]).toEqual([true, "UNAUTHORIZED"]);
      expect((await ledger(mark)).map((e) => [e.door, e.kind, e.entity.type, e.entity.id, e.action, e.actor, e.outcome, e.code])).toEqual([["mcp", "write", "booking", "NO-SUCH", "cancel", null, "refused", "UNAUTHORIZED"]]);
    } finally {
      await client.close();
    }
  });
});
