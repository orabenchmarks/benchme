import { createApp, type Pool } from "@benchme/core";
import { UnknownScenarioError, type ScenarioRegistry } from "@benchme/scenarios";
import { esc, registerWorkspaceScope, shell, type ShellCtx } from "@benchme/site-kit";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { PgDocsRepo } from "./docs-repo.js";
import { registerVaultMcp } from "./mcp.js";

export type BuildDeps = { pool: Pool; scenarios: ScenarioRegistry; gatewaySecret: string; logLevel?: string };

/** Read-only document vault: UI + REST + MCP (resources, tools, prompts). No signups. */
export async function buildVaultdocs(d: BuildDeps): Promise<FastifyInstance> {
  const repo = new PgDocsRepo(d.pool);
  const app = createApp({ name: "vaultdocs", readiness: async () => (await d.pool.query("SELECT 1")).rowCount === 1, ...(d.logLevel ? { logLevel: d.logLevel } : {}) });
  registerWorkspaceScope(app, d.gatewaySecret);
  const ctx = (req: FastifyRequest, flash?: string): ShellCtx => ({ site: "Vault", accent: "#2f5d50", prefix: req.prefix, nav: [{ href: "/documents", label: "Documents" }, { href: "/search", label: "Search" }], user: null, flash });

  app.post<{ Params: { id: string } }>("/internal/workspaces/:id/seed", async (req, reply) => {
    if (req.params.id !== req.workspaceId) return reply.code(400).send({ error: "WORKSPACE_MISMATCH" });
    const body = z.object({ scenario: z.string().min(1), seed: z.number().int().positive() }).parse(req.body);
    try {
      const rows = d.scenarios.get(body.scenario).generate(body.seed);
      await repo.seed(req.workspaceId, rows);
      return reply.code(201).send({ ok: true, documents: rows.vault.documents.length });
    } catch (err) {
      if (err instanceof UnknownScenarioError) return reply.code(422).send({ error: "UNKNOWN_SCENARIO", message: err.message });
      throw err;
    }
  });

  app.get("/api/v1/documents", async (req) => repo.list(req.workspaceId, z.object({ kind: z.string().optional() }).parse(req.query).kind));
  app.get<{ Params: { id: string } }>("/api/v1/documents/:id", async (req, reply) => (await repo.get(req.workspaceId, req.params.id)) ?? reply.code(404).send({ error: "NOT_FOUND" }));
  app.get("/api/v1/search", async (req) => {
    const q = z.object({ q: z.string().min(1), limit: z.coerce.number().int().min(1).max(50).default(10) }).parse(req.query);
    return repo.search(req.workspaceId, q.q, q.limit);
  });

  const html = (body: string) => body;
  app.get("/", async (req, reply) => reply.type("text/html").send(html(shell(ctx(req), "Vault", `<h1>Document vault</h1><p>${(await repo.list(req.workspaceId)).length} documents. <a href="${req.prefix}/documents">Browse</a> or <a href="${req.prefix}/search">search</a>.</p><p class="muted">Also available as MCP resources (<code>docs://&lt;id&gt;</code>) with <code>search</code>, <code>get_document</code> and <code>list_documents</code> tools at <code>${esc(req.prefix)}/mcp</code>.</p>`))));
  app.get("/documents", async (req, reply) => {
    const kind = (req.query as { kind?: string }).kind;
    const docs = await repo.list(req.workspaceId, kind);
    const rows = docs.map((x) => `<tr><td><a href="${req.prefix}/documents/${esc(x.id)}">${esc(x.id)}</a></td><td>${esc(x.title)}</td><td>${esc(x.kind)}</td><td>${esc(x.tags.join(", "))}</td><td>${esc(x.updatedAt.slice(0, 10))}</td></tr>`).join("");
    return reply.type("text/html").send(shell(ctx(req), "Documents", `<h1>Documents</h1><table><tr><th>Id</th><th>Title</th><th>Kind</th><th>Tags</th><th>Updated</th></tr>${rows}</table>`));
  });
  app.get<{ Params: { id: string } }>("/documents/:id", async (req, reply) => {
    const doc = await repo.get(req.workspaceId, req.params.id);
    if (!doc) return reply.code(404).type("text/html").send(shell(ctx(req), "Not found", "<h1>No such document</h1>"));
    return reply.type("text/html").send(shell(ctx(req), doc.title, `<h1>${esc(doc.title)}</h1><p class="muted">${esc(doc.id)} · ${esc(doc.kind)} · ${esc(doc.tags.join(", "))} · updated ${esc(doc.updatedAt.slice(0, 10))}</p><p>${esc(doc.body)}</p>`));
  });
  app.get("/search", async (req, reply) => {
    const q = ((req.query as { q?: string }).q ?? "").trim();
    const hits = q ? await repo.search(req.workspaceId, q, 20) : [];
    const rows = hits.map((h) => `<tr><td><a href="${req.prefix}/documents/${esc(h.id)}">${esc(h.id)}</a></td><td>${esc(h.title)}</td><td>${h.snippet}</td></tr>`).join("");
    return reply.type("text/html").send(shell(ctx(req), "Search", `<h1>Search</h1><form method="get" action="${req.prefix}/search"><input name="q" value="${esc(q)}" placeholder="words or &quot;a phrase&quot;" style="width:20rem;display:inline"> <button style="margin:0">Search</button></form>${q ? `<table style="margin-top:1rem"><tr><th>Id</th><th>Title</th><th>Snippet</th></tr>${rows || "<tr><td colspan=3>No matches.</td></tr>"}</table>` : ""}`));
  });

  await app.register(async (scope) => registerVaultMcp(scope, repo));
  return app;
}
