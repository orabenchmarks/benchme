import { WORKSPACE_HEADER, WORKSPACE_SIG_HEADER, createPool, migrate, newWorkspaceId, signWorkspaceHeader, type Pool } from "@benchme/core";
import { webmcpV1, homeSlotsOf, scenarios, searchHomeListings, type HomeListing, type HomeRows, type HomeSlot } from "@benchme/scenarios";
import type { Mailer } from "@benchme/site-kit";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { FastifyInstance, InjectOptions } from "fastify";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildHomes } from "./build-app.js";

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
let rows: HomeRows;
let bearer = "";
let cookie = "";
let baseUrl = "";
const scoped = (o: InjectOptions & { url: string }, wsId = ws): InjectOptions => ({
  ...o,
  headers: { ...(o.headers ?? {}), [WORKSPACE_HEADER]: wsId, [WORKSPACE_SIG_HEADER]: signWorkspaceHeader(SECRET, wsId), "x-forwarded-prefix": `/w/${wsId}/homes` },
});
const get = async (url: string) => (await app.inject(scoped({ method: "GET", url }))).json();
const post = (url: string, payload: unknown, auth = true) => app.inject(scoped({ method: "POST", url, payload: payload as Record<string, unknown>, headers: auth ? { authorization: `Bearer ${bearer}` } : {} }));
const form = (url: string, body: Record<string, string>) => app.inject(scoped({ method: "POST", url, payload: new URLSearchParams(body).toString(), headers: { "content-type": "application/x-www-form-urlencoded", cookie } }));

async function signIn(wsId: string, email: string): Promise<{ token: string; cookie: string }> {
  const before = mailer.sent.length;
  const enc = encodeURIComponent(email);
  const fh = { "content-type": "application/x-www-form-urlencoded" };
  await app.inject(scoped({ method: "POST", url: "/signup", payload: `name=T&email=${enc}&password=correct-horse-9`, headers: fh }, wsId));
  const code = /code is (\d{6})/.exec(mailer.sent[before]!.body)![1]!;
  await app.inject(scoped({ method: "POST", url: "/verify", payload: `email=${enc}&code=${code}`, headers: fh }, wsId));
  const login = await app.inject(scoped({ method: "POST", url: "/login", payload: `email=${enc}&password=correct-horse-9`, headers: fh }, wsId));
  const session = `hm_session=${login.cookies.find((c) => c.name === "hm_session")!.value}`;
  await app.inject(scoped({ method: "POST", url: "/account/token", headers: { cookie: session } }, wsId));
  return { token: /hom_[0-9a-f]+/.exec((await app.inject(scoped({ url: "/account", headers: { cookie: session } }, wsId))).body)![0], cookie: session };
}

/** Active listings whose agent has at least `n` free slots on one day: [listing, that day's free slots]. */
function freeDays(n: number): [HomeListing, HomeSlot[]][] {
  return rows.listings
    .filter((l) => l.status === "active")
    .flatMap((l) => {
      const slots = homeSlotsOf(rows, l.agentCode);
      return [...new Set(slots.map((s) => s.date))].map((d) => [l, slots.filter((s) => s.date === d && s.free)] as [HomeListing, HomeSlot[]]).filter(([, free]) => free.length >= n);
    });
}

beforeAll(async () => {
  if (!DB) return;
  pool = createPool(DB, 4);
  await migrate(pool, "core", join(here, "..", "..", "gateway", "migrations"));
  await migrate(pool, "homes", join(here, "..", "migrations"));
  mailer = new CapturingMailer();
  app = await buildHomes({ pool, scenarios, mailer, gatewaySecret: SECRET, sessionTtlSeconds: 3600, logLevel: "silent" });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  baseUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  rows = webmcpV1.generate(4242).homes;
  ws = newWorkspaceId();
  await pool.query("INSERT INTO core.workspaces (id, scenario, seed, expires_at) VALUES ($1, 'webmcp-v1', 4242, now() + interval '1 hour')", [ws]);
  expect((await app.inject(scoped({ method: "POST", url: `/internal/workspaces/${ws}/seed`, payload: { scenario: "webmcp-v1", seed: 4242 } }))).statusCode).toBe(201);
  ({ token: bearer, cookie } = await signIn(ws, "viewer@example.com"));
});
afterAll(async () => {
  await app?.close();
  await pool?.end();
});

describe.skipIf(!DB)("homes (real Postgres)", () => {
  it("serves the WebMCP bridge with the full catalog on the home page", async () => {
    const res = await app.inject(scoped({ method: "GET", url: "/" }));
    expect(res.body).toContain('data-webmcp="bridge"');
    expect(res.body).toContain('"name":"search_listings"');
  });

  it("serves the seeded listings, agents and viewings as the generator made them", async () => {
    expect((await get("/api/v1/listings")).length).toBe(rows.listings.length);
    const l = rows.listings[0]!;
    expect(await get(`/api/v1/listings/${l.code}`)).toMatchObject({ ...l, agent: rows.agents.find((a) => a.code === l.agentCode) });
    const a = rows.agents[0]!;
    expect(await get(`/api/v1/agents/${a.code}`)).toEqual({ ...a, days: rows.agentDays.filter((d) => d.agentCode === a.code) });
    const v = rows.viewings[0]!;
    expect(await get(`/api/v1/viewings/${v.viewingNo}`)).toMatchObject({ ...v });
    const mine = await get(`/api/v1/viewings?email=${encodeURIComponent(v.viewerEmail.toUpperCase())}&limit=200`);
    expect(mine.items.map((x: { viewingNo: string }) => x.viewingNo)).toEqual(rows.viewings.filter((x) => x.viewerEmail === v.viewerEmail).map((x) => x.viewingNo).sort());
  });

  it("answers every search and every slot list the way the rules do, a fully booked day included", async () => {
    const pending = rows.listings.find((l) => l.status === "pending" && l.features.length > 0)!;
    for (const q of [
      { city: pending.city },
      { city: pending.city, types: [pending.type], features: [pending.features[0]!], maxPriceCents: pending.priceCents, minBeds: pending.beds - 1 },
      { city: pending.city, types: [pending.type], minBaths: 2, status: "active" as const },
    ]) {
      const qs = new URLSearchParams({ city: q.city, ...(q.types ? { type: q.types.join(",") } : {}), ...(q.features ? { features: q.features.join(",") } : {}), ...(q.maxPriceCents ? { maxPrice: String(q.maxPriceCents / 100) } : {}), ...(q.minBeds !== undefined ? { minBeds: String(q.minBeds) } : {}), ...(q.minBaths ? { minBaths: String(q.minBaths) } : {}), ...(q.status ? { status: q.status } : {}) });
      expect(await get(`/api/v1/listings?${qs}`)).toEqual(searchHomeListings(rows.listings, q));
    }
    expect((await get(`/api/v1/listings?city=${pending.city}&status=active`)).every((l: HomeListing) => l.status === "active")).toBe(true);
    const full = rows.agentDays.find((d) => homeSlotsOf(rows, d.agentCode).filter((s) => s.date === d.date).every((s) => !s.free))!;
    const shown = rows.listings.find((l) => l.agentCode === full.agentCode)!;
    expect(await get(`/api/v1/listings/${shown.code}/slots`)).toEqual(homeSlotsOf(rows, full.agentCode));
    const from = `${full.date}T${full.from}`;
    expect((await get(`/api/v1/listings/${shown.code}/slots?from=${from}&free=true`))[0]).toEqual(homeSlotsOf(rows, full.agentCode).find((s) => s.free && `${s.date}T${s.time}` >= from));
    for (const bad of ["/api/v1/listings?features=sauna", "/api/v1/listings?maxPrice=cheap", "/api/v1/listings?type=castle", `/api/v1/listings/${shown.code}/slots?from=2027-06-31T09:00`]) {
      expect((await app.inject(scoped({ method: "GET", url: bad }))).statusCode).toBe(400);
    }
  });

  it("takes a viewing, refuses what the rules refuse, and cancels once", async () => {
    // A free slot whose time another agent also has free: the viewer-busy case needs both.
    const sameTime = (a: HomeSlot, b: HomeSlot) => a.date === b.date && a.time === b.time;
    const [listing, [slot, next]] = freeDays(2).find(([l, [s]]) => freeDays(1).some(([o, free]) => o.agentCode !== l.agentCode && free.some((f) => sameTime(f, s!))))!;
    const other = freeDays(1).find(([l, free]) => l.agentCode !== listing.agentCode && free.some((s) => sameTime(s, slot!)))!;
    const ask = { listingCode: listing.code, date: slot!.date, time: slot!.time, viewerName: "Ilsa Voss", viewerEmail: "Ilsa.Voss@Example.com" };
    expect((await post("/api/v1/viewings", ask, false)).statusCode).toBe(401);
    const made = await post("/api/v1/viewings", ask);
    expect(made.statusCode).toBe(201);
    expect(made.json()).toMatchObject({ listingCode: listing.code, agentCode: listing.agentCode, date: slot!.date, time: slot!.time, viewerEmail: "ilsa.voss@example.com", status: "requested" });
    const again = await post("/api/v1/viewings", { ...ask, viewerEmail: "someone.else@example.com" });
    expect([again.statusCode, again.json().error]).toEqual([409, "SLOT_TAKEN"]);
    const busy = await post("/api/v1/viewings", { ...ask, listingCode: other[0].code });
    expect([busy.statusCode, busy.json().error]).toEqual([422, "VIEWER_BUSY"]);
    const notActive = rows.listings.find((l) => l.status !== "active")!;
    expect((await post("/api/v1/viewings", { ...ask, listingCode: notActive.code })).json().error).toBe("NOT_ACTIVE");
    expect((await post("/api/v1/viewings", { ...ask, time: "07:00" })).json().error).toBe("NO_SLOT");
    expect((await post("/api/v1/viewings", { ...ask, date: "2027-07-01" })).json().error).toBe("OUTSIDE_WINDOW");
    expect((await post("/api/v1/viewings", { ...ask, time: next!.time, agentCode: other[0].agentCode })).json().error).toBe("WRONG_AGENT");
    expect((await post("/api/v1/viewings", { ...ask, time: "9:00" })).statusCode).toBe(400);
    const no = made.json().viewingNo;
    expect((await post(`/api/v1/viewings/${no}/cancel`, {})).json().status).toBe("cancelled");
    expect((await post(`/api/v1/viewings/${no}/cancel`, {})).statusCode).toBe(409);
    expect((await post("/api/v1/viewings", ask)).statusCode).toBe(201);
  });

  it("takes a viewing through the listing page's form, and shows a refusal on the page", async () => {
    const [listing, [slot]] = freeDays(1).at(-1)!;
    const page = await app.inject(scoped({ method: "GET", url: `/listings/${listing.code}`, headers: { cookie } }));
    expect(page.body).toContain(`value="${slot!.date}T${slot!.time}"`);
    const body = { listingCode: listing.code, slot: `${slot!.date}T${slot!.time}`, viewerName: "Bram Okonjo", viewerEmail: "bram@example.com" };
    const made = await form("/viewings", body);
    expect(made.statusCode).toBe(303);
    const detail = await app.inject(scoped({ method: "GET", url: made.headers.location!.replace(`/w/${ws}/homes`, "") }));
    expect(detail.body).toContain("requested");
    const refused = await form("/viewings", { ...body, viewerEmail: "carla@example.com" });
    expect(refused.statusCode).toBe(409);
    expect(refused.body).toContain("is already taken");
    const no = made.headers.location!.split("/").pop();
    expect((await form(`/viewings/${no}/cancel`, {})).statusCode).toBe(303);
    expect((await get(`/api/v1/viewings/${no}`)).status).toBe("cancelled");
  });

  it("exposes the same tools over MCP", async () => {
    const client = new Client({ name: "test", version: "0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), { requestInit: { headers: { [WORKSPACE_HEADER]: ws, [WORKSPACE_SIG_HEADER]: signWorkspaceHeader(SECRET, ws) } } }));
    try {
      const names = (await client.listTools()).tools.map((t) => t.name).sort();
      expect(names).toEqual(["cancel_viewing", "get_agent", "get_listing", "get_viewing", "list_cities", "list_viewing_slots", "list_viewings", "request_viewing", "search_listings"]);
      const city = rows.listings[0]!.city;
      const res = (await client.callTool({ name: "search_listings", arguments: { city, types: ["house", "townhouse"], minBeds: 2, status: "active" } })) as { content: { text: string }[] };
      expect(JSON.parse(res.content[0]!.text)).toEqual(searchHomeListings(rows.listings, { city, types: ["house", "townhouse"], minBeds: 2, status: "active" }));
    } finally {
      await client.close();
    }
  });
});
