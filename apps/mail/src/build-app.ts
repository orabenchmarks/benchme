import { WORKSPACE_HEADER, WORKSPACE_SIG_HEADER, createApp, isWorkspaceId, verifyWorkspaceHeader, type Pool } from "@benchme/core";
import { header, registerMcp, registerWorkspaceScope, webmcpBridge } from "@benchme/site-kit";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { mailTools } from "./mcp/tools.js";
import { PgMessagesRepo, type Message, type MessagesRepo } from "./messages-repo.js";

export type BuildDeps = { pool: Pool; gatewaySecret: string; internalSecret: string; logLevel?: string };

const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
/** `scripts` go in verbatim before </body>: the WebMCP bridge. */
const page = (title: string, body: string, scripts = "") =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>${esc(title)} — Inbox</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:56rem;margin:2rem auto;padding:0 1rem;color:#1b1b1b}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:.35em .6em;text-align:left}pre{white-space:pre-wrap;background:#f6f6f6;padding:1em}.unread{font-weight:600}</style></head><body>${body}${scripts}</body></html>`;

/**
 * The workspace inbox: apps deliver over /internal/deliver; users and agents
 * read it through the pages, REST, or the same two reads as MCP tools (and,
 * on the pages, WebMCP tools), so whichever door an agent has, the code a
 * sign-up mails is within reach.
 */
export async function buildMail(d: BuildDeps): Promise<FastifyInstance> {
  const repo: MessagesRepo = new PgMessagesRepo(d.pool);
  const tools = mailTools();
  const app = createApp({ name: "mail", readiness: async () => (await d.pool.query("SELECT 1")).rowCount === 1, ...(d.logLevel ? { logLevel: d.logLevel } : {}) });
  // Everything but /internal/ is scoped by the gateway's signed header.
  registerWorkspaceScope(app, d.gatewaySecret, ["/internal/"]);

  // Internal delivery: any app with the internal secret, workspace named in the body.
  app.post("/internal/deliver", async (req, reply) => {
    if (header(req, "x-benchme-internal-secret") !== d.internalSecret) return reply.code(401).send({ error: "UNAUTHORIZED" });
    const b = z.object({ workspaceId: z.string().refine(isWorkspaceId), from: z.string().min(1), to: z.string().min(3), subject: z.string().min(1), body: z.string() }).parse(req.body);
    const ws = await d.pool.query("SELECT 1 FROM core.workspaces WHERE id = $1", [b.workspaceId]);
    if (!ws.rowCount) return reply.code(404).send({ error: "NO_WORKSPACE" });
    return reply.code(201).send(await repo.deliver(b.workspaceId, b));
  });

  // Gateway-only seed hook: an inbox starts empty, but the gateway calls every seeded app.
  app.post<{ Params: { id: string } }>("/internal/workspaces/:id/seed", async (req, reply) => {
    if (!scoped(req, d.gatewaySecret)) return reply.code(401).send({ error: "NO_WORKSPACE" });
    return reply.code(201).send({ ok: true });
  });

  app.get("/api/v1/messages", async (req) => {
    const q = z.object({ to: z.string().optional(), limit: z.coerce.number().int().min(1).max(500).default(100) }).parse(req.query);
    return repo.list(req.workspaceId, q.to, q.limit);
  });
  app.get<{ Params: { id: string } }>("/api/v1/messages/:id", async (req, reply) => (await repo.get(req.workspaceId, req.params.id, true)) ?? reply.code(404).send({ error: "NOT_FOUND" }));

  app.get("/", async (req, reply) => {
    const to = (req.query as { to?: string }).to;
    const msgs = await repo.list(req.workspaceId, to);
    const rows = msgs.map((m: Message) => `<tr class="${m.readAt ? "" : "unread"}"><td><a href="${req.prefix}/m/${m.id}">${esc(m.subject)}</a></td><td>${esc(m.to)}</td><td>${esc(m.from)}</td><td>${esc(m.receivedAt)}</td></tr>`).join("");
    return reply.type("text/html").send(page("Inbox", `<h1>Workspace inbox</h1><form method="get"><input name="to" placeholder="filter by recipient" value="${esc(to ?? "")}"> <button>Filter</button></form><table><tr><th>Subject</th><th>To</th><th>From</th><th>Received</th></tr>${rows || "<tr><td colspan=4>No messages yet.</td></tr>"}</table>`, webmcpBridge(req, tools)));
  });
  app.get<{ Params: { id: string } }>("/m/:id", async (req, reply) => {
    const m = await repo.get(req.workspaceId, req.params.id, true);
    if (!m) return reply.code(404).type("text/html").send(page("Not found", "<h1>No such message</h1>", webmcpBridge(req, tools)));
    return reply.type("text/html").send(page(m.subject, `<p><a href="${req.prefix}/">← Inbox</a></p><h1>${esc(m.subject)}</h1><p>From ${esc(m.from)} to ${esc(m.to)} at ${esc(m.receivedAt)}</p><pre>${esc(m.body)}</pre>`, webmcpBridge(req, tools)));
  });

  // MCP lives in its own plugin scope: it replaces the content-type parsers for /mcp only.
  await app.register(async (scope) => registerMcp(scope, { serverName: "benchme-mail", version: "0.1.0", tools, context: (workspaceId) => ({ workspaceId, messages: repo }) }));
  return app;
}

function scoped(req: FastifyRequest, secret: string): boolean {
  const id = header(req, WORKSPACE_HEADER);
  const sig = header(req, WORKSPACE_SIG_HEADER);
  return !!id && isWorkspaceId(id) && !!sig && verifyWorkspaceHeader(secret, id, sig);
}
