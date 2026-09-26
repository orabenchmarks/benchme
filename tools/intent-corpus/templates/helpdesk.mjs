/**
 * Helpdesk intent templates: tickets to assign, resolve, re-prioritise,
 * comment on, open, hold, reopen, close and reassign (state), and ticket,
 * agent and SLA questions to answer (json). See ./index.mjs for the contract.
 *
 * The write rules these tasks respect live in apps/helpdesk/src/db/
 * tickets-repo.ts: a closed ticket refuses every change; `resolved` needs an
 * assignee; status moves open ⇄ pending → resolved → closed | open.
 */
import { openTicketsFor } from "../../../packages/scenarios/dist/index.js";
import { pick, unique } from "../kit.mjs";

const TICKETS = "/api/v1/tickets";
const PAGES_AND_TOOLS = ["pages", "tools"];
const EVERY_SURFACE = ["pages", "tools", "nlweb"];

const notClosed = (ctx) => ctx.rows.helpdesk.tickets.filter((t) => t.status !== "closed");
const withStatus = (ctx, status) => ctx.rows.helpdesk.tickets.filter((t) => t.status === status);
const detailCheck = (name, ticketNo, expect) => ({ name, app: "helpdesk", path: `${TICKETS}/${ticketNo}`, expect });

const INTERNAL_NOTES = [
  "Customer confirmed the replacement shipped; monitoring until delivery.",
  "Escalated to logistics: the carrier has opened a damage claim.",
  "Awaiting the customer's photos of the damaged goods.",
  "Credit note approved by billing; close once it is issued.",
  "Duplicate of an earlier report; both are linked for tracking.",
  "Called the customer back and walked them through the portal reset.",
];
const CUSTOMER_REPLIES = [
  "Thanks for reporting this. A replacement is on its way and should arrive within three business days.",
  "We have issued a credit note for the damaged items; it will appear on your next statement.",
  "Your portal password has been reset. Please sign in again and tell us if the problem persists.",
  "Our logistics team is looking into this and we will update you by tomorrow.",
];
const NEW_SUBJECTS = [
  "Request for a bulk pricing quote",
  "Invoice shows the wrong billing address",
  "Need a copy of the product safety datasheet",
  "Delivery window change for next week's order",
  "Question about the returns process",
  "Portal access for a new team member",
];
const PRIORITIES = ["low", "normal", "high", "urgent"];

/** A comment body this ticket does not already carry, else the check would pass before the agent writes anything. */
function freshComment(ctx, rng, ticketNo, bodies) {
  const taken = new Set(ctx.commentsOf(ticketNo).map((c) => c.body.trim().toLowerCase()));
  const free = bodies.filter((b) => !taken.has(b.toLowerCase()));
  return free.length ? pick(rng, free) : null;
}

/** A status move: the template for hold / reopen / close, which differ only in from, to and wording. */
function statusMove({ key, from, to, count, intent, about }) {
  return {
    key,
    app: "helpdesk",
    oracle: "state",
    surfaces: PAGES_AND_TOOLS,
    count,
    about,
    candidates: (ctx) => withStatus(ctx, from),
    claims: (t) => [`ticket:${t.ticketNo}`],
    build(t) {
      return {
        intent: intent(t),
        summary: `Ticket ${t.ticketNo} (${from} in the seed) has status ${to}.`,
        oracle: { kind: "state", checks: [detailCheck(`ticket-${to}`, t.ticketNo, { status: to })] },
        note: `${t.ticketNo} ${from} → ${to}`,
        solve: (api) => api.post("helpdesk", `${TICKETS}/${t.ticketNo}/status`, { status: to }),
      };
    },
  };
}

export const helpdeskTemplates = [
  {
    key: "ticket",
    app: "helpdesk",
    oracle: "state",
    surfaces: PAGES_AND_TOOLS,
    count: 4,
    about: "Assign an open or pending ticket to an agent it is not already assigned to, and resolve it (intent-ticket-01's shape). Resolving requires an assignee, so the order of the two steps is part of the task.",
    candidates: (ctx) => ctx.rows.helpdesk.tickets.filter((t) => t.status === "open" || t.status === "pending"),
    claims: (t) => [`ticket:${t.ticketNo}`],
    build(t, ctx, rng) {
      const a = pick(rng, ctx.rows.helpdesk.agents.filter((x) => x.code !== t.assigneeCode));
      return {
        intent: `Assign helpdesk ticket ${t.ticketNo} to agent ${a.name} (${a.code}) and mark it resolved.`,
        summary: `Ticket ${t.ticketNo} assigned to ${a.code} with status resolved.`,
        oracle: { kind: "state", checks: [detailCheck("ticket-assigned-and-resolved", t.ticketNo, { assigneeCode: a.code, status: "resolved" })] },
        note: `${t.ticketNo} (${t.status}, ${t.assigneeCode ?? "unassigned"}) → ${a.code}, resolved`,
        solve: async (api) => {
          await api.post("helpdesk", `${TICKETS}/${t.ticketNo}/assign`, { agentCode: a.code });
          await api.post("helpdesk", `${TICKETS}/${t.ticketNo}/status`, { status: "resolved" });
        },
      };
    },
  },
  {
    key: "priority",
    app: "helpdesk",
    oracle: "state",
    surfaces: PAGES_AND_TOOLS,
    count: 5,
    about: "Change a ticket's priority to one it does not already have (a closed ticket refuses the change, so none is picked).",
    candidates: notClosed,
    claims: (t) => [`ticket:${t.ticketNo}`],
    build(t, ctx, rng) {
      const to = pick(rng, PRIORITIES.filter((p) => p !== t.priority));
      return {
        intent: `Set the priority of helpdesk ticket ${t.ticketNo} ("${t.subject}") to ${to}.`,
        summary: `Ticket ${t.ticketNo} (${t.priority} in the seed) has priority ${to}.`,
        oracle: { kind: "state", checks: [detailCheck("ticket-priority", t.ticketNo, { priority: to })] },
        note: `${t.ticketNo} ${t.priority} → ${to}`,
        solve: (api) => api.post("helpdesk", `${TICKETS}/${t.ticketNo}/priority`, { priority: to }),
      };
    },
  },
  {
    key: "note",
    app: "helpdesk",
    oracle: "state",
    surfaces: PAGES_AND_TOOLS,
    count: 4,
    about: "Add an INTERNAL note with an exact text. The check requires a comment on the ticket's detail row with that body (compared trimmed and case-insensitively) AND `internal: true` — a public reply with the same words fails.",
    candidates: notClosed,
    claims: (t) => [`ticket:${t.ticketNo}`],
    build(t, ctx, rng) {
      const body = freshComment(ctx, rng, t.ticketNo, INTERNAL_NOTES);
      if (!body) return null;
      return {
        intent: `Add an internal note to helpdesk ticket ${t.ticketNo} that reads exactly: "${body}"`,
        summary: `Ticket ${t.ticketNo} carries an internal note with that exact text.`,
        oracle: { kind: "state", checks: [detailCheck("internal-note", t.ticketNo, { comments: { body, internal: true } })] },
        note: `${t.ticketNo} ← internal "${body}"`,
        solve: (api) => api.post("helpdesk", `${TICKETS}/${t.ticketNo}/comments`, { body, internal: true }),
      };
    },
  },
  {
    key: "reply",
    app: "helpdesk",
    oracle: "state",
    surfaces: PAGES_AND_TOOLS,
    count: 3,
    about: "Reply to the customer (a PUBLIC comment) with an exact text — the mirror of `note`: `internal: false` is part of the check.",
    candidates: notClosed,
    claims: (t) => [`ticket:${t.ticketNo}`],
    build(t, ctx, rng) {
      const body = freshComment(ctx, rng, t.ticketNo, CUSTOMER_REPLIES);
      if (!body) return null;
      return {
        intent: `Reply to the customer on helpdesk ticket ${t.ticketNo} with exactly: "${body}"`,
        summary: `Ticket ${t.ticketNo} carries a public reply with that exact text.`,
        oracle: { kind: "state", checks: [detailCheck("customer-reply", t.ticketNo, { comments: { body, internal: false } })] },
        note: `${t.ticketNo} ← public "${body}"`,
        solve: (api) => api.post("helpdesk", `${TICKETS}/${t.ticketNo}/comments`, { body, internal: false }),
      };
    },
  },
  {
    key: "new-ticket",
    app: "helpdesk",
    oracle: "state",
    surfaces: PAGES_AND_TOOLS,
    count: 4,
    about: "Open a ticket on a customer's behalf with a given subject and priority. The check lists the customer's tickets (filtered by requester — no ticket number to predict) and needs one with that subject and priority; the subject is one the customer has never reported.",
    candidates: (ctx) => ctx.rows.warehouse.customers,
    claims: (c) => [`new-ticket:${c.code}`],
    build(c, ctx, rng) {
      const used = new Set(ctx.ticketsBy(c.code).map((t) => t.subject.toLowerCase()));
      const subjects = NEW_SUBJECTS.filter((s) => !used.has(s.toLowerCase()));
      if (!subjects.length) return null;
      const subject = pick(rng, subjects);
      const priority = pick(rng, PRIORITIES);
      return {
        intent: `Open a new helpdesk ticket for customer ${c.name} (${c.code}) with the subject "${subject}" and ${priority} priority.`,
        summary: `A ticket requested by ${c.code} with that subject and priority ${priority}.`,
        oracle: { kind: "state", checks: [{ name: "ticket-opened", app: "helpdesk", path: `${TICKETS}?requester=${c.code}`, where: { requester: c.code, subject }, expect: { priority } }] },
        note: `${c.code} → "${subject}" (${priority})`,
        solve: (api) => api.post("helpdesk", TICKETS, { subject, requester: c.code, priority }),
      };
    },
  },
  statusMove({
    key: "hold",
    from: "open",
    to: "pending",
    count: 3,
    about: "Put an open ticket on hold: status open → pending.",
    intent: (t) => `Put helpdesk ticket ${t.ticketNo} on hold: set its status to pending.`,
  }),
  statusMove({
    key: "reopen",
    from: "resolved",
    to: "open",
    count: 3,
    about: "Reopen a resolved ticket: status resolved → open.",
    intent: (t) => `Reopen helpdesk ticket ${t.ticketNo}.`,
  }),
  statusMove({
    key: "close",
    from: "resolved",
    to: "closed",
    count: 3,
    about: "Close a resolved ticket: status resolved → closed (final — nothing can change it afterwards).",
    intent: (t) => `Close helpdesk ticket ${t.ticketNo}, which is already resolved.`,
  }),
  {
    key: "reassign",
    app: "helpdesk",
    oracle: "state",
    surfaces: PAGES_AND_TOOLS,
    count: 3,
    about: "Move an assigned, not-closed ticket to a different agent.",
    candidates: (ctx) => notClosed(ctx).filter((t) => t.assigneeCode),
    claims: (t) => [`ticket:${t.ticketNo}`],
    build(t, ctx, rng) {
      const from = ctx.agent.get(t.assigneeCode);
      const to = pick(rng, ctx.rows.helpdesk.agents.filter((a) => a.code !== t.assigneeCode));
      return {
        intent: `Reassign helpdesk ticket ${t.ticketNo} from ${from.name} to ${to.name} (${to.code}).`,
        summary: `Ticket ${t.ticketNo} (assigned to ${from.code} in the seed) is assigned to ${to.code}.`,
        oracle: { kind: "state", checks: [detailCheck("ticket-reassigned", t.ticketNo, { assigneeCode: to.code })] },
        note: `${t.ticketNo} ${from.code} → ${to.code}`,
        solve: (api) => api.post("helpdesk", `${TICKETS}/${t.ticketNo}/assign`, { agentCode: to.code }),
      };
    },
  },
  {
    key: "reporter",
    app: "helpdesk",
    oracle: "json",
    surfaces: EVERY_SURFACE,
    count: 3,
    about: "Which customer reported a ticket (intent-reporter-01's shape).",
    candidates: (ctx) => ctx.rows.helpdesk.tickets,
    claims: (t) => [`ticket-read:${t.ticketNo}`],
    build(t) {
      return {
        intent: `Which customer reported helpdesk ticket ${t.ticketNo}? Answer as JSON: {"requester": "<customer code>"}.`,
        summary: `The requester of ${t.ticketNo}.`,
        oracle: { kind: "json", expect: { requester: t.requester } },
        note: `${t.ticketNo} → ${t.requester}`,
        answer: async (api) => ({ requester: (await api.get("helpdesk", `${TICKETS}/${t.ticketNo}`)).requester }),
      };
    },
  },
  {
    key: "ticket-priority",
    app: "helpdesk",
    oracle: "json",
    surfaces: PAGES_AND_TOOLS,
    count: 3,
    about: "A ticket's priority, from the seeded ticket row.",
    candidates: (ctx) => ctx.rows.helpdesk.tickets,
    claims: (t) => [`ticket-read:${t.ticketNo}`],
    build(t) {
      return {
        intent: `What is the priority of helpdesk ticket ${t.ticketNo}? Answer as JSON: {"priority": "<priority>"}.`,
        summary: `The priority of ${t.ticketNo}.`,
        oracle: { kind: "json", expect: { priority: t.priority } },
        note: `${t.ticketNo} → ${t.priority}`,
        answer: async (api) => ({ priority: (await api.get("helpdesk", `${TICKETS}/${t.ticketNo}`)).priority }),
      };
    },
  },
  {
    key: "ticket-status",
    app: "helpdesk",
    oracle: "json",
    surfaces: PAGES_AND_TOOLS,
    count: 3,
    about: "A ticket's status, from the seeded ticket row.",
    candidates: (ctx) => ctx.rows.helpdesk.tickets,
    claims: (t) => [`ticket-read:${t.ticketNo}`],
    build(t) {
      return {
        intent: `What is the status of helpdesk ticket ${t.ticketNo}? Answer as JSON: {"status": "<status>"}.`,
        summary: `The status of ${t.ticketNo}.`,
        oracle: { kind: "json", expect: { status: t.status } },
        note: `${t.ticketNo} → ${t.status}`,
        answer: async (api) => ({ status: (await api.get("helpdesk", `${TICKETS}/${t.ticketNo}`)).status }),
      };
    },
  },
  {
    key: "assignee",
    app: "helpdesk",
    oracle: "json",
    surfaces: PAGES_AND_TOOLS,
    count: 3,
    about: "Which agent an assigned ticket belongs to.",
    candidates: (ctx) => ctx.rows.helpdesk.tickets.filter((t) => t.assigneeCode),
    claims: (t) => [`ticket-read:${t.ticketNo}`],
    build(t) {
      return {
        intent: `Which agent is helpdesk ticket ${t.ticketNo} assigned to? Answer with the agent code as JSON: {"assigneeCode": "<code>"}.`,
        summary: `The assignee of ${t.ticketNo}.`,
        oracle: { kind: "json", expect: { assigneeCode: t.assigneeCode } },
        note: `${t.ticketNo} → ${t.assigneeCode}`,
        answer: async (api) => ({ assigneeCode: (await api.get("helpdesk", `${TICKETS}/${t.ticketNo}`)).assigneeCode }),
      };
    },
  },
  {
    key: "agent-team",
    app: "helpdesk",
    oracle: "json",
    surfaces: EVERY_SURFACE,
    count: 3,
    about: "The team an agent is on, asked by a name no other agent carries.",
    candidates: (ctx) => unique(ctx.rows.helpdesk.agents, (a) => a.name),
    claims: (a) => [`agent-read:${a.code}`],
    build(a) {
      return {
        intent: `Which team is support agent ${a.name} on? Answer as JSON: {"team": "<team>"}.`,
        summary: `The team of ${a.code}.`,
        oracle: { kind: "json", expect: { team: a.team } },
        note: `${a.name} (${a.code}) → ${a.team}`,
        answer: async (api) => ({ team: (await api.get("helpdesk", "/api/v1/agents")).find((x) => x.name === a.name).team }),
      };
    },
  },
  {
    key: "agent-load",
    app: "helpdesk",
    oracle: "json",
    surfaces: PAGES_AND_TOOLS,
    count: 3,
    about: "How many open or pending tickets an agent holds — `openTicketsFor(rows, code)`.",
    candidates: (ctx) => ctx.rows.helpdesk.agents,
    claims: (a) => [`agent-load:${a.code}`],
    build(a, ctx) {
      const count = openTicketsFor(ctx.rows, a.code).length;
      return {
        intent: `How many open or pending helpdesk tickets are currently assigned to ${a.name} (${a.code})? Answer as JSON: {"count": <number>}.`,
        summary: `The number of ${a.code}'s tickets with status open or pending, derived by openTicketsFor().`,
        oracle: { kind: "json", expect: { count } },
        note: `${a.code} → ${count}`,
        answer: async (api) => ({ count: (await api.list("helpdesk", `${TICKETS}?assignee=${a.code}`)).filter((t) => t.status === "open" || t.status === "pending").length }),
      };
    },
  },
  {
    key: "sla",
    app: "helpdesk",
    oracle: "json",
    surfaces: PAGES_AND_TOOLS,
    count: 2,
    about: "The resolution target, in hours, of a ticket priority under the SLA policy.",
    candidates: (ctx) => ctx.rows.helpdesk.slaPolicies,
    claims: (s) => [`sla-read:${s.priority}`],
    build(s) {
      return {
        intent: `Under our support SLA, within how many hours must a ${s.priority}-priority ticket be resolved? Answer as JSON: {"hours": <number>}.`,
        summary: `The resolve target of the ${s.priority} SLA policy.`,
        oracle: { kind: "json", expect: { hours: s.resolveHours } },
        note: `${s.priority} → ${s.resolveHours} h`,
        answer: async (api) => ({ hours: (await api.get("helpdesk", "/api/v1/sla")).find((x) => x.priority === s.priority).resolveHours }),
      };
    },
  },
  {
    key: "comment-count",
    app: "helpdesk",
    oracle: "json",
    surfaces: PAGES_AND_TOOLS,
    count: 2,
    about: "How many comments a ticket carries, internal notes included — asked of tickets with at least two.",
    candidates: (ctx) => ctx.rows.helpdesk.tickets.filter((t) => ctx.commentsOf(t.ticketNo).length >= 2),
    claims: (t) => [`ticket-read:${t.ticketNo}`],
    build(t, ctx) {
      const count = ctx.commentsOf(t.ticketNo).length;
      return {
        intent: `How many comments, internal notes included, does helpdesk ticket ${t.ticketNo} have? Answer as JSON: {"count": <number>}.`,
        summary: `The number of comments on ${t.ticketNo}.`,
        oracle: { kind: "json", expect: { count } },
        note: `${t.ticketNo} → ${count}`,
        answer: async (api) => ({ count: (await api.get("helpdesk", `${TICKETS}/${t.ticketNo}`)).comments.length }),
      };
    },
  },
  {
    key: "requester-tickets",
    app: "helpdesk",
    oracle: "json",
    surfaces: PAGES_AND_TOOLS,
    count: 2,
    about: "How many tickets a customer has reported — asked of customers with at least two.",
    candidates: (ctx) => ctx.rows.warehouse.customers.filter((c) => ctx.ticketsBy(c.code).length >= 2),
    claims: (c) => [`requester-read:${c.code}`],
    build(c, ctx) {
      const count = ctx.ticketsBy(c.code).length;
      return {
        intent: `How many helpdesk tickets has customer ${c.name} (${c.code}) reported? Answer as JSON: {"count": <number>}.`,
        summary: `The number of tickets requested by ${c.code}.`,
        oracle: { kind: "json", expect: { count } },
        note: `${c.code} → ${count}`,
        answer: async (api) => ({ count: (await api.list("helpdesk", `${TICKETS}?requester=${c.code}`)).length }),
      };
    },
  },
];
