import { esc } from "@benchme/site-kit";
import type { AgentRow, SlaRow, TicketDetail, TicketRow } from "../db/tickets-repo.js";

const tag = (s: string) => `<span class="tag">${esc(s)}</span>`;

export function dashboard(p: string, counts: { open: number; pending: number; unassigned: number; breaches: number }): string {
  return `<h1>Helpdesk</h1><table><tr><th>Open</th><th>Pending</th><th>Unassigned</th><th>SLA breaches</th></tr>
<tr><td>${counts.open}</td><td>${counts.pending}</td><td>${counts.unassigned}</td><td>${counts.breaches}</td></tr></table>
<p class="muted">Browse <a href="${p}/tickets">tickets</a>, see the <a href="${p}/agents">agents</a> and the <a href="${p}/sla">SLA policy</a>. Sign in to work tickets.</p>`;
}

export function ticketsList(p: string, items: TicketRow[], nextCursor: string | null, f: Record<string, string | undefined>): string {
  const rows = items
    .map((t) => `<tr><td><a href="${p}/tickets/${esc(t.ticketNo)}">${esc(t.ticketNo)}</a></td><td>${esc(t.subject)}</td><td>${esc(t.requester)}</td><td>${tag(t.priority)}</td><td>${tag(t.status)}</td><td>${esc(t.assigneeCode ?? "—")}</td><td>${esc(t.openedAt.slice(0, 10))}</td></tr>`)
    .join("");
  const keep = Object.entries(f).filter(([, v]) => v).map(([k, v]) => `&${k}=${esc(v)}`).join("");
  const next = nextCursor ? `<nav class="pager"><a href="${p}/tickets?cursor=${esc(nextCursor)}${keep}">Next page →</a></nav>` : "";
  return `<h1>Tickets</h1>
<form method="get" action="${p}/tickets" style="margin-bottom:1rem"><input name="query" placeholder="search" value="${esc(f.query ?? "")}" style="width:14rem;display:inline">
<select name="status" style="width:auto;display:inline"><option value="">any status</option>${["open", "pending", "resolved", "closed"].map((s) => `<option${f.status === s ? " selected" : ""}>${s}</option>`).join("")}</select>
<input name="assignee" placeholder="assignee" value="${esc(f.assignee ?? "")}" style="width:8rem;display:inline"> <button style="margin:0">Filter</button> <a href="${p}/tickets/new">New ticket</a></form>
<table><tr><th>No</th><th>Subject</th><th>Requester</th><th>Priority</th><th>Status</th><th>Assignee</th><th>Opened</th></tr>${rows}</table>${next}`;
}

export function ticketDetail(p: string, t: TicketDetail, agents: AgentRow[], canWrite: boolean): string {
  const comments = t.comments
    .map((c) => `<tr><td>${c.seq}</td><td>${esc(c.author)}${c.internal ? ' <span class="tag">internal</span>' : ""}</td><td>${esc(c.body)}</td><td>${esc(c.createdAt)}</td></tr>`)
    .join("");
  const opts = `<option value="">— unassigned —</option>` + agents.map((a) => `<option value="${esc(a.code)}"${t.assigneeCode === a.code ? " selected" : ""}>${esc(a.code)} ${esc(a.name)} (${esc(a.team)})</option>`).join("");
  const actions = canWrite
    ? `<h2>Work this ticket</h2>
<form class="card" method="post" action="${p}/tickets/${esc(t.ticketNo)}/assign"><label>Assignee</label><select name="agent">${opts}</select><button>Assign</button></form>
<form class="card" method="post" action="${p}/tickets/${esc(t.ticketNo)}/status"><label>Status</label><select name="status">${["open", "pending", "resolved", "closed"].map((s) => `<option${t.status === s ? " selected" : ""}>${s}</option>`).join("")}</select><button>Change status</button></form>
<form class="card" method="post" action="${p}/tickets/${esc(t.ticketNo)}/comments"><label>Comment</label><textarea name="body" rows="3"></textarea><label><input type="checkbox" name="internal" value="1" style="width:auto"> internal note</label><button>Add comment</button></form>`
    : `<p class="muted">Sign in to assign, comment or change status.</p>`;
  return `<h1>${esc(t.ticketNo)}: ${esc(t.subject)}</h1>
<p>${tag(t.priority)} ${tag(t.status)} · requester ${esc(t.requester)} · assignee ${esc(t.assigneeCode ?? "—")} · opened ${esc(t.openedAt)}${t.resolvedAt ? ` · resolved ${esc(t.resolvedAt)}` : ""}${t.breached ? ' · <span class="tag" style="background:#f8d7da">SLA breached</span>' : ""}</p>
<p>${esc(t.body)}</p>${t.sla ? `<p class="muted">SLA for ${esc(t.priority)}: respond within ${t.sla.respondHours} h, resolve within ${t.sla.resolveHours} h.</p>` : ""}
<h2>Comments</h2><table><tr><th>#</th><th>Author</th><th>Body</th><th>When</th></tr>${comments || "<tr><td colspan=4>None yet.</td></tr>"}</table>${actions}`;
}

export function ticketForm(p: string): string {
  return `<h1>New ticket</h1><form class="card" method="post" action="${p}/tickets">
<label>Requester (customer code)</label><input name="requester" required><label>Subject</label><input name="subject" required><label>Body</label><textarea name="body" rows="4"></textarea>
<label>Priority</label><select name="priority">${["low", "normal", "high", "urgent"].map((s) => `<option${s === "normal" ? " selected" : ""}>${s}</option>`).join("")}</select><button>Open ticket</button></form>`;
}

export function agentsList(p: string, agents: AgentRow[]): string {
  return `<h1>Agents</h1><table><tr><th>Code</th><th>Name</th><th>Team</th></tr>${agents.map((a) => `<tr><td><a href="${p}/tickets?assignee=${esc(a.code)}">${esc(a.code)}</a></td><td>${esc(a.name)}</td><td>${esc(a.team)}</td></tr>`).join("")}</table>`;
}

export function slaPage(sla: SlaRow[], breaches: string[]): string {
  return `<h1>SLA policy</h1><table><tr><th>Priority</th><th>Respond within</th><th>Resolve within</th></tr>${sla.map((s) => `<tr><td>${esc(s.priority)}</td><td>${s.respondHours} h</td><td>${s.resolveHours} h</td></tr>`).join("")}</table>
<h2>Breaches (${breaches.length})</h2><p>${breaches.map((b) => `<code>${esc(b)}</code>`).join(" ") || "none"}</p>`;
}
