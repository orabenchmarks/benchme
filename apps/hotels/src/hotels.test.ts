import { WORKSPACE_HEADER, WORKSPACE_SIG_HEADER, createPool, migrate, newWorkspaceId, signWorkspaceHeader, type Pool } from "@benchme/core";
import { webmcpV1, roomsLeft, scenarios, searchStays, type HotelRows } from "@benchme/scenarios";
import type { Mailer } from "@benchme/site-kit";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { FastifyInstance, InjectOptions } from "fastify";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildHotels } from "./build-app.js";

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

  it("exposes the same tools over MCP", async () => {
    const client = new Client({ name: "test", version: "0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), { requestInit: { headers: { [WORKSPACE_HEADER]: ws, [WORKSPACE_SIG_HEADER]: signWorkspaceHeader(SECRET, ws) } } }));
    try {
      const names = (await client.listTools()).tools.map((t) => t.name).sort();
      expect(names).toEqual(["cancel_booking", "check_availability", "create_booking", "get_booking", "get_hotel", "list_bookings", "list_cities", "list_hotels", "search_stays"]);
      const city = rows.hotels[0]!.city;
      // Not QUIET: the booking test above left a booking on those nights, which the seed rows do not have.
      const res = (await client.callTool({ name: "search_stays", arguments: { city, checkIn: "2027-11-08", nights: 3, adults: 1 } })) as { content: { text: string }[] };
      expect(JSON.parse(res.content[0]!.text)).toEqual(searchStays(rows, { city, checkIn: "2027-11-08", nights: 3, adults: 1, kids: 0, pets: 0 }));
    } finally {
      await client.close();
    }
  });
});
