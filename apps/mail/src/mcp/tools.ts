import { DomainError, ToolRegistry } from "@benchme/site-kit";
import { z } from "zod";
import type { MessagesRepo } from "../messages-repo.js";

export type ToolContext = { workspaceId: string; messages: MessagesRepo };

/**
 * The inbox's MCP surface (and, through the bridge, its WebMCP tools): what
 * its pages and REST show, so a verification code a site mails can be read by
 * an agent that only has tools. Reading is open inside the workspace, as it is
 * at the other doors; nothing here writes.
 */
export function mailTools(): ToolRegistry<ToolContext> {
  return new ToolRegistry<ToolContext>()
    .register({
      name: "list_messages",
      description: "The workspace inbox, newest first: each message's id, sender, recipient, subject, body and when it arrived. Optionally only the messages to one address. A site's verification code arrives here.",
      input: { to: z.string().optional().describe("only messages to this address"), limit: z.number().int().min(1).max(500).optional() },
      handler: (a, c) => c.messages.list(c.workspaceId, a.to || undefined, a.limit ?? 100),
    })
    .register({
      name: "get_message",
      description: "One message by its id (m_…), with its body. Reading it marks it read.",
      input: { id: z.string() },
      handler: async (a, c) => {
        const message = await c.messages.get(c.workspaceId, a.id, true);
        if (!message) throw new DomainError("NOT_FOUND", `message ${a.id} not found`, 404);
        return message;
      },
    });
}
