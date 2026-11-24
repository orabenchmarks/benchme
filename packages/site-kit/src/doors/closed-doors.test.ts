import cookie from "@fastify/cookie";
import { DOORS_HEADER, DOORS_SIG_HEADER, DoorSet, VERIFIER_SIG_HEADER, WORKSPACE_HEADER, WORKSPACE_SIG_HEADER, doorsHeaders, signDoorsHeader, signVerifierHeader, signWorkspaceHeader, type Door } from "@benchme/core";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { registerAuthRoutes } from "../auth-routes.js";
import { AuthService, type Mailer } from "../auth-service.js";
import { shell } from "../html.js";
import { MemoryLedger } from "../ledger/ledger.js";
import { untransacted } from "../ledger/ledgered.js";
import { read, type LedgerRules } from "../ledger/rules.js";
import { registerMcp } from "../mcp-server.js";
import { ToolRegistry } from "../tool-registry.js";
import { MemoryUsersRepo } from "../users-repo.js";
import { WEBMCP_SCRIPT_MARKER, webmcpBridge } from "../webmcp.js";
import { registerWorkspaceScope } from "../workspace-scope.js";
import { BRIDGE_TOKEN_HEADER } from "./bridge-credential.js";
import { registerDoors } from "./register-doors.js";

// A closed door is not there: an app reads its workspace's doors from the gateway's signed header and answers a request
// through a closed one as it answers a path it does not have, before any handler runs. Each case varies the open doors.

const SECRET = "gateway-secret-for-tests";
const COOKIE = "toy_session";
const WS = "ws_0123456789ab";
const OTHER_WS = "ws_ba9876543210";
const NOT_FOUND = { error: "NOT_FOUND" };

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

let app: FastifyInstance;
let baseUrl = "";
let auth: AuthService;
const mailer = new CapturingMailer();
/** A browser that opened one of the site's pages: the bridge cookie it holds, and the token the page embedded. */
let bridgeCookie = "";
let bridgeTokenOfPage = "";
let session = "";

/** What the gateway forwards for a workspace served through `doors` (named, or left out like a gateway from before doors). */
const forwarded = (doors?: DoorSet, ws = WS) => ({ [WORKSPACE_HEADER]: ws, [WORKSPACE_SIG_HEADER]: signWorkspaceHeader(SECRET, ws), "x-forwarded-prefix": `/w/${ws}/toy`, ...(doors ? doorsHeaders(SECRET, ws, doors) : {}) });

/** Every set of the doors a workspace can close (pages are always served): 2 × 2 × 2. */
const SETS: Door[][] = [[], ["rest"], ["mcp"], ["webmcp"], ["rest", "mcp"], ["rest", "webmcp"], ["mcp", "webmcp"], ["rest", "mcp", "webmcp"]];

async function rpc(headers: Record<string, string>, method: string, params: Record<string, unknown>) {
  const res = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const text = await res.text();
  return { status: res.status, text };
}

/** Each way in, as an agent takes it: the status it got, and the body when it was refused. */
const WAYS = {
  page: async (h: Record<string, string>) => app.inject({ url: "/", headers: h }).then((r) => ({ status: r.statusCode, text: r.body })),
  rest: async (h: Record<string, string>) => app.inject({ url: "/api/v1/things/T-1", headers: h }).then((r) => ({ status: r.statusCode, text: r.body })),
  // The REST route spelled with an escape the router decodes: still the REST door.
  restEscaped: async (h: Record<string, string>) => app.inject({ url: "/%61pi/v1/things/T-1", headers: h }).then((r) => ({ status: r.statusCode, text: r.body })),
  mcp: async (h: Record<string, string>) => rpc(h, "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "0" } }),
  bridge: async (h: Record<string, string>) => rpc({ ...h, [BRIDGE_TOKEN_HEADER]: bridgeTokenOfPage, cookie: bridgeCookie }, "tools/call", { name: "get_thing", arguments: { id: "T-1" } }),
};

beforeAll(async () => {
  auth = new AuthService({ users: new MemoryUsersRepo(), mailer, sessionTtlSeconds: 3600, tokenPrefix: "toy", verification: { subject: "Your code", body: (code) => `Your verification code is ${code}.` } });
  app = Fastify();
  await app.register(cookie);
  registerWorkspaceScope(app, SECRET);
  const doors = registerDoors(app, { ledger: new MemoryLedger("toy"), transactions: untransacted, auth, cookie: COOKIE, gatewaySecret: SECRET });
  const things = doors.ledgered<ThingsRepo>({ getThing: async (_ws, id) => (id === "T-1" ? { id } : null) }, RULES);
  const tools = doors.withSignIn(new ToolRegistry<{ workspaceId: string }>().register({ name: "get_thing", description: "One thing.", input: { id: z.string() }, handler: (a, c) => things.getThing(c.workspaceId, a.id) }));
  const shellCtx = async (req: Parameters<typeof webmcpBridge>[0]) => ({
    site: "Toy",
    accent: "#000",
    prefix: req.prefix,
    nav: [],
    user: (await auth.userForSession(req.workspaceId, req.cookies[COOKIE])) ?? null,
    scripts: [webmcpBridge(req, tools)],
  });
  app.get("/", async (req, reply) => reply.type("text/html").send(shell(await shellCtx(req), "Home", "<h1>Toy</h1>")));
  app.get<{ Params: { id: string } }>("/api/v1/things/:id", async (req) => things.getThing(req.workspaceId, req.params.id));
  registerAuthRoutes(app, { auth: doors.auth, cookie: COOKIE, shellCtx });
  await app.register(async (scope) => registerMcp(scope, { serverName: "toy", version: "0", tools, context: (workspaceId) => ({ workspaceId }), sessions: true }));
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  baseUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;

  // A browser opens a page while the WebMCP door is open, and keeps what it handed it.
  const page = await app.inject({ url: "/", headers: forwarded(DoorSet.ALL) });
  bridgeCookie = String(page.headers["set-cookie"]).split(";")[0]!;
  bridgeTokenOfPage = /"token":"([0-9a-f]+)"/.exec(page.body)![1]!;

  await auth.signup(WS, "ilsa@example.com", "correct-horse-9", "Ilsa");
  await auth.verify(WS, "ilsa@example.com", /code is (\d{6})/.exec(mailer.sent.at(-1)!.body)![1]!);
  session = (await auth.login(WS, "ilsa@example.com", "correct-horse-9")).token;
});
afterAll(async () => {
  await app?.close();
});

describe("a closed door, at the app", () => {
  it.each(SETS.map((open) => [open.join(",") || "pages alone", open] as const))("serves %s: every open door, and nothing through a closed one", async (_name, open) => {
    const doors = DoorSet.of(open);
    const headers = forwarded(doors);
    const got = {
      page: await WAYS.page(headers),
      rest: await WAYS.rest(headers),
      restEscaped: await WAYS.restEscaped(headers),
      mcp: await WAYS.mcp(headers),
      bridge: await WAYS.bridge(headers),
    };
    const expected = { page: true, rest: doors.has("rest"), restEscaped: doors.has("rest"), mcp: doors.has("mcp"), bridge: doors.has("webmcp") };
    for (const [way, served] of Object.entries(expected)) {
      const res = got[way as keyof typeof got];
      if (served) expect([way, res.status], res.text).toEqual([way, 200]);
      else expect([way, res.status, JSON.parse(res.text)]).toEqual([way, 404, NOT_FOUND]);
    }
    // A page names the bridge (and with it /mcp and the tools) only where the WebMCP door is open.
    expect(got.page.text.includes(WEBMCP_SCRIPT_MARKER)).toBe(doors.has("webmcp"));
    expect(got.page.text.includes("/mcp")).toBe(doors.has("webmcp"));
  });

  it("leaves the verifier's own reads through: they are no visitor's", async () => {
    const closed = forwarded(DoorSet.of([]));
    const res = await app.inject({ url: "/api/v1/things/T-1", headers: { ...closed, [VERIFIER_SIG_HEADER]: signVerifierHeader(SECRET, WS) } });
    expect([res.statusCode, res.json()]).toEqual([200, { id: "T-1" }]);
    // Only the verifier's signature for this workspace: one made for another is a visitor's like any.
    const crossed = await app.inject({ url: "/api/v1/things/T-1", headers: { ...closed, [VERIFIER_SIG_HEADER]: signVerifierHeader(SECRET, OTHER_WS) } });
    expect([crossed.statusCode, crossed.json()]).toEqual([404, NOT_FOUND]);
  });
});

describe("the gateway's doors header, at the app", () => {
  const rest = (headers: Record<string, string>) => app.inject({ url: "/api/v1/things/T-1", headers }).then((r) => [r.statusCode, r.json()]);
  const NO_WORKSPACE = { error: "NO_WORKSPACE", message: "requests must come through the benchme gateway" };

  it("serves every door when there is none: a gateway from before doors", async () => {
    expect(await rest(forwarded())).toEqual([200, { id: "T-1" }]);
    expect((await WAYS.bridge(forwarded())).status).toBe(200);
  });

  it("refuses, as it refuses a bad workspace header, a list it cannot verify", async () => {
    const signed = doorsHeaders(SECRET, WS, DoorSet.of([]));
    const base = forwarded();
    const cases: [string, Record<string, string>][] = [
      ["a list a client wrote", { ...base, [DOORS_HEADER]: "page,rest,mcp,webmcp", [DOORS_SIG_HEADER]: "0".repeat(64) }],
      ["a signed list, changed", { ...base, ...signed, [DOORS_HEADER]: "page,rest" }],
      ["a list signed for another workspace", { ...base, ...doorsHeaders(SECRET, OTHER_WS, DoorSet.ALL) }],
      ["a list signed with another secret", { ...base, [DOORS_HEADER]: "page,rest", [DOORS_SIG_HEADER]: signDoorsHeader("other-secret", WS, "page,rest") }],
      ["a list without its signature", { ...base, [DOORS_HEADER]: "page,rest,mcp,webmcp" }],
      ["a signature without its list", { ...base, [DOORS_SIG_HEADER]: signed[DOORS_SIG_HEADER] }],
    ];
    for (const [name, headers] of cases) expect([name, ...(await rest(headers))]).toEqual([name, 401, NO_WORKSPACE]);
  });
});

describe("the account page", () => {
  const account = async (doors: DoorSet) => (await app.inject({ url: "/account", headers: { ...forwarded(doors), cookie: `${COOKIE}=${session}` } })).body;
  const newToken = async (doors: DoorSet) => (await app.inject({ method: "POST", url: "/account/token", headers: { ...forwarded(doors), cookie: `${COOKIE}=${session}` } })).statusCode;

  it.each([
    [["rest", "mcp", "webmcp"], ["/api/v1/…", "MCP client", "/mcp"], []],
    [["rest"], ["/api/v1/…"], ["MCP client", "/mcp"]],
    [["mcp"], ["MCP client", "/mcp"], ["/api/v1/…"]],
  ] as [Door[], string[], string[]][])("offers an api token through %j, naming only those doors", async (open, named, unnamed) => {
    const html = await account(DoorSet.of(open));
    expect(html).toContain("<h2>API token</h2>");
    for (const text of named) expect(html).toContain(text);
    for (const text of unnamed) expect(html).not.toContain(text);
    expect(await newToken(DoorSet.of(open))).toBe(303);
  });

  it("offers none where the token would open no door, and refuses to make one", async () => {
    for (const open of [[], ["webmcp"]] as Door[][]) {
      const html = await account(DoorSet.of(open));
      expect(html).toContain("ilsa@example.com");
      expect(html).not.toContain("API token");
      expect(html).not.toContain("/account/token");
      expect(await newToken(DoorSet.of(open))).toBe(404);
    }
    expect((await auth.userForSession(WS, session))?.apiToken ?? null).not.toBeNull();
  });
});
