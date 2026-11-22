import cookie from "@fastify/cookie";
import { VERIFIER_SIG_HEADER, WORKSPACE_HEADER, WORKSPACE_SIG_HEADER, signVerifierHeader, signWorkspaceHeader } from "@benchme/core";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { AuthService, type Mailer } from "../auth-service.js";
import { ledgerPath } from "../ledger/ledger-route.js";
import { MemoryLedger } from "../ledger/ledger.js";
import { read, unrecorded, write, type LedgerRules } from "../ledger/rules.js";
import { DomainError, registerMcp } from "../mcp-server.js";
import { ToolRegistry } from "../tool-registry.js";
import { MemoryUsersRepo } from "../users-repo.js";
import { registerWorkspaceScope } from "../workspace-scope.js";
import { DOOR_HEADER } from "./door.js";
import { registerDoors } from "./register-doors.js";

const SECRET = "gateway-secret-for-tests";
const COOKIE = "toy_session";
const WS = "ws_0123456789ab";
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

/** The headers the gateway puts on what it forwards. */
const gateway = (ws = WS) => ({ [WORKSPACE_HEADER]: ws, [WORKSPACE_SIG_HEADER]: signWorkspaceHeader(SECRET, ws) });
/** The headers the verifier reads an app with: the gateway's, and its own signature. */
const verifier = (ws = WS) => ({ ...gateway(ws), [VERIFIER_SIG_HEADER]: signVerifierHeader(SECRET, ws) });

async function callTool(name: string, args: Record<string, unknown>, headers: Record<string, string> = {}) {
  const res = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...gateway(), ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  const text = await res.text();
  const line = text.split("\n").filter((l) => l.startsWith("data:")).pop();
  return (JSON.parse(line ? line.slice(5) : text) as { result: { isError?: boolean; content: { text: string }[] } }).result;
}

/** Sign-up, the mailed code, verify, sign in: the session token of a new account, and its api token. */
async function account(email: string) {
  await auth.signup(WS, email, "correct-horse-9", "Ilsa");
  const code = /code is (\d{6})/.exec(mailer.sent.filter((m) => m.to === email).at(-1)!.body)![1]!;
  await auth.verify(WS, email, code);
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
  const doors = registerDoors(app, { ledger, auth, cookie: COOKIE, gatewaySecret: SECRET });
  const things = doors.ledgered<ThingsRepo>(new FakeThings(), RULES);

  app.get("/api/v1/things", async (req) => things.listThings(req.workspaceId));
  app.get<{ Params: { id: string } }>("/api/v1/things/:id", async (req, reply) => (await things.getThing(req.workspaceId, req.params.id)) ?? reply.code(404).send({ error: "NOT_FOUND" }));
  app.get<{ Params: { id: string } }>("/things/:id", async (req, reply) => reply.type("text/html").send(`<h1>${(await things.getThing(req.workspaceId, req.params.id))?.colour ?? "none"}</h1>`));
  const tools = new ToolRegistry<{ workspaceId: string }>().register({ name: "get_thing", description: "One thing.", input: { id: z.string() }, handler: (a, c) => things.getThing(c.workspaceId, a.id) });
  await app.register(async (scope) => registerMcp(scope, { serverName: "toy", version: "0", tools, context: (workspaceId) => ({ workspaceId }) }));
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  baseUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
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
    await callTool("get_thing", { id: "T-1" }, { [DOOR_HEADER]: "webmcp" });
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
