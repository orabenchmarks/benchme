import { WORKSPACE_HEADER, WORKSPACE_SIG_HEADER, createPool, migrate, newWorkspaceId, signWorkspaceHeader, type Pool } from "@benchme/core";
import { cujV1, scenarios } from "@benchme/scenarios";
import { BRIDGE_COOKIE, BRIDGE_TOKEN_HEADER, bridgeToken } from "@benchme/site-kit";
import type { FastifyInstance } from "fastify";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildMail } from "./build-app.js";
import { heldAddressesOf } from "./mailboxes/held-addresses.js";
import { PgMessagesRepo } from "./messages-repo.js";

/**
 * A cuj-v1 workspace's inbox (private mailboxes) beside a webmcp-v1 one's (shared), the same people in both: mail to
 * someone the rows already hold is stored, and no read returns it, through any door; mail to anyone else reads as it
 * always has. The shared workspace is the control: every read there is today's.
 */

const DB = process.env.DATABASE_URL;
const SECRET = "gateway-secret-for-mailboxes";
const INTERNAL = "internal-secret-for-mailboxes";
const here = dirname(fileURLToPath(import.meta.url));
const rows = cujV1.generate(4242);
const HELD = heldAddressesOf(rows);
/** People the rows hold: an event's organiser (mailed in capitals), a hotel guest, a seeded account (mailed in capitals, between stray spaces). */
const ORGANISER = rows.events.events[0]!.organiserEmail;
const GUEST = rows.hotels.bookings[0]!.guestEmail;
const ACCOUNT = rows.accounts!.flights![0]!.email;
/** A new person a task names: no row holds them. */
const NEWCOMER = "keira.greystone.52953@journeys.example";
const MISSING = "m_000000000000";

let pool: Pool;
let app: FastifyInstance;
let baseUrl = "";
const ws = { private: "", shared: "" };
type Recipient = "organiser" | "guest" | "account" | "newcomer";
/** Per workspace, the ids of the four messages delivered to it, by recipient. */
const ids = { private: {} as Record<Recipient, string>, shared: {} as Record<Recipient, string> };

const scoped = (wsId: string) => ({ [WORKSPACE_HEADER]: wsId, [WORKSPACE_SIG_HEADER]: signWorkspaceHeader(SECRET, wsId), "x-forwarded-prefix": `/w/${wsId}/mail` });
const rest = async (wsId: string, url: string) => {
  const r = await app.inject({ url, headers: scoped(wsId) });
  return { status: r.statusCode, body: r.json() };
};
/** One browser: one bridge cookie, so two renders of a page carry one WebMCP token and compare byte for byte. */
const ONE_BROWSER = "0".repeat(32);
const page = async (wsId: string, url: string) => {
  const r = await app.inject({ url, headers: { ...scoped(wsId), cookie: `${BRIDGE_COOKIE}=${ONE_BROWSER}` } });
  return { status: r.statusCode, html: r.body };
};
/** A tool's answer through the inbox's MCP server, as the gateway forwards it (and as a page's WebMCP bridge calls it, with the page's cookie and token). */
async function tool(wsId: string, name: string, args: Record<string, unknown>, door?: "webmcp"): Promise<unknown> {
  const res = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...scoped(wsId), ...(door ? { cookie: `${BRIDGE_COOKIE}=${ONE_BROWSER}`, [BRIDGE_TOKEN_HEADER]: bridgeToken(SECRET, wsId, ONE_BROWSER) } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  const text = await res.text();
  const line = text.split("\n").filter((l) => l.startsWith("data:")).pop();
  return JSON.parse((JSON.parse(line ? line.slice(5) : text) as { result: { content: { text: string }[] } }).result.content[0]!.text);
}
const deliver = async (wsId: string, to: string, subject: string) => {
  const r = await app.inject({ method: "POST", url: "/internal/deliver", headers: { "x-benchme-internal-secret": INTERNAL }, payload: { workspaceId: wsId, from: "no-reply@events.benchme", to, subject, body: `${subject}: your code is 424242` } });
  expect(r.statusCode).toBe(201);
  return r.json().id as string;
};
const seed = (wsId: string, payload: unknown, headers: Record<string, string> = scoped(wsId), id = wsId) => app.inject({ method: "POST", url: `/internal/workspaces/${id}/seed`, headers, payload: payload as Record<string, unknown> });
const workspace = async (scenario: string) => {
  const id = newWorkspaceId();
  await pool.query("INSERT INTO core.workspaces (id, scenario, seed, expires_at) VALUES ($1, $2, 4242, now() + interval '1 hour')", [id, scenario]);
  return id;
};
const listed = (messages: { id: string }[]) => messages.map((m) => m.id).sort();

beforeAll(async () => {
  if (!DB) return;
  pool = createPool(DB, 4);
  await migrate(pool, "core", join(here, "..", "..", "gateway", "migrations"));
  await migrate(pool, "mail", join(here, "..", "migrations"));
  app = await buildMail({ pool, scenarios, gatewaySecret: SECRET, internalSecret: INTERNAL, logLevel: "silent" });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  baseUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  ws.private = await workspace("cuj-v1");
  ws.shared = await workspace("webmcp-v1");
  for (const kind of ["private", "shared"] as const) {
    expect((await seed(ws[kind], { scenario: kind === "private" ? "cuj-v1" : "webmcp-v1", seed: 4242 })).statusCode).toBe(201);
    // The newcomer's first, so the newest message in each inbox is one to a held address.
    ids[kind].newcomer = await deliver(ws[kind], NEWCOMER, "Newcomer");
    ids[kind].guest = await deliver(ws[kind], GUEST, "Guest");
    ids[kind].account = await deliver(ws[kind], ` ${ACCOUNT.toUpperCase()} `, "Account");
    ids[kind].organiser = await deliver(ws[kind], ORGANISER.toUpperCase(), "Organiser");
  }
});
afterAll(async () => {
  await app?.close();
  await pool?.end();
});

describe.skipIf(!DB)("private mailboxes (real Postgres)", () => {
  it("are what a cuj-v1 seed stores, and a webmcp-v1 seed stores nothing; a re-seed replaces", async () => {
    const stored = async (wsId: string) => (await pool.query<{ address: string }>("SELECT address FROM mail.held_addresses WHERE workspace_id = $1", [wsId])).rows.map((r) => r.address).sort();
    expect(await stored(ws.private)).toEqual(HELD);
    expect(await stored(ws.shared)).toEqual([]);
    expect([HELD.includes(ORGANISER), HELD.includes(GUEST), HELD.includes(ACCOUNT), HELD.includes(NEWCOMER)]).toEqual([true, true, true, false]);
    // Another seed's people, then this seed's again: exactly this seed's are held.
    const other = heldAddressesOf(cujV1.generate(4243));
    expect(other).not.toEqual(HELD);
    expect((await seed(ws.private, { scenario: "cuj-v1", seed: 4243 })).json()).toEqual({ ok: true, mailboxes: "private", held: other.length });
    expect(await stored(ws.private)).toEqual(other);
    expect((await seed(ws.private, { scenario: "cuj-v1", seed: 4242 })).json()).toEqual({ ok: true, mailboxes: "private", held: HELD.length });
    expect(await stored(ws.private)).toEqual(HELD);
    expect((await seed(ws.shared, { scenario: "webmcp-v1", seed: 4242 })).json()).toEqual({ ok: true, mailboxes: "shared", held: 0 });
    expect(await stored(ws.shared)).toEqual([]);
  });

  it("are seeded by the gateway alone, for the workspace it names, of a scenario it knows", async () => {
    expect((await seed(ws.private, { scenario: "cuj-v1", seed: 4242 }, {})).statusCode).toBe(401);
    expect((await seed(ws.private, { scenario: "cuj-v1", seed: 4242 }, { ...scoped(ws.private), [WORKSPACE_SIG_HEADER]: signWorkspaceHeader("another-secret-entirely", ws.private) })).statusCode).toBe(401);
    expect((await seed(ws.private, { scenario: "cuj-v1", seed: 4242 }, scoped(ws.private), ws.shared)).json()).toEqual({ error: "WORKSPACE_MISMATCH" });
    expect((await seed(ws.private, { scenario: "no-such-v9", seed: 4242 })).json()).toEqual({ error: "UNKNOWN_SCENARIO", message: "unknown scenario: no-such-v9" });
    expect((await seed(ws.private, { scenario: "cuj-v1" })).statusCode).toBe(400);
    // A refused seed changes nothing: the private set is whole, the shared one still empty.
    const held = async (wsId: string) => (await pool.query("SELECT count(*)::int AS n FROM mail.held_addresses WHERE workspace_id = $1", [wsId])).rows[0].n;
    expect([await held(ws.private), await held(ws.shared)]).toEqual([HELD.length, 0]);
  });

  it("show, in a shared workspace, every message on every read path, as before", async () => {
    const all = Object.values(ids.shared).sort();
    expect(listed((await rest(ws.shared, "/api/v1/messages")).body)).toEqual(all);
    expect(listed(await tool(ws.shared, "list_messages", {}) as { id: string }[])).toEqual(all);
    expect(listed((await rest(ws.shared, `/api/v1/messages?to=${encodeURIComponent(ORGANISER)}`)).body)).toEqual([ids.shared.organiser]);
    expect(listed(await tool(ws.shared, "list_messages", { to: ORGANISER.toUpperCase() }) as { id: string }[])).toEqual([ids.shared.organiser]);
    expect((await rest(ws.shared, `/api/v1/messages/${ids.shared.organiser}`)).body).toMatchObject({ id: ids.shared.organiser, to: ORGANISER });
    expect(await tool(ws.shared, "get_message", { id: ids.shared.account })).toMatchObject({ id: ids.shared.account, to: ` ${ACCOUNT} ` });
    const inbox = await page(ws.shared, "/");
    expect([inbox.html.includes(ORGANISER), inbox.html.includes(GUEST), inbox.html.includes(NEWCOMER), inbox.html.includes('role="note"')]).toEqual([true, true, true, false]);
    expect((await page(ws.shared, `/m/${ids.shared.guest}`)).status).toBe(200);
  });

  it("hide, in a private workspace, mail to a held address from REST, the tools and the pages, whatever its case", async () => {
    const visible = [ids.private.newcomer];
    expect(listed((await rest(ws.private, "/api/v1/messages")).body)).toEqual(visible);
    expect(listed(await tool(ws.private, "list_messages", {}) as { id: string }[])).toEqual(visible);
    expect(listed(await tool(ws.private, "list_messages", {}, "webmcp") as { id: string }[])).toEqual(visible);
    for (const to of [ORGANISER, ORGANISER.toUpperCase(), GUEST, GUEST.toUpperCase()]) {
      expect([to, (await rest(ws.private, `/api/v1/messages?to=${encodeURIComponent(to)}`)).body]).toEqual([to, []]);
      expect([to, await tool(ws.private, "list_messages", { to })]).toEqual([to, []]);
      expect([to, (await page(ws.private, `/?to=${encodeURIComponent(to)}`)).html.includes("No messages yet.")]).toEqual([to, true]);
    }
    const inbox = await page(ws.private, "/");
    expect([inbox.html.includes(ORGANISER), inbox.html.includes(GUEST), inbox.html.includes(ACCOUNT), inbox.html.includes(NEWCOMER)]).toEqual([false, false, false, true]);
  });

  it("answer a held message asked for by id exactly as a missing one, and never mark it read", async () => {
    const missing = { rest: await rest(ws.private, `/api/v1/messages/${MISSING}`), page: await page(ws.private, `/m/${MISSING}`) };
    expect(missing.rest).toEqual({ status: 404, body: { error: "NOT_FOUND" } });
    for (const id of [ids.private.organiser, ids.private.guest, ids.private.account]) {
      expect([id, await rest(ws.private, `/api/v1/messages/${id}`)]).toEqual([id, missing.rest]);
      expect([id, await page(ws.private, `/m/${id}`)]).toEqual([id, missing.page]);
      expect([id, await tool(ws.private, "get_message", { id })]).toEqual([id, { error: "NOT_FOUND", message: `message ${id} not found` }]);
      expect([id, await tool(ws.private, "get_message", { id }, "webmcp")]).toEqual([id, { error: "NOT_FOUND", message: `message ${id} not found` }]);
    }
    expect(await tool(ws.private, "get_message", { id: MISSING })).toEqual({ error: "NOT_FOUND", message: `message ${MISSING} not found` });
    // The repository's own reads, whichever a door asks for: a held message is in neither, marking read or not.
    const repo = new PgMessagesRepo(pool);
    for (const markRead of [false, true]) expect([markRead, await repo.get(ws.private, ids.private.organiser, markRead)]).toEqual([markRead, null]);
    expect(await repo.get(ws.private, ids.private.newcomer, false)).toMatchObject({ id: ids.private.newcomer, to: NEWCOMER });
    // Nothing is lost: delivery stored all three, and asking for them read none.
    const stored = await pool.query<{ id: string; read_at: Date | null }>("SELECT id, read_at FROM mail.messages WHERE workspace_id = $1 AND id = ANY($2) ORDER BY id", [ws.private, [ids.private.organiser, ids.private.guest, ids.private.account]]);
    expect(stored.rows.map((r) => [r.id, r.read_at]).sort()).toEqual([ids.private.organiser, ids.private.guest, ids.private.account].sort().map((id) => [id, null]));
  });

  it("show, in a private workspace, mail to a new address on every read path", async () => {
    const id = ids.private.newcomer;
    expect(listed((await rest(ws.private, `/api/v1/messages?to=${encodeURIComponent(NEWCOMER.toUpperCase())}`)).body)).toEqual([id]);
    expect(listed(await tool(ws.private, "list_messages", { to: NEWCOMER }) as { id: string }[])).toEqual([id]);
    expect((await page(ws.private, `/?to=${encodeURIComponent(NEWCOMER)}`)).html).toContain(`/w/${ws.private}/mail/m/${id}`);
    expect(await tool(ws.private, "get_message", { id }, "webmcp")).toMatchObject({ id, to: NEWCOMER, body: "Newcomer: your code is 424242" });
    expect((await rest(ws.private, `/api/v1/messages/${id}`)).body).toMatchObject({ id, to: NEWCOMER });
    expect((await page(ws.private, `/m/${id}`)).html).toContain("Newcomer: your code is 424242");
  });

  it("count only what is shown against a list's limit", async () => {
    // The newest message stored in each inbox is the organiser's.
    expect(listed((await rest(ws.private, "/api/v1/messages?limit=1")).body)).toEqual([ids.private.newcomer]);
    expect(listed(await tool(ws.private, "list_messages", { limit: 1 }) as { id: string }[])).toEqual([ids.private.newcomer]);
    expect(listed((await rest(ws.shared, "/api/v1/messages?limit=1")).body)).toEqual([ids.shared.organiser]);
  });

  it("say on the private inbox's page, in one line, where the rest of the mail goes", async () => {
    const note = /<p role="note">([^<]*)<\/p>/;
    expect(note.exec((await page(ws.private, "/")).html)?.[1]).toBe("Mail to people who already exist in this workspace goes to their own mailboxes and is not shown here.");
    expect(note.exec((await page(ws.private, `/?to=${encodeURIComponent(NEWCOMER)}`)).html)).not.toBeNull();
    expect(note.exec((await page(ws.shared, "/")).html)).toBeNull();
  });
});
