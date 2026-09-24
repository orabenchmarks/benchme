import { comment, person, question, wordVariants, type AskItem } from "@benchme/site-kit";
import type { AgentRow, CommentRow, TicketRow, TicketsRepo } from "../db/tickets-repo.js";

const RESOLVED_STATUSES: readonly TicketRow["status"][] = ["resolved", "closed"];

/**
 * Every ticket as a Question (the last public comment becomes its
 * `acceptedAnswer` once the ticket is resolved or closed; internal comments
 * never leave the item) and every agent as a Person.
 *
 * `prefix` is the caller's request-time `req.prefix`, NOT re-derived from
 * `ws` — see warehouse/src/nlweb/items.ts's doc comment for why.
 */
export async function helpdeskItems(tickets: TicketsRepo, ws: string, prefix: string): Promise<AskItem[]> {
  const [page, agents, allComments] = await Promise.all([tickets.listTickets(ws, { limit: 1000 }), tickets.listAgents(ws), tickets.listAllComments(ws)]);
  const agentByCode = new Map(agents.map((a) => [a.code, a]));
  const commentsByTicket = new Map<string, CommentRow[]>();
  for (const c of allComments) commentsByTicket.set(c.ticketNo, [...(commentsByTicket.get(c.ticketNo) ?? []), c]);

  const ticketItems = page.items.map((t) => ticketItem(prefix, t, commentsByTicket.get(t.ticketNo) ?? [], agentByCode));
  const agentItems = agents.map((a) => agentItem(prefix, a));
  return [...ticketItems, ...agentItems];
}

/** The display name for a comment/resolution author: an agent code resolves to their name; "customer" stays as-is. */
function authorName(code: string, agentByCode: Map<string, AgentRow>): string {
  return agentByCode.get(code)?.name ?? code;
}

function ticketItem(prefix: string, t: TicketRow, comments: CommentRow[], agentByCode: Map<string, AgentRow>): AskItem {
  const url = `${prefix}/tickets/${t.ticketNo}`;
  const visible = comments.filter((c) => !c.internal);
  const resolution = RESOLVED_STATUSES.includes(t.status) ? visible.at(-1) : undefined;
  return {
    id: url,
    url,
    name: t.subject,
    // The ticket number leads the searchable text: it is how people ask for a ticket.
    text: `Ticket ${t.ticketNo}. ${t.body}`,
    keywords: [t.ticketNo.toLowerCase(), ...wordVariants(t.priority), ...wordVariants(t.status)],
    schema: question({
      id: url,
      url,
      name: t.subject,
      text: t.body,
      dateCreated: t.openedAt,
      author: t.requester,
      ...(resolution ? { answer: { text: resolution.body, dateCreated: resolution.createdAt, author: authorName(resolution.author, agentByCode) } } : {}),
      comments: visible.map((c) => comment({ id: `${url}#c${c.seq}`, url, text: c.body, dateCreated: c.createdAt, author: authorName(c.author, agentByCode) })),
    }),
  };
}

function agentItem(prefix: string, a: AgentRow): AskItem {
  const url = `${prefix}/agents#${a.code}`;
  const text = `${a.name} is a support agent on the ${a.team} team.`;
  return {
    id: url,
    url,
    name: a.name,
    text,
    keywords: ["agent", "agents", a.team],
    schema: person({ id: url, url, name: a.name, jobTitle: `Support agent, ${a.team}` }),
  };
}
