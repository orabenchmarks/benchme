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

beforeAll(async () => {
  if (!DB) return;
  pool = createPool(DB, 4);
  await migrate(pool, "core", join(dirname(fileURLToPath(import.meta.url)), "..", "..", "gateway", "migrations"));
  await migrate(pool, "mail", join(dirname(fileURLToPath(import.meta.url)), "..", "migrations"));
  app = await buildMail({ pool, gatewaySecret: SECRET, internalSecret: INTERNAL, logLevel: "silent" });
  ws = newWorkspaceId();
  await pool.query("INSERT INTO core.workspaces (id, scenario, seed, expires_at) VALUES ($1, 'acme-v1', 1, now() + interval '1 hour')", [ws]);
});
afterAll(async () => {
  await app?.close();
  await pool?.end();
});

const scoped = (wsId: string) => ({ [WORKSPACE_HEADER]: wsId, [WORKSPACE_SIG_HEADER]: signWorkspaceHeader(SECRET, wsId), "x-forwarded-prefix": `/w/${wsId}/mail` });

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
});
