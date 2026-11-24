import cookie from "@fastify/cookie";
import { DOORS_HEADER, DOORS_SIG_HEADER, DoorSet, HmacReceiptSigner, createPool, migrate, type Door, type Pool } from "@benchme/core";
import { scenarios } from "@benchme/scenarios";
import { AuthService, BRIDGE_COOKIE, BRIDGE_TOKEN_HEADER, MemoryLedger, MemoryUsersRepo, ToolRegistry, bridgeToken, read, registerDoors, registerMcp, registerWorkspaceScope, untransacted, webmcpBridge, type LedgerRules, type Mailer } from "@benchme/site-kit";
import Fastify, { type FastifyInstance } from "fastify";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { AppRegistry } from "./app-registry.js";
import { buildGateway } from "./build-app.js";
import { MemoryRateLimiter } from "./rate-limit.js";

// The seam neither side proves alone: the gateway decides a request's doors and signs them; a site built with the kit
// reads them, tells a page's bridge from a direct MCP client, and records the door it came through. Every request
// below goes through the gateway, as an agent's would.

const DB = process.env.DATABASE_URL;
const SECRET = "gateway-secret-for-tests";
const NOT_FOUND = { error: "NOT_FOUND" };
const COOKIE = "toy_session";
const OPERATOR = { "x-benchme-operator-key": "operator-key-for-tests" };

interface ThingsRepo {
  getThing(ws: string, id: string): Promise<{ id: string } | null>;
}
const RULES: LedgerRules<ThingsRepo> = { getThing: read("thing", ([id]) => id) };

class CapturingMailer implements Mailer {
  sent: { to: string; body: string }[] = [];
  async deliver(_ws: string, msg: { to: string; subject: string; body: string }) {
    this.sent.push(msg);
  }
}

let pool: Pool;
let site: FastifyInstance;
let gateway: FastifyInstance;
const ledger = new MemoryLedger("toy");
const mailer = new CapturingMailer();

/** A site built with the kit, as the sites are: its pages render the bridge, its REST API, its MCP server with the sign-in tools. */
async function toySite(): Promise<FastifyInstance> {
  const auth = new AuthService({ users: new MemoryUsersRepo(), mailer, sessionTtlSeconds: 3600, tokenPrefix: "toy", verification: { subject: "Your code", body: (code) => `Your verification code is ${code}.` } });
  const app = Fastify();
  await app.register(cookie);
  registerWorkspaceScope(app, SECRET);
  const doors = registerDoors(app, { ledger, transactions: untransacted, auth, cookie: COOKIE, gatewaySecret: SECRET });
  const things = doors.ledgered<ThingsRepo>({ getThing: async (_ws, id) => (id === "T-1" ? { id } : null) }, RULES);
  const tools = doors.withSignIn(new ToolRegistry<{ workspaceId: string }>().register({ name: "get_thing", description: "One thing.", input: { id: z.string() }, handler: (a, c) => things.getThing(c.workspaceId, a.id) }));
  app.get("/", async (req, reply) => reply.type("text/html").send(`<h1>Toy</h1>${webmcpBridge(req, tools)}`));
  app.get<{ Params: { id: string } }>("/api/v1/things/:id", async (req) => things.getThing(req.workspaceId, req.params.id));
  await app.register(async (scope) => registerMcp(scope, { serverName: "toy", version: "0", tools, context: (workspaceId) => ({ workspaceId }), sessions: true }));
  await app.listen({ port: 0, host: "127.0.0.1" });
  return app;
}

beforeAll(async () => {
  if (!DB) return;
  pool = createPool(DB, 4);
  await migrate(pool, "core", join(dirname(fileURLToPath(import.meta.url)), "..", "migrations"));
  site = await toySite();
  const addr = site.server.address();
  const apps = new AppRegistry({ toy: `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}` }, [], ["toy"], [], ["toy"]);
  ({ app: gateway } = await buildGateway({
    pool,
    scenarios,
    apps,
    seeder: { seed: async () => undefined },
    receipts: new HmacReceiptSigner("receipt-secret-for-tests"),
    limiter: new MemoryRateLimiter(1000, 3600),
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
  await site?.close();
  await pool?.end();
});

/** A workspace created with `doors` (the deployment's when none): its id. */
const mint = async (doors?: Door[]) => (await gateway.inject({ method: "POST", url: "/api/workspaces", headers: OPERATOR, payload: { scenario: "acme-v1", ...(doors ? { doors } : {}) } })).json().id as string;

/** A browser opening the site's home page through the gateway: the page, and the bridge cookie and token it was handed (when it was). */
async function openPage(id: string) {
  const res = await gateway.inject(`/w/${id}/toy/`);
  const setCookie = res.headers["set-cookie"];
  return { status: res.statusCode, body: res.body, setCookie: setCookie === undefined ? undefined : String(setCookie), cookie: setCookie ? String(setCookie).split(";")[0]! : undefined, token: /"token":"([0-9a-f]+)"/.exec(res.body)?.[1] };
}

/** One JSON-RPC message to the site's /mcp through the gateway: the status, and the message when there was one. */
async function rpc(id: string, method: string, params: Record<string, unknown>, headers: Record<string, string> = {}) {
  const res = await gateway.inject({ method: "POST", url: `/w/${id}/toy/mcp`, headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers }, payload: { jsonrpc: "2.0", id: 1, method, params } });
  const line = res.body.split("\n").filter((l) => l.startsWith("data:")).pop();
  return { status: res.statusCode, setCookie: res.headers["set-cookie"], message: JSON.parse(line ? line.slice(5) : res.body) as { error?: string; result?: { isError?: boolean; content: { text: string }[] } } };
}
const said = (m: { result?: { content: { text: string }[] } }) => JSON.parse(m.result!.content[0]!.text) as Record<string, unknown>;
const getThing = (id: string, headers: Record<string, string> = {}) => rpc(id, "tools/call", { name: "get_thing", arguments: { id: "T-1" } }, headers);
const doorsRecorded = async (id: string) => (await ledger.list(id)).map((e) => e.door);

describe.skipIf(!DB)("the doors, through the gateway, at a site built with the kit", () => {
  const SETS: Door[][] = [[], ["rest"], ["mcp"], ["webmcp"], ["rest", "mcp"], ["rest", "webmcp"], ["mcp", "webmcp"], ["rest", "mcp", "webmcp"]];

  it.each(SETS.map((open) => [open.join(",") || "pages alone", open] as const))("serves %s: a page, REST, an MCP client and a page's bridge each get in exactly when their door is open", async (_name, open) => {
    const doors = DoorSet.of(open);
    const id = await mint(open);
    const page = await openPage(id);
    expect(page.status).toBe(200);
    // The bridge, and with it /mcp and the tool catalog, only where the WebMCP door is open; its cookie with it.
    expect([page.body.includes('data-webmcp="bridge"'), page.body.includes("/mcp"), page.setCookie !== undefined]).toEqual([doors.has("webmcp"), doors.has("webmcp"), doors.has("webmcp")]);
    // The bridge of a page of this workspace: the one the page handed over, or what it would have been handed.
    const bridgeCookie = page.cookie ?? `${BRIDGE_COOKIE}=${"ab".repeat(16)}`;
    const token = page.token ?? bridgeToken(SECRET, id, "ab".repeat(16));

    const rest = await gateway.inject(`/w/${id}/toy/api/v1/things/T-1`);
    const client = await getThing(id);
    const bridged = await getThing(id, { [BRIDGE_TOKEN_HEADER]: token, cookie: bridgeCookie });
    const got = { rest: [rest.statusCode, rest.json()], client: [client.status, client.message], bridge: [bridged.status, bridged.message] };
    expect(got.rest).toEqual(doors.has("rest") ? [200, { id: "T-1" }] : [404, NOT_FOUND]);
    expect(got.client[0]).toBe(doors.has("mcp") ? 200 : 404);
    expect(got.bridge[0]).toBe(doors.has("webmcp") ? 200 : 404);
    if (!doors.has("mcp")) expect(got.client[1]).toEqual(NOT_FOUND);
    if (!doors.has("webmcp")) expect(got.bridge[1]).toEqual(NOT_FOUND);
    // The site recorded each read through the door it came through, and nothing of what never reached it.
    expect(await doorsRecorded(id)).toEqual((["rest", "mcp", "webmcp"] as Door[]).filter((d) => doors.has(d)));
  });

  it("counts a token copied out of a page, without the cookie it was minted for, as a direct MCP client, and gives it nothing where that door is closed", async () => {
    const every = await mint();
    const page = await openPage(every);
    await getThing(every, { [BRIDGE_TOKEN_HEADER]: page.token! });
    await getThing(every, { [BRIDGE_TOKEN_HEADER]: page.token!, "x-benchme-door": "webmcp" });
    await getThing(every, { [BRIDGE_TOKEN_HEADER]: page.token!, cookie: page.cookie! });
    expect(await doorsRecorded(every)).toEqual(["mcp", "mcp", "webmcp"]);

    const bridgeOnly = await mint(["webmcp"]);
    const theirs = await openPage(bridgeOnly);
    expect((await getThing(bridgeOnly, { [BRIDGE_TOKEN_HEADER]: theirs.token! })).message).toEqual(NOT_FOUND);
    // Another workspace's page's token and cookie are no bridge of this one's.
    expect((await getThing(bridgeOnly, { [BRIDGE_TOKEN_HEADER]: page.token!, cookie: page.cookie! })).message).toEqual(NOT_FOUND);
    expect(said((await getThing(bridgeOnly, { [BRIDGE_TOKEN_HEADER]: theirs.token!, cookie: theirs.cookie! })).message)).toEqual({ id: "T-1" });
    expect(await doorsRecorded(bridgeOnly)).toEqual(["webmcp"]);
  });

  it("keeps a sign-in made through the page's bridge: the session cookie comes back through the gateway, and later bridge calls are signed in", async () => {
    const id = await mint(["webmcp"]);
    const page = await openPage(id);
    const bridge = (cookies = "") => ({ [BRIDGE_TOKEN_HEADER]: page.token!, cookie: [page.cookie!, cookies].filter(Boolean).join("; ") });
    const call = (name: string, args: Record<string, unknown>, cookies = "") => rpc(id, "tools/call", { name, arguments: args }, bridge(cookies));
    const email = "wren@example.com";
    expect(said((await call("sign_up", { name: "Wren", email, password: "correct-horse-9" })).message)).toMatchObject({ verified: false });
    const code = /code is (\d{6})/.exec(mailer.sent.filter((m) => m.to === email).at(-1)!.body)![1]!;
    expect(said((await call("verify_email", { email, code })).message)).toMatchObject({ verified: true });
    const signIn = await call("sign_in", { email, password: "correct-horse-9" });
    expect(said(signIn.message)).toEqual({ signedIn: true, email });
    const session = String(signIn.setCookie).split(";")[0]!;
    expect(session).toMatch(new RegExp(`^${COOKIE}=[0-9a-f]{48}$`));
    expect(said((await call("whoami", {}, session)).message)).toEqual({ signedIn: true, email });
    // The same session, without the bridge's proof, is a direct client's call: and that door is closed here.
    expect((await rpc(id, "tools/call", { name: "whoami", arguments: {} }, { cookie: session })).message).toEqual(NOT_FOUND);
    expect((await ledger.list(id)).filter((e) => e.kind === "auth").map((e) => [e.door, e.action, e.outcome])).toEqual([
      ["webmcp", "sign_up", "ok"],
      ["webmcp", "verify", "ok"],
      ["webmcp", "sign_in", "ok"],
    ]);
  });

  it("serves the doors the gateway decided, whatever doors header a client sends", async () => {
    const id = await mint([]);
    const forged = { [DOORS_HEADER]: "page,rest,mcp,webmcp", [DOORS_SIG_HEADER]: "0".repeat(64) };
    expect((await gateway.inject({ url: `/w/${id}/toy/api/v1/things/T-1`, headers: forged })).json()).toEqual(NOT_FOUND);
    expect((await openPage(id)).status).toBe(200);
  });
});
