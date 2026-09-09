import { DomainError, ToolRegistry } from "@benchme/site-kit";
import { z } from "zod";
import type { TicketsRepo } from "../db/tickets-repo.js";

export type ToolContext = { workspaceId: string; tickets: TicketsRepo; actor: string };

const notFound = (what: string) => {
  throw new DomainError("NOT_FOUND", `${what} not found`, 404);
};
const priority = z.enum(["low", "normal", "high", "urgent"]);
const status = z.enum(["open", "pending", "resolved", "closed"]);

/** The helpdesk MCP surface: business rules (transitions, assignment before resolve), error recovery, and one destructive tool. */
export function helpdeskTools(): ToolRegistry<ToolContext> {
  return new ToolRegistry<ToolContext>()
    .register({
      name: "list_tickets",
      description: "List tickets with optional filters: status (open|pending|resolved|closed), assignee agent code, priority, requester customer code, free-text query. Paginated via cursor.",
      input: { status: status.optional(), assignee: z.string().optional(), priority: priority.optional(), requester: z.string().optional(), query: z.string().optional(), cursor: z.string().optional(), limit: z.number().int().min(1).max(100).optional() },
      handler: (a, c) => c.tickets.listTickets(c.workspaceId, { ...(a.status ? { status: a.status } : {}), ...(a.assignee ? { assignee: a.assignee } : {}), ...(a.priority ? { priority: a.priority } : {}), ...(a.requester ? { requester: a.requester } : {}), ...(a.query ? { query: a.query } : {}), ...(a.cursor ? { cursor: a.cursor } : {}), limit: a.limit ?? 25 }),
    })
    .register({
      name: "get_ticket",
      description: "One ticket with its comments, its SLA policy and whether the SLA was breached.",
      input: { ticketNo: z.string() },
      handler: async (a, c) => (await c.tickets.getTicket(c.workspaceId, a.ticketNo)) ?? notFound(`ticket ${a.ticketNo}`),
    })
    .register({
      name: "list_agents",
      description: "Support agents (code, name, team) tickets can be assigned to.",
      input: {},
      handler: (_a, c) => c.tickets.listAgents(c.workspaceId),
    })
    .register({
      name: "get_sla_policies",
      description: "Hours to first response and to resolution, per priority.",
      input: {},
      handler: (_a, c) => c.tickets.listSla(c.workspaceId),
    })
    .register({
      name: "sla_breaches",
      description: "Ticket numbers whose resolution exceeded their priority's SLA.",
      input: {},
      handler: (_a, c) => c.tickets.slaBreaches(c.workspaceId),
    })
    .register({
      name: "create_ticket",
      description: "Open a new ticket for a requester (customer code) with a subject, body and priority.",
      input: { subject: z.string(), body: z.string(), requester: z.string(), priority: priority.default("normal") },
      handler: (a, c) => c.tickets.createTicket(c.workspaceId, a),
    })
    .register({
      name: "add_comment",
      description: "Add a comment to a ticket. internal=true keeps it invisible to the requester. Fails on a closed ticket.",
      input: { ticketNo: z.string(), body: z.string(), internal: z.boolean().default(false) },
      handler: (a, c) => c.tickets.addComment(c.workspaceId, a.ticketNo, c.actor, a.body, a.internal),
    })
    .register({
      name: "assign_ticket",
      description: "Assign a ticket to an agent code (or null to unassign). Fails for an unknown agent or a closed ticket.",
      input: { ticketNo: z.string(), agentCode: z.string().nullable() },
      handler: (a, c) => c.tickets.assign(c.workspaceId, a.ticketNo, a.agentCode),
    })
    .register({
      name: "set_priority",
      description: "Change a ticket's priority.",
      input: { ticketNo: z.string(), priority },
      handler: (a, c) => c.tickets.setPriority(c.workspaceId, a.ticketNo, a.priority),
    })
    .register({
      name: "transition_ticket",
      description: "Move a ticket between statuses. Allowed: open→pending|resolved, pending→open|resolved, resolved→closed|open. Resolving requires an assignee. closed is final.",
      input: { ticketNo: z.string(), status },
      handler: (a, c) => c.tickets.transition(c.workspaceId, a.ticketNo, a.status),
    })
    .register({
      name: "delete_ticket",
      description: "PERMANENTLY delete a ticket and all its comments. Irreversible; there is no undo. Only for spam or duplicates explicitly confirmed by a human.",
      input: { ticketNo: z.string() },
      handler: async (a, c) => {
        await c.tickets.deleteTicket(c.workspaceId, a.ticketNo);
        return { deleted: a.ticketNo };
      },
    });
}
