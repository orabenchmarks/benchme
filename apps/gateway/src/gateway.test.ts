import { HmacReceiptSigner, WORKSPACE_HEADER, WORKSPACE_SIG_HEADER, createPool, migrate, verifyWorkspaceHeader, type Pool } from "@benchme/core";
import { scenarios } from "@benchme/scenarios";
import Fastify, { errorCodes, type FastifyInstance } from "fastify";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppRegistry } from "./app-registry.js";
import { buildGateway } from "./build-app.js";
import { readConfig } from "./config.js";
import { MemoryRateLimiter } from "./rate-limit.js";
import { HttpWorkspaceSeeder, type WorkspaceSeeder } from "./seeder.js";
import type { WorkspaceService } from "./workspace-service.js";

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
  app.all("/*", async (req) => ({
    path: req.url,
    workspace: req.headers[WORKSPACE_HEADER],
    sig: req.headers[WORKSPACE_SIG_HEADER],
    prefix: req.headers["x-forwarded-prefix"],
    // Echoed so the proxy test can prove the PUBLIC host/scheme reach the app:
    // reply-from rewrites Host to this stub's own 127.0.0.1:<port>.
    host: req.headers.host,
    forwardedHost: req.headers["x-forwarded-host"],
    forwardedProto: req.headers["x-forwarded-proto"],
    contentType: req.headers["content-type"] ?? null,
    body: req.body ?? null,
  }));
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return { app, url: `http://127.0.0.1:${port}`, seeds, failSeed };
}

/** GET a request-target exactly as written: node:http sends `path` verbatim, where fetch (WHATWG) would re-encode it. */
function rawGet(port: number, path: string): Promise<{ status: number; location: string | undefined }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, path, method: "GET" }, (res) => {
      res.resume();
      resolve({ status: res.statusCode ?? 0, location: res.headers.location });
    });
    req.on("error", reject);
    req.end();
  });
}

/** GET a request-target exactly as written, with what the gateway answered. */
function rawFetch(port: number, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, path, method: "GET" }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end();
  });
}

const OPERATOR = { "x-benchme-operator-key": "operator-key-for-tests" };

let pool: Pool;
let stub: Awaited<ReturnType<typeof stubApp>>;
let gateway: FastifyInstance;
let service: WorkspaceService;
let limiter: MemoryRateLimiter;

/** The gateway on a real socket, started by the first test that needs one: its port. */
async function listening(): Promise<number> {
  if (!gateway.server.listening) await gateway.listen({ port: 0, host: "127.0.0.1" });
  return (gateway.server.address() as AddressInfo).port;
}

beforeAll(async () => {
  if (!DB) return;
  pool = createPool(DB, 4);
  await migrate(pool, "core", join(dirname(fileURLToPath(import.meta.url)), "..", "migrations"));
  stub = await stubApp();
  // warehouse: mcp + ask (NLWeb) flagged; data: webmcp flagged only — proves
  // urls()/the registry gate each capability independently, not as a bundle.
  // halden: a target with a PATH base, the way one process serves several
  // sites under /s/<site>. paylantern: UNLISTED though every capability is
  // flagged — proves urls(), the portal, the registry and robots.txt leave it
  // out on the listing alone, while the proxy still routes to it.
  const apps = new AppRegistry(
    { warehouse: stub.url, data: stub.url, halden: `${stub.url}/s/halden`, paylantern: `${stub.url}/s/paylantern` },
    ["warehouse"],
    ["warehouse", "paylantern"],
    ["warehouse", "paylantern"],
    ["data", "paylantern"],
    ["paylantern"],
  );
  limiter = new MemoryRateLimiter(2, 3600);
  const seeder: WorkspaceSeeder = new HttpWorkspaceSeeder(apps.seeded(), SECRET);
  ({ app: gateway, service } = await buildGateway({
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
    sharedSeed: 20260908,
    logLevel: "silent",
  }));
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
    expect(body.urls.ask).toEqual({ warehouse: `http://benchme.test/w/${body.id}/warehouse/ask` });
    expect(body.urls.askMcp).toEqual({ warehouse: `http://benchme.test/w/${body.id}/warehouse/ask/mcp` });
    expect(body.urls.webmcp).toEqual({ data: `http://benchme.test/w/${body.id}/data/` });
    // A path-based target is advertised at its gateway path, never its
    // internal one; the unlisted paylantern is named nowhere — not in apps, nor
    // in the capability maps above, though it carries every flag.
    expect(body.urls.apps.halden).toBe(`http://benchme.test/w/${body.id}/halden`);
    expect(Object.keys(body.urls.apps).sort()).toEqual(["data", "halden", "warehouse"]);
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
    // Without these the app derives its public base from the REWRITTEN Host
    // and advertises an internal, uncrawlable robots.txt / schema map.
    expect(res.json()).toMatchObject({ forwardedHost: "benchme.test", forwardedProto: "http" });
    expect(res.json().host).not.toBe("benchme.test");
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

  // The prompts open urls.apps.<store> (no trailing slash) with ?utm_campaign=<code> appended, so every
  // run enters through the bare "/w/:id/:app" redirect: a query lost there is a scenario never applied.
  it("redirects a prompt's literal entry URL — urls.apps.<store> + ?utm_campaign=<code> — into the store with the code", async () => {
    const minted = (await gateway.inject({ method: "POST", url: "/api/workspaces", headers: OPERATOR, payload: { scenario: "shops-v1" } })).json();
    const entry = new URL(`${minted.urls.apps.halden as string}?utm_campaign=fixture-plain`);
    const res = await gateway.inject(entry.pathname + entry.search);
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`/w/${minted.id}/halden/?utm_campaign=fixture-plain`);
    const landed = await gateway.inject(res.headers.location as string);
    expect(landed.json()).toMatchObject({ path: "/s/halden/?utm_campaign=fixture-plain", workspace: minted.id });
  });

  it("keeps the redirected query byte for byte: escapes as sent (case too), repeated keys in order, '+', bare and empty keys", async () => {
    const created = (await gateway.inject({ method: "POST", url: "/api/workspaces", headers: OPERATOR, payload: { scenario: "shops-v1" } })).json();
    for (const query of [
      "?a=1&a=2&a=1",
      "?q=a%20b+c&reserved=%2F%3F%26%3D%23%25&lower=%e2%9c%93&upper=%E2%9C%93",
      "?empty=&flag&odd=[1]|{2}^`~!$()*,;:@/?",
    ]) {
      const res = await gateway.inject(`/w/${created.id}/halden${query}`);
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe(`/w/${created.id}/halden/${query}`);
    }
    // Over a real socket: what a client sends, unnormalized — bytes a browser or fetch would re-encode, a
    // malformed escape, a lone "?" — comes back in Location unchanged.
    const port = await listening();
    for (const query of ["?utm_campaign=fixture-plain&utm_campaign=x", "?", `?k='"<>\\&k=%zz&k=%`]) {
      expect(await rawGet(port, `/w/${created.id}/halden${query}`)).toEqual({ status: 302, location: `/w/${created.id}/halden/${query}` });
    }
  });

  it("builds the redirect from re-encoded path segments, so an encoded CR/LF in one can never break the Location header", async () => {
    const res = await gateway.inject("/w/ws_0%0D%0Ax/halden?a=1");
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/w/ws_0%0D%0Ax/halden/?a=1");
  });

  // reply-from decodes the whole target URL before forwarding it (its path-traversal check): an escape that is
  // not UTF-8 throws a bare URIError there, which nothing would answer but the error handler's 500.
  it("answers a malformed percent-escape in a proxied URL — in the query or in the path — with a 400, never a 500", async () => {
    const created = (await gateway.inject({ method: "POST", url: "/api/workspaces", headers: OPERATOR, payload: { scenario: "shops-v1" } })).json();
    const port = await listening();
    const at = `/w/${created.id}/halden`;
    for (const bad of ["%FF", "%80", "%C3%28", "%ED%A0%80", "%E2%9C", "%zz", "%"]) {
      for (const target of [`${at}/?utm_campaign=${bad}`, `${at}/products/x?a=1&utm_campaign=${bad}&b=2`, `${at}/products/${bad}`, `${at}/${bad}/x?utm_campaign=ok`]) {
        const res = await rawFetch(port, target);
        expect(res.status, `${target}: ${res.body}`).toBe(400);
      }
    }
    // A well-formed escape still reaches the store byte for byte, in the path as in the query: "%25FF" is "%FF"
    // spelled out (never decoded twice into a malformed one), "%2F" stays inside its segment.
    for (const [path, query] of [
      ["/products/a%25FF", "?utm_campaign=%25FF"],
      ["/products/%E2%9C%93/x", "?q=%e2%9c%93"],
      ["/products/a%2Fb", "?next=%2Fcart"],
    ]) {
      const res = await rawFetch(port, `${at}${path}${query}`);
      expect(res.status, res.body).toBe(200);
      expect(JSON.parse(res.body)).toMatchObject({ path: `/s/halden${path}${query}`, workspace: created.id, prefix: at });
    }
    // Dot segments, spelled out or not, still never leave the app's base path.
    for (const target of [`${at}/../paylantern/pay`, `${at}/%2E%2E/%2e%2e/paylantern/pay`, `${at}/a/..%2F..%2Fpaylantern/pay`]) {
      expect((await rawFetch(port, target)).status, target).toBe(400);
    }
  });

  it("answers a malformed JSON body with the 400 a store gives itself, never a 500 — on a proxied route and on its own API", async () => {
    const created = (await gateway.inject({ method: "POST", url: "/api/workspaces", headers: OPERATOR, payload: { scenario: "shops-v1" } })).json();
    const invalid = new errorCodes.FST_ERR_CTP_INVALID_JSON_BODY();
    for (const url of [`/w/${created.id}/halden/cart/add`, "/api/workspaces"]) {
      const res = await gateway.inject({ method: "POST", url, headers: { ...OPERATOR, "content-type": "application/json" }, payload: "{bad json" });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: invalid.message });
    }
    // Well-formed JSON still reaches the store parsed, and an empty JSON body still reads as {}.
    const ok = await gateway.inject({ method: "POST", url: `/w/${created.id}/halden/cart/add`, headers: { "content-type": "application/json" }, payload: '{"sku":"x","qty":2}' });
    expect(ok.json().body).toEqual({ sku: "x", qty: 2 });
    const empty = await gateway.inject({ method: "POST", url: `/w/${created.id}/halden/cart/add`, headers: { "content-type": "application/json" }, payload: "" });
    expect(empty.json().body).toEqual({});
  });

  it("routes a shops-v1 workspace to path-based targets — an unlisted one included — signed, under the gateway's prefix", async () => {
    const minted = await gateway.inject({ method: "POST", url: "/api/workspaces", headers: { "x-benchme-operator-key": "operator-key-for-tests" }, payload: { scenario: "shops-v1" } });
    expect(minted.statusCode).toBe(201);
    const id = minted.json().id as string;
    const store = await gateway.inject(`/w/${id}/halden/products/x?a=1`);
    expect(store.statusCode).toBe(200);
    expect(store.json()).toMatchObject({ path: "/s/halden/products/x?a=1", workspace: id, prefix: `/w/${id}/halden` });
    expect(verifyWorkspaceHeader(SECRET, id, store.json().sig)).toBe(true);
    // Unlisted is "not advertised", never "not routed".
    const unlisted = await gateway.inject(`/w/${id}/paylantern/pay?ref=r1`);
    expect(unlisted.statusCode).toBe(200);
    expect(unlisted.json()).toMatchObject({ path: "/s/paylantern/pay?ref=r1", workspace: id, prefix: `/w/${id}/paylantern` });
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

  it("resolves shared-shops-v1-<seed> to a shops-v1 workspace at that seed, like any registered scenario's alias", async () => {
    const seed = 1000 + Math.floor(Math.random() * 1_000_000); // the alias persists in the shared test DB across runs
    const id = await service.resolveShared(`shared-shops-v1-${seed}`);
    expect(id).toMatch(/^ws_[0-9a-f]{12}$/);
    const w = await service.get(id as string);
    expect({ scenario: w.scenario, seed: w.seed }).toEqual({ scenario: "shops-v1", seed });
    expect(await service.resolveShared(`shared-shops-v1-${seed}`)).toBe(id);
  });

  it("serves the portal, the registry and the workspace page", async () => {
    const home = (await gateway.inject("/")).body;
    expect(home).toContain("acme-v1");
    expect(home).toContain("<code>halden</code>");
    const registry = (await gateway.inject("/registry")).body;
    expect(registry).toContain("/warehouse/mcp");
    expect(registry).toContain("NLWeb /ask");
    expect(registry).toContain("ask MCP");
    expect(registry).toContain("WebMCP");
    expect(registry).toContain("/warehouse/ask/mcp");
    expect(registry).toContain("/warehouse/ask</code>");
    expect(registry).toContain("/data/</code>");
    // data has no ask capability — its ask/ask-MCP cells must not claim one.
    const dataRow = registry.slice(registry.indexOf("<code>data</code>"), registry.indexOf("</tr>", registry.indexOf("<code>data</code>")));
    expect(dataRow).not.toContain("/data/ask");
    const created = (await gateway.inject({ method: "POST", url: "/api/workspaces", headers: { "x-benchme-operator-key": "operator-key-for-tests" }, payload: { scenario: "acme-v1" } })).json();
    const workspacePage = (await gateway.inject(`/w/${created.id}`)).body;
    expect(workspacePage).toContain(created.id);
    expect(workspacePage).toContain(`/w/${created.id}/halden/`);
    // paylantern carries every capability flag, yet no page names it.
    for (const body of [home, registry, workspacePage]) expect(body).not.toContain("paylantern");
  });

  it("serves a host-root robots.txt that disallows /w/ and lists a schemamap per listed ask-capable app", async () => {
    const res = await gateway.inject("/robots.txt");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.body).toContain("User-agent: *\nDisallow: /w/\n");
    // The broad Disallow would otherwise forbid the schema map the line right
    // below it advertises; the narrower Allow wins by longest match.
    expect(res.body).toContain("Allow: /w/shared-acme-v1-20260908/warehouse/schema/\nschemamap: http://benchme.test/w/shared-acme-v1-20260908/warehouse/schema/map.xml");
    // data is webmcp-only, not ask-capable — no schemamap line for it.
    expect(res.body).not.toContain("/data/schema/map.xml");
    // paylantern is ask-capable but unlisted — never advertised to crawlers.
    expect(res.body).not.toContain("paylantern");
  });
});

describe("app registry and config (no database)", () => {
  it("routes to and seeds an unlisted app but leaves it out of listed()", () => {
    const reg = new AppRegistry({ halden: "http://shops:3000/s/halden", paylantern: "http://shops:3000/s/paylantern/" }, ["paylantern"], [], [], [], ["paylantern"]);
    expect(reg.get("paylantern")?.baseUrl).toBe("http://shops:3000/s/paylantern");
    expect(reg.listed().map((a) => a.name)).toEqual(["halden"]);
    expect(reg.seeded().map((a) => a.name)).toEqual(["paylantern"]);
  });

  it("refuses an UNLISTED_APPS name that is not in APP_TARGETS", () => {
    expect(() => new AppRegistry({ halden: "http://shops:3000/s/halden" }, [], [], [], [], ["paylantern"])).toThrow(/UNLISTED_APPS names "paylantern"/);
  });

  const env = {
    DATABASE_URL: "postgres://db.test/x",
    REDIS_URL: "redis://redis.test",
    GATEWAY_SECRET: "g".repeat(16),
    OPERATOR_KEY: "o".repeat(16),
    RECEIPT_SECRET: "r".repeat(16),
    PUBLIC_BASE_URL: "http://benchme.test",
    APP_TARGETS: '{"halden":"http://shops:3000/s/halden"}',
  };

  it("accepts an APP_TARGETS url that carries a path", () => {
    expect(readConfig(env).APP_TARGETS).toEqual({ halden: "http://shops:3000/s/halden" });
  });

  it("reads UNLISTED_APPS as a trimmed comma list, empty when unset or blank", () => {
    expect(readConfig(env).UNLISTED_APPS).toEqual([]);
    expect(readConfig({ ...env, UNLISTED_APPS: "" }).UNLISTED_APPS).toEqual([]);
    expect(readConfig({ ...env, UNLISTED_APPS: " paylantern, ,extra " }).UNLISTED_APPS).toEqual(["paylantern", "extra"]);
  });
});
