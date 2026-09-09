import { WORKSPACE_HEADER, WORKSPACE_SIG_HEADER, createPool, migrate, newWorkspaceId, signWorkspaceHeader, type Pool } from "@benchme/core";
import { acmeV1, lowStock, orderTotalCents, scenarios, stockOf, type ScenarioRows } from "@benchme/scenarios";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { FastifyInstance, InjectOptions } from "fastify";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Mailer } from "@benchme/site-kit";
import { buildWarehouse } from "./build-app.js";

const DB = process.env.DATABASE_URL;
const SECRET = "gateway-secret-for-tests";
const CORE_SQL = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "gateway", "migrations");
const WH_SQL = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

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
let rows: ScenarioRows;
let baseUrl = "";

const scoped = (o: InjectOptions & { url: string }, wsId = ws): InjectOptions => ({
  ...o,
  headers: { ...(o.headers ?? {}), [WORKSPACE_HEADER]: wsId, [WORKSPACE_SIG_HEADER]: signWorkspaceHeader(SECRET, wsId), "x-forwarded-prefix": `/w/${wsId}/warehouse` },
});

async function createWorkspace(seed: number): Promise<string> {
  const id = newWorkspaceId();
  await pool.query("INSERT INTO core.workspaces (id, scenario, seed, expires_at) VALUES ($1, 'acme-v1', $2, now() + interval '1 hour')", [id, seed]);
  const res = await app.inject(scoped({ method: "POST", url: `/internal/workspaces/${id}/seed`, payload: { scenario: "acme-v1", seed } }, id));
  expect(res.statusCode).toBe(201);
  return id;
}

beforeAll(async () => {
  if (!DB) return;
  pool = createPool(DB, 4);
  await migrate(pool, "core", CORE_SQL);
  await migrate(pool, "warehouse", WH_SQL);
  mailer = new CapturingMailer();
  app = await buildWarehouse({ pool, scenarios, mailer, gatewaySecret: SECRET, sessionTtlSeconds: 3600, logLevel: "silent" });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  baseUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  rows = acmeV1.generate(4242);
  ws = await createWorkspace(4242);
});
afterAll(async () => {
  await app?.close();
  await pool?.end();
});

describe.skipIf(!DB)("warehouse (real Postgres)", () => {
  it("refuses requests without the gateway's signed header", async () => {
    expect((await app.inject("/api/v1/products")).statusCode).toBe(401);
    expect((await app.inject({ url: "/api/v1/products", headers: { [WORKSPACE_HEADER]: ws, [WORKSPACE_SIG_HEADER]: "bad" } })).statusCode).toBe(401);
    expect((await app.inject("/healthz")).statusCode).toBe(200);
  });

  it("serves seeded data that agrees with the generator's derived answers", async () => {
    const sku = rows.warehouse.products[0]!.sku;
    const stock = (await app.inject(scoped({ url: `/api/v1/stock?sku=${sku}` }))).json();
    expect(stock.total).toBe(stockOf(rows, sku));
    const loc = rows.warehouse.locations[1]!.code;
    expect((await app.inject(scoped({ url: `/api/v1/stock?sku=${sku}&location=${loc}` }))).json().total).toBe(stockOf(rows, sku, loc));
    const orderNo = rows.warehouse.orders[0]!.orderNo;
    expect((await app.inject(scoped({ url: `/api/v1/orders/${orderNo}` }))).json().totalCents).toBe(orderTotalCents(rows, orderNo));
    const low = (await app.inject(scoped({ url: "/api/v1/stock/low?threshold=60" }))).json() as { sku: string }[];
    expect(low.map((x) => x.sku)).toEqual(lowStock(rows, 60));
  });

  it("paginates products by cursor without gaps or repeats", async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page = (await app.inject(scoped({ url: `/api/v1/products?limit=50${cursor ? `&cursor=${cursor}` : ""}` }))).json() as { items: { sku: string }[]; nextCursor: string | null };
      seen.push(...page.items.map((p) => p.sku));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toEqual(rows.warehouse.products.map((p) => p.sku).sort());
  });

  it("isolates workspaces: same seed → identical rows; a write in one never shows in the other", async () => {
    const other = await createWorkspace(4242);
    const sku = rows.warehouse.stock.find((s) => s.qty > 30)!.sku;
    const before = (await app.inject(scoped({ url: `/api/v1/stock?sku=${sku}` }, other))).json();
    expect(before).toEqual((await app.inject(scoped({ url: `/api/v1/stock?sku=${sku}` }))).json());
    // sign up + verify + login in `ws`, then create a transfer there
    const token = await signupAndToken(ws, "iso@example.test");
    const src = rows.warehouse.stock.find((s) => s.sku === sku && s.qty > 30)!;
    const to = rows.warehouse.locations.find((l) => l.code !== src.locationCode)!.code;
    const t = await app.inject(scoped({ method: "POST", url: "/api/v1/transfers", headers: { authorization: `Bearer ${token}` }, payload: { sku, from: src.locationCode, to, qty: 5 } }));
    expect(t.statusCode).toBe(201);
    const afterWs = (await app.inject(scoped({ url: `/api/v1/stock?sku=${sku}&location=${src.locationCode}` }))).json();
    const afterOther = (await app.inject(scoped({ url: `/api/v1/stock?sku=${sku}&location=${src.locationCode}` }, other))).json();
    expect(afterWs.total).toBe(src.qty - 5);
    expect(afterOther.total).toBe(src.qty);
  });

  it("runs the signup → mail → verify → login → session flow through the UI", async () => {
    const before = mailer.sent.length;
    const signup = await app.inject(scoped({ method: "POST", url: "/signup", payload: "name=Ilsa&email=ilsa%40example.test&password=correct-horse-9", headers: { "content-type": "application/x-www-form-urlencoded" } }));
    expect(signup.statusCode).toBe(200);
    expect(signup.body).toContain("Verify your email");
    const mail = mailer.sent[before]!;
    expect(mail.ws).toBe(ws);
    expect(mail.to).toBe("ilsa@example.test");
    const code = /code is (\d{6})/.exec(mail.body)![1]!;
    const early = await app.inject(scoped({ method: "POST", url: "/login", payload: "email=ilsa%40example.test&password=correct-horse-9", headers: { "content-type": "application/x-www-form-urlencoded" } }));
    expect(early.statusCode).toBe(403); // unverified
    const verify = await app.inject(scoped({ method: "POST", url: "/verify", payload: `email=ilsa%40example.test&code=${code}`, headers: { "content-type": "application/x-www-form-urlencoded" } }));
    expect(verify.statusCode).toBe(200);
    const login = await app.inject(scoped({ method: "POST", url: "/login", payload: "email=ilsa%40example.test&password=correct-horse-9", headers: { "content-type": "application/x-www-form-urlencoded" } }));
    expect(login.statusCode).toBe(303);
    const cookie = login.cookies.find((c) => c.name === "wh_session")!;
    expect(cookie.path).toBe(`/w/${ws}/warehouse/`);
    const home = await app.inject(scoped({ url: "/", headers: { cookie: `wh_session=${cookie.value}` } }));
    expect(home.body).toContain("Ilsa");
    expect(home.body).toContain("Sign out");
    const wrong = await app.inject(scoped({ method: "POST", url: "/login", payload: "email=ilsa%40example.test&password=nope-nope-nope", headers: { "content-type": "application/x-www-form-urlencoded" } }));
    expect(wrong.statusCode).toBe(401);
  });

  it("enforces write preconditions over REST: auth, insufficient stock, shipped orders", async () => {
    expect((await app.inject(scoped({ method: "POST", url: "/api/v1/transfers", payload: { sku: "x", from: "VLM", to: "OST", qty: 1 } }))).statusCode).toBe(401);
    const token = await signupAndToken(ws, "ops@example.test");
    const auth = { authorization: `Bearer ${token}` };
    const src = rows.warehouse.stock.find((s) => s.qty > 0 && s.qty < 50)!;
    const to = rows.warehouse.locations.find((l) => l.code !== src.locationCode)!.code;
    const tooMany = await app.inject(scoped({ method: "POST", url: "/api/v1/transfers", headers: auth, payload: { sku: src.sku, from: src.locationCode, to, qty: src.qty + 1 } }));
    expect(tooMany.statusCode).toBe(422);
    expect(tooMany.json().error).toBe("INSUFFICIENT_STOCK");
    const ok = await app.inject(scoped({ method: "POST", url: "/api/v1/transfers", headers: auth, payload: { sku: src.sku, from: src.locationCode, to, qty: src.qty } }));
    expect(ok.statusCode).toBe(201);
    const done = await app.inject(scoped({ method: "POST", url: `/api/v1/transfers/${ok.json().transferNo}/complete`, headers: auth }));
    expect(done.json().status).toBe("completed");
    const shipped = rows.warehouse.orders.find((o) => o.status === "shipped")!;
    const cancel = await app.inject(scoped({ method: "POST", url: `/api/v1/orders/${shipped.orderNo}/cancel`, headers: auth }));
    expect(cancel.statusCode).toBe(409);
    const created = await app.inject(scoped({ method: "POST", url: "/api/v1/orders", headers: auth, payload: { customer: rows.warehouse.customers[0]!.code, lines: [{ sku: src.sku, qty: 2 }] } }));
    expect(created.statusCode).toBe(201);
    expect(created.json().totalCents).toBe(2 * rows.warehouse.products.find((p) => p.sku === src.sku)!.unitPriceCents);
  });

  it("exposes the tools over MCP streamable HTTP, scoped to the workspace in the URL", async () => {
    const client = new Client({ name: "test", version: "0" });
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { [WORKSPACE_HEADER]: ws, [WORKSPACE_SIG_HEADER]: signWorkspaceHeader(SECRET, ws) } },
    });
    await client.connect(transport);
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toContain("get_stock");
    expect(tools.tools).toHaveLength(14);
    const sku = rows.warehouse.products[3]!.sku;
    const res = await client.callTool({ name: "get_stock", arguments: { sku } });
    const text = (res.content as { type: string; text: string }[])[0]!.text;
    expect(JSON.parse(text).total).toBe(stockOf(rows, sku));
    const missing = await client.callTool({ name: "get_product", arguments: { sku: "NOPE-1" } });
    expect(missing.isError).toBe(true);
    await client.close();
  });
});

async function signupAndToken(wsId: string, email: string): Promise<string> {
  const before = mailer.sent.length;
  const enc = encodeURIComponent(email);
  await app.inject(scoped({ method: "POST", url: "/signup", payload: `name=T&email=${enc}&password=correct-horse-9`, headers: { "content-type": "application/x-www-form-urlencoded" } }, wsId));
  const code = /code is (\d{6})/.exec(mailer.sent[before]!.body)![1]!;
  await app.inject(scoped({ method: "POST", url: "/verify", payload: `email=${enc}&code=${code}`, headers: { "content-type": "application/x-www-form-urlencoded" } }, wsId));
  const login = await app.inject(scoped({ method: "POST", url: "/login", payload: `email=${enc}&password=correct-horse-9`, headers: { "content-type": "application/x-www-form-urlencoded" } }, wsId));
  const cookie = login.cookies.find((c) => c.name === "wh_session")!.value;
  await app.inject(scoped({ method: "POST", url: "/account/token", headers: { cookie: `wh_session=${cookie}` } }, wsId));
  const account = await app.inject(scoped({ url: "/account", headers: { cookie: `wh_session=${cookie}` } }, wsId));
  return /whk_[0-9a-f]+/.exec(account.body)![0];
}
