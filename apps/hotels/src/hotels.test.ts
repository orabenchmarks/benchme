import { VERIFIER_SIG_HEADER, WORKSPACE_HEADER, WORKSPACE_SIG_HEADER, createPool, migrate, newWorkspaceId, signVerifierHeader, signWorkspaceHeader, type Pool } from "@benchme/core";
import { cujV1, webmcpV1, roomsLeft, scenarios, searchStays, type HotelRows } from "@benchme/scenarios";
import { SIGN_IN_TOOLS, type LedgerEntry, type Mailer } from "@benchme/site-kit";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { FastifyInstance, InjectOptions } from "fastify";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildHotels } from "./build-app.js";
import { PgHotelsRepo } from "./db/hotels-repo.js";

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
let rows: HotelRows;
let bearer = "";
let baseUrl = "";
const scoped = (o: InjectOptions & { url: string }, wsId = ws): InjectOptions => ({
  ...o,
  headers: { ...(o.headers ?? {}), [WORKSPACE_HEADER]: wsId, [WORKSPACE_SIG_HEADER]: signWorkspaceHeader(SECRET, wsId), "x-forwarded-prefix": `/w/${wsId}/hotels` },
});
const get = async (url: string) => (await app.inject(scoped({ method: "GET", url }))).json();
const post = (url: string, payload: unknown, auth = true) => app.inject(scoped({ method: "POST", url, payload: payload as Record<string, unknown>, headers: auth ? { authorization: `Bearer ${bearer}` } : {} }));
/** The site's ledger as the verifier reads it: every entry after `from`. */
const ledger = async (from = 0) => (await app.inject(scoped({ url: `/internal/workspaces/${ws}/ledger?cursor=${from}&limit=1000`, headers: { [VERIFIER_SIG_HEADER]: signVerifierHeader(SECRET, ws) } }))).json().items as LedgerEntry[];
const ledgerEnd = async () => Number((await pool.query("SELECT COALESCE(max(seq), 0) AS seq FROM hotels.ledger WHERE workspace_id = $1", [ws])).rows[0].seq);

async function token(wsId: string, email: string): Promise<string> {
  const before = mailer.sent.length;
  const enc = encodeURIComponent(email);
  const fh = { "content-type": "application/x-www-form-urlencoded" };
  await app.inject(scoped({ method: "POST", url: "/signup", payload: `name=T&email=${enc}&password=correct-horse-9`, headers: fh }, wsId));
  const code = /code is (\d{6})/.exec(mailer.sent[before]!.body)![1]!;
  await app.inject(scoped({ method: "POST", url: "/verify", payload: `email=${enc}&code=${code}`, headers: fh }, wsId));
  const login = await app.inject(scoped({ method: "POST", url: "/login", payload: `email=${enc}&password=correct-horse-9`, headers: fh }, wsId));
  const cookie = login.cookies.find((c) => c.name === "ht_session")!.value;
  await app.inject(scoped({ method: "POST", url: "/account/token", headers: { cookie: `ht_session=${cookie}` } }, wsId));
  return /htl_[0-9a-f]+/.exec((await app.inject(scoped({ url: "/account", headers: { cookie: `ht_session=${cookie}` } }, wsId))).body)![0];
}

beforeAll(async () => {
  if (!DB) return;
  pool = createPool(DB, 4);
  await migrate(pool, "core", join(here, "..", "..", "gateway", "migrations"));
  await migrate(pool, "hotels", join(here, "..", "migrations"));
  mailer = new CapturingMailer();
  app = await buildHotels({ pool, scenarios, mailer, gatewaySecret: SECRET, sessionTtlSeconds: 3600, logLevel: "silent" });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  baseUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  rows = webmcpV1.generate(4242).hotels;
  ws = newWorkspaceId();
  await pool.query("INSERT INTO core.workspaces (id, scenario, seed, expires_at) VALUES ($1, 'webmcp-v1', 4242, now() + interval '1 hour')", [ws]);
  expect((await app.inject(scoped({ method: "POST", url: `/internal/workspaces/${ws}/seed`, payload: { scenario: "webmcp-v1", seed: 4242 } }))).statusCode).toBe(201);
  bearer = await token(ws, "booker@example.com");
});
afterAll(async () => {
  await app?.close();
  await pool?.end();
});

/** A stay no seeded booking touches, in the bookable year: every room type is fully free. */
const QUIET = { checkIn: "2027-10-04", nights: 2 };

describe.skipIf(!DB)("hotels (real Postgres)", () => {
  it("serves the WebMCP bridge with the full catalog on the home page", async () => {
    const res = await app.inject(scoped({ method: "GET", url: "/" }));
    expect(res.body).toContain('data-webmcp="bridge"');
    expect(res.body).toContain('"name":"search_stays"');
  });

  it("serves the seeded hotels, rooms and bookings as the generator made them", async () => {
    expect((await get("/api/v1/hotels")).length).toBe(rows.hotels.length);
    const h = rows.hotels[0]!;
    const detail = await get(`/api/v1/hotels/${h.code}`);
    expect(detail).toMatchObject({ ...h });
    expect(detail.rooms).toEqual(rows.rooms.filter((r) => r.hotelCode === h.code).sort((x, y) => x.nightlyCents - y.nightlyCents || x.code.localeCompare(y.code)));
    const b = rows.bookings[0]!;
    expect(await get(`/api/v1/bookings/${b.bookingNo}`)).toMatchObject({ ...b });
    const guest = await get(`/api/v1/bookings?guestEmail=${encodeURIComponent(b.guestEmail.toUpperCase())}&limit=200`);
    expect(guest.items.map((x: { bookingNo: string }) => x.bookingNo)).toEqual(rows.bookings.filter((x) => x.guestEmail === b.guestEmail).map((x) => x.bookingNo).sort());
  });

  it("answers every search the way searchStays does, a booked-out room type included", async () => {
    const out = rows.bookings.find((b) => b.status === "confirmed" && roomsLeft(rows.rooms.find((r) => r.code === b.roomCode)!, rows.bookings, b.checkIn, 1) === 0)!;
    const city = rows.hotels.find((h) => h.code === out.hotelCode)!.city;
    for (const q of [
      { city, checkIn: out.checkIn, nights: 1, adults: 1, kids: 0, pets: 0 },
      { city, checkIn: out.checkIn, nights: 3, adults: 2, kids: 1, pets: 0, amenities: ["gym"] },
      { city, ...QUIET, adults: 1, kids: 0, pets: 1, maxNightlyCents: 20000 },
    ]) {
      const qs = new URLSearchParams({ city: q.city, checkIn: q.checkIn, nights: String(q.nights), adults: String(q.adults), kids: String(q.kids), pets: String(q.pets), ...(q.amenities ? { amenities: q.amenities.join(",") } : {}), ...(q.maxNightlyCents ? { maxPrice: String(q.maxNightlyCents / 100) } : {}) });
      expect(await get(`/api/v1/search?${qs}`)).toEqual(searchStays(rows, q));
    }
    expect((await app.inject(scoped({ method: "GET", url: `/api/v1/search?city=${city}&checkIn=2027-02-30&nights=1` }))).statusCode).toBe(400);
    // The search form sends the fields a person leaves empty as "": no cap, the default party — not a 400.
    const blank = await app.inject(scoped({ method: "GET", url: `/search?city=${city}&checkIn=${QUIET.checkIn}&nights=2&adults=1&kids=&pets=&maxPrice=` }));
    expect([blank.statusCode, blank.body.includes("hotel(s) with a room that fits")]).toEqual([200, true]);
  });

  it("reads a blank optional query field as not given, and a given one as before", async () => {
    const status = async (url: string) => (await app.inject(scoped({ method: "GET", url }))).statusCode;
    // One blank field per request, each read as the same request without it.
    const blanks = ["/api/v1/hotels?pets=", "/api/v1/bookings?status=", "/api/v1/bookings?limit="];
    const statuses: Record<string, number> = {};
    for (const url of blanks) statuses[url] = await status(url);
    expect(statuses).toEqual(Object.fromEntries(blanks.map((url) => [url, 200])));
    const hotels = await get("/api/v1/hotels");
    expect(hotels.length).toBe(rows.hotels.length);
    expect(await get("/api/v1/hotels?pets=")).toEqual(hotels);
    const bookings = await get("/api/v1/bookings");
    // The default page holds both statuses and is not the whole list, so a filter or another limit would show.
    expect([bookings.items.length, new Set(bookings.items.map((b: { status: string }) => b.status)).size, bookings.nextCursor !== null]).toEqual([50, 2, true]);
    expect(await get("/api/v1/bookings?status=")).toEqual(bookings);
    expect(await get("/api/v1/bookings?limit=")).toEqual(bookings);
    // A given value filters as it did, and a malformed one is still the caller's to fix.
    expect((await get("/api/v1/hotels?pets=true")).map((h: { code: string }) => h.code)).toEqual(rows.hotels.filter((h) => h.petsAllowed).map((h) => h.code));
    expect((await get("/api/v1/bookings?status=cancelled&limit=200")).items.map((b: { bookingNo: string }) => b.bookingNo)).toEqual(rows.bookings.filter((b) => b.status === "cancelled").map((b) => b.bookingNo).sort());
    expect((await get("/api/v1/bookings?limit=3")).items.length).toBe(3);
    for (const url of ["/api/v1/hotels?pets=yes", "/api/v1/bookings?status=open", "/api/v1/bookings?limit=0"]) expect([url, await status(url)]).toEqual([url, 400]);
    // A blank required field is still missing.
    const room = rows.rooms[0]!.code;
    for (const url of [`/api/v1/search?city=&checkIn=${QUIET.checkIn}&nights=2`, `/api/v1/search?city=${rows.hotels[0]!.city}&checkIn=${QUIET.checkIn}&nights=`, `/api/v1/rooms/${room}/availability?checkIn=&nights=2`, `/api/v1/rooms/${room}/availability?checkIn=${QUIET.checkIn}&nights=`])
      expect([url, await status(url)]).toEqual([url, 400]);
  });

  it("refuses a stay longer than the site books before computing its nights, on the hotel page and in the repo", async () => {
    const h = rows.hotels[0]!;
    const page = (qs: string) => app.inject(scoped({ method: "GET", url: `/hotels/${h.code}?${qs}` }));
    const started = Date.now();
    const huge = await page("checkIn=2027-01-01&nights=10000000");
    expect(Date.now() - started).toBeLessThan(2000);
    expect([huge.statusCode, huge.body.includes("a stay is 1 to 14 nights"), huge.body.includes("<th>Free ")]).toEqual([400, true, false]);
    // One night past the cap is refused the same way; the cap itself is answered, as is every stay the site books.
    const over = await page("checkIn=2027-01-01&nights=15");
    expect([over.statusCode, over.body.includes("a stay is 1 to 14 nights"), over.body.includes("<th>Free ")]).toEqual([400, true, false]);
    const most = await page("checkIn=2027-01-01&nights=14");
    expect([most.statusCode, most.body.includes("a stay is 1 to 14 nights"), most.body.includes("<th>Free 2027-01-01, 14 night(s)</th>")]).toEqual([200, false, true]);
    // No stay asked — no nights, or the field left blank — is the plain page, not a refusal.
    for (const qs of ["", "checkIn=2027-01-01", "checkIn=2027-01-01&nights="]) {
      const plain = await page(qs);
      expect([qs, plain.statusCode, plain.body.includes("a stay is 1 to 14 nights"), plain.body.includes("<th>Free ")]).toEqual([qs, 200, false, false]);
    }
    // The repo holds the cap itself, whatever door calls it.
    const repo = new PgHotelsRepo(pool);
    const room = rows.rooms.find((r) => r.hotelCode === h.code)!;
    const asked = Date.now();
    await expect(repo.availability(ws, room.code, "2027-01-01", 10_000_000)).rejects.toMatchObject({ code: "BAD_NIGHTS", status: 422 });
    await expect(repo.availability(ws, room.code, "2027-01-01", 15)).rejects.toMatchObject({ code: "BAD_NIGHTS", status: 422 });
    expect(Date.now() - asked).toBeLessThan(2000);
    expect(await repo.availability(ws, room.code, "2027-01-01", 14)).toEqual({ roomCode: room.code, checkIn: "2027-01-01", nights: 14, roomsLeft: roomsLeft(room, rows.bookings, "2027-01-01", 14) });
  });

  it("books, refuses what the rules refuse, and cancels once", async () => {
    const room = rows.rooms.find((r) => r.rooms === 1 && r.maxAdults >= 2)!;
    const hotel = rows.hotels.find((h) => h.code === room.hotelCode)!;
    const stay = { roomCode: room.code, ...QUIET, adults: 2, kids: 0, pets: 0, guestName: "Ilsa Voss", guestEmail: "Ilsa.Voss@Example.com" };
    expect((await post("/api/v1/bookings", stay, false)).statusCode).toBe(401);
    const made = await post("/api/v1/bookings", stay);
    expect(made.statusCode).toBe(201);
    expect(made.json()).toMatchObject({ hotelCode: hotel.code, roomCode: room.code, guestEmail: "ilsa.voss@example.com", status: "confirmed", totalCents: room.nightlyCents * 2, checkOut: "2027-10-06" });
    const again = await post("/api/v1/bookings", stay);
    expect([again.statusCode, again.json().error]).toEqual([409, "SOLD_OUT"]);
    expect((await post("/api/v1/bookings", { ...stay, adults: room.maxAdults + 1 })).json().error).toBe("TOO_MANY_GUESTS");
    const noPets = rows.rooms.find((r) => !rows.hotels.find((h) => h.code === r.hotelCode)!.petsAllowed && r.code !== room.code)!;
    expect((await post("/api/v1/bookings", { ...stay, roomCode: noPets.code, adults: 1, pets: 1 })).json().error).toBe("NO_PETS");
    expect((await post("/api/v1/bookings", { ...stay, checkIn: "2028-01-02" })).json().error).toBe("OUTSIDE_WINDOW");
    const no = made.json().bookingNo;
    expect((await post(`/api/v1/bookings/${no}/cancel`, {})).json().status).toBe("cancelled");
    expect((await post(`/api/v1/bookings/${no}/cancel`, {})).statusCode).toBe(409);
    expect((await post("/api/v1/bookings", stay)).statusCode).toBe(201);
  });

  it("keeps its ledger: a read through REST and through a page, a write nobody may make, a write and a rule's refusal, each with its door and who was signed in", async () => {
    const no = [...rows.bookings].reverse().find((x) => x.status === "confirmed")!.bookingNo;
    const from = await ledgerEnd();
    await get(`/api/v1/bookings/${no}`);
    await app.inject(scoped({ method: "GET", url: `/bookings/${no}` }));
    // Nobody signed in: REST says 401, the page sends the visitor to sign in, and neither reaches the rules.
    expect((await post(`/api/v1/bookings/${no}/cancel`, {}, false)).json()).toEqual({ error: "UNAUTHORIZED", message: "sign in or send Authorization: Bearer <api token>" });
    const sent = await app.inject(scoped({ method: "POST", url: `/bookings/${no}/cancel` }));
    expect([sent.statusCode, sent.headers.location]).toEqual([302, `/w/${ws}/hotels/login`]);
    expect((await post(`/api/v1/bookings/${no}/cancel`, {})).statusCode).toBe(200);
    expect((await post(`/api/v1/bookings/${no}/cancel`, {})).json().error).toBe("ALREADY_CANCELLED");
    const kept = (await ledger(from)).filter((e) => e.entity.type === "booking");
    expect(kept.map((e) => [e.app, e.kind, e.entity.id, e.action, e.door, e.actor, e.outcome, e.code])).toEqual([
      ["hotels", "read", no, "read", "rest", null, "ok", null],
      ["hotels", "read", no, "read", "page", null, "ok", null],
      ["hotels", "write", no, "cancel", "rest", null, "refused", "UNAUTHORIZED"],
      ["hotels", "write", no, "cancel", "page", null, "refused", "UNAUTHORIZED"],
      ["hotels", "write", no, "cancel", "rest", "booker@example.com", "ok", null],
      ["hotels", "write", no, "cancel", "rest", "booker@example.com", "refused", "ALREADY_CANCELLED"],
    ]);
    // Each is stamped when it happened, in order.
    expect(kept.map((e) => Date.parse(e.at))).toEqual(kept.map((e) => Date.parse(e.at)).sort((a, b) => a - b));
    expect(Math.abs(Date.now() - Date.parse(kept[0]!.at))).toBeLessThan(60_000);
  });

  it("keeps a write and its ledger entry together: a cancel, or a sign-up, whose entry cannot be kept does not happen", async () => {
    const no = rows.bookings.find((x) => x.status === "confirmed")!.bookingNo;
    const email = "unkept@example.com";
    // For this test only, the ledger refuses the entry of a cancel and of a sign-up.
    await pool.query("ALTER TABLE hotels.ledger ADD CONSTRAINT test_unkept CHECK (action NOT IN ('cancel', 'sign_up')) NOT VALID");
    try {
      expect((await post(`/api/v1/bookings/${no}/cancel`, {})).statusCode).toBe(500);
      const signup = await app.inject(scoped({ method: "POST", url: "/signup", payload: `name=U&email=${encodeURIComponent(email)}&password=correct-horse-9`, headers: { "content-type": "application/x-www-form-urlencoded" } }));
      expect(signup.statusCode).toBe(500);
    } finally {
      await pool.query("ALTER TABLE hotels.ledger DROP CONSTRAINT test_unkept");
    }
    expect((await get(`/api/v1/bookings/${no}`)).status).toBe("confirmed");
    expect((await pool.query("SELECT 1 FROM hotels.users WHERE workspace_id = $1 AND email = $2", [ws, email])).rowCount).toBe(0);
  });

  it("names what a refused create was about: it has no entity id yet, and its subject says which one it was for", async () => {
    const room = rows.rooms[0]!.code;
    const from = await ledgerEnd();
    const res = await post("/api/v1/bookings", { roomCode: room, checkIn: "2028-01-02", nights: 1, adults: 1, kids: 0, pets: 0, lateCheckout: false, guestName: "Subject Test", guestEmail: "subject@example.com" });
    expect([res.statusCode >= 400 && res.statusCode < 500 && res.statusCode !== 400, res.json().error]).toEqual([true, "OUTSIDE_WINDOW"]);
    expect((await ledger(from)).map((e) => [e.kind, e.entity, e.subject, e.outcome, e.code])).toEqual([["write", { type: "booking", id: null }, { type: "room", id: room }, "refused", "OUTSIDE_WINDOW"]]);
  });

  it("starts a cuj-v1 workspace with its accounts signed up and verified: their owners sign in with their password", async () => {
    const cuj = newWorkspaceId();
    await pool.query("INSERT INTO core.workspaces (id, scenario, seed, expires_at) VALUES ($1, 'cuj-v1', 4242, now() + interval '1 hour')", [cuj]);
    expect((await app.inject(scoped({ method: "POST", url: `/internal/workspaces/${cuj}/seed`, payload: { scenario: "cuj-v1", seed: 4242 } }, cuj))).statusCode).toBe(201);
    const [owner, other] = cujV1.generate(4242).accounts!.hotels!;
    const login = (email: string, password: string) => app.inject(scoped({ method: "POST", url: "/login", payload: `email=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}`, headers: { "content-type": "application/x-www-form-urlencoded" } }, cuj));
    const ok = await login(owner!.email, owner!.password);
    expect([ok.statusCode, ok.cookies.some((c) => c.name === "ht_session")]).toEqual([303, true]);
    // Each account takes its own password only, and an account of one workspace is no account in another.
    expect((await login(owner!.email, other!.password)).statusCode).toBe(401);
    expect((await app.inject(scoped({ method: "POST", url: "/login", payload: `email=${encodeURIComponent(owner!.email)}&password=${encodeURIComponent(owner!.password)}`, headers: { "content-type": "application/x-www-form-urlencoded" } }))).statusCode).toBe(401);
    // The same seed, the same rows: a second workspace keeps the same password hash for the same account.
    const again = newWorkspaceId();
    await pool.query("INSERT INTO core.workspaces (id, scenario, seed, expires_at) VALUES ($1, 'cuj-v1', 4242, now() + interval '1 hour')", [again]);
    await app.inject(scoped({ method: "POST", url: `/internal/workspaces/${again}/seed`, payload: { scenario: "cuj-v1", seed: 4242 } }, again));
    const hashes = await pool.query<{ password_hash: string }>("SELECT password_hash FROM hotels.users WHERE workspace_id = ANY($1) AND email = $2", [[cuj, again], owner!.email]);
    expect(hashes.rows.map((r) => r.password_hash)).toEqual([hashes.rows[0]!.password_hash, hashes.rows[0]!.password_hash]);
  });

  it("exposes the same tools over MCP", async () => {
    const client = new Client({ name: "test", version: "0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), { requestInit: { headers: { [WORKSPACE_HEADER]: ws, [WORKSPACE_SIG_HEADER]: signWorkspaceHeader(SECRET, ws) } } }));
    try {
      const names = (await client.listTools()).tools.map((t) => t.name).sort();
      // The site's own tools, and the kit's for signing up and in.
      expect(names).toEqual(["cancel_booking", "check_availability", "create_booking", "get_booking", "get_hotel", "list_bookings", "list_cities", "list_hotels", "search_stays", ...SIGN_IN_TOOLS].sort());
      const city = rows.hotels[0]!.city;
      // Not QUIET: the booking test above left a booking on those nights, which the seed rows do not have.
      const res = (await client.callTool({ name: "search_stays", arguments: { city, checkIn: "2027-11-08", nights: 3, adults: 1 } })) as { content: { text: string }[] };
      expect(JSON.parse(res.content[0]!.text)).toEqual(searchStays(rows, { city, checkIn: "2027-11-08", nights: 3, adults: 1, kids: 0, pets: 0 }));
      // A tool call is a door of its own in the ledger.
      const from = await ledgerEnd();
      await client.callTool({ name: "get_hotel", arguments: { hotelCode: rows.hotels[0]!.code } });
      expect((await ledger(from)).map((e) => [e.kind, e.entity.type, e.entity.id, e.door, e.outcome])).toEqual([["read", "hotel", rows.hotels[0]!.code, "mcp", "ok"]]);
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
