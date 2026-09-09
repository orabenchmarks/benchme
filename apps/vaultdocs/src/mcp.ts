import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DocsRepo } from "./docs-repo.js";

/**
 * The vault exercises the protocol beyond tools: documents are MCP RESOURCES
 * (docs://<id>, listed + templated), `search`/`get_document`/`list_documents`
 * are tools, and two PROMPTS package common workflows.
 */
export function buildVaultServer(repo: DocsRepo, ws: string): McpServer {
  const server = new McpServer({ name: "benchme-vaultdocs", version: "0.1.0" });

  server.resource(
    "documents",
    new ResourceTemplate("docs://{id}", {
      list: async () => ({
        resources: (await repo.list(ws)).map((d) => ({ uri: `docs://${d.id}`, name: d.title, description: `${d.kind} · updated ${d.updatedAt.slice(0, 10)}`, mimeType: "text/plain" })),
      }),
    }),
    async (uri, { id }) => {
      const doc = await repo.get(ws, String(id));
      if (!doc) throw new Error(`no document ${String(id)}`);
      return { contents: [{ uri: uri.href, mimeType: "text/plain", text: `# ${doc.title}\n\n${doc.body}\n\n(kind: ${doc.kind}; tags: ${doc.tags.join(", ")}; updated ${doc.updatedAt})` }] };
    },
  );

  server.tool("list_documents", "List documents in the vault (id, title, kind, tags). Optionally filter by kind: policy|datasheet|memo|meeting-notes|faq.", { kind: z.string().optional() }, async ({ kind }) => ({
    content: [{ type: "text", text: JSON.stringify(await repo.list(ws, kind), null, 2) }],
  }));
  server.tool("search", "Full-text search over titles and bodies. Returns ranked hits with a snippet; read the full text via get_document or the docs://<id> resource.", { query: z.string().min(1), limit: z.number().int().min(1).max(50).optional() }, async ({ query, limit }) => ({
    content: [{ type: "text", text: JSON.stringify(await repo.search(ws, query, limit ?? 10), null, 2) }],
  }));
  server.tool("get_document", "Read one document by id.", { id: z.string() }, async ({ id }) => {
    const doc = await repo.get(ws, id);
    if (!doc) return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: "NOT_FOUND", message: `no document ${id}` }) }] };
    return { content: [{ type: "text", text: JSON.stringify(doc, null, 2) }] };
  });

  server.prompt("answer_from_docs", "Answer a question strictly from the vault, citing document ids.", { question: z.string() }, ({ question }) => ({
    messages: [{ role: "user", content: { type: "text", text: `Use the search tool, then read the most relevant documents with get_document. Answer the question below using ONLY those documents, cite each fact as [doc-id], and say "not in the vault" if the documents do not settle it.\n\nQuestion: ${question}` } }],
  }));
  server.prompt("summarize_document", "Summarize one document in three bullet points.", { id: z.string() }, ({ id }) => ({
    messages: [{ role: "user", content: { type: "text", text: `Read docs://${id} and summarize it in exactly three bullet points, keeping every number exact.` } }],
  }));
  return server;
}

export function registerVaultMcp(app: FastifyInstance, repo: DocsRepo): void {
  app.removeAllContentTypeParsers();
  app.addContentTypeParser("*", { parseAs: "buffer" }, (_req, body, done) => done(null, body));
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    try {
      done(null, (body as string).length ? JSON.parse(body as string) : {});
    } catch (err) {
      done(err as Error);
    }
  });
  app.all("/mcp", async (req, reply) => {
    const server = buildVaultServer(repo, req.workspaceId);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    reply.hijack();
    reply.raw.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req.raw, reply.raw, req.body);
  });
}
