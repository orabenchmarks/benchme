import { VERIFIER_SIG_HEADER, WORKSPACE_HEADER, WORKSPACE_SIG_HEADER, createPool, migrate, newWorkspaceId, signVerifierHeader, signWorkspaceHeader, type Pool } from "@benchme/core";
import { scenarios } from "@benchme/scenarios";
import { BRIDGE_TOKEN_HEADER, CODE_ATTEMPTS, MCP_SESSION_HEADER, type LedgerEntry, type Mailer } from "@benchme/site-kit";
import type { FastifyInstance } from "fastify";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildHotels } from "./build-app.js";

// A six-digit code with no limit on tries can be guessed. Here, on a real site with its own migrations, its ledger and
// its transactions: a pending sign-up's code takes CODE_ATTEMPTS tries, through every door it can be tried at (the
// verify page, a direct MCP client's tool, a page's WebMCP tool), and then stops working until a sign-up again sends a
// new one. The tries are counted in the same transaction the ledger keeps the refusal in, so a refusal does not undo
// its own count.

const DB = process.env.DATABASE_URL;
const SECRET = "gateway-secret-for-tests";
const here = dirname(fileURLToPath(import.meta.url));
const PASSWORD = "correct-horse-9";

class CapturingMailer implements Mailer {
  sent: { to: string; body: string }[] = [];
  async deliver(_ws: string, msg: { to: string; subject: string; body: string }) {
    this.sent.push(msg);
  }
}

let pool: Pool;
let app: FastifyInstance;
let baseUrl = "";
let ws = "";
const mailer = new CapturingMailer();

const gateway = () => ({ [WORKSPACE_HEADER]: ws, [WORKSPACE_SIG_HEADER]: signWorkspaceHeader(SECRET, ws), "x-forwarded-prefix": `/w/${ws}/hotels` });
const form = (url: string, fields: Record<string, string>) =>
  app.inject({ method: "POST", url, headers: { ...gateway(), "content-type": "application/x-www-form-urlencoded" }, payload: new URLSearchParams(fields).toString() });
/** The code last mailed to `email`, and a code that is not it. */
const codeOf = (email: string) => /code is (\d{6})/.exec(mailer.sent.filter((m) => m.to === email).at(-1)!.body)![1]!;
const notIt = (code: string) => `${code.slice(0, 5)}${(Number(code[5]) + 1) % 10}`;
/** A tool call to the site's /mcp, as a client sends it: the tool's answer, as JSON. */
async function tool(name: string, args: Record<string, unknown>, headers: Record<string, string> = {}): Promise<Record<string, unknown>> {
  const res = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...gateway(), ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  const text = await res.text();
  const line = text.split("\n").filter((l) => l.startsWith("data:")).pop();
  const message = JSON.parse(line ? line.slice(5) : text) as { result: { content: { text: string }[] } };
  return JSON.parse(message.result.content[0]!.text) as Record<string, unknown>;
}
/** The verify steps the site's ledger kept for `email`: the door, and what came of each. */
async function verifySteps(email: string): Promise<[string, string][]> {
  const page = await app.inject({ url: `/internal/workspaces/${ws}/ledger?limit=1000`, headers: { ...gateway(), [VERIFIER_SIG_HEADER]: signVerifierHeader(SECRET, ws) } });
  return (page.json().items as LedgerEntry[]).filter((e) => e.action === "verify" && e.entity.id === email).map((e) => [e.door, e.code ?? e.outcome]);
}
const triesSpent = async (email: string) => (await pool.query<{ attempts: number }>("SELECT attempts FROM hotels.verification_codes WHERE workspace_id = $1 AND email = $2", [ws, email])).rows[0]?.attempts ?? null;

beforeAll(async () => {
  if (!DB) return;
  pool = createPool(DB, 4);
  await migrate(pool, "core", join(here, "..", "..", "gateway", "migrations"));
  await migrate(pool, "hotels", join(here, "..", "migrations"));
  app = await buildHotels({ pool, scenarios, mailer, gatewaySecret: SECRET, sessionTtlSeconds: 3600, logLevel: "silent" });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  baseUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  ws = newWorkspaceId();
  await pool.query("INSERT INTO core.workspaces (id, scenario, seed, expires_at) VALUES ($1, 'webmcp-v1', 4242, now() + interval '1 hour')", [ws]);
});
afterAll(async () => {
  await app?.close();
  await pool?.end();
});

describe.skipIf(!DB)("a verification code's tries, on a site (real Postgres)", () => {
  it(`on the pages: refuses even the right code after ${CODE_ATTEMPTS} wrong ones, and the ledger keeps every try`, async () => {
    const email = "pages@example.com";
    expect((await form("/signup", { name: "Pia", email, password: PASSWORD })).statusCode).toBe(200);
    const right = codeOf(email);
    for (let i = 0; i < CODE_ATTEMPTS; i++) {
      const wrong = await form("/verify", { email, code: notIt(right) });
      expect([wrong.statusCode, wrong.body.includes("that code is wrong")]).toEqual([400, true]);
    }
    expect(await triesSpent(email)).toBe(CODE_ATTEMPTS);
    const locked = await form("/verify", { email, code: right });
    expect([locked.statusCode, locked.body.includes("too many wrong codes"), locked.body.includes(`href="/w/${ws}/hotels/signup"`)]).toEqual([429, true, true]);
    expect((await form("/login", { email, password: PASSWORD })).statusCode).toBe(403);
    expect(await verifySteps(email)).toEqual([...Array.from({ length: CODE_ATTEMPTS }, () => ["page", "BAD_CODE"]), ["page", "TOO_MANY_ATTEMPTS"]]);
  });

  it(`through a direct MCP client's tools: takes the right code after ${CODE_ATTEMPTS - 1} wrong ones`, async () => {
    const email = "client@example.com";
    const init = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...gateway() },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "0" } } }),
    });
    const session = { [MCP_SESSION_HEADER]: init.headers.get(MCP_SESSION_HEADER) ?? "" };
    expect(await tool("sign_up", { name: "Cleo", email, password: PASSWORD }, session)).toMatchObject({ verified: false });
    const right = codeOf(email);
    for (let i = 1; i < CODE_ATTEMPTS; i++) expect(await tool("verify_email", { email, code: notIt(right) }, session)).toMatchObject({ error: "BAD_CODE" });
    expect(await tool("verify_email", { email, code: right }, session)).toEqual({ email, verified: true, next: "call sign_in" });
    expect(await tool("sign_in", { email, password: PASSWORD }, session)).toEqual({ signedIn: true, email });
    expect((await verifySteps(email)).map(([door, what]) => `${door} ${what}`)).toEqual([...Array.from({ length: CODE_ATTEMPTS - 1 }, () => "mcp BAD_CODE"), "mcp ok"]);
  });

  it("through a page's WebMCP tools: the same limit, and a sign-up again sends a new code with every try back", async () => {
    const email = "bridge@example.com";
    const page = await app.inject({ url: "/", headers: gateway() });
    const bridge = { [BRIDGE_TOKEN_HEADER]: /"token":"([0-9a-f]+)"/.exec(page.body)![1]!, cookie: String(page.headers["set-cookie"]).split(";")[0]! };
    expect(await tool("sign_up", { name: "Wren", email, password: PASSWORD }, bridge)).toMatchObject({ verified: false });
    const first = codeOf(email);
    for (let i = 0; i < CODE_ATTEMPTS; i++) expect(await tool("verify_email", { email, code: notIt(first) }, bridge)).toMatchObject({ error: "BAD_CODE" });
    expect(await tool("verify_email", { email, code: first }, bridge)).toMatchObject({ error: "TOO_MANY_ATTEMPTS", message: expect.stringMatching(/Sign up again/) });
    expect(await tool("sign_up", { name: "Wren", email, password: PASSWORD }, bridge)).toMatchObject({ verified: false });
    expect(await triesSpent(email)).toBe(0);
    expect(await tool("verify_email", { email, code: codeOf(email) }, bridge)).toMatchObject({ verified: true });
    const steps = await verifySteps(email);
    expect(steps.map(([door]) => door)).toEqual(Array.from({ length: CODE_ATTEMPTS + 2 }, () => "webmcp"));
    expect(steps.map(([, what]) => what)).toEqual([...Array.from({ length: CODE_ATTEMPTS }, () => "BAD_CODE"), "TOO_MANY_ATTEMPTS", "ok"]);
  });

  it(`compares no more than ${CODE_ATTEMPTS} codes however many are tried at once`, async () => {
    const email = "burst@example.com";
    await form("/signup", { name: "Bo", email, password: PASSWORD });
    const right = codeOf(email);
    const burst = await Promise.all(Array.from({ length: 4 * CODE_ATTEMPTS }, () => form("/verify", { email, code: notIt(right) })));
    expect(burst.filter((r) => r.statusCode === 400)).toHaveLength(CODE_ATTEMPTS);
    expect(burst.filter((r) => r.statusCode === 429)).toHaveLength(3 * CODE_ATTEMPTS);
    expect(await triesSpent(email)).toBe(CODE_ATTEMPTS);
    expect((await form("/verify", { email, code: right })).statusCode).toBe(429);
    expect((await verifySteps(email)).filter(([, what]) => what === "BAD_CODE")).toHaveLength(CODE_ATTEMPTS);
  });
});
