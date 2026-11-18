import { WORKSPACE_HEADER, WORKSPACE_SIG_HEADER, createPool, migrate, newWorkspaceId, signWorkspaceHeader, type Pool } from "@benchme/core";
import { webmcpV1, pizzaMenuSearch, pizzaQuote, pizzaSlots, scenarios, type PizzaRows } from "@benchme/scenarios";
import type { Mailer } from "@benchme/site-kit";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { FastifyInstance, InjectOptions } from "fastify";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildPizza } from "./build-app.js";

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
let rows: PizzaRows;
let bearer = "";
let cookie = "";
let baseUrl = "";
const scoped = (o: InjectOptions & { url: string }, wsId = ws): InjectOptions => ({
  ...o,
  headers: { ...(o.headers ?? {}), [WORKSPACE_HEADER]: wsId, [WORKSPACE_SIG_HEADER]: signWorkspaceHeader(SECRET, wsId), "x-forwarded-prefix": `/w/${wsId}/pizza` },
});
const get = async (url: string) => (await app.inject(scoped({ method: "GET", url }))).json();
const post = (url: string, payload: unknown, auth = true) => app.inject(scoped({ method: "POST", url, payload: payload as Record<string, unknown>, headers: auth ? { authorization: `Bearer ${bearer}` } : {} }));
const form = (url: string, body: Record<string, string | string[]>) => {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) for (const x of [v].flat()) qs.append(k, x);
  return app.inject(scoped({ method: "POST", url, payload: qs.toString(), headers: { "content-type": "application/x-www-form-urlencoded", cookie: `pz_session=${cookie}` } }));
};

async function signIn(wsId: string, email: string): Promise<{ token: string; cookie: string }> {
  const before = mailer.sent.length;
  const enc = encodeURIComponent(email);
  const fh = { "content-type": "application/x-www-form-urlencoded" };
  await app.inject(scoped({ method: "POST", url: "/signup", payload: `name=T&email=${enc}&password=correct-horse-9`, headers: fh }, wsId));
  const code = /code is (\d{6})/.exec(mailer.sent[before]!.body)![1]!;
  await app.inject(scoped({ method: "POST", url: "/verify", payload: `email=${enc}&code=${code}`, headers: fh }, wsId));
  const login = await app.inject(scoped({ method: "POST", url: "/login", payload: `email=${enc}&password=correct-horse-9`, headers: fh }, wsId));
  const session = login.cookies.find((c) => c.name === "pz_session")!.value;
  await app.inject(scoped({ method: "POST", url: "/account/token", headers: { cookie: `pz_session=${session}` } }, wsId));
  const token = /pza_[0-9a-f]+/.exec((await app.inject(scoped({ url: "/account", headers: { cookie: `pz_session=${session}` } }, wsId))).body)![0];
  return { token, cookie: session };
}

beforeAll(async () => {
  if (!DB) return;
  pool = createPool(DB, 4);
  await migrate(pool, "core", join(here, "..", "..", "gateway", "migrations"));
  await migrate(pool, "pizza", join(here, "..", "migrations"));
  mailer = new CapturingMailer();
  app = await buildPizza({ pool, scenarios, mailer, gatewaySecret: SECRET, sessionTtlSeconds: 3600, logLevel: "silent" });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  baseUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  rows = webmcpV1.generate(4242).pizza;
  ws = newWorkspaceId();
  await pool.query("INSERT INTO core.workspaces (id, scenario, seed, expires_at) VALUES ($1, 'webmcp-v1', 4242, now() + interval '1 hour')", [ws]);
  expect((await app.inject(scoped({ method: "POST", url: `/internal/workspaces/${ws}/seed`, payload: { scenario: "webmcp-v1", seed: 4242 } }))).statusCode).toBe(201);
  ({ token: bearer, cookie } = await signIn(ws, "orderer@example.com"));
});
afterAll(async () => {
  await app?.close();
  await pool?.end();
});

/** A seeded slot with no room left, and a date no seeded order touches. */
const fullSlot = () => {
  for (const o of rows.orders) {
    const s = pizzaSlots(rows, { branchCode: o.branchCode, date: o.slotDate, from: o.slotTime })[0];
    if (s && s.time === o.slotTime && s.left === 0) return o;
  }
  throw new Error("no full slot");
};
const QUIET = "2027-10-04";
const offer = (branchCode: string, extra: Record<string, unknown> = {}) => ({ branchCode, fulfilment: "pickup", slotDate: QUIET, slotTime: "18:00", customerName: "Ilsa Voss", customerEmail: "Ilsa.Voss@Example.com", ...extra });

describe.skipIf(!DB)("pizza (real Postgres)", () => {
  it("serves the WebMCP bridge with the full catalog on the home page", async () => {
    const res = await app.inject(scoped({ method: "GET", url: "/" }));
    expect(res.body).toContain('data-webmcp="bridge"');
    expect(res.body).toContain('"name":"search_menu"');
    expect(res.body).not.toContain('"$ref"');
  });

  it("serves the seeded menu, branches and orders as the generator made them", async () => {
    const branches = await get("/api/v1/branches");
    expect(branches.map((b: { code: string }) => b.code)).toEqual(rows.branches.map((b) => b.code));
    const out = rows.stockouts[0]!;
    expect(branches.find((b: { code: string }) => b.code === out.branchCode).outOfStock).toContain(out.toppingKey);
    const builder = await get("/api/v1/builder");
    expect([builder.sizes, builder.toppings.length]).toEqual([rows.sizes, rows.toppings.length]);
    expect(await get(`/api/v1/pizzas/${rows.pizzas[0]!.code}`)).toMatchObject({ ...rows.pizzas[0] });
    const o = rows.orders.find((x) => x.lines.length > 1)!;
    expect(await get(`/api/v1/orders/${o.orderNo}`)).toMatchObject({ ...o, lineCount: o.lines.length });
    const mine = await get(`/api/v1/orders?customerEmail=${encodeURIComponent(o.customerEmail.toUpperCase())}&limit=200`);
    expect(mine.items.map((x: { orderNo: string }) => x.orderNo)).toEqual(rows.orders.filter((x) => x.customerEmail === o.customerEmail).map((x) => x.orderNo).sort());
  });

  it("answers every search, slot and quote the way the rules do, a full slot and a missing topping included", async () => {
    const out = rows.stockouts[0]!;
    for (const [qs, q] of [
      ["size=large", { size: "large" }],
      [`size=small&branch=${out.branchCode}&vegetarian=true&without=nuts`, { size: "small", branchCode: out.branchCode, vegetarian: true, without: ["nuts"] }],
      ["size=xlarge&vegan=true&maxPrice=30&without=dairy,nuts", { size: "xlarge", vegan: true, without: ["dairy", "nuts"], maxPriceCents: 3000 }],
    ] as const) expect(await get(`/api/v1/search?${qs}`)).toEqual(pizzaMenuSearch(rows, q as never));
    const full = fullSlot();
    const slots = await get(`/api/v1/branches/${full.branchCode}/slots?date=${full.slotDate}`);
    expect(slots).toEqual(pizzaSlots(rows, { branchCode: full.branchCode, date: full.slotDate }));
    expect(slots.find((s: { time: string }) => s.time === full.slotTime).left).toBe(0);
    expect(await get(`/api/v1/branches/${full.branchCode}/slots?date=${full.slotDate}&pizzas=2&from=${full.slotTime}`)).toEqual(pizzaSlots(rows, { branchCode: full.branchCode, date: full.slotDate, pizzas: 2, from: full.slotTime }));
    const quote = { branchCode: rows.branches.find((b) => b.delivers)!.code, fulfilment: "delivery" as const, lines: [{ pizzaCode: rows.pizzas[1]!.code, size: "large", crust: "thin", quantity: 2 }] };
    expect((await post("/api/v1/quote", quote, false)).json()).toEqual((pizzaQuote(rows, quote) as { quote: unknown }).quote);
    for (const bad of ["/api/v1/search?vegan=true", "/api/v1/search?size=large&without=gluten,shells", `/api/v1/branches/${full.branchCode}/slots?date=2027-02-30`]) {
      expect((await app.inject(scoped({ method: "GET", url: bad }))).statusCode).toBe(400);
    }
  });

  it("places, refuses what the rules refuse, changes a received order, and cancels once", async () => {
    const b = rows.branches.find((x) => x.delivers && !rows.stockouts.some((s) => s.branchCode === x.code))!;
    const pizza = rows.pizzas.find((p) => p.toppings.length >= 2)!;
    const body = offer(b.code, { lines: [{ pizzaCode: pizza.code, size: "medium", quantity: 1 }] });
    expect((await post("/api/v1/orders", body, false)).statusCode).toBe(401);
    const made = await post("/api/v1/orders", body);
    expect(made.statusCode).toBe(201);
    const want = (pizzaQuote(rows, body as never) as { quote: { totalCents: number } }).quote;
    expect(made.json()).toMatchObject({ branchCode: b.code, customerEmail: "ilsa.voss@example.com", status: "received", totalCents: want.totalCents, lineCount: 1, lines: [{ pizzaCode: pizza.code, toppings: pizza.toppings }] });
    const no = made.json().orderNo;
    const full = fullSlot();
    const refused = async (extra: Record<string, unknown>) => (await post("/api/v1/orders", { ...body, ...extra })).json().error;
    expect([await post("/api/v1/orders", { ...body, branchCode: full.branchCode, slotDate: full.slotDate, slotTime: full.slotTime, lines: [{ size: "small", toppings: [], quantity: 1 }] })].map((r) => [r.statusCode, r.json().error])).toEqual([[409, "SLOT_FULL"]]);
    const out = rows.stockouts[0]!;
    expect(await refused({ branchCode: out.branchCode, lines: [{ size: "small", toppings: [out.toppingKey], quantity: 1 }] })).toBe("TOPPING_OUT");
    expect(await refused({ lines: [{ size: "large", crust: "gluten-free", quantity: 1 }] })).toBe("CRUST_NOT_IN_SIZE");
    expect(await refused({ slotDate: "2028-01-04" })).toBe("OUTSIDE_WINDOW");
    expect(await refused({ branchCode: rows.branches.find((x) => !x.delivers)!.code, fulfilment: "delivery", address: "1 Road" })).toBe("NO_DELIVERY");
    expect((await post("/api/v1/orders", { ...body, lines: [] })).statusCode).toBe(400);
    const off = pizza.toppings[0]!;
    const changed = await post(`/api/v1/orders/${no}/lines/1`, { removeToppings: [off] });
    expect(changed.json()).toMatchObject({ status: "received", lines: [{ line: 1, toppings: pizza.toppings.filter((t) => t !== off) }] });
    expect(changed.json().totalCents).toBeLessThan(made.json().totalCents);
    const preparing = rows.orders.find((o) => o.status === "preparing")!;
    expect([(await post(`/api/v1/orders/${preparing.orderNo}/lines/1`, { quantity: 1 })).statusCode, (await post(`/api/v1/orders/${preparing.orderNo}/cancel`, {})).json().error]).toEqual([409, "ORDER_LOCKED"]);
    expect((await post(`/api/v1/orders/${no}/cancel`, {})).json().status).toBe("cancelled");
    expect((await post(`/api/v1/orders/${no}/cancel`, {})).json().error).toBe("ALREADY_CANCELLED");
    expect((await post(`/api/v1/orders/${no}/lines/1`, { quantity: 2 })).statusCode).toBe(409);
  });

  it("places an order through the builder form, shows a refusal on the page, and cancels from the order page", async () => {
    const b = rows.branches.find((x) => !rows.stockouts.some((s) => s.branchCode === x.code))!;
    const pizza = rows.pizzas[0]!;
    const fields = { pizzaCode: pizza.code, edited: "1", size: "large", crust: "thin", sauce: pizza.sauce, cheese: pizza.cheese, toppings: pizza.toppings, quantity: "1", branchCode: b.code, fulfilment: "pickup", slotDate: "2027-10-11", slotTime: "19:00", customerName: "Bram Okonjo", customerEmail: "bram.page@example.com" };
    const res = await form("/orders", fields);
    expect(res.statusCode).toBe(303);
    const page = await app.inject(scoped({ method: "GET", url: res.headers.location!.replace(`/w/${ws}/pizza`, ""), headers: { cookie: `pz_session=${cookie}` } }));
    expect(page.body).toContain("bram.page@example.com");
    expect(page.body).toContain("Cancel this order");
    const full = fullSlot();
    const refused = await form("/orders", { ...fields, branchCode: full.branchCode, slotDate: full.slotDate, slotTime: full.slotTime, toppings: [] , pizzaCode: "", crust: "classic", size: "small" });
    expect(refused.statusCode).toBe(409);
    expect(refused.body).toContain("more pizza(s) in the");
    const no = res.headers.location!.split("/").pop()!;
    expect((await form(`/orders/${no}/cancel`, {})).statusCode).toBe(303);
    expect((await get(`/api/v1/orders/${no}`)).status).toBe("cancelled");
  });

  it("exposes the same tools over MCP", async () => {
    const client = new Client({ name: "test", version: "0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), { requestInit: { headers: { [WORKSPACE_HEADER]: ws, [WORKSPACE_SIG_HEADER]: signWorkspaceHeader(SECRET, ws) } } }));
    try {
      const names = (await client.listTools()).tools.map((t) => t.name).sort();
      expect(names).toEqual(["cancel_order", "change_order_line", "find_slots", "get_menu", "get_order", "list_branches", "list_orders", "place_order", "quote_order", "search_menu"]);
      const out = rows.stockouts[0]!;
      const res = (await client.callTool({ name: "search_menu", arguments: { size: "medium", branchCode: out.branchCode, vegetarian: true } })) as { content: { text: string }[] };
      expect(JSON.parse(res.content[0]!.text)).toEqual(pizzaMenuSearch(rows, { size: "medium", branchCode: out.branchCode, vegetarian: true }));
    } finally {
      await client.close();
    }
  });
});
