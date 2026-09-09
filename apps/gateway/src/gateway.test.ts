import { HmacReceiptSigner, WORKSPACE_HEADER, WORKSPACE_SIG_HEADER, createPool, migrate, verifyWorkspaceHeader, type Pool } from "@benchme/core";
import { scenarios } from "@benchme/scenarios";
import Fastify, { type FastifyInstance } from "fastify";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppRegistry } from "./app-registry.js";
import { buildGateway } from "./build-app.js";
import { MemoryRateLimiter } from "./rate-limit.js";
import { HttpWorkspaceSeeder, type WorkspaceSeeder } from "./seeder.js";

const DB = process.env.DATABASE_URL;
const SECRET = "gateway-secret-for-tests";

/** A stand-in app: records the seed calls it receives and echoes headers on any other path. */
async function stubApp(): Promise<{ app: FastifyInstance; url: string; seeds: string[]; failSeed: { value: boolean } }> {
  const seeds: string[] = [];
  const failSeed = { value: false };
  const app = Fastify();
  app.post<{ Params: { id: string } }>("/internal/workspaces/:id/seed", async (req, reply) => {
    const sig = req.headers[WORKSPACE_SIG_HEADER] as string;
    if (!verifyWorkspaceHeader(SECRET, req.params.id, sig ?? "")) return reply.code(401).send({ error: "BAD_SIG" });
    if (failSeed.value) return reply.code(500).send({ error: "boom" });
    seeds.push(req.params.id);
    return reply.code(201).send({ ok: true });
  });
  app.register(import("@fastify/formbody"));
  app.all("/*", async (req) => ({ path: req.url, workspace: req.headers[WORKSPACE_HEADER], prefix: req.headers["x-forwarded-prefix"], contentType: req.headers["content-type"] ?? null, body: req.body ?? null }));
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return { app, url: `http://127.0.0.1:${port}`, seeds, failSeed };
}

let pool: Pool;
let stub: Awaited<ReturnType<typeof stubApp>>;
let gateway: FastifyInstance;
let limiter: MemoryRateLimiter;

beforeAll(async () => {
  if (!DB) return;
  pool = createPool(DB, 4);
  await migrate(pool, "core", join(dirname(fileURLToPath(import.meta.url)), "..", "migrations"));
  stub = await stubApp();
  const apps = new AppRegistry({ warehouse: stub.url, data: stub.url }, ["warehouse"]);
  limiter = new MemoryRateLimiter(2, 3600);
  const seeder: WorkspaceSeeder = new HttpWorkspaceSeeder(apps.seeded(), SECRET);
  gateway = (
    await buildGateway({
      pool,
      scenarios,
      apps,
      seeder,
      receipts: new HmacReceiptSigner("receipt-secret-for-tests"),
      limiter,
      gatewaySecret: SECRET,
      operatorKey: "operator-key-for-tests",
      publicBaseUrl: "http://benchme.test",
      internalBaseUrl: "http://gateway.benchme.svc",
      defaultTtlSeconds: 3600,
      maxTtlSeconds: 7200,
      logLevel: "silent",
    })
  ).app;
});
afterAll(async () => {
  await gateway?.close();
  await stub?.app.close();
  await pool?.end();
});

describe.skipIf(!DB)("gateway (real Postgres + stub app)", () => {
  it("creates a workspace, seeds every seeded app, and reports urls", async () => {
    const res = await gateway.inject({ method: "POST", url: "/api/workspaces", payload: { scenario: "acme-v1", seed: 4242 } });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toMatch(/^ws_[0-9a-f]{12}$/);
    expect(body.seed).toBe(4242);
    expect(body.urls.apps.warehouse).toBe(`http://benchme.test/w/${body.id}/warehouse`);
    expect(body.urls.mcp).toEqual({ warehouse: `http://benchme.test/w/${body.id}/warehouse/mcp` });
    expect(stub.seeds).toContain(body.id);

    const get = await gateway.inject(`/api/workspaces/${body.id}`);
    expect(get.statusCode).toBe(200);
    expect(get.json().finalizedAt).toBeNull();
  });

  it("rejects an unknown scenario and a too-long ttl with 422, and unknown ids with 404", async () => {
    const bad = await gateway.inject({ method: "POST", url: "/api/workspaces", payload: { scenario: "nope" } });
    expect(bad.statusCode).toBe(422);
    const ttl = await gateway.inject({ method: "POST", url: "/api/workspaces", payload: { scenario: "acme-v1", ttlSeconds: 999_999 } });
    expect(ttl.statusCode).toBe(422);
    expect((await gateway.inject("/api/workspaces/ws_000000000000")).statusCode).toBe(404);
  });

  it("rolls the workspace back when an app fails to seed", async () => {
    stub.failSeed.value = true;
    const res = await gateway.inject({
      method: "POST",
      url: "/api/workspaces",
      headers: { "x-benchme-operator-key": "operator-key-for-tests" },
      payload: { scenario: "acme-v1" },
    });
    stub.failSeed.value = false;
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toBe("SEED_FAILED");
  });

  it("rate-limits anonymous creation but not the operator key", async () => {
    // two anonymous creates already consumed above (one 201, one 422 counted? no: limiter is consumed before create)
    const anon = await gateway.inject({ method: "POST", url: "/api/workspaces", remoteAddress: "10.9.9.9", payload: { scenario: "acme-v1" } });
    const anon2 = await gateway.inject({ method: "POST", url: "/api/workspaces", remoteAddress: "10.9.9.9", payload: { scenario: "acme-v1" } });
    const anon3 = await gateway.inject({ method: "POST", url: "/api/workspaces", remoteAddress: "10.9.9.9", payload: { scenario: "acme-v1" } });
    expect([anon.statusCode, anon2.statusCode]).toEqual([201, 201]);
    expect(anon3.statusCode).toBe(429);
    const op = await gateway.inject({
      method: "POST",
      url: "/api/workspaces",
      remoteAddress: "10.9.9.9",
      headers: { "x-benchme-operator-key": "operator-key-for-tests" },
      payload: { scenario: "acme-v1" },
    });
    expect(op.statusCode).toBe(201);
  });

  it("proxies /w/:id/<app>/* with the signed workspace header and forwarded prefix", async () => {
    const created = (await gateway.inject({ method: "POST", url: "/api/workspaces", headers: { "x-benchme-operator-key": "operator-key-for-tests" }, payload: { scenario: "acme-v1" } })).json();
    const res = await gateway.inject(`/w/${created.id}/warehouse/api/v1/products?limit=2`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ path: "/api/v1/products?limit=2", workspace: created.id, prefix: `/w/${created.id}/warehouse` });
    expect((await gateway.inject(`/w/${created.id}/nosuchapp/x`)).statusCode).toBe(404);
    expect((await gateway.inject(`/w/ws_000000000000/warehouse/x`)).statusCode).toBe(404);
    const form = await gateway.inject({ method: "POST", url: `/w/${created.id}/warehouse/signup`, headers: { "content-type": "application/x-www-form-urlencoded" }, payload: "email=a%40b.test&password=pw" });
    expect(form.statusCode).toBe(200);
    expect(form.json().body).toEqual({ email: "a@b.test", password: "pw" });
    const json = await gateway.inject({ method: "POST", url: `/w/${created.id}/warehouse/mcp`, payload: { jsonrpc: "2.0", id: 1, method: "ping" } });
    expect(json.json().body).toEqual({ jsonrpc: "2.0", id: 1, method: "ping" });
    const redirect = await gateway.inject(`/w/${created.id}/warehouse`);
    expect(redirect.statusCode).toBe(302);
    expect(redirect.headers.location).toBe(`/w/${created.id}/warehouse/`);
  });

  it("finalizes once and issues a logged, verifiable receipt", async () => {
    const created = (await gateway.inject({ method: "POST", url: "/api/workspaces", headers: { "x-benchme-operator-key": "operator-key-for-tests" }, payload: { scenario: "acme-v1" } })).json();
    const fin = await gateway.inject({ method: "POST", url: `/api/workspaces/${created.id}/finalize` });
    expect(fin.statusCode).toBe(200);
    expect(fin.json().receipt).toMatch(new RegExp(`^RCPT-ws-${created.id}-OK-[0-9a-f]{12}$`));
    const logged = await pool.query("SELECT nonce, ts FROM core.receipts WHERE receipt = $1", [fin.json().receipt]);
    expect(logged.rowCount).toBe(1);
    const row = logged.rows[0] as { nonce: string; ts: string };
    expect(new HmacReceiptSigner("receipt-secret-for-tests").verify(fin.json().receipt, row.nonce, Number(row.ts))).toBe(true);
    const again = await gateway.inject({ method: "POST", url: `/api/workspaces/${created.id}/finalize` });
    expect(again.json().finalizedAt).toBe(fin.json().finalizedAt);
  });

  it("resolves shared-<scenario>-<seed> to one lazily created workspace, reused on the next request", async () => {
    const seed = 1000 + Math.floor(Math.random() * 1_000_000); // the alias persists in the shared test DB across runs
    const a = await gateway.inject(`/w/shared-acme-v1-${seed}/warehouse/api/v1/products?limit=1`);
    expect(a.statusCode).toBe(200);
    expect(a.json().prefix).toBe(`/w/shared-acme-v1-${seed}/warehouse`);
    const first = a.json().workspace as string;
    expect(first).toMatch(/^ws_/);
    const b = await gateway.inject(`/w/shared-acme-v1-${seed}/warehouse/x`);
    expect(b.json().workspace).toBe(first);
    expect(stub.seeds.filter((id) => id === first)).toHaveLength(1);
    expect((await gateway.inject(`/w/shared-nope-1/warehouse/x`)).statusCode).toBe(404);
    expect((await gateway.inject(`/w/shared-acme-v1-0/warehouse/x`)).statusCode).toBe(404);
  });

  it("serves the portal, the registry and the workspace page", async () => {
    expect((await gateway.inject("/")).body).toContain("acme-v1");
    expect((await gateway.inject("/registry")).body).toContain("/warehouse/mcp");
    const created = (await gateway.inject({ method: "POST", url: "/api/workspaces", headers: { "x-benchme-operator-key": "operator-key-for-tests" }, payload: { scenario: "acme-v1" } })).json();
    expect((await gateway.inject(`/w/${created.id}`)).body).toContain(created.id);
  });
});
