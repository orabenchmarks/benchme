import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { VaultToolContext } from "./tools.js";

/**
 * The vault exercises the protocol beyond tools: documents are MCP RESOURCES
 * (docs://<id>, listed + templated), and two PROMPTS package common
 * workflows. Registered via McpDeps.extras, after the tool loop.
 */
export function vaultExtras(server: McpServer, ctx: VaultToolContext): void {
  const { repo, workspaceId } = ctx;

  server.resource(
    "documents",
    new ResourceTemplate("docs://{id}", {
      list: async () => ({
        resources: (await repo.list(workspaceId)).map((d) => ({ uri: `docs://${d.id}`, name: d.title, description: `${d.kind} · updated ${d.updatedAt.slice(0, 10)}`, mimeType: "text/plain" })),
      }),
    }),
    async (uri, { id }) => {
      const doc = await repo.get(workspaceId, String(id));
      if (!doc) throw new Error(`no document ${String(id)}`);
      return { contents: [{ uri: uri.href, mimeType: "text/plain", text: `# ${doc.title}\n\n${doc.body}\n\n(kind: ${doc.kind}; tags: ${doc.tags.join(", ")}; updated ${doc.updatedAt})` }] };
    },
  );

  server.prompt("answer_from_docs", "Answer a question strictly from the vault, citing document ids.", { question: z.string() }, ({ question }) => ({
    messages: [{ role: "user", content: { type: "text", text: `Use the search tool, then read the most relevant documents with get_document. Answer the question below using ONLY those documents, cite each fact as [doc-id], and say "not in the vault" if the documents do not settle it.\n\nQuestion: ${question}` } }],
  }));
  server.prompt("summarize_document", "Summarize one document in three bullet points.", { id: z.string() }, ({ id }) => ({
    messages: [{ role: "user", content: { type: "text", text: `Read docs://${id} and summarize it in exactly three bullet points, keeping every number exact.` } }],
  }));
}
