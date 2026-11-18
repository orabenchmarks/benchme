import { WORKSPACE_HEADER, WORKSPACE_SIG_HEADER, createPool, migrate, newWorkspaceId, signWorkspaceHeader, type Pool } from "@benchme/core";
import { DINING_AREAS, webmcpV1, diningAvailability, diningClock, diningMinutes, diningSearch, diningSeatingTimes, diningTablesLeft, scenarios, type DiningRows, type DiningSeating } from "@benchme/scenarios";
import type { Mailer } from "@benchme/site-kit";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { FastifyInstance, InjectOptions } from "fastify";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildDining } from "./build-app.js";

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
let rows: DiningRows;
let bearer = "";
let cookie = "";
let baseUrl = "";
const scoped = (o: InjectOptions & { url: string }, wsId = ws): InjectOptions => ({
  ...o,
  headers: { ...(o.headers ?? {}), [WORKSPACE_HEADER]: wsId, [WORKSPACE_SIG_HEADER]: signWorkspaceHeader(SECRET, wsId), "x-forwarded-prefix": `/w/${wsId}/dining` },
});
const get = async (url: string) => (await app.inject(scoped({ method: "GET", url }))).json();
const post = (url: string, payload: unknown, auth = true) => app.inject(scoped({ method: "POST", url, payload: payload as Record<string, unknown>, headers: auth ? { authorization: `Bearer ${bearer}` } : {} }));
const form = (url: string, body: Record<string, string>) =>
  app.inject(scoped({ method: "POST", url, payload: new URLSearchParams(body).toString(), headers: { "content-type": "application/x-www-form-urlencoded", cookie: `dn_session=${cookie}` } }));

async function signIn(wsId: string, email: string): Promise<{ token: string; cookie: string }> {
  const before = mailer.sent.length;
  const enc = encodeURIComponent(email);
  const fh = { "content-type": "application/x-www-form-urlencoded" };
  await app.inject(scoped({ method: "POST", url: "/signup", payload: `name=T&email=${enc}&password=correct-horse-9`, headers: fh }, wsId));
  const code = /code is (\d{6})/.exec(mailer.sent[before]!.body)![1]!;
  await app.inject(scoped({ method: "POST", url: "/verify", payload: `email=${enc}&code=${code}`, headers: fh }, wsId));
  const login = await app.inject(scoped({ method: "POST", url: "/login", payload: `email=${enc}&password=correct-horse-9`, headers: fh }, wsId));
  const session = login.cookies.find((c) => c.name === "dn_session")!.value;
  await app.inject(scoped({ method: "POST", url: "/account/token", headers: { cookie: `dn_session=${session}` } }, wsId));
  const token = /dnr_[0-9a-f]+/.exec((await app.inject(scoped({ url: "/account", headers: { cookie: `dn_session=${session}` } }, wsId))).body)![0];
  return { token, cookie: session };
}

beforeAll(async () => {
  if (!DB) return;
  pool = createPool(DB, 4);
  await migrate(pool, "core", join(here, "..", "..", "gateway", "migrations"));
  await migrate(pool, "dining", join(here, "..", "migrations"));
  mailer = new CapturingMailer();
  app = await buildDining({ pool, scenarios, mailer, gatewaySecret: SECRET, sessionTtlSeconds: 3600, logLevel: "silent" });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  baseUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  rows = webmcpV1.generate(4242).dining;
  ws = newWorkspaceId();
  await pool.query("INSERT INTO core.workspaces (id, scenario, seed, expires_at) VALUES ($1, 'webmcp-v1', 4242, now() + interval '1 hour')", [ws]);
  expect((await app.inject(scoped({ method: "POST", url: `/internal/workspaces/${ws}/seed`, payload: { scenario: "webmcp-v1", seed: 4242 } }))).statusCode).toBe(201);
  ({ token: bearer, cookie } = await signIn(ws, "booker@example.com"));
});
afterAll(async () => {
  await app?.close();
  await pool?.end();
});

/** A Wednesday no seeded reservation touches, in the reservable year: every table is free. */
const QUIET = "2027-10-06";
const restaurantOf = (code: string) => rows.restaurants.find((r) => r.code === code)!;
const searchQs = (q: { city: string; date: string; time: string; partySize: number; area?: string; menus?: string[]; maxPriceLevel?: number }) =>
  new URLSearchParams({ city: q.city, date: q.date, time: q.time, partySize: String(q.partySize), ...(q.area ? { area: q.area } : {}), ...(q.menus?.length ? { menus: q.menus.join(",") } : {}), ...(q.maxPriceLevel ? { maxPriceLevel: String(q.maxPriceLevel) } : {}) });

describe.skipIf(!DB)("dining (real Postgres)", () => {
  it("serves the WebMCP bridge with the full catalog on the home page", async () => {
    const res = await app.inject(scoped({ method: "GET", url: "/" }));
    expect(res.body).toContain('data-webmcp="bridge"');
    expect(res.body).toContain('"name":"search_tables"');
  });

  it("serves the seeded restaurants, seating and reservations as the generator made them", async () => {
    expect((await get("/api/v1/restaurants")).length).toBe(rows.restaurants.length);
    const r = rows.restaurants.find((x) => rows.seating.filter((s) => s.restaurantCode === x.code).length >= 3)!;
    const detail = await get(`/api/v1/restaurants/${r.code}`);
    expect(detail).toMatchObject({ ...r });
    expect(Object.keys(detail.hours)).toEqual(Object.keys(r.hours));
    expect(detail.seating).toEqual(rows.seating.filter((s) => s.restaurantCode === r.code).sort((x, y) => DINING_AREAS.indexOf(x.area) - DINING_AREAS.indexOf(y.area)));
    const b = rows.reservations[0]!;
    expect(await get(`/api/v1/reservations/${b.reservationNo}`)).toMatchObject({ ...b });
    const guest = await get(`/api/v1/reservations?guestEmail=${encodeURIComponent(b.guestEmail.toUpperCase())}&limit=200`);
    expect(guest.items.map((x: { reservationNo: string }) => x.reservationNo)).toEqual(rows.reservations.filter((x) => x.guestEmail === b.guestEmail).map((x) => x.reservationNo).sort());
    expect((await get(`/api/v1/restaurants?menus=vegan&area=terrace`)).map((x: { code: string }) => x.code)).toEqual(
      rows.restaurants.filter((x) => x.menus.includes("vegan") && rows.seating.some((s) => s.restaurantCode === x.code && s.area === "terrace")).map((x) => x.code),
    );
  });

  it("answers every search and day the way the rules do, a full area included", async () => {
    const seatingOf = (code: string, area: string) => rows.seating.find((s) => s.restaurantCode === code && s.area === area) as DiningSeating;
    const full = rows.reservations.find((b) => b.status === "confirmed" && diningTablesLeft(seatingOf(b.restaurantCode, b.area), rows.reservations, b.date, b.time) === 0)!;
    const r = restaurantOf(full.restaurantCode);
    for (const q of [
      { city: r.city, date: full.date, time: full.time, partySize: 2 },
      { city: r.city, date: full.date, time: full.time, partySize: 2, area: full.area },
      { city: r.city, date: full.date, time: full.time, partySize: 4, menus: ["vegetarian"], maxPriceLevel: 3 },
      { city: r.city, date: QUIET, time: "19:00", partySize: 8, area: "private" as const },
    ]) {
      const offers = await get(`/api/v1/search?${searchQs(q)}`);
      expect(offers).toEqual(diningSearch(rows, q));
      if (q.area === full.area && q.date === full.date) expect(offers.map((o: { restaurantCode: string }) => o.restaurantCode)).not.toContain(full.restaurantCode);
    }
    const day = await get(`/api/v1/restaurants/${r.code}/availability?date=${full.date}&partySize=2`);
    expect(day.slots).toEqual(diningAvailability(r, rows, full.date, 2));
    expect(day.slots.find((s: { area: string; time: string }) => s.area === full.area && s.time === full.time).tablesLeft).toBe(0);
    expect((await app.inject(scoped({ method: "GET", url: `/api/v1/search?city=${r.city}&date=2027-02-30&time=19:00&partySize=2` }))).statusCode).toBe(400);
    expect((await app.inject(scoped({ method: "GET", url: `/api/v1/search?city=${r.city}&date=${QUIET}&time=7pm&partySize=2` }))).statusCode).toBe(400);
  });

  it("reserves, refuses what the rules refuse, changes, and cancels once", async () => {
    const s = rows.seating.find((x) => x.area === "terrace" && x.tables === 1 && x.seats === 4 && diningSeatingTimes(restaurantOf(x.restaurantCode), QUIET).includes("19:00"))!;
    const r = restaurantOf(s.restaurantCode);
    const ask = { restaurantCode: r.code, area: "terrace", date: QUIET, time: "19:00", partySize: 3, guestName: "Ilsa Voss", guestEmail: "Ilsa.Voss@Example.com", guestPhone: "555-123-4567", note: "Anniversary dinner" };
    expect((await post("/api/v1/reservations", ask, false)).statusCode).toBe(401);
    const made = await post("/api/v1/reservations", ask);
    expect(made.statusCode).toBe(201);
    expect(made.json()).toMatchObject({ restaurantCode: r.code, area: "terrace", date: QUIET, time: "19:00", partySize: 3, guestEmail: "ilsa.voss@example.com", note: "Anniversary dinner", status: "confirmed", depositCents: 3 * r.depositPerGuestCents });
    const no = made.json().reservationNo;
    const again = await post("/api/v1/reservations", { ...ask, time: "20:00" });
    expect([again.statusCode, again.json().error]).toEqual([409, "FULL"]);
    // Each refusal on its own, asked of the slot just taken: every fit rule is checked before the free tables.
    const code = async (body: Record<string, unknown>) => (await post("/api/v1/reservations", { ...ask, ...body })).json().error;
    const closed = ["2027-10-04", "2027-10-05", "2027-10-07", "2027-10-10"].find((d) => diningSeatingTimes(r, d).length === 0)!;
    expect(await code({ partySize: 5 })).toBe("TABLE_TOO_SMALL");
    expect(await code({ time: "19:15" })).toBe("BAD_TIME");
    expect(await code({ time: diningClock(diningMinutes(diningSeatingTimes(r, QUIET).at(-1)!) + 30) })).toBe("OUTSIDE_HOURS");
    expect(await code({ date: "2028-01-05" })).toBe("OUTSIDE_WINDOW");
    expect(await code({ partySize: 13, area: "indoor" })).toBe("PARTY_LIMIT");
    expect(await code({ date: closed })).toBe("CLOSED");
    const lacking = DINING_AREAS.find((a) => !rows.seating.some((x) => x.restaurantCode === r.code && x.area === a))!;
    expect(await code({ area: lacking })).toBe("NO_AREA");
    expect((await post("/api/v1/reservations", { ...ask, guestPhone: "12345" })).statusCode).toBe(400);
    // A change is held to the same rules, its own table not counted against it.
    const changed = await post(`/api/v1/reservations/${no}/change`, { partySize: 4, time: "19:30" });
    expect(changed.json()).toMatchObject({ reservationNo: no, partySize: 4, time: "19:30", note: "Anniversary dinner", depositCents: 4 * r.depositPerGuestCents });
    expect((await post(`/api/v1/reservations/${no}/change`, { partySize: 5 })).json().error).toBe("TABLE_TOO_SMALL");
    expect((await post(`/api/v1/reservations/${no}/change`, {})).statusCode).toBe(400);
    expect((await post(`/api/v1/reservations/${no}/cancel`, {})).json().status).toBe("cancelled");
    expect((await post(`/api/v1/reservations/${no}/cancel`, {})).statusCode).toBe(409);
    expect((await post(`/api/v1/reservations/${no}/change`, { partySize: 2 })).json().error).toBe("NOT_CONFIRMED");
    expect((await post("/api/v1/reservations", ask)).statusCode).toBe(201);
  });

  it("reserves through the page form, shows a refusal on the page, and changes and cancels from the reservation page", async () => {
    const s = rows.seating.find((x) => x.area === "private" && diningSeatingTimes(restaurantOf(x.restaurantCode), QUIET).includes("19:00"))!;
    const body = { restaurantCode: s.restaurantCode, area: "private", date: QUIET, time: "19:00", partySize: "6", guestName: "Bram Okonjo", guestEmail: "bram@example.com", guestPhone: "555-987-6543", note: "" };
    const made = await form("/reservations", body);
    expect(made.statusCode).toBe(303);
    const where = made.headers.location as string;
    const no = where.split("/").pop()!;
    expect(where).toBe(`/w/${ws}/dining/reservations/${no}`);
    const page = await app.inject(scoped({ method: "GET", url: `/reservations/${no}`, headers: { cookie: `dn_session=${cookie}` } }));
    expect(page.body).toContain("Bram Okonjo");
    expect(page.body).toContain(`/reservations/${no}/change`);
    const refused = await form("/reservations", { ...body, time: "20:00" });
    expect(refused.statusCode).toBe(409);
    expect(refused.body).toContain("no private room table is free");
    expect((await form(`/reservations/${no}/change`, { date: QUIET, time: "19:00", partySize: "7", area: "private", note: "Window" })).statusCode).toBe(303);
    expect(await get(`/api/v1/reservations/${no}`)).toMatchObject({ partySize: 7, note: "Window" });
    expect((await form(`/reservations/${no}/cancel`, {})).statusCode).toBe(303);
    expect((await get(`/api/v1/reservations/${no}`)).status).toBe("cancelled");
  });

  it("exposes the same tools over MCP", async () => {
    const client = new Client({ name: "test", version: "0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), { requestInit: { headers: { [WORKSPACE_HEADER]: ws, [WORKSPACE_SIG_HEADER]: signWorkspaceHeader(SECRET, ws) } } }));
    try {
      const names = (await client.listTools()).tools.map((t) => t.name).sort();
      expect(names).toEqual(["cancel_reservation", "change_reservation", "check_availability", "create_reservation", "get_reservation", "get_restaurant", "list_cities", "list_reservations", "list_restaurants", "search_tables"]);
      const city = rows.restaurants[0]!.city;
      // Not QUIET: the write tests above left reservations on that date, which the seed rows do not have.
      const res = (await client.callTool({ name: "search_tables", arguments: { city, date: "2027-11-10", time: "19:00", partySize: 2 } })) as { content: { text: string }[] };
      expect(JSON.parse(res.content[0]!.text)).toEqual(diningSearch(rows, { city, date: "2027-11-10", time: "19:00", partySize: 2, menus: [] }));
    } finally {
      await client.close();
    }
  });
});
