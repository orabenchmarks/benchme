import { comment, person, question, type AskItem } from "@benchme/site-kit";
import type { AgentRow, CommentRow, TicketRow, TicketsRepo } from "../db/tickets-repo.js";

const APP = "helpdesk";

/** Naive plural/singular pair — `tokenize` has no stemming (see warehouse/src/nlweb/items.ts for the same helper). */
function wordVariants(word: string): string[] {
  const w = word.toLowerCase();
  return w.endsWith("s") ? [w, w.slice(0, -1)] : [w, `${w}s`];
}

const RESOLVED_STATUSES: readonly TicketRow["status"][] = ["resolved", "closed"];

/**
 * Every ticket as a Question (the last public comment becomes its
 * `acceptedAnswer` once the ticket is resolved or closed; internal comments
 * never leave the item) and every agent as a Person.
 */
export async function helpdeskItems(tickets: TicketsRepo, ws: string): Promise<AskItem[]> {
  const prefix = `/w/${ws}/${APP}`;
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
    text: t.body,
    keywords: [...wordVariants(t.priority), ...wordVariants(t.status)],
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
