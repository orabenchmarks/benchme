import { DomainError, ToolRegistry } from "@benchme/site-kit";
import { z } from "zod";
import type { DocsRepo } from "../docs-repo.js";

export type VaultToolContext = { workspaceId: string; repo: DocsRepo };

/** The vault's three read tools. Resources (docs://{id}) and prompts live in extras.ts. */
export function vaultTools(): ToolRegistry<VaultToolContext> {
  return new ToolRegistry<VaultToolContext>()
    .register({
      name: "list_documents",
      description: "List documents in the vault (id, title, kind, tags). Optionally filter by kind: policy|datasheet|memo|meeting-notes|faq.",
      input: { kind: z.string().optional() },
      handler: (a, c) => c.repo.list(c.workspaceId, a.kind),
    })
    .register({
      name: "search",
      description: "Full-text search over titles and bodies. Returns ranked hits with a snippet; read the full text via get_document or the docs://<id> resource.",
      input: { query: z.string().min(1), limit: z.number().int().min(1).max(50).optional() },
      handler: (a, c) => c.repo.search(c.workspaceId, a.query, a.limit ?? 10),
    })
    .register({
      name: "get_document",
      description: "Read one document by id.",
      input: { id: z.string() },
      handler: async (a, c) => {
        const doc = await c.repo.get(c.workspaceId, a.id);
        if (!doc) throw new DomainError("NOT_FOUND", `no document ${a.id}`, 404);
        return doc;
      },
    });
}
