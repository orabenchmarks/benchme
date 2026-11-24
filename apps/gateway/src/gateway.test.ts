import { DOORS_HEADER, DOORS_SIG_HEADER, DoorSet, HmacReceiptSigner, WORKSPACE_HEADER, WORKSPACE_SIG_HEADER, createPool, migrate, signWorkspaceHeader, verifyDoorsHeader, verifyWorkspaceHeader, type Door, type Pool } from "@benchme/core";
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
import { checkServiceNames } from "./routes/services.js";
import { MemoryRateLimiter } from "./rate-limit.js";
import { HttpWorkspaceSeeder, seedTargetsFor, type WorkspaceSeeder } from "./seeder.js";
import type { WorkspaceService } from "./workspace-service.js";

const DB = process.env.DATABASE_URL;
/** Where the front page says an app's MCP server is, with the MCP door open. */
const MCP_AT = "an app's MCP server is at <code>/w/&lt;id&gt;/&lt;app&gt;/mcp</code>";
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
    doors: req.headers[DOORS_HEADER],
    doorsSig: req.headers[DOORS_SIG_HEADER],
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
/** A correctly signed workspace header, as a client could only forge with the gateway's secret. */
const signWorkspaceHeaderForTest = (id: string) => signWorkspaceHeader(SECRET, id);

let pool: Pool;
let stub: Awaited<ReturnType<typeof stubApp>>;
let gateway: FastifyInstance;
let service: WorkspaceService;
let limiter: MemoryRateLimiter;
let apps: AppRegistry;

/** Another gateway over the same database and apps, for a deployment that serves `doors` (BENCHME_DOORS). */
async function deployment(doors: DoorSet): Promise<FastifyInstance> {
  const { app } = await buildGateway({
    pool,
    scenarios,
    apps,
    seeder: new HttpWorkspaceSeeder(seedTargetsFor(apps, scenarios), SECRET),
    receipts: new HmacReceiptSigner("receipt-secret-for-tests"),
    limiter: new MemoryRateLimiter(1000, 3600),
    gatewaySecret: SECRET,
    operatorKey: "operator-key-for-tests",
    publicBaseUrl: "http://benchme.test",
    internalBaseUrl: "http://gateway.benchme.svc",
    defaultTtlSeconds: 3600,
    maxTtlSeconds: 7200,
    sharedSeed: 20260908,
    doors,
    logLevel: "silent",
  });
  return app;
}

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
  // out on the listing alone, while the proxy still routes to it. wallet: an
  // unlisted app that shares its name with a root service (the wallet's
  // card-on-file door, /w/<id>/wallet/card, beside the root /wallet/*).
  // guide: unlisted, and the one app guide-v1 names (Scenario.apps) — advertised by that scenario's workspaces alone.
  // web: the same, for web-v1 — a PATH base on the guide's own service (the site network under /web).
  apps = new AppRegistry(
    { warehouse: stub.url, data: stub.url, halden: `${stub.url}/s/halden`, paylantern: `${stub.url}/s/paylantern`, wallet: `${stub.url}/workspace`, guide: stub.url, web: `${stub.url}/web` },
    ["warehouse"],
    ["warehouse", "paylantern"],
    ["warehouse", "paylantern"],
    ["data", "paylantern"],
    ["paylantern", "wallet", "guide", "web"],
  );
  limiter = new MemoryRateLimiter(2, 3600);
  const seeder: WorkspaceSeeder = new HttpWorkspaceSeeder(seedTargetsFor(apps, scenarios), SECRET);
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
    // A root service, outside any workspace (the wallet stand-in link-cli is pointed at).
    services: { wallet: stub.url },
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

  it("never proxies an app's /internal/workspaces/* (the gateway's own seed door), however the path is written", async () => {
    const minted = (await gateway.inject({ method: "POST", url: "/api/workspaces", headers: OPERATOR, payload: { scenario: "acme-v1", seed: 5 } })).json();
    const port = await listening();
    const seededBefore = stub.seeds.length;
    const door = `internal/workspaces/${minted.id}/seed`;
    const post = (path: string) => gateway.inject({ method: "POST", url: path, payload: { scenario: "acme-v1", seed: 9 } });
    // As written; under a path-based target (/s/halden/internal/…); through the shared alias's own id.
    for (const path of [`/w/${minted.id}/warehouse/${door}`, `/w/${minted.id}/halden/${door}`, `/w/${minted.id}/warehouse/internal/workspaces`]) {
      const res = await post(path);
      expect(res.statusCode, path).toBe(404);
      expect(res.json(), path).toMatchObject({ error: "NOT_FOUND" });
    }
    // Escaped, behind dot segments (plain and escaped), and behind a doubled slash: read as the app would route them.
    for (const rest of [`%69nternal/workspaces/${minted.id}/seed`, `x/../${door}`, `x/%2e%2e/${door}`, `/${door}`, `INTERNAL/workspaces/${minted.id}/seed`]) {
      expect((await rawFetch(port, `/w/${minted.id}/warehouse/${rest}`)).status, rest).toBe(404);
    }
    expect(stub.seeds.length).toBe(seededBefore);
    // A site's change ledger is under the same door: the verifier reads it on the app's own address, and no address here leads to it.
    for (const path of [`/w/${minted.id}/warehouse/internal/workspaces/${minted.id}/ledger`, `/w/${minted.id}/warehouse/internal/workspaces/${minted.id}/ledger?cursor=0&limit=5`]) {
      const res = await gateway.inject({ method: "GET", url: path });
      expect([path, res.statusCode, res.json().error]).toEqual([path, 404, "NOT_FOUND"]);
    }
    // An app's other /internal/* pages (the guide's operator-keyed records) are still proxied.
    const records = await gateway.inject(`/w/${minted.id}/guide/internal/records?workspace=${minted.id}`);
    expect(records.statusCode).toBe(200);
    expect(records.json().path).toBe(`/internal/records?workspace=${minted.id}`);
  });

  it("advertises only the apps a scenario names — an unlisted one included — in its urls and on its portal page", async () => {
    const minted = await gateway.inject({ method: "POST", url: "/api/workspaces", headers: OPERATOR, payload: { scenario: "guide-v1", seed: 104_729 } });
    expect(minted.statusCode).toBe(201);
    const { id, seed, urls } = minted.json() as { id: string; seed: number; urls: Record<string, Record<string, string>> };
    expect(seed).toBe(104_729);
    expect(urls.apps).toEqual({ guide: `http://benchme.test/w/${id}/guide` });
    expect([urls.mcp, urls.ask, urls.askMcp, urls.webmcp]).toEqual([{}, {}, {}, {}]);
    expect((await gateway.inject(`/api/workspaces/${id}`)).json().urls.apps).toEqual({ guide: `http://benchme.test/w/${id}/guide` });
    const portal = (await gateway.inject(`/w/${id}`)).body;
    expect(portal).toContain(`/w/${id}/guide/`);
    expect(portal).not.toContain(`/w/${id}/warehouse/`);
    const guide = await gateway.inject(`/w/${id}/guide/products/x`);
    expect(guide.json()).toMatchObject({ path: "/products/x", workspace: id, prefix: `/w/${id}/guide` });
    // Every other scenario's workspaces keep leaving the unlisted guide out.
    const acme = (await gateway.inject({ method: "POST", url: "/api/workspaces", headers: OPERATOR, payload: { scenario: "acme-v1", seed: 4242 } })).json();
    expect(Object.keys(acme.urls.apps)).not.toContain("guide");
    expect(Object.keys(acme.urls.apps)).not.toContain("web");
  });

  it("advertises the site network to a web-v1 workspace alone and routes it to the guide's /web, under the web prefix", async () => {
    const minted = await gateway.inject({ method: "POST", url: "/api/workspaces", headers: OPERATOR, payload: { scenario: "web-v1", seed: 812_768 } });
    expect(minted.statusCode).toBe(201);
    const { id, urls } = minted.json() as { id: string; urls: Record<string, Record<string, string>> };
    expect(urls.apps).toEqual({ web: `http://benchme.test/w/${id}/web` });
    const site = await gateway.inject(`/w/${id}/web/tested-and-told/`);
    expect(site.json()).toMatchObject({ path: "/web/tested-and-told/", workspace: id, prefix: `/w/${id}/web` });
    const guide = (await gateway.inject({ method: "POST", url: "/api/workspaces", headers: OPERATOR, payload: { scenario: "guide-v1", seed: 104_729 } })).json();
    expect(Object.keys(guide.urls.apps)).toEqual(["guide"]);
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

  it("serves an unlisted workspace app that shares its name with a root service: /w/<id>/wallet/* signed, /wallet/* never", async () => {
    const minted = await gateway.inject({ method: "POST", url: "/api/workspaces", headers: { "x-benchme-operator-key": "operator-key-for-tests" }, payload: { scenario: "shops-v1" } });
    const { id, urls } = minted.json() as { id: string; urls: { apps: Record<string, string>; mcp: Record<string, string> } };
    expect(Object.keys(urls.apps)).not.toContain("wallet");
    expect(JSON.stringify(urls)).not.toContain("/wallet");
    const doorRes = await gateway.inject({ url: `/w/${id}/wallet/card`, headers: { accept: "application/json" } });
    expect(doorRes.statusCode).toBe(200);
    expect(doorRes.json()).toMatchObject({ path: "/workspace/card", workspace: id, prefix: `/w/${id}/wallet`, forwardedHost: "benchme.test" });
    expect(verifyWorkspaceHeader(SECRET, id, doorRes.json().sig)).toBe(true);
    // The root service reaches the same backend path with no workspace at all: the wallet refuses it there.
    const root = (await gateway.inject({ url: "/wallet/workspace/card", headers: { [WORKSPACE_HEADER]: id, [WORKSPACE_SIG_HEADER]: signWorkspaceHeaderForTest(id) } })).json();
    expect(root).toMatchObject({ path: "/workspace/card", prefix: "/wallet" });
    expect(root.workspace).toBeUndefined();
    expect(root.sig).toBeUndefined();
  });

  it("serves a root service at /<name>/*: path and query as sent, the public host and its prefix forwarded, never a workspace header", async () => {
    const res = await gateway.inject({ method: "GET", url: "/wallet/api/spend_requests/lsrq_1?include=card", headers: { [WORKSPACE_HEADER]: "ws_000000000000", [WORKSPACE_SIG_HEADER]: "forged" } });
    expect(res.statusCode).toBe(200);
    const echo = res.json();
    expect(echo).toMatchObject({ path: "/api/spend_requests/lsrq_1?include=card", prefix: "/wallet", forwardedHost: "benchme.test", forwardedProto: "http" });
    expect(echo.workspace).toBeUndefined();
    expect(echo.sig).toBeUndefined();
    const form = await gateway.inject({ method: "POST", url: "/wallet/auth/device/token", payload: "grant_type=refresh_token&refresh_token=x", headers: { "content-type": "application/x-www-form-urlencoded" } });
    expect(form.json()).toMatchObject({ path: "/auth/device/token", contentType: "application/x-www-form-urlencoded", body: { grant_type: "refresh_token", refresh_token: "x" } });
    const json = await gateway.inject({ method: "POST", url: "/wallet/api/spend_requests", payload: { amount: 2450 } });
    expect(json.json().body).toEqual({ amount: 2450 });
    const bare = await gateway.inject({ method: "GET", url: "/wallet?x=1" });
    expect([bare.statusCode, bare.headers.location]).toEqual([302, "/wallet/?x=1"]);
    expect((await gateway.inject({ method: "GET", url: "/nowallet/api" })).statusCode).toBe(404);
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
    expect(home).toContain('<li title="halden">');
    // A card for every registered scenario, and the search over them, opened filtered by ?q=.
    for (const s of scenarios.list()) expect(home).toContain(`data-scenario="${s.key}"`);
    expect(home).toContain('<input id="q" name="q" type="search"');
    expect((await gateway.inject("/?q=Halden%20Audio")).body).toContain(`>1 of ${scenarios.list().length} scenarios</p>`);
    // Each scenario's own page, and none for a scenario there is not.
    const cuj = await gateway.inject("/scenarios/cuj-v1");
    expect([cuj.statusCode, cuj.body.includes("<h1 id=\"page-h\">Critical user journeys</h1>")]).toEqual([200, true]);
    expect((await gateway.inject("/scenarios/no-such-v9")).statusCode).toBe(404);
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
    // paylantern carries every capability flag, yet no page names it; nor the unlisted wallet door.
    for (const body of [home, registry, workspacePage]) expect(body).not.toContain("paylantern");
    for (const body of [home, registry, workspacePage]) expect(body).not.toMatch(/\/wallet\b|<code>wallet<\/code>/);
  });

  it("serves a host-root robots.txt that allows every path to everyone but the model-training crawlers, and lists a schemamap per listed ask-capable app", async () => {
    const res = await gateway.inject("/robots.txt");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    // Everyone else — an agent honouring robots.txt on a shopper's behalf included — meets no directive at all.
    expect(res.body).toContain("\nUser-agent: *\nAllow: /\n");
    const groups = res.body.split(/\n\n+/);
    const star = groups.find((g) => g.startsWith("User-agent: *")) as string;
    expect(star).not.toMatch(/^Disallow:/m);
    // The crawlers that gather pages for training or an index keep off the per-run tree (they honour Disallow, not
    // noindex), all but the shared workspace's schema maps the schemamap lines advertise.
    const training = groups[0] as string;
    for (const bot of ["GPTBot", "ClaudeBot", "CCBot", "Google-Extended", "Applebot-Extended", "PerplexityBot", "Bytespider", "meta-externalagent"]) expect(training).toContain(`User-agent: ${bot}\n`);
    expect(training).toContain("Disallow: /w/\n");
    expect(training).toContain("Allow: /w/shared-acme-v1-20260908/warehouse/schema/");
    expect(training).not.toContain("User-agent: *");
    expect(res.body).toContain("schemamap: http://benchme.test/w/shared-acme-v1-20260908/warehouse/schema/map.xml");
    // data is webmcp-only, not ask-capable — no schemamap line for it.
    expect(res.body).not.toContain("/data/schema/map.xml");
    // paylantern is ask-capable but unlisted — never advertised to crawlers; nor is the wallet door.
    expect(res.body).not.toContain("paylantern");
    expect(res.body).not.toContain("wallet");
  });

  it("keeps every per-run page of every app out of search indexes (X-Robots-Tag), the shared workspace's pages indexable as before", async () => {
    const minted = (await gateway.inject({ method: "POST", url: "/api/workspaces", headers: OPERATOR, payload: { scenario: "shops-v1" } })).json();
    for (const app of ["warehouse", "data", "halden", "paylantern", "wallet"]) {
      const res = await gateway.inject(`/w/${minted.id}/${app}/any/page`);
      expect(res.statusCode, app).toBe(200);
      expect(res.headers["x-robots-tag"], app).toBe("noindex, nofollow");
    }
    const shared = await gateway.inject(`/w/shared-acme-v1-20260908/warehouse/schema/map.xml`);
    expect(shared.statusCode).toBe(200);
    expect(shared.headers["x-robots-tag"]).toBeUndefined();
  });
});

// The doors: decided here (a workspace's own, else the deployment's), refused by path before the app is called, and
// forwarded to the app signed for the workspace. The stub app answers everything, so a 404 {"error":"NOT_FOUND"} is the
// gateway's own.
describe.skipIf(!DB)("the doors a workspace is served through, at the gateway (real Postgres + stub app)", () => {
  const NOT_FOUND = { error: "NOT_FOUND" };
  /** Every set of the doors a workspace can close (pages are always served). */
  const SETS: Door[][] = [[], ["rest"], ["mcp"], ["webmcp"], ["rest", "mcp"], ["rest", "webmcp"], ["mcp", "webmcp"], ["rest", "mcp", "webmcp"]];
  const mint = async (body: Record<string, unknown>, on: FastifyInstance = gateway) => on.inject({ method: "POST", url: "/api/workspaces", headers: OPERATOR, payload: { scenario: "acme-v1", ...body } });

  it("keeps the doors a workspace is created with, pages among them, shows them, and serves every door to one created without", async () => {
    const own = await mint({ doors: ["webmcp"] });
    expect([own.statusCode, own.json().doors]).toEqual([201, ["page", "webmcp"]]);
    expect((await gateway.inject(`/api/workspaces/${own.json().id}`)).json().doors).toEqual(["page", "webmcp"]);
    expect((await mint({ doors: [] })).json().doors).toEqual(["page"]);
    const plain = (await mint({})).json();
    expect(plain.doors).toEqual(["page", "rest", "mcp", "webmcp"]);
    expect((await gateway.inject({ method: "POST", url: `/api/workspaces/${plain.id}/finalize` })).json().doors).toEqual(["page", "rest", "mcp", "webmcp"]);
  });

  it("refuses a name that is no door with 422 UNKNOWN_DOOR, before it spends a rate-limit unit", async () => {
    const strict = new MemoryRateLimiter(1, 3600);
    const own = await buildGateway({ pool, scenarios, apps, seeder: { seed: async () => undefined }, receipts: new HmacReceiptSigner("receipt-secret-for-tests"), limiter: strict, gatewaySecret: SECRET, operatorKey: "operator-key-for-tests", publicBaseUrl: "http://benchme.test", internalBaseUrl: "http://gateway.benchme.svc", defaultTtlSeconds: 3600, maxTtlSeconds: 7200, sharedSeed: 20260908, logLevel: "silent" });
    for (let i = 0; i < 3; i++) {
      const bad = await own.app.inject({ method: "POST", url: "/api/workspaces", remoteAddress: "10.7.7.7", payload: { scenario: "acme-v1", doors: ["page", "ftp"] } });
      expect([bad.statusCode, bad.json()]).toEqual([422, { error: "UNKNOWN_DOOR", message: 'unknown door "ftp": the doors are page, rest, mcp, webmcp' }]);
    }
    const ok = await own.app.inject({ method: "POST", url: "/api/workspaces", remoteAddress: "10.7.7.7", payload: { scenario: "acme-v1", doors: ["page"] } });
    expect(ok.statusCode).toBe(201);
    await own.app.close();
  });

  it.each(SETS.map((open) => [open.join(",") || "pages alone", open] as const))("serves %s: each way in behind an open door reaches the app with the doors signed, every other one is refused first", async (_name, open) => {
    const doors = DoorSet.of(open);
    const minted = (await mint({ doors: open })).json();
    const { id } = minted as { id: string };
    expect(minted.doors).toEqual(doors.list());
    const at = `/w/${id}/warehouse`;
    const port = await listening();
    const get = (path: string) => rawFetch(port, `${at}/${path}`).then((r) => ({ status: r.status, body: JSON.parse(r.body) as Record<string, unknown> }));
    const post = (path: string) => gateway.inject({ method: "POST", url: `${at}/${path}`, payload: { jsonrpc: "2.0", id: 1, method: "ping" } }).then((r) => ({ status: r.statusCode, body: r.json() as Record<string, unknown> }));
    const ways: [string, () => Promise<{ status: number; body: Record<string, unknown> }>, boolean][] = [
      ["a page", () => get("products/x?a=1"), true],
      ["REST", () => get("api/v1/products?limit=2"), doors.has("rest")],
      // REST spelled as the app's router reads it: an escape, a dot segment, a doubled slash, a trailing slash.
      ["REST, escaped", () => get("%61pi/v1/products"), doors.has("rest")],
      ["REST, behind a dot segment", () => get("./api/v1/products"), doors.has("rest")],
      ["REST, behind a doubled slash", () => get("/api/v1/products"), doors.has("rest")],
      ["NLWeb /ask", () => get("ask?query=x&streaming=false"), doors.has("rest")],
      ["NLWeb /ask/mcp", () => post("ask/mcp"), doors.has("mcp")],
      // A page's bridge and a direct client call one path: it is open while either door is, and the app tells them apart.
      ["/mcp", () => post("mcp"), doors.has("mcp") || doors.has("webmcp")],
      ["/mcp/", () => post("mcp/"), doors.has("mcp") || doors.has("webmcp")],
      // No door at all: an app's other /internal/ pages (authenticated their own way) are proxied whatever the doors.
      ["the guide's records", () => rawFetch(port, `/w/${id}/guide/internal/records`).then((r) => ({ status: r.status, body: JSON.parse(r.body) as Record<string, unknown> })), true],
    ];
    for (const [way, send, served] of ways) {
      const res = await send();
      if (!served) {
        expect([way, res.status, res.body]).toEqual([way, 404, NOT_FOUND]);
        continue;
      }
      expect([way, res.status]).toEqual([way, 200]);
      // What reached the app: this workspace, and its doors, signed for it.
      expect([way, res.body.workspace, res.body.doors]).toEqual([way, id, doors.toString()]);
      expect(verifyDoorsHeader(SECRET, id, res.body.doors as string, res.body.doorsSig as string)).toBe(true);
    }
    // urls name only what is behind an open door; every app's pages are always there.
    expect(Object.keys(minted.urls.apps)).toContain("warehouse");
    expect([Object.keys(minted.urls.mcp).length > 0, Object.keys(minted.urls.ask).length > 0, Object.keys(minted.urls.askMcp).length > 0, Object.keys(minted.urls.webmcp).length > 0]).toEqual([
      doors.has("mcp"),
      doors.has("rest"),
      doors.has("mcp"),
      doors.has("webmcp"),
    ]);
  });

  it("replaces the doors a client says it has with the workspace's own, signed for it", async () => {
    const { id } = (await mint({ doors: ["page"] })).json() as { id: string };
    const forged = { [DOORS_HEADER]: "page,rest,mcp,webmcp", [DOORS_SIG_HEADER]: "0".repeat(64) };
    expect((await gateway.inject({ url: `/w/${id}/warehouse/api/v1/products`, headers: forged })).json()).toEqual(NOT_FOUND);
    const page = (await gateway.inject({ url: `/w/${id}/warehouse/products/x`, headers: forged })).json();
    expect([page.doors, verifyDoorsHeader(SECRET, id, page.doors, page.doorsSig)]).toEqual(["page", true]);
  });
});

// A deployment's doors (BENCHME_DOORS): every workspace created without its own is served through them, the shared ones
// too, and the portal and the registry name nothing behind a closed one.
describe.skipIf(!DB)("a deployment's doors (real Postgres + stub app)", () => {
  it("serves a workspace created without doors, and a shared workspace, through the deployment's; one with its own through those", async () => {
    const bridgeOnly = await deployment(DoorSet.parse("webmcp"));
    try {
      const plain = (await bridgeOnly.inject({ method: "POST", url: "/api/workspaces", headers: OPERATOR, payload: { scenario: "acme-v1" } })).json();
      expect([plain.doors, plain.urls.mcp, plain.urls.ask, plain.urls.askMcp, plain.urls.webmcp]).toEqual([["page", "webmcp"], {}, {}, {}, { data: `http://benchme.test/w/${plain.id}/data/` }]);
      expect((await bridgeOnly.inject(`/w/${plain.id}/warehouse/api/v1/products`)).statusCode).toBe(404);
      const own = (await bridgeOnly.inject({ method: "POST", url: "/api/workspaces", headers: OPERATOR, payload: { scenario: "acme-v1", doors: ["rest"] } })).json();
      expect(own.doors).toEqual(["page", "rest"]);
      expect((await bridgeOnly.inject(`/w/${own.id}/warehouse/api/v1/products`)).json()).toMatchObject({ workspace: own.id, doors: "page,rest" });
      expect((await bridgeOnly.inject({ method: "POST", url: `/w/${own.id}/warehouse/mcp`, payload: {} })).statusCode).toBe(404);

      const seed = 1000 + Math.floor(Math.random() * 1_000_000); // the alias persists in the shared test DB across runs
      const shared = await bridgeOnly.inject(`/w/shared-acme-v1-${seed}/warehouse/products/x`);
      expect(shared.json()).toMatchObject({ doors: "page,webmcp" });
      expect((await bridgeOnly.inject(`/w/shared-acme-v1-${seed}/warehouse/api/v1/products`)).json()).toEqual({ error: "NOT_FOUND" });
      expect((await bridgeOnly.inject(`/api/workspaces/${shared.json().workspace as string}`)).json().doors).toEqual(["page", "webmcp"]);
    } finally {
      await bridgeOnly.close();
    }
  });

  it("names on the portal and the registry only what is behind the deployment's open doors", async () => {
    const pages = (app: FastifyInstance) => Promise.all([app.inject("/"), app.inject("/registry")]).then(([home, registry]) => ({ home: home.body, registry: registry.body }));
    const every = await pages(gateway);
    expect(every.home).toContain(MCP_AT);
    expect(every.home).toContain('href="/registry"');
    for (const text of ["MCP endpoint", "NLWeb /ask", "ask MCP", "WebMCP", "/warehouse/mcp</code>", "/warehouse/ask</code>", "/warehouse/ask/mcp</code>", "/data/</code>", "Streamable HTTP"]) expect(every.registry).toContain(text);

    const cases: [string, { has: string[]; hasNot: string[] }][] = [
      // warehouse has an MCP server and NLWeb but no WebMCP: with those doors closed it is not a row at all.
      ["webmcp", { has: ["WebMCP", "<code>data</code>", "/data/</code>"], hasNot: ["MCP endpoint", "NLWeb /ask", "ask MCP", "/mcp</code>", "/ask</code>", "Streamable HTTP", "<code>warehouse</code>"] }],
      ["rest", { has: ["NLWeb /ask", "/warehouse/ask</code>"], hasNot: ["MCP endpoint", "ask MCP", "WebMCP", "/mcp</code>", "/data/</code>", "<code>data</code>"] }],
      ["mcp", { has: ["MCP endpoint", "ask MCP", "/warehouse/mcp</code>", "/warehouse/ask/mcp</code>", "Streamable HTTP"], hasNot: ["NLWeb /ask", "WebMCP", "/warehouse/ask</code>", "/data/</code>"] }],
    ];
    for (const [list, { has, hasNot }] of cases) {
      const deployed = await deployment(DoorSet.parse(list));
      try {
        const { home, registry } = await pages(deployed);
        expect([list, home.includes(MCP_AT)]).toEqual([list, list === "mcp"]);
        for (const text of has) expect([list, text, registry.includes(text)]).toEqual([list, text, true]);
        for (const text of hasNot) expect([list, text, registry.includes(text)]).toEqual([list, text, false]);
      } finally {
        await deployed.close();
      }
    }

    // The pages alone: the registry lists no server, and the portal does not point at it.
    const pagesAlone = await deployment(DoorSet.parse("page"));
    try {
      const { home, registry } = await pages(pagesAlone);
      expect(home).not.toContain("/registry");
      expect(home).not.toContain("/mcp");
      expect(registry).not.toContain("<table>");
      expect(registry).toContain("through their pages alone");
    } finally {
      await pagesAlone.close();
    }
  });
});

describe("app registry and config (no database)", () => {
  it("routes to and seeds an unlisted app but leaves it out of listed()", () => {
    const reg = new AppRegistry({ halden: "http://shops:3000/s/halden", paylantern: "http://shops:3000/s/paylantern/" }, ["paylantern"], [], [], [], ["paylantern"]);
    expect(reg.get("paylantern")?.baseUrl).toBe("http://shops:3000/s/paylantern");
    expect(reg.listed().map((a) => a.name)).toEqual(["halden"]);
    expect(reg.seeded().map((a) => a.name)).toEqual(["paylantern"]);
  });

  // The lists the chart renders (charts/benchme/templates/apps.yaml): the nine webmcp-v1 sites are seeded AND unlisted.
  const SITES = ["hotels", "flights", "dining", "pizza", "cinema", "sports", "homes", "clinic", "events"];
  const BEFORE_THE_SITES = ["warehouse", "helpdesk", "vaultdocs", "mail", "verify"];
  const deployed = () =>
    new AppRegistry(
      Object.fromEntries([...BEFORE_THE_SITES, ...SITES, "data", "guide", "web", "paylantern", "wallet"].map((name) => [name, `http://${name}`])),
      ["warehouse", "helpdesk", "vaultdocs", ...SITES, "mail", "verify"],
      [],
      [],
      [],
      ["paylantern", "wallet", "guide", "web", ...SITES],
    );

  it("seeds a listed app for every scenario, an unlisted one only for a scenario that names it", () => {
    const reg = new AppRegistry({ warehouse: "http://w", mail: "http://m", hotels: "http://h", guide: "http://g" }, ["warehouse", "mail", "hotels"], [], [], [], ["hotels", "guide"]);
    const names = (named: readonly string[] | undefined) => reg.seededFor(named).map((a) => a.name);
    expect(names(undefined)).toEqual(["warehouse", "mail"]);
    expect(names(["guide"])).toEqual(["warehouse", "mail"]);
    expect(names(["hotels", "mail"])).toEqual(["warehouse", "mail", "hotels"]);
  });

  it("seeds exactly the apps seeded before the webmcp-v1 sites for every other scenario, and the nine sites for the scenarios that name them (webmcp-v1, cuj-v1)", () => {
    const targets = seedTargetsFor(deployed(), scenarios);
    const naming = ["webmcp-v1", "cuj-v1"];
    for (const scenario of scenarios.list().map((s) => s.key).filter((key) => !naming.includes(key))) {
      expect(targets({ scenario }).map((a) => a.name).sort(), scenario).toEqual([...BEFORE_THE_SITES].sort());
    }
    for (const scenario of naming) expect(targets({ scenario }).map((a) => a.name).sort(), scenario).toEqual([...BEFORE_THE_SITES, ...SITES].sort());
  });

  it("creates a workspace of another scenario while a webmcp-v1 site is down; a webmcp-v1 one fails on it", async () => {
    const called: string[] = [];
    const fetchImpl = (async (url: Parameters<typeof fetch>[0]) => {
      const host = new URL(String(url)).host;
      called.push(host);
      if (host === "hotels") throw new Error("connect ECONNREFUSED");
      return new Response("{}", { status: 201 });
    }) as typeof fetch;
    const seeder = new HttpWorkspaceSeeder(seedTargetsFor(deployed(), scenarios), SECRET, fetchImpl);
    const workspace = (scenario: string) => ({ id: "ws_0123456789ab", scenario, seed: 1, createdAt: new Date(), expiresAt: new Date(), finalizedAt: null }) as never;
    await seeder.seed(workspace("acme-v1"));
    expect(called.sort()).toEqual([...BEFORE_THE_SITES].sort());
    await expect(seeder.seed(workspace("webmcp-v1"))).rejects.toThrow(/ECONNREFUSED/);
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

  it("reads SERVICE_TARGETS as a JSON map, none by default, and refuses a name the gateway answers itself", () => {
    const base = { DATABASE_URL: "postgres://x", REDIS_URL: "redis://x", GATEWAY_SECRET: "g".repeat(16), OPERATOR_KEY: "o".repeat(16), RECEIPT_SECRET: "r".repeat(16), PUBLIC_BASE_URL: "http://benchme.test", APP_TARGETS: "{}", SEEDED_APPS: "", MCP_APPS: "" };
    expect(readConfig(base).SERVICE_TARGETS).toEqual({});
    expect(readConfig({ ...base, SERVICE_TARGETS: '{"wallet":"http://wallet:3000"}' }).SERVICE_TARGETS).toEqual({ wallet: "http://wallet:3000" });
    expect(() => readConfig({ ...base, SERVICE_TARGETS: "nope" })).toThrow(/SERVICE_TARGETS/);
    expect(() => checkServiceNames({ api: "http://x" })).toThrow(/answers itself/);
    expect(() => checkServiceNames({ w: "http://x" })).toThrow(/answers itself/);
    expect(() => checkServiceNames({ "Wallet/x": "http://x" })).toThrow(/path segment/);
  });

  it("reads UNLISTED_APPS as a trimmed comma list, empty when unset or blank", () => {
    expect(readConfig(env).UNLISTED_APPS).toEqual([]);
    expect(readConfig({ ...env, UNLISTED_APPS: "" }).UNLISTED_APPS).toEqual([]);
    expect(readConfig({ ...env, UNLISTED_APPS: " paylantern, ,extra " }).UNLISTED_APPS).toEqual(["paylantern", "extra"]);
  });

  it("reads BENCHME_DOORS as the doors every workspace gets, all four when unset or blank, pages always among them", () => {
    const doors = (value?: string) => readConfig(value === undefined ? env : { ...env, BENCHME_DOORS: value }).BENCHME_DOORS.list();
    expect(doors()).toEqual(["page", "rest", "mcp", "webmcp"]);
    expect(doors("")).toEqual(["page", "rest", "mcp", "webmcp"]);
    expect(doors("page")).toEqual(["page"]);
    expect(doors("webmcp, rest")).toEqual(["page", "rest", "webmcp"]);
    expect(() => doors("page,none")).toThrow(/BENCHME_DOORS: unknown door "none"/);
  });
});
