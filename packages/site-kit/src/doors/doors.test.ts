import cookie from "@fastify/cookie";
import { DoorSet, VERIFIER_SIG_HEADER, WORKSPACE_HEADER, WORKSPACE_SIG_HEADER, doorsHeaders, signVerifierHeader, signWorkspaceHeader } from "@benchme/core";
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { registerAuthRoutes } from "../auth-routes.js";
import { AuthService, type Mailer } from "../auth-service.js";
import { ledgerPath } from "../ledger/ledger-route.js";
import { MemoryLedger } from "../ledger/ledger.js";
import { untransacted } from "../ledger/ledgered.js";
import { read, unrecorded, write, type LedgerRules } from "../ledger/rules.js";
import { DomainError, registerMcp } from "../mcp-server.js";
import { ToolRegistry } from "../tool-registry.js";
import { MemoryUsersRepo } from "../users-repo.js";
import { webmcpBridge } from "../webmcp.js";
import { registerWorkspaceScope } from "../workspace-scope.js";
import { BRIDGE_COOKIE, BRIDGE_TOKEN_HEADER } from "./bridge-credential.js";
import { MCP_SESSION_HEADER, registerDoors } from "./register-doors.js";
import { SIGN_IN_TOOLS } from "./sign-in-tools.js";

const SECRET = "gateway-secret-for-tests";
const COOKIE = "toy_session";
const WS = "ws_0123456789ab";
const PREFIX = `/w/${WS}/toy`;
const OTHER_WS = "ws_ba9876543210";

type Thing = { id: string; colour: string };
/** A site's rules in miniature: a list, a read of one thing, a write. */
interface ThingsRepo {
  listThings(ws: string): Promise<Thing[]>;
  getThing(ws: string, id: string): Promise<Thing | null>;
  paintThing(ws: string, id: string, colour: string): Promise<Thing>;
}
const RULES: LedgerRules<ThingsRepo> = {
  listThings: unrecorded,
  getThing: read("thing", ([id]) => id),
  paintThing: write("thing", "paint", ([id]) => id),
};

class FakeThings implements ThingsRepo {
  private readonly things = new Map<string, Thing>([["T-1", { id: "T-1", colour: "red" }]]);
  async listThings() {
    return [...this.things.values()];
  }
  async getThing(_ws: string, id: string) {
    return this.things.get(id) ?? null;
  }
  async paintThing(_ws: string, id: string, colour: string) {
    const thing = this.things.get(id);
    if (!thing) throw new DomainError("UNKNOWN_THING", `no thing ${id}`, 404);
    if (colour === "invisible") throw new DomainError("NO_SUCH_COLOUR", "pick a colour that exists", 422);
    thing.colour = colour;
    return thing;
  }
}

class CapturingMailer implements Mailer {
  sent: { to: string; body: string }[] = [];
  async deliver(_ws: string, msg: { to: string; subject: string; body: string }) {
    this.sent.push(msg);
  }
}

let app: FastifyInstance;
let baseUrl = "";
let ledger: MemoryLedger;
let auth: AuthService;
const mailer = new CapturingMailer();

/** The headers the gateway puts on what it forwards: the workspace and its prefix, and the workspace's doors when it names them. */
const gateway = (ws = WS, doors?: DoorSet) => ({ [WORKSPACE_HEADER]: ws, [WORKSPACE_SIG_HEADER]: signWorkspaceHeader(SECRET, ws), "x-forwarded-prefix": `/w/${ws}/toy`, ...(doors ? doorsHeaders(SECRET, ws, doors) : {}) });
/** The headers the verifier reads an app with: the gateway's, and its own signature. */
const verifier = (ws = WS) => ({ ...gateway(ws), [VERIFIER_SIG_HEADER]: signVerifierHeader(SECRET, ws) });

/** One JSON-RPC request to /mcp, as any client would send it: the HTTP response, and the message in it. */
async function rpc(method: string, params: Record<string, unknown>, headers: Record<string, string> = {}) {
  const res = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...gateway(), ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const text = await res.text();
  const line = text.split("\n").filter((l) => l.startsWith("data:")).pop();
  return { res, message: JSON.parse(line ? line.slice(5) : text) as { result: { isError?: boolean; content: { text: string }[] } } };
}
const callTool = async (name: string, args: Record<string, unknown>, headers: Record<string, string> = {}) => (await rpc("tools/call", { name, arguments: args }, headers)).message.result;
/** A tool's answer as the caller reads it: the JSON it printed, with `error` the refusal's code, or false for an answer that is no refusal. */
const said = (result: { isError?: boolean; content: { text: string }[] }): Record<string, unknown> => ({ error: false, ...(JSON.parse(result.content[0]!.text) as Record<string, unknown>) });
/** A browser on one of the site's pages: the bridge cookie the page set, and the token the page embedded for it. */
type Browser = { cookie: string; token: string };
let browser: Browser;
/** Opens the site's home page in a fresh browser (no cookie yet), as the gateway forwards it for `ws`: what the page handed it. */
async function openPage(ws = WS): Promise<Browser> {
  const res = await app.inject({ url: "/", headers: gateway(ws) });
  const cookie = String(res.headers["set-cookie"]).split(";")[0]!;
  const token = /"token":"([0-9a-f]+)"/.exec(res.body)![1]!;
  return { cookie, token };
}
/** A page's WebMCP tool calling home: the page's token, and the cookies the browser holds for the site (the bridge cookie, and whatever else). */
const bridge = (cookies = "", b: Browser = browser) => ({ [BRIDGE_TOKEN_HEADER]: b.token, cookie: [b.cookie, cookies].filter(Boolean).join("; ") });
/** A fresh MCP client's connection: the session id `initialize` answers with, as the header to repeat. */
async function connect() {
  const { res } = await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "0" } });
  return { [MCP_SESSION_HEADER]: res.headers.get(MCP_SESSION_HEADER) ?? "" };
}
/** The code the site last mailed to an address. */
const mailedCode = (email: string) => /code is (\d{6})/.exec(mailer.sent.filter((m) => m.to === email).at(-1)!.body)![1]!;
const colourOf = async () => (await app.inject({ url: "/api/v1/things/T-1", headers: verifier() })).json().colour as string;

/** Sign-up, the mailed code, verify, sign in: the session token of a new account, and its api token. */
async function account(email: string) {
  await auth.signup(WS, email, "correct-horse-9", "Ilsa");
  await auth.verify(WS, email, mailedCode(email));
  return { session: (await auth.login(WS, email, "correct-horse-9")).token, apiToken: await auth.issueApiToken(WS, email) };
}
const entries = async (ws = WS) => ledger.list(ws);
const since = async (seq: number) => (await entries()).filter((e) => e.seq > seq);
const lastSeq = async () => (await entries()).at(-1)?.seq ?? 0;

beforeAll(async () => {
  ledger = new MemoryLedger("toy");
  auth = new AuthService({ users: new MemoryUsersRepo(), mailer, sessionTtlSeconds: 3600, tokenPrefix: "toy", verification: { subject: "Your code", body: (code) => `Your verification code is ${code}.` } });
  app = Fastify();
  await app.register(cookie);
  registerWorkspaceScope(app, SECRET);
  const doors = registerDoors(app, { ledger, transactions: untransacted, auth, cookie: COOKIE, gatewaySecret: SECRET });
  const things = doors.ledgered<ThingsRepo>(new FakeThings(), RULES);
  // The routes of a site, as the sites write them: none of them asks who is signed in.
  const refusal = (reply: FastifyReply, err: unknown) => {
    if (err instanceof DomainError) return reply.code(err.status).send({ error: err.code, message: err.message });
    throw err;
  };
  type Paint = { Params: { id: string }; Body: { colour: string } };

  app.get("/api/v1/things", async (req) => things.listThings(req.workspaceId));
  app.get<{ Params: { id: string } }>("/api/v1/things/:id", async (req, reply) => (await things.getThing(req.workspaceId, req.params.id)) ?? reply.code(404).send({ error: "NOT_FOUND" }));
  app.post<Paint>("/api/v1/things/:id/paint", async (req, reply) => things.paintThing(req.workspaceId, req.params.id, req.body.colour).catch((err: unknown) => refusal(reply, err)));
  app.get<{ Params: { id: string } }>("/things/:id", async (req, reply) => reply.type("text/html").send(`<h1>${(await things.getThing(req.workspaceId, req.params.id))?.colour ?? "none"}</h1>`));
  app.post<Paint>("/things/:id/paint", async (req, reply) => {
    try {
      await things.paintThing(req.workspaceId, req.params.id, req.body.colour);
      return reply.redirect(`${req.prefix}/things/${req.params.id}`, 303);
    } catch (err) {
      if (!(err instanceof DomainError)) throw err;
      return reply.code(err.status).type("text/html").send(`<p class="flash">${err.message}</p>`);
    }
  });
  registerAuthRoutes(app, { auth: doors.auth, cookie: COOKIE, shellCtx: async (req) => ({ site: "Toy", accent: "#000", prefix: req.prefix, nav: [], user: null }) });
  const tools = doors.withSignIn(
    new ToolRegistry<{ workspaceId: string }>()
      .register({ name: "get_thing", description: "One thing.", input: { id: z.string() }, handler: (a, c) => things.getThing(c.workspaceId, a.id) })
      .register({ name: "paint_thing", description: "Paint a thing.", input: { id: z.string(), colour: z.string() }, handler: (a, c) => things.paintThing(c.workspaceId, a.id, a.colour) }),
  );
  // The site's home page renders the page's WebMCP bridge, as every site's pages do.
  app.get("/", async (req, reply) => reply.type("text/html").send(`<h1>Toy</h1>${webmcpBridge(req, tools)}`));
  await app.register(async (scope) => registerMcp(scope, { serverName: "toy", version: "0", tools, context: (workspaceId) => ({ workspaceId }), sessions: true }));
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  baseUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  browser = await openPage();
});
afterAll(async () => {
  await app?.close();
});

describe("a site's doors", () => {
  it("enter every request with the door it came through: a page, REST, an MCP client, a page's WebMCP tool", async () => {
    const from = await lastSeq();
    await app.inject({ url: "/things/T-1", headers: gateway() });
    await app.inject({ url: "/api/v1/things/T-1", headers: gateway() });
    await callTool("get_thing", { id: "T-1" });
    await callTool("get_thing", { id: "T-1" }, bridge());
    expect((await since(from)).map((e) => [e.door, e.kind, e.entity.type, e.entity.id, e.outcome])).toEqual([
      ["page", "read", "thing", "T-1", "ok"],
      ["rest", "read", "thing", "T-1", "ok"],
      ["mcp", "read", "thing", "T-1", "ok"],
      ["webmcp", "read", "thing", "T-1", "ok"],
    ]);
  });

  it("name who is signed in on the request: a session cookie, an api token, or nobody", async () => {
    const ilsa = await account("ilsa@example.com");
    const from = await lastSeq();
    await app.inject({ url: "/api/v1/things/T-1", headers: gateway() });
    await app.inject({ url: "/api/v1/things/T-1", headers: { ...gateway(), cookie: `${COOKIE}=${ilsa.session}` } });
    await app.inject({ url: "/api/v1/things/T-1", headers: { ...gateway(), authorization: `Bearer ${ilsa.apiToken}` } });
    await app.inject({ url: "/api/v1/things/T-1", headers: { ...gateway(), cookie: `${COOKIE}=not-a-session` } });
    expect((await since(from)).map((e) => e.actor)).toEqual([null, "ilsa@example.com", "ilsa@example.com", null]);
  });

  it("leave the verifier's own reads out of the ledger", async () => {
    const from = await lastSeq();
    const seen = await app.inject({ url: "/api/v1/things/T-1", headers: verifier() });
    expect(seen.json()).toMatchObject({ id: "T-1" });
    expect(await since(from)).toEqual([]);
    // Only the signature makes a read the verifier's: one made for another workspace is a visitor's read like any other.
    await app.inject({ url: "/api/v1/things/T-1", headers: { ...gateway(), [VERIFIER_SIG_HEADER]: signVerifierHeader(SECRET, OTHER_WS) } });
    expect((await since(from)).map((e) => e.door)).toEqual(["rest"]);
  });
});

// The WebMCP door is the page's bridge, which proves it is one with the page's own cookie. A label any client can write,
// or a token copied out of a page without the cookie it was minted for, is a direct MCP client.
describe("the WebMCP door", () => {
  /** The door the ledger records for one read through /mcp, sent with `headers`. */
  const doorOfRead = async (headers: Record<string, string>) => {
    const from = await lastSeq();
    await callTool("get_thing", { id: "T-1" }, headers);
    return (await since(from)).map((e) => e.door);
  };

  it("is the page's bridge only with the page's token and the cookie it was minted for", async () => {
    const anotherBrowser = await openPage();
    const anotherWorkspace = await openPage(OTHER_WS);
    const cases: [string, Record<string, string>, string][] = [
      ["the page's token and its cookie", bridge(), "webmcp"],
      ["the label the bridge used to send", { "x-benchme-door": "webmcp" }, "mcp"],
      ["the label, with the browser's cookies", { "x-benchme-door": "webmcp", cookie: browser.cookie }, "mcp"],
      ["the token copied out of the page, without its cookie", { [BRIDGE_TOKEN_HEADER]: browser.token }, "mcp"],
      ["the cookie without the token", { cookie: browser.cookie }, "mcp"],
      ["another browser's token, with this one's cookie", { [BRIDGE_TOKEN_HEADER]: anotherBrowser.token, cookie: browser.cookie }, "mcp"],
      ["another workspace's page's token and cookie", bridge("", anotherWorkspace), "mcp"],
      ["a cookie of the right shape and a token for another", { [BRIDGE_TOKEN_HEADER]: browser.token, cookie: `${BRIDGE_COOKIE}=${"0".repeat(32)}` }, "mcp"],
    ];
    for (const [name, headers, door] of cases) expect([name, await doorOfRead(headers)]).toEqual([name, [door]]);
  });

  it("leaves a token copied out of a page nothing to reach where the MCP door is closed; the page's bridge still gets in", async () => {
    const pagesAndBridge = gateway(WS, DoorSet.of(["webmcp"]));
    const from = await lastSeq();
    const copied = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...pagesAndBridge, [BRIDGE_TOKEN_HEADER]: browser.token },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_thing", arguments: { id: "T-1" } } }),
    });
    expect([copied.status, await copied.json()]).toEqual([404, { error: "NOT_FOUND" }]);
    expect(said(await callTool("get_thing", { id: "T-1" }, { ...pagesAndBridge, ...bridge() }))).toMatchObject({ error: false, id: "T-1" });
    expect((await since(from)).map((e) => e.door)).toEqual(["webmcp"]);
  });
});

describe("the ledger's route", () => {
  it("answers the verifier, and tells anyone else there is no such page", async () => {
    await app.inject({ url: "/api/v1/things/T-1", headers: gateway() });
    const page = await app.inject({ url: ledgerPath(WS), headers: verifier() });
    expect(page.statusCode).toBe(200);
    expect(page.json().items).toEqual(await entries());
    expect(page.json().nextCursor).toBeNull();
    // What the gateway would forward (it never does: it does not proxy /internal/workspaces/): the workspace signature alone.
    const visitor = await app.inject({ url: ledgerPath(WS), headers: gateway() });
    expect([visitor.statusCode, visitor.json()]).toEqual([404, { error: "NOT_FOUND" }]);
    // The verifier's signature for one workspace opens no other's ledger.
    const crossed = await app.inject({ url: ledgerPath(OTHER_WS), headers: verifier() });
    expect(crossed.statusCode).toBe(404);
    expect((await app.inject({ url: ledgerPath(WS) })).statusCode).toBe(401);
  });

  it("pages through the entries in order, and shows a workspace only its own", async () => {
    const all = await entries();
    expect(all.length).toBeGreaterThan(3);
    const first = (await app.inject({ url: `${ledgerPath(WS)}?limit=2`, headers: verifier() })).json();
    expect(first.items).toEqual(all.slice(0, 2));
    expect(first.nextCursor).toBe(String(all[1]!.seq));
    const rest = (await app.inject({ url: `${ledgerPath(WS)}?cursor=${first.nextCursor}&limit=1000`, headers: verifier() })).json();
    expect([...first.items, ...rest.items]).toEqual(all);
    expect(rest.nextCursor).toBeNull();
    expect((await app.inject({ url: ledgerPath(OTHER_WS), headers: verifier(OTHER_WS) })).json()).toEqual({ items: [], nextCursor: null });
  });

  it("is the only place the ledger shows: no page, REST answer or tool result of the site carries an entry", async () => {
    const shown = [
      (await app.inject({ url: "/things/T-1", headers: gateway() })).body,
      (await app.inject({ url: "/api/v1/things", headers: gateway() })).body,
      (await app.inject({ url: "/api/v1/things/T-1", headers: gateway() })).body,
      JSON.stringify(await callTool("get_thing", { id: "T-1" })),
    ].join("\n");
    for (const word of ["seq", "outcome", "actor", "door"]) expect(shown).not.toContain(`"${word}"`);
  });
});

// The same sign-in on every door. One thing (T-1), one write (painting it); each case varies the door or who is signed in.
describe("a write through any door", () => {
  const paintRest = (colour: string, headers: Record<string, string> = {}) => app.inject({ method: "POST", url: "/api/v1/things/T-1/paint", payload: { colour }, headers: { ...gateway(), ...headers } });
  const paintPage = (colour: string, headers: Record<string, string> = {}) => app.inject({ method: "POST", url: "/things/T-1/paint", payload: { colour }, headers: { ...gateway(), ...headers } });
  const paintTool = (colour: string, headers: Record<string, string> = {}) => callTool("paint_thing", { id: "T-1", colour }, headers);

  it("is refused for nobody with one reason code, which the ledger records, and each door says so in its own way", async () => {
    const [before, from] = [await colourOf(), await lastSeq()];
    const rest = await paintRest("blue");
    expect([rest.statusCode, rest.json()]).toEqual([401, { error: "UNAUTHORIZED", message: "sign in or send Authorization: Bearer <api token>" }]);
    const page = await paintPage("blue");
    expect([page.statusCode, page.headers.location]).toEqual([302, `${PREFIX}/login`]);
    const mcp = await paintTool("blue");
    expect(mcp.isError).toBe(true);
    expect(said(mcp)).toEqual({ error: "UNAUTHORIZED", message: expect.stringMatching(/sign_up.*verify_email.*sign_in/) });
    const webmcp = await paintTool("blue", bridge());
    expect(webmcp.isError).toBe(true);
    expect(said(webmcp)).toEqual({ error: "UNAUTHORIZED", message: expect.stringMatching(/sign-in page.*sign_up.*verify_email.*sign_in/) });
    expect((await since(from)).map((e) => [e.door, e.kind, e.entity.id, e.action, e.actor, e.outcome, e.code])).toEqual([
      ["rest", "write", "T-1", "paint", null, "refused", "UNAUTHORIZED"],
      ["page", "write", "T-1", "paint", null, "refused", "UNAUTHORIZED"],
      ["mcp", "write", "T-1", "paint", null, "refused", "UNAUTHORIZED"],
      ["webmcp", "write", "T-1", "paint", null, "refused", "UNAUTHORIZED"],
    ]);
    expect(await colourOf()).toBe(before);
  });

  it("goes through for someone signed in, whichever door: the session cookie, or an api token", async () => {
    const ilsa = await account("signed-in@example.com");
    const cookies = `${COOKIE}=${ilsa.session}`;
    const from = await lastSeq();
    expect((await paintRest("green", { cookie: cookies })).statusCode).toBe(200);
    expect((await paintRest("teal", { authorization: `Bearer ${ilsa.apiToken}` })).statusCode).toBe(200);
    expect((await paintPage("amber", { cookie: cookies })).statusCode).toBe(303);
    expect(said(await paintTool("plum", { authorization: `Bearer ${ilsa.apiToken}` }))).toMatchObject({ error: false, colour: "plum" });
    // Signed in on the pages is signed in for the page's own tools: the browser sends the bridge's call the same cookie.
    expect(said(await paintTool("rust", bridge(cookies)))).toMatchObject({ error: false, colour: "rust" });
    expect((await since(from)).map((e) => [e.door, e.actor, e.outcome])).toEqual([
      ["rest", "signed-in@example.com", "ok"],
      ["rest", "signed-in@example.com", "ok"],
      ["page", "signed-in@example.com", "ok"],
      ["mcp", "signed-in@example.com", "ok"],
      ["webmcp", "signed-in@example.com", "ok"],
    ]);
  });

  it("still gets the rule's own refusal once signed in", async () => {
    const { apiToken } = await account("refused@example.com");
    const res = await paintRest("invisible", { authorization: `Bearer ${apiToken}` });
    expect([res.statusCode, res.json().error]).toEqual([422, "NO_SUCH_COLOUR"]);
    expect((await entries()).at(-1)).toMatchObject({ actor: "refused@example.com", outcome: "refused", code: "NO_SUCH_COLOUR" });
  });
});

describe("no door is a dead end", () => {
  it("lists the sign-in tools beside the site's own, to an MCP client and to the page's bridge alike", async () => {
    const listed = ((await rpc("tools/list", {})).message.result as unknown as { tools: { name: string }[] }).tools.map((t) => t.name);
    expect(listed).toEqual(["get_thing", "paint_thing", ...SIGN_IN_TOOLS]);
  });

  it("an agent with only the MCP tools signs up, is mailed its code, verifies, signs in, and then writes as itself", async () => {
    const email = "mcp-only@example.com";
    const session = await connect();
    expect(session[MCP_SESSION_HEADER]).toMatch(/^mcp-[0-9a-f-]{36}$/);
    const from = await lastSeq();
    expect(said(await callTool("paint_thing", { id: "T-1", colour: "white" }, session))).toMatchObject({ error: "UNAUTHORIZED" });
    expect(said(await callTool("whoami", {}, session))).toEqual({ error: false, signedIn: false });
    expect(said(await callTool("sign_up", { name: "Mina", email, password: "correct-horse-9" }, session))).toMatchObject({ error: false, email, verified: false });
    // Signing up signs nobody in, and neither does verifying.
    expect(said(await callTool("sign_in", { email, password: "correct-horse-9" }, session))).toMatchObject({ error: "UNVERIFIED" });
    expect(said(await callTool("verify_email", { email, code: "000000" }, session))).toMatchObject({ error: "BAD_CODE" });
    expect(said(await callTool("verify_email", { email, code: mailedCode(email) }, session))).toMatchObject({ error: false, verified: true });
    expect(said(await callTool("whoami", {}, session))).toEqual({ error: false, signedIn: false });
    expect(said(await callTool("sign_in", { email, password: "wrong-horse-9" }, session))).toMatchObject({ error: "BAD_CREDENTIALS" });
    expect(said(await callTool("sign_in", { email, password: "correct-horse-9" }, session))).toEqual({ error: false, signedIn: true, email });
    expect(said(await callTool("whoami", {}, session))).toEqual({ error: false, signedIn: true, email });
    expect(said(await callTool("paint_thing", { id: "T-1", colour: "white" }, session))).toMatchObject({ error: false, colour: "white" });
    expect((await since(from)).map((e) => [e.door, e.kind, e.entity.type, e.entity.id, e.action, e.actor, e.outcome, e.code])).toEqual([
      ["mcp", "write", "thing", "T-1", "paint", null, "refused", "UNAUTHORIZED"],
      ["mcp", "auth", "account", email, "sign_up", null, "ok", null],
      ["mcp", "auth", "account", email, "sign_in", null, "refused", "UNVERIFIED"],
      ["mcp", "auth", "account", email, "verify", null, "refused", "BAD_CODE"],
      ["mcp", "auth", "account", email, "verify", null, "ok", null],
      ["mcp", "auth", "account", email, "sign_in", null, "refused", "BAD_CREDENTIALS"],
      ["mcp", "auth", "account", email, "sign_in", null, "ok", null],
      ["mcp", "write", "thing", "T-1", "paint", email, "ok", null],
    ]);

    // The sign-in is that connection's own: another client is nobody, and signing out makes this one nobody again.
    expect(said(await callTool("paint_thing", { id: "T-1", colour: "grey" }, await connect()))).toMatchObject({ error: "UNAUTHORIZED" });
    expect(said(await callTool("sign_out", {}, session))).toEqual({ error: false, signedIn: false });
    expect(said(await callTool("paint_thing", { id: "T-1", colour: "grey" }, session))).toMatchObject({ error: "UNAUTHORIZED" });
    expect(await colourOf()).toBe("white");
  });

  it("an agent with only the page's WebMCP tools does the same, and the sign-in comes back as the site's own cookie", async () => {
    const email = "webmcp-only@example.com";
    const from = await lastSeq();
    expect(said(await callTool("sign_up", { name: "Wren", email, password: "correct-horse-9" }, bridge()))).toMatchObject({ error: false, verified: false });
    expect(said(await callTool("verify_email", { email, code: mailedCode(email) }, bridge()))).toMatchObject({ error: false, verified: true });
    const signIn = await rpc("tools/call", { name: "sign_in", arguments: { email, password: "correct-horse-9" } }, bridge());
    expect(said(signIn.message.result)).toEqual({ error: false, signedIn: true, email });
    // The cookie the pages' own sign-in sets: same name, the site's path, not readable by the page's scripts.
    const [setCookie] = signIn.res.headers.getSetCookie();
    expect(setCookie).toMatch(new RegExp(`^${COOKIE}=[0-9a-f]{48}; Path=${PREFIX}/; Expires=[^;]+; HttpOnly; SameSite=Lax$`));
    const cookies = setCookie!.split(";")[0]!;
    expect(said(await callTool("whoami", {}, bridge(cookies)))).toEqual({ error: false, signedIn: true, email });
    expect(said(await callTool("paint_thing", { id: "T-1", colour: "ivory" }, bridge(cookies)))).toMatchObject({ error: false, colour: "ivory" });
    // One session for the browser: the pages and REST take the same cookie.
    expect((await app.inject({ method: "POST", url: "/api/v1/things/T-1/paint", payload: { colour: "jade" }, headers: { ...gateway(), cookie: cookies } })).statusCode).toBe(200);
    expect((await since(from)).filter((e) => e.kind !== "read").map((e) => [e.door, e.kind, e.action, e.actor, e.outcome])).toEqual([
      ["webmcp", "auth", "sign_up", null, "ok"],
      ["webmcp", "auth", "verify", null, "ok"],
      ["webmcp", "auth", "sign_in", null, "ok"],
      ["webmcp", "write", "paint", email, "ok"],
      ["rest", "write", "paint", email, "ok"],
    ]);
    const signOut = await rpc("tools/call", { name: "sign_out", arguments: {} }, bridge(cookies));
    expect(signOut.res.headers.getSetCookie()[0]).toMatch(new RegExp(`^${COOKIE}=; Path=${PREFIX}/; Expires=Thu, 01 Jan 1970`));
    expect(said(await callTool("paint_thing", { id: "T-1", colour: "kiwi" }, bridge(cookies)))).toMatchObject({ error: "UNAUTHORIZED" });
  });

  it("tells a tool call with nothing to stay signed in with how to get it, before any password is checked", async () => {
    await account("sessionless@example.com");
    const from = await lastSeq();
    const refused = said(await callTool("sign_in", { email: "sessionless@example.com", password: "correct-horse-9" }));
    expect(refused).toMatchObject({ error: "NO_SESSION", message: expect.stringMatching(/initialize.*Mcp-Session-Id/) });
    // Something under that header that is not shaped like the ids the site hands out is not a session to keep a sign-in under.
    expect(said(await callTool("sign_in", { email: "sessionless@example.com", password: "correct-horse-9" }, { [MCP_SESSION_HEADER]: "mine" }))).toMatchObject({ error: "NO_SESSION" });
    expect(await since(from)).toEqual([]);
  });

  it("signs the pages' own forms up and in as before, and records each step as the page's", async () => {
    const email = "pages@example.com";
    const from = await lastSeq();
    const form = (url: string, payload: Record<string, string>) => app.inject({ method: "POST", url, payload, headers: gateway() });
    expect((await form("/signup", { name: "Pia", email, password: "correct-horse-9" })).statusCode).toBe(200);
    expect((await form("/verify", { email, code: mailedCode(email) })).statusCode).toBe(200);
    const login = await form("/login", { email, password: "correct-horse-9" });
    expect([login.statusCode, login.cookies.map((c) => c.name)]).toEqual([303, [COOKIE]]);
    expect((await since(from)).map((e) => [e.door, e.kind, e.entity.id, e.action, e.outcome])).toEqual([
      ["page", "auth", email, "sign_up", "ok"],
      ["page", "auth", email, "verify", "ok"],
      ["page", "auth", email, "sign_in", "ok"],
    ]);
  });
});

describe("the MCP server's answers", () => {
  it("still streams to an MCP client, and answers a page's bridge in one JSON body", async () => {
    const client = await rpc("tools/call", { name: "get_thing", arguments: { id: "T-1" } }, await connect());
    expect(client.res.headers.get("content-type")).toMatch(/^text\/event-stream/);
    const page = await rpc("tools/call", { name: "get_thing", arguments: { id: "T-1" } }, bridge());
    expect(page.res.headers.get("content-type")).toMatch(/^application\/json/);
    expect(said(page.message.result)).toEqual(said(client.message.result));
  });

  it("hands out no session id from a server that was not asked to keep sign-ins", async () => {
    const plain = Fastify();
    registerWorkspaceScope(plain, SECRET);
    const tools = new ToolRegistry<{ workspaceId: string }>().register({ name: "ping", description: "Pong.", input: {}, handler: async () => "pong" });
    await plain.register(async (scope) => registerMcp(scope, { serverName: "plain", version: "0", tools, context: (workspaceId) => ({ workspaceId }) }));
    await plain.listen({ port: 0, host: "127.0.0.1" });
    try {
      const addr = plain.server.address();
      const res = await fetch(`http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...gateway() },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "0" } } }),
      });
      expect([res.status, res.headers.get(MCP_SESSION_HEADER), res.headers.get("content-type")]).toEqual([200, null, "text/event-stream"]);
    } finally {
      await plain.close();
    }
  });
});
