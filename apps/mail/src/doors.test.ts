import { DoorSet, WORKSPACE_HEADER, WORKSPACE_SIG_HEADER, createPool, doorsHeaders, migrate, newWorkspaceId, signWorkspaceHeader, type Door, type Pool } from "@benchme/core";
import { BRIDGE_COOKIE, BRIDGE_TOKEN_HEADER, bridgeToken } from "@benchme/site-kit";
import type { FastifyInstance } from "fastify";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildMail } from "./build-app.js";

// The inbox has no accounts and no ledger, but the same doors as every site: where a workspace is not served through
// one, the inbox is not there through it, and its pages name the bridge only where the WebMCP door is open.

const DB = process.env.DATABASE_URL;
const SECRET = "gateway-secret-for-tests";
const NOT_FOUND = { error: "NOT_FOUND" };
let pool: Pool;
let app: FastifyInstance;
let ws: string;

beforeAll(async () => {
  if (!DB) return;
  pool = createPool(DB, 4);
  await migrate(pool, "core", join(dirname(fileURLToPath(import.meta.url)), "..", "..", "gateway", "migrations"));
  await migrate(pool, "mail", join(dirname(fileURLToPath(import.meta.url)), "..", "migrations"));
  app = await buildMail({ pool, gatewaySecret: SECRET, internalSecret: "internal-secret-for-tests", logLevel: "silent" });
  ws = newWorkspaceId();
  await pool.query("INSERT INTO core.workspaces (id, scenario, seed, expires_at) VALUES ($1, 'acme-v1', 1, now() + interval '1 hour')", [ws]);
});
afterAll(async () => {
  await app?.close();
  await pool?.end();
});

const forwarded = (open: Door[]) => ({ [WORKSPACE_HEADER]: ws, [WORKSPACE_SIG_HEADER]: signWorkspaceHeader(SECRET, ws), "x-forwarded-prefix": `/w/${ws}/mail`, ...doorsHeaders(SECRET, ws, DoorSet.of(open)) });
const listTool = (headers: Record<string, string>) =>
  app.inject({ method: "POST", url: "/mcp", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers }, payload: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_messages", arguments: {} } } });

describe.skipIf(!DB)("the inbox's doors", () => {
  it.each([[[]], [["rest"]], [["mcp"]], [["webmcp"]], [["rest", "mcp", "webmcp"]]] as Door[][][])("serves %j and nothing through a closed door", async (open) => {
    const doors = DoorSet.of(open);
    const headers = forwarded(open);
    const page = await app.inject({ url: "/", headers });
    expect(page.statusCode).toBe(200);
    expect(page.body.includes('data-webmcp="bridge"')).toBe(doors.has("webmcp"));
    const rest = await app.inject({ url: "/api/v1/messages", headers });
    expect(rest.statusCode === 200 ? 200 : [rest.statusCode, rest.json()]).toEqual(doors.has("rest") ? 200 : [404, NOT_FOUND]);
    const client = await listTool(headers);
    expect(client.statusCode).toBe(doors.has("mcp") ? 200 : 404);
    const cookie = "c0ffee00".repeat(4);
    const bridged = await listTool({ ...headers, [BRIDGE_TOKEN_HEADER]: bridgeToken(SECRET, ws, cookie), cookie: `${BRIDGE_COOKIE}=${cookie}` });
    expect(bridged.statusCode).toBe(doors.has("webmcp") ? 200 : 404);
  });

  it("hands the browser its bridge cookie with the page, and its delivery door is no door at all", async () => {
    const page = await app.inject({ url: "/", headers: forwarded(["webmcp"]) });
    expect(String(page.headers["set-cookie"])).toMatch(new RegExp(`^${BRIDGE_COOKIE}=[0-9a-f]{32}; Path=/w/${ws}/mail/; HttpOnly; SameSite=Strict$`));
    // /internal/deliver is the other apps' door to the inbox, keyed by its own secret: no workspace's doors close it.
    expect((await app.inject({ method: "POST", url: "/internal/deliver", payload: {} })).statusCode).toBe(401);
  });
});
