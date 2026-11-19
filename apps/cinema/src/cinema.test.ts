import { WORKSPACE_HEADER, WORKSPACE_SIG_HEADER, createPool, migrate, newWorkspaceId, signWorkspaceHeader, type Pool } from "@benchme/core";
import { webmcpV1, cinemaBookingView, cinemaFreeRuns, cinemaFreeSeats, cinemaSearchShowtimes, cinemaSeatMap, cinemaTakenSeats, scenarios, type CinemaRows, type CinemaScreen } from "@benchme/scenarios";
import type { Mailer } from "@benchme/site-kit";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { FastifyInstance, InjectOptions } from "fastify";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildCinema } from "./build-app.js";

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
let rows: CinemaRows;
let bearer = "";
let cookie = "";
let baseUrl = "";
const scoped = (o: InjectOptions & { url: string }, wsId = ws): InjectOptions => ({
  ...o,
  headers: { ...(o.headers ?? {}), [WORKSPACE_HEADER]: wsId, [WORKSPACE_SIG_HEADER]: signWorkspaceHeader(SECRET, wsId), "x-forwarded-prefix": `/w/${wsId}/cinema` },
});
const get = async (url: string) => (await app.inject(scoped({ method: "GET", url }))).json();
const post = (url: string, payload: unknown, auth = true) => app.inject(scoped({ method: "POST", url, payload: payload as Record<string, unknown>, headers: auth ? { authorization: `Bearer ${bearer}` } : {} }));
const form = (url: string, body: Record<string, string>) =>
  app.inject(scoped({ method: "POST", url, payload: new URLSearchParams(body).toString(), headers: { "content-type": "application/x-www-form-urlencoded", cookie: `cn_session=${cookie}` } }));

async function signIn(wsId: string, email: string): Promise<{ token: string; cookie: string }> {
  const before = mailer.sent.length;
  const enc = encodeURIComponent(email);
  const fh = { "content-type": "application/x-www-form-urlencoded" };
  await app.inject(scoped({ method: "POST", url: "/signup", payload: `name=T&email=${enc}&password=correct-horse-9`, headers: fh }, wsId));
  const code = /code is (\d{6})/.exec(mailer.sent[before]!.body)![1]!;
  await app.inject(scoped({ method: "POST", url: "/verify", payload: `email=${enc}&code=${code}`, headers: fh }, wsId));
  const login = await app.inject(scoped({ method: "POST", url: "/login", payload: `email=${enc}&password=correct-horse-9`, headers: fh }, wsId));
  const session = login.cookies.find((c) => c.name === "cn_session")!.value;
  await app.inject(scoped({ method: "POST", url: "/account/token", headers: { cookie: `cn_session=${session}` } }, wsId));
  const token = /cin_[0-9a-f]+/.exec((await app.inject(scoped({ url: "/account", headers: { cookie: `cn_session=${session}` } }, wsId))).body)![0];
  return { token, cookie: session };
}

beforeAll(async () => {
  if (!DB) return;
  pool = createPool(DB, 4);
  await migrate(pool, "core", join(here, "..", "..", "gateway", "migrations"));
  await migrate(pool, "cinema", join(here, "..", "migrations"));
  mailer = new CapturingMailer();
  app = await buildCinema({ pool, scenarios, mailer, gatewaySecret: SECRET, sessionTtlSeconds: 3600, logLevel: "silent" });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  baseUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  rows = webmcpV1.generate(4242).cinema;
  ws = newWorkspaceId();
  await pool.query("INSERT INTO core.workspaces (id, scenario, seed, expires_at) VALUES ($1, 'webmcp-v1', 4242, now() + interval '1 hour')", [ws]);
  expect((await app.inject(scoped({ method: "POST", url: `/internal/workspaces/${ws}/seed`, payload: { scenario: "webmcp-v1", seed: 4242 } }))).statusCode).toBe(201);
  ({ token: bearer, cookie } = await signIn(ws, "booker@example.com"));
});
afterAll(async () => {
  await app?.close();
  await pool?.end();
});

const screenOf = (code: string) => rows.screens.find((s) => s.code === code) as CinemaScreen;
const showtimeOf = (code: string) => rows.showtimes.find((s) => s.code === code)!;
const offers = () => cinemaSearchShowtimes(rows, {});
/** Showtimes the writes below use; the read tests stay off them. */
const soldOut = () => offers().find((o) => o.freeSeats === 0)!;
const empty = () => offers().filter((o) => o.freeSeats === o.seatsTotal && o.rating !== "15" && o.rating !== "18" && o.format === "2d")[0]!;
const pagesShow = () => offers().filter((o) => o.freeSeats === o.seatsTotal && o.format === "2d" && o.showtimeCode !== empty().showtimeCode)[0]!;
/** A nearly-full showtime on a city and day no write below touches. */
const untouched = () => {
  const days = new Set([empty(), pagesShow()].map((o) => `${o.city}:${o.date}`));
  return offers().find((o) => o.freeSeats > 1 && o.bestRun === 1 && !days.has(`${o.city}:${o.date}`))!;
};

describe.skipIf(!DB)("cinema (real Postgres)", () => {
  it("serves the WebMCP bridge with the full catalog on the home page", async () => {
    const res = await app.inject(scoped({ method: "GET", url: "/" }));
    expect(res.body).toContain('data-webmcp="bridge"');
    expect(res.body).toContain('"name":"search_showtimes"');
  });

  it("serves the seeded cinemas, films, showtimes and bookings as the generator made them", async () => {
    expect(await get("/api/v1/cinemas")).toEqual(rows.cinemas);
    const c = rows.cinemas[1]!;
    expect(await get(`/api/v1/cinemas/${c.code}`)).toEqual({ ...c, screens: rows.screens.filter((s) => s.cinemaCode === c.code), prices: expect.arrayContaining(rows.prices.filter((p) => p.cinemaCode === c.code)) });
    expect(await get("/api/v1/films")).toEqual(rows.films);
    expect((await get(`/api/v1/films?genre=${encodeURIComponent(rows.films[0]!.genre.toUpperCase())}`)).map((f: { code: string }) => f.code)).toEqual(rows.films.filter((f) => f.genre === rows.films[0]!.genre).map((f) => f.code));
    const b = rows.bookings[0]!;
    expect(await get(`/api/v1/bookings/${b.bookingNo}`)).toEqual({ ...cinemaBookingView(b, showtimeOf(b.showtimeCode)), cancelledAt: null });
    const mine = await get(`/api/v1/bookings?customerEmail=${encodeURIComponent(b.customerEmail.toUpperCase())}&limit=200`);
    expect(mine.items.map((x: { bookingNo: string }) => x.bookingNo)).toEqual(rows.bookings.filter((x) => x.customerEmail === b.customerEmail).map((x) => x.bookingNo).sort());
    const s = soldOut();
    const detail = await get(`/api/v1/showtimes/${s.showtimeCode}`);
    expect(detail).toMatchObject({ ...s, seatMap: cinemaSeatMap(screenOf(s.screenCode), cinemaTakenSeats(rows.bookings, s.showtimeCode)) });
    expect(detail.seatMap.every((r: { free: string[] }) => r.free.length === 0)).toBe(true);
  });

  it("answers every search the way cinemaSearchShowtimes does, sold-out and nearly-full showtimes included", async () => {
    const full = soldOut();
    const nearly = offers().find((o) => o.freeSeats > 1 && o.bestRun === 1)!;
    for (const q of [
      { city: full.city, date: full.date },
      { city: full.city, date: full.date, seats: 1 },
      { city: nearly.city, seats: 2, together: true },
      { genre: nearly.genre, format: nearly.format, after: "18:00", seats: 2 },
      { film: nearly.filmCode },
    ]) {
      const qs = new URLSearchParams(Object.entries(q).map(([k, v]) => [k, String(v)]));
      const { film, ...rest } = q as typeof q & { film?: string };
      expect(await get(`/api/v1/showtimes?${qs}`)).toEqual(cinemaSearchShowtimes(rows, { ...rest, ...(film ? { filmCode: film } : {}) } as Parameters<typeof cinemaSearchShowtimes>[1]));
    }
    expect((await get(`/api/v1/showtimes?city=${encodeURIComponent(full.city)}&date=${full.date}`)).map((o: { showtimeCode: string }) => o.showtimeCode)).toContain(full.showtimeCode);
    expect((await get(`/api/v1/showtimes?city=${encodeURIComponent(full.city)}&date=${full.date}&seats=1`)).map((o: { showtimeCode: string }) => o.showtimeCode)).not.toContain(full.showtimeCode);
    for (const bad of ["date=2027-02-30", "after=7pm", "format=4d", "seats=11"]) expect((await app.inject(scoped({ method: "GET", url: `/api/v1/showtimes?${bad}` }))).statusCode).toBe(400);
  });

  it("reads a query param left blank as not given, on showtimes and bookings alike", async () => {
    const blank = await app.inject(scoped({ method: "GET", url: "/api/v1/showtimes?date=" }));
    expect([blank.statusCode, blank.json()]).toEqual([200, offers()]);
    const full = soldOut();
    expect(await get(`/api/v1/showtimes?city=${encodeURIComponent(full.city)}&cinema=&date=&genre=&film=&format=&after=&seats=&together=`)).toEqual(cinemaSearchShowtimes(rows, { city: full.city }));
    expect(await get(`/api/v1/showtimes?city=&date=${full.date}&seats=1`)).toEqual(cinemaSearchShowtimes(rows, { date: full.date, seats: 1 }));
    const b = rows.bookings[0]!;
    const mine = await app.inject(scoped({ method: "GET", url: `/api/v1/bookings?customerEmail=${encodeURIComponent(b.customerEmail)}&showtime=&film=&status=&cursor=&limit=` }));
    expect([mine.statusCode, mine.json().items?.map((x: { bookingNo: string }) => x.bookingNo)]).toEqual([200, rows.bookings.filter((x) => x.customerEmail === b.customerEmail).map((x) => x.bookingNo).sort()]);
    // A value that is given and wrong is still the caller's to fix.
    for (const bad of ["showtimes?date=2027-02-30", "showtimes?seats=0", "showtimes?together=maybe", "bookings?status=held", "bookings?limit=0"]) expect((await app.inject(scoped({ method: "GET", url: `/api/v1/${bad}` }))).statusCode, bad).toBe(400);
  });

  it("books, refuses what the rules refuse, and cancels once", async () => {
    const s = empty();
    const seats = ["C3", "C4", "C5"];
    const body = { showtimeCode: s.showtimeCode, seats, adult: 2, child: 1, customerName: "Anouk Belloc", customerEmail: "Anouk.Belloc@Example.com" };
    expect((await post("/api/v1/bookings", body, false)).statusCode).toBe(401);
    const made = await post("/api/v1/bookings", body);
    expect(made.statusCode).toBe(201);
    const fee = rows.cinemas.find((c) => c.code === s.cinemaCode)!.bookingFeeCents;
    const price = (t: string) => rows.prices.find((p) => p.cinemaCode === s.cinemaCode && p.format === s.format && p.ticketType === t)!.priceCents;
    expect(made.json()).toMatchObject({ seats: "C3,C4,C5", together: true, customerEmail: "anouk.belloc@example.com", status: "confirmed", ticketCounts: { adult: 2, child: 1, senior: 0, student: 0 }, feesCents: fee * 3, totalCents: price("adult") * 2 + price("child") + fee * 3 });
    const refused = async (b: Record<string, unknown>) => {
      const r = await post("/api/v1/bookings", { ...body, ...b });
      return [r.statusCode, r.json().error];
    };
    expect(await refused({ seats: ["C5", "C6"], child: 0 })).toEqual([409, "SEAT_TAKEN"]);
    expect(await refused({ showtimeCode: soldOut().showtimeCode, seats: ["A1"], adult: 1, child: 0 })).toEqual([409, "SOLD_OUT"]);
    expect(await refused({ seats: ["A1", "A2"], adult: 2, child: 1 })).toEqual([422, "BAD_TICKET_COUNT"]);
    expect(await refused({ seats: ["Z1", "A2", "A3"] })).toEqual([422, "BAD_SEAT"]);
    expect(await refused({ seats: "A1,A2,A3,A4,A5,A6,B1,B2,B3,B4,B5", adult: 0, child: 0 })).toEqual([422, "TOO_MANY_SEATS"]);
    const adultOnly = offers().find((o) => (o.rating === "18" || o.rating === "15") && o.freeSeats > 4)!;
    expect(await refused({ showtimeCode: adultOnly.showtimeCode, seats: cinemaFreeSeats(screenOf(adultOnly.screenCode), cinemaTakenSeats(rows.bookings, adultOnly.showtimeCode)).slice(0, 3) })).toEqual([422, "CHILD_NOT_ALLOWED"]);
    expect(await refused({ showtimeCode: "ST-1" })).toEqual([404, "UNKNOWN_SHOWTIME"]);
    expect((await post("/api/v1/bookings", { ...body, seats: [] })).statusCode).toBe(422);
    const no = made.json().bookingNo;
    expect((await post(`/api/v1/bookings/${no}/cancel`, {})).json().status).toBe("cancelled");
    expect((await post(`/api/v1/bookings/${no}/cancel`, {})).statusCode).toBe(409);
    expect((await post("/api/v1/bookings", body)).statusCode).toBe(201);
  });

  it("books through the pages, shows a refusal on the showtime page, and cancels from the booking page", async () => {
    const s = pagesShow();
    const page = await app.inject(scoped({ method: "GET", url: `/showtimes/${s.showtimeCode}`, headers: { cookie: `cn_session=${cookie}` } }));
    expect(page.body).toContain(`action="/w/${ws}/cinema/bookings"`);
    const booked = await form("/bookings", { showtimeCode: s.showtimeCode, seats: "D1, D2", adult: "", senior: "1", student: "1", customerName: "Basil Castellan", customerEmail: "basil.castellan@film.example" });
    expect(booked.statusCode).toBe(303);
    const no = booked.headers.location!.split("/").pop()!;
    const detail = await app.inject(scoped({ method: "GET", url: `/bookings/${no}`, headers: { cookie: `cn_session=${cookie}` } }));
    expect(detail.body).toContain("D1,D2");
    expect(detail.body).toContain("Senior");
    const again = await form("/bookings", { showtimeCode: s.showtimeCode, seats: "D2", customerName: "Basil Castellan", customerEmail: "basil.castellan@film.example" });
    expect(again.statusCode).toBe(409);
    expect(again.body).toContain("D2 already booked");
    expect((await form(`/bookings/${no}/cancel`, {})).statusCode).toBe(303);
    expect((await get(`/api/v1/bookings/${no}`)).status).toBe("cancelled");
  });

  it("exposes the same tools over MCP", async () => {
    const client = new Client({ name: "test", version: "0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), { requestInit: { headers: { [WORKSPACE_HEADER]: ws, [WORKSPACE_SIG_HEADER]: signWorkspaceHeader(SECRET, ws) } } }));
    try {
      const names = (await client.listTools()).tools.map((t) => t.name).sort();
      expect(names).toEqual(["cancel_booking", "create_booking", "get_booking", "get_cinema", "get_film", "get_showtime", "list_bookings", "list_cinemas", "list_films", "search_showtimes"]);
      // Not the writes' showtimes: they hold bookings the seed rows do not have.
      const nearly = untouched();
      const q = { city: nearly.city, date: nearly.date, seats: 2, together: true };
      const res = (await client.callTool({ name: "search_showtimes", arguments: q })) as { content: { text: string }[] };
      expect(JSON.parse(res.content[0]!.text)).toEqual(cinemaSearchShowtimes(rows, q));
      expect(cinemaFreeRuns(screenOf(nearly.screenCode), cinemaTakenSeats(rows.bookings, nearly.showtimeCode)).every((r) => r.length === 1)).toBe(true);
    } finally {
      await client.close();
    }
  });
});
