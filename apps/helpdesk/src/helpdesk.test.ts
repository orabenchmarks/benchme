import { WORKSPACE_HEADER, WORKSPACE_SIG_HEADER, createPool, migrate, newWorkspaceId, signWorkspaceHeader, type Pool } from "@benchme/core";
import { acmeV1, openTicketsFor, scenarios, slaBreaches, type ScenarioRows } from "@benchme/scenarios";
import type { Mailer } from "@benchme/site-kit";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { FastifyInstance, InjectOptions } from "fastify";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildHelpdesk } from "./build-app.js";

const DB = process.env.DATABASE_URL;
const SECRET = "gateway-secret-for-tests";
const here = dirname(fileURLToPath(import.meta.url));

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
  headers: { ...(o.headers ?? {}), [WORKSPACE_HEADER]: wsId, [WORKSPACE_SIG_HEADER]: signWorkspaceHeader(SECRET, wsId), "x-forwarded-prefix": `/w/${wsId}/helpdesk` },
});

async function createWorkspace(seed: number): Promise<string> {
  const id = newWorkspaceId();
  await pool.query("INSERT INTO core.workspaces (id, scenario, seed, expires_at) VALUES ($1, 'acme-v1', $2, now() + interval '1 hour')", [id, seed]);
  expect((await app.inject(scoped({ method: "POST", url: `/internal/workspaces/${id}/seed`, payload: { scenario: "acme-v1", seed } }, id))).statusCode).toBe(201);
  return id;
}

async function token(wsId: string, email: string): Promise<string> {
  const before = mailer.sent.length;
  const enc = encodeURIComponent(email);
  const fh = { "content-type": "application/x-www-form-urlencoded" };
  await app.inject(scoped({ method: "POST", url: "/signup", payload: `name=T&email=${enc}&password=correct-horse-9`, headers: fh }, wsId));
  const code = /code is (\d{6})/.exec(mailer.sent[before]!.body)![1]!;
  await app.inject(scoped({ method: "POST", url: "/verify", payload: `email=${enc}&code=${code}`, headers: fh }, wsId));
  const login = await app.inject(scoped({ method: "POST", url: "/login", payload: `email=${enc}&password=correct-horse-9`, headers: fh }, wsId));
  const cookie = login.cookies.find((c) => c.name === "hd_session")!.value;
  await app.inject(scoped({ method: "POST", url: "/account/token", headers: { cookie: `hd_session=${cookie}` } }, wsId));
  return /hdk_[0-9a-f]+/.exec((await app.inject(scoped({ url: "/account", headers: { cookie: `hd_session=${cookie}` } }, wsId))).body)![0];
}

beforeAll(async () => {
  if (!DB) return;
  pool = createPool(DB, 4);
  await migrate(pool, "core", join(here, "..", "..", "gateway", "migrations"));
  await migrate(pool, "helpdesk", join(here, "..", "migrations"));
  mailer = new CapturingMailer();
  app = await buildHelpdesk({ pool, scenarios, mailer, gatewaySecret: SECRET, sessionTtlSeconds: 3600, logLevel: "silent" });
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

describe.skipIf(!DB)("helpdesk (real Postgres)", () => {
  it("serves seeded tickets that agree with the generator's derived answers", async () => {
    const agent = rows.helpdesk.agents[0]!.code;
    const list = (await app.inject(scoped({ url: `/api/v1/tickets?assignee=${agent}&status=open&limit=200` }))).json() as { items: { ticketNo: string }[] };
    const pending = (await app.inject(scoped({ url: `/api/v1/tickets?assignee=${agent}&status=pending&limit=200` }))).json() as { items: { ticketNo: string }[] };
    expect([...list.items, ...pending.items].map((t) => t.ticketNo).sort()).toEqual(openTicketsFor(rows, agent));
    const breaches = (await app.inject(scoped({ url: "/api/v1/sla/breaches" }))).json() as string[];
    expect(breaches).toEqual(slaBreaches(rows));
  });

  it("enforces the business rules: transitions, assign-before-resolve, closed is final", async () => {
    const tok = await token(ws, "ops@example.test");
    const auth = { authorization: `Bearer ${tok}` };
    const open = rows.helpdesk.tickets.find((t) => t.status === "open" && t.assigneeCode === null)!;
    expect((await app.inject(scoped({ method: "POST", url: `/api/v1/tickets/${open.ticketNo}/status`, payload: { status: "resolved" } }))).statusCode).toBe(401);
    const unassigned = await app.inject(scoped({ method: "POST", url: `/api/v1/tickets/${open.ticketNo}/status`, headers: auth, payload: { status: "resolved" } }));
    expect(unassigned.statusCode).toBe(409);
    expect(unassigned.json().error).toBe("UNASSIGNED");
    expect((await app.inject(scoped({ method: "POST", url: `/api/v1/tickets/${open.ticketNo}/assign`, headers: auth, payload: { agentCode: "AG-99" } }))).statusCode).toBe(422);
    expect((await app.inject(scoped({ method: "POST", url: `/api/v1/tickets/${open.ticketNo}/assign`, headers: auth, payload: { agentCode: rows.helpdesk.agents[1]!.code } }))).statusCode).toBe(200);
    expect((await app.inject(scoped({ method: "POST", url: `/api/v1/tickets/${open.ticketNo}/status`, headers: auth, payload: { status: "closed" } }))).statusCode).toBe(409); // open → closed not allowed
    const resolved = await app.inject(scoped({ method: "POST", url: `/api/v1/tickets/${open.ticketNo}/status`, headers: auth, payload: { status: "resolved" } }));
    expect(resolved.json().status).toBe("resolved");
    expect(resolved.json().resolvedAt).not.toBeNull();
    expect((await app.inject(scoped({ method: "POST", url: `/api/v1/tickets/${open.ticketNo}/status`, headers: auth, payload: { status: "closed" } }))).json().status).toBe("closed");
    const late = await app.inject(scoped({ method: "POST", url: `/api/v1/tickets/${open.ticketNo}/comments`, headers: auth, payload: { body: "too late" } }));
    expect(late.statusCode).toBe(409);
    const created = await app.inject(scoped({ method: "POST", url: "/api/v1/tickets", headers: auth, payload: { subject: "Portal login broken", requester: rows.warehouse.customers[0]!.code, priority: "high" } }));
    expect(created.statusCode).toBe(201);
    expect(created.json().ticketNo).toMatch(/^HD-9/);
    const commented = await app.inject(scoped({ method: "POST", url: `/api/v1/tickets/${created.json().ticketNo}/comments`, headers: auth, payload: { body: "Looking into it", internal: true } }));
    expect(commented.json().comments).toHaveLength(1);
    expect(commented.json().comments[0].author).toBe("ops@example.test");
  });

  it("isolates workspaces and deletes for real", async () => {
    const other = await createWorkspace(4242);
    const tok = await token(ws, "del@example.test");
    const victim = rows.helpdesk.tickets[5]!.ticketNo;
    expect((await app.inject(scoped({ method: "DELETE", url: `/api/v1/tickets/${victim}`, headers: { authorization: `Bearer ${tok}` } }))).json()).toEqual({ deleted: victim });
    expect((await app.inject(scoped({ url: `/api/v1/tickets/${victim}` }))).statusCode).toBe(404);
    expect((await app.inject(scoped({ url: `/api/v1/tickets/${victim}` }, other))).statusCode).toBe(200);
  });

  it("renders the UI and exposes 11 tools over MCP", async () => {
    const fresh = await createWorkspace(4242); // untouched by the write tests above
    const home = await app.inject(scoped({ url: "/" }, fresh));
    expect(home.body).toContain("Helpdesk");
    expect(home.body).toContain("SLA breaches");
    const client = new Client({ name: "test", version: "0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), { requestInit: { headers: { [WORKSPACE_HEADER]: fresh, [WORKSPACE_SIG_HEADER]: signWorkspaceHeader(SECRET, fresh) } } }));
    try {
      const tools = await client.listTools();
      expect(tools.tools).toHaveLength(11);
      expect(tools.tools.find((t) => t.name === "delete_ticket")?.description).toMatch(/PERMANENTLY/);
      const res = await client.callTool({ name: "sla_breaches", arguments: {} });
      expect(JSON.parse((res.content as { text: string }[])[0]!.text)).toEqual(slaBreaches(rows));
      const bad = await client.callTool({ name: "transition_ticket", arguments: { ticketNo: rows.helpdesk.tickets.find((t) => t.status === "closed")!.ticketNo, status: "open" } });
      expect(bad.isError).toBe(true);
    } finally {
      await client.close();
    }
  });
});
