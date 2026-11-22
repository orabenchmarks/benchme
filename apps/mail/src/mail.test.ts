import { WORKSPACE_HEADER, WORKSPACE_SIG_HEADER, createPool, migrate, newWorkspaceId, signWorkspaceHeader, type Pool } from "@benchme/core";
import type { FastifyInstance } from "fastify";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildMail } from "./build-app.js";

const DB = process.env.DATABASE_URL;
const SECRET = "gateway-secret-for-tests";
const INTERNAL = "internal-secret-for-tests";
let pool: Pool;
let app: FastifyInstance;
let ws: string;
let baseUrl = "";

beforeAll(async () => {
  if (!DB) return;
  pool = createPool(DB, 4);
  await migrate(pool, "core", join(dirname(fileURLToPath(import.meta.url)), "..", "..", "gateway", "migrations"));
  await migrate(pool, "mail", join(dirname(fileURLToPath(import.meta.url)), "..", "migrations"));
  app = await buildMail({ pool, gatewaySecret: SECRET, internalSecret: INTERNAL, logLevel: "silent" });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  baseUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  ws = newWorkspaceId();
  await pool.query("INSERT INTO core.workspaces (id, scenario, seed, expires_at) VALUES ($1, 'acme-v1', 1, now() + interval '1 hour')", [ws]);
});
afterAll(async () => {
  await app?.close();
  await pool?.end();
});

const scoped = (wsId: string) => ({ [WORKSPACE_HEADER]: wsId, [WORKSPACE_SIG_HEADER]: signWorkspaceHeader(SECRET, wsId), "x-forwarded-prefix": `/w/${wsId}/mail` });
/** One JSON-RPC request to the inbox's MCP server, as the gateway would forward it: the result. */
async function rpc(wsId: string, method: string, params: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${baseUrl}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...scoped(wsId) }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const text = await res.text();
  const line = text.split("\n").filter((l) => l.startsWith("data:")).pop();
  return (JSON.parse(line ? line.slice(5) : text) as { result: unknown }).result;
}
/** A tool's answer: the JSON it printed. */
const call = async (wsId: string, name: string, args: Record<string, unknown>) => JSON.parse(((await rpc(wsId, "tools/call", { name, arguments: args })) as { content: { text: string }[] }).content[0]!.text);

describe.skipIf(!DB)("mail (real Postgres)", () => {
  it("delivers with the internal secret only, into an existing workspace only", async () => {
    const msg = { workspaceId: ws, from: "no-reply@warehouse.benchme", to: "Ilsa@Example.test", subject: "Your code", body: "code is 123456" };
    expect((await app.inject({ method: "POST", url: "/internal/deliver", payload: msg })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/internal/deliver", headers: { "x-benchme-internal-secret": INTERNAL }, payload: { ...msg, workspaceId: "ws_000000000000" } })).statusCode).toBe(404);
    const ok = await app.inject({ method: "POST", url: "/internal/deliver", headers: { "x-benchme-internal-secret": INTERNAL }, payload: msg });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().to).toBe("ilsa@example.test");
  });

  it("lists and reads per workspace, marking read; other workspaces see nothing", async () => {
    const list = (await app.inject({ url: "/api/v1/messages?to=ilsa@example.test", headers: scoped(ws) })).json();
    expect(list).toHaveLength(1);
    expect(list[0].readAt).toBeNull();
    const one = (await app.inject({ url: `/api/v1/messages/${list[0].id}`, headers: scoped(ws) })).json();
    expect(one.body).toContain("123456");
    expect(one.readAt).not.toBeNull();
    const other = newWorkspaceId();
    await pool.query("INSERT INTO core.workspaces (id, scenario, seed, expires_at) VALUES ($1, 'acme-v1', 1, now() + interval '1 hour')", [other]);
    expect((await app.inject({ url: "/api/v1/messages", headers: scoped(other) })).json()).toEqual([]);
    expect((await app.inject("/api/v1/messages")).statusCode).toBe(401);
  });

  it("renders the inbox UI with prefixed links", async () => {
    const html = (await app.inject({ url: "/", headers: scoped(ws) })).body;
    expect(html).toContain("Your code");
    expect(html).toContain(`href="/w/${ws}/mail/m/`);
  });

  // A site's verification code is mailed here: an agent that only has tools must be able to read it, or signing up through tools would be a dead end.
  it("reads the same inbox through MCP tools, per workspace", async () => {
    const tools = ((await rpc(ws, "tools/list", {})) as { tools: { name: string }[] }).tools.map((t) => t.name);
    expect(tools).toEqual(["list_messages", "get_message"]);
    const viaRest = (await app.inject({ url: "/api/v1/messages?to=ilsa@example.test", headers: scoped(ws) })).json();
    expect(await call(ws, "list_messages", { to: "Ilsa@Example.test" })).toEqual(viaRest);
    expect(await call(ws, "list_messages", {})).toEqual((await app.inject({ url: "/api/v1/messages", headers: scoped(ws) })).json());
    expect(await call(ws, "get_message", { id: viaRest[0].id })).toMatchObject({ id: viaRest[0].id, body: "code is 123456" });
    expect(await call(ws, "get_message", { id: "m_000000000000" })).toEqual({ error: "NOT_FOUND", message: "message m_000000000000 not found" });
    const other = newWorkspaceId();
    await pool.query("INSERT INTO core.workspaces (id, scenario, seed, expires_at) VALUES ($1, 'acme-v1', 1, now() + interval '1 hour')", [other]);
    expect(await call(other, "list_messages", {})).toEqual([]);
    expect(await call(other, "get_message", { id: viaRest[0].id })).toMatchObject({ error: "NOT_FOUND" });
    expect((await fetch(`${baseUrl}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: "{}" })).status).toBe(401);
  });

  it("serves the WebMCP bridge with both tools on the inbox and on a message's page", async () => {
    const id = (await app.inject({ url: "/api/v1/messages", headers: scoped(ws) })).json()[0].id;
    for (const url of ["/", `/m/${id}`, "/m/m_000000000000"]) {
      const html = (await app.inject({ url, headers: scoped(ws) })).body;
      expect([url, html.includes('data-webmcp="bridge"'), html.includes('"name":"list_messages"'), html.includes('"name":"get_message"'), html.includes(`"/w/${ws}/mail/mcp"`)]).toEqual([url, true, true, true, true]);
    }
  });
});
