import { PgWorkspaceRepo, WORKSPACE_HEADER, WORKSPACE_SIG_HEADER, createPool, migrate, newWorkspaceId, signWorkspaceHeader, type Pool, type Workspace } from "@benchme/core";
import { cujV1, scenarios } from "@benchme/scenarios";
import { HttpMailer } from "@benchme/site-kit";
import type { FastifyInstance } from "fastify";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// The events site and the gateway's seeder themselves, in-process: the site mails its codes to this inbox over the real internal endpoint.
import { buildEvents } from "../../events/src/build-app.js";
import { HttpWorkspaceSeeder } from "../../gateway/src/seeder.js";
import { buildMail } from "./build-app.js";

/**
 * Signing up as someone, end to end: the gateway's seeder seeds the events site and the inbox, the site's sign-up
 * mails its code over HTTP, and an agent looks for it at every door the inbox has. In a cuj-v1 workspace a sign-up
 * as an event's organiser leaves no code to read, so it cannot be finished and nobody signs in as them; a sign-up as
 * a new person does, as it always has. In a webmcp-v1 workspace (shared mailboxes) the organiser's code is there to
 * read, as it always was.
 */

const DB = process.env.DATABASE_URL;
const SECRET = "gateway-secret-for-sign-up-e2e";
const INTERNAL = "internal-secret-for-sign-up-e2e";
const here = dirname(fileURLToPath(import.meta.url));
const rows = cujV1.generate(4242);
/** An organiser with no account on the events site: who a run signed up as, to change the event. */
const event = rows.events.events.find((e) => e.status === "scheduled" && !rows.accounts?.events?.some((a) => a.email === e.organiserEmail))!;
const ORGANISER = event.organiserEmail;
const NEWCOMER = "keira.greystone.52953@journeys.example";
const PASSWORD = "Journey-1234-go";

let pool: Pool;
let mail: FastifyInstance;
let events: FastifyInstance;
let mailUrl = "";
const ws = { private: "", shared: "" };

const urlOf = (app: FastifyInstance) => {
  const addr = app.server.address();
  return `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
};
const scoped = (wsId: string, app: string) => ({ [WORKSPACE_HEADER]: wsId, [WORKSPACE_SIG_HEADER]: signWorkspaceHeader(SECRET, wsId), "x-forwarded-prefix": `/w/${wsId}/${app}` });
/** A form posted to one of the events site's auth pages, as a browser through the gateway posts it. */
const form = (wsId: string, path: string, fields: Record<string, string>) =>
  events.inject({ method: "POST", url: path, headers: { ...scoped(wsId, "events"), "content-type": "application/x-www-form-urlencoded" }, payload: new URLSearchParams(fields).toString() });
const CODE = /\b(\d{6})\b/g;
const codesIn = (text: string) => [...text.matchAll(CODE)].map((m) => m[1] as string);

/** Every verification code for `email` an agent can read in the inbox: REST, the tools, the pages and each message's page. */
async function readable(wsId: string, email: string): Promise<string[]> {
  const found = new Set<string>();
  type Listed = { id: string; to: string; body: string }[];
  const rest = async (url: string) => (await mail.inject({ url, headers: scoped(wsId, "mail") })).json() as Listed;
  const tool = async (args: Record<string, unknown>) => {
    const res = await fetch(`${mailUrl}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...scoped(wsId, "mail") }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_messages", arguments: args } }) });
    const line = (await res.text()).split("\n").filter((l) => l.startsWith("data:")).pop() as string;
    return JSON.parse(JSON.parse(line.slice(5)).result.content[0].text) as Listed;
  };
  const lists = [await rest("/api/v1/messages?limit=500"), await rest(`/api/v1/messages?to=${encodeURIComponent(email)}`), await tool({}), await tool({ to: email })];
  for (const m of lists.flat()) if (m.to.trim().toLowerCase() === email) codesIn(m.body).forEach((c) => found.add(c));
  for (const to of ["", email]) {
    const inbox = (await mail.inject({ url: `/?to=${encodeURIComponent(to)}`, headers: scoped(wsId, "mail") })).body;
    for (const [, id] of inbox.matchAll(/\/mail\/m\/(m_[0-9a-f]+)/g)) {
      const one = (await mail.inject({ url: `/m/${id}`, headers: scoped(wsId, "mail") })).body;
      if (one.toLowerCase().includes(` to ${email} `)) codesIn(one).forEach((c) => found.add(c));
    }
  }
  return [...found];
}
/** The code the site issued, from its own table: what a reader of the right mailbox would have. */
const issued = async (wsId: string, email: string) => (await pool.query<{ code: string }>("SELECT code FROM events.verification_codes WHERE workspace_id = $1 AND email = $2", [wsId, email])).rows[0]?.code;

beforeAll(async () => {
  if (!DB) return;
  pool = createPool(DB, 4);
  await migrate(pool, "core", join(here, "..", "..", "gateway", "migrations"));
  await migrate(pool, "mail", join(here, "..", "migrations"));
  await migrate(pool, "events", join(here, "..", "..", "events", "migrations"));
  mail = await buildMail({ pool, scenarios, gatewaySecret: SECRET, internalSecret: INTERNAL, logLevel: "silent" });
  await mail.listen({ port: 0, host: "127.0.0.1" });
  mailUrl = urlOf(mail);
  events = await buildEvents({ pool, scenarios, mailer: new HttpMailer(mailUrl, INTERNAL, "no-reply@events.benchme"), gatewaySecret: SECRET, sessionTtlSeconds: 3600, logLevel: "silent" });
  await events.listen({ port: 0, host: "127.0.0.1" });
  const target = (name: string, baseUrl: string) => ({ name, baseUrl, seeded: true, mcp: true, ask: false, webmcp: true, listed: false });
  const seeder = new HttpWorkspaceSeeder(() => [target("events", urlOf(events)), target("mail", mailUrl)], SECRET);
  const repo = new PgWorkspaceRepo(pool);
  const create = async (scenario: string): Promise<Workspace> => repo.create({ id: newWorkspaceId(), scenario, seed: 4242, expiresAt: new Date(Date.now() + 3_600_000) });
  for (const [kind, scenario] of [["private", "cuj-v1"], ["shared", "webmcp-v1"]] as const) {
    const w = await create(scenario);
    await seeder.seed(w);
    ws[kind] = w.id;
  }
});
afterAll(async () => {
  await events?.close();
  await mail?.close();
  await pool?.end();
});

describe.skipIf(!DB)("signing up on a site, as someone the workspace holds or as a new person (real Postgres, real HTTP)", () => {
  it("in a cuj-v1 workspace, leaves an organiser's code where no agent can read it, so the sign-up cannot be finished", async () => {
    expect((await form(ws.private, "/signup", { name: "Organiser", email: ORGANISER.toUpperCase(), password: PASSWORD })).statusCode).toBe(200);
    const code = await issued(ws.private, ORGANISER);
    expect(code).toMatch(/^\d{6}$/);
    // Nothing is lost: the inbox stored the mail with the code in it.
    const stored = await pool.query<{ body: string }>("SELECT body FROM mail.messages WHERE workspace_id = $1 AND to_addr = $2", [ws.private, ORGANISER]);
    expect(stored.rows.map((r) => codesIn(r.body))).toEqual([[code]]);
    expect(await readable(ws.private, ORGANISER)).toEqual([]);
    // Unverified, the account signs nobody in: the event stays the organiser's alone.
    expect((await form(ws.private, "/login", { email: ORGANISER, password: PASSWORD })).statusCode).toBe(403);
  });

  it("in a cuj-v1 workspace, leaves a new person's code in the inbox, and they sign up and in", async () => {
    expect((await form(ws.private, "/signup", { name: "Keira Greystone", email: NEWCOMER, password: PASSWORD })).statusCode).toBe(200);
    const code = await issued(ws.private, NEWCOMER);
    expect(await readable(ws.private, NEWCOMER)).toEqual([code]);
    expect((await form(ws.private, "/verify", { email: NEWCOMER, code: code as string })).body).toContain("Email verified");
    const login = await form(ws.private, "/login", { email: NEWCOMER, password: PASSWORD });
    expect([login.statusCode, login.cookies.some((c) => c.name === "ev_session")]).toEqual([303, true]);
  });

  it("in a webmcp-v1 workspace, leaves the organiser's code in the shared inbox, as it always did", async () => {
    expect((await form(ws.shared, "/signup", { name: "Organiser", email: ORGANISER, password: PASSWORD })).statusCode).toBe(200);
    const code = await issued(ws.shared, ORGANISER);
    expect(await readable(ws.shared, ORGANISER)).toEqual([code]);
    expect((await form(ws.shared, "/verify", { email: ORGANISER, code: code as string })).body).toContain("Email verified");
    expect((await form(ws.shared, "/login", { email: ORGANISER, password: PASSWORD })).statusCode).toBe(303);
  });
});
