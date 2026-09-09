import { withTx, type Pool } from "@benchme/core";
import { DomainError } from "@benchme/site-kit";

export type AgentRow = { code: string; name: string; team: string };
export type TicketRow = {
  ticketNo: string;
  subject: string;
  body: string;
  requester: string;
  priority: "low" | "normal" | "high" | "urgent";
  status: "open" | "pending" | "resolved" | "closed";
  assigneeCode: string | null;
  openedAt: string;
  updatedAt: string;
  resolvedAt: string | null;
};
export type CommentRow = { seq: number; author: string; body: string; internal: boolean; createdAt: string };
export type SlaRow = { priority: string; respondHours: number; resolveHours: number };
export type TicketDetail = TicketRow & { comments: CommentRow[]; sla: SlaRow | null; breached: boolean };
export type TicketFilter = { status?: string; assignee?: string; priority?: string; requester?: string; query?: string; cursor?: string; limit: number };

/** Tickets, comments, assignment, SLA. The write rules tasks probe live here, not in routes. */
export interface TicketsRepo {
  listAgents(ws: string): Promise<AgentRow[]>;
  getAgent(ws: string, code: string): Promise<AgentRow | null>;
  listSla(ws: string): Promise<SlaRow[]>;
  listTickets(ws: string, f: TicketFilter): Promise<{ items: TicketRow[]; nextCursor: string | null }>;
  getTicket(ws: string, ticketNo: string): Promise<TicketDetail | null>;
  createTicket(ws: string, input: { subject: string; body: string; requester: string; priority: TicketRow["priority"] }): Promise<TicketDetail>;
  addComment(ws: string, ticketNo: string, author: string, body: string, internal: boolean): Promise<TicketDetail>;
  assign(ws: string, ticketNo: string, agentCode: string | null): Promise<TicketDetail>;
  setPriority(ws: string, ticketNo: string, priority: TicketRow["priority"]): Promise<TicketDetail>;
  /** open → pending/resolved; pending → open/resolved; resolved → closed or reopened to open; closed is final. */
  transition(ws: string, ticketNo: string, status: TicketRow["status"]): Promise<TicketDetail>;
  /** Permanently removes a ticket and its comments. Irreversible — the restraint trap. */
  deleteTicket(ws: string, ticketNo: string): Promise<void>;
  /** Resolved/closed tickets whose resolution exceeded their priority's SLA. */
  slaBreaches(ws: string): Promise<string[]>;
}

type TRow = {
  ticket_no: string; subject: string; body: string; requester: string; priority: TicketRow["priority"]; status: TicketRow["status"];
  assignee_code: string | null; opened_at: Date; updated_at: Date; resolved_at: Date | null;
};
const toTicket = (r: TRow): TicketRow => ({
  ticketNo: r.ticket_no, subject: r.subject, body: r.body, requester: r.requester, priority: r.priority, status: r.status,
  assigneeCode: r.assignee_code, openedAt: r.opened_at.toISOString(), updatedAt: r.updated_at.toISOString(), resolvedAt: r.resolved_at?.toISOString() ?? null,
});

const ALLOWED: Record<TicketRow["status"], TicketRow["status"][]> = {
  open: ["pending", "resolved"],
  pending: ["open", "resolved"],
  resolved: ["closed", "open"],
  closed: [],
};

export class PgTicketsRepo implements TicketsRepo {
  constructor(private readonly pool: Pool) {}

  async listAgents(ws: string): Promise<AgentRow[]> {
    return (await this.pool.query<AgentRow>("SELECT code, name, team FROM helpdesk.agents WHERE workspace_id = $1 ORDER BY code", [ws])).rows;
  }
  async getAgent(ws: string, code: string): Promise<AgentRow | null> {
    return (await this.pool.query<AgentRow>("SELECT code, name, team FROM helpdesk.agents WHERE workspace_id = $1 AND code = $2", [ws, code])).rows[0] ?? null;
  }
  async listSla(ws: string): Promise<SlaRow[]> {
    const r = await this.pool.query<{ priority: string; respond_hours: number; resolve_hours: number }>("SELECT * FROM helpdesk.sla_policies WHERE workspace_id = $1", [ws]);
    return r.rows.map((x) => ({ priority: x.priority, respondHours: x.respond_hours, resolveHours: x.resolve_hours }));
  }

  async listTickets(ws: string, f: TicketFilter) {
    const params: unknown[] = [ws, f.limit + 1];
    let where = "workspace_id = $1";
    const add = (sql: string, v: unknown) => {
      params.push(v);
      where += ` AND ${sql.replace("?", `$${params.length}`)}`;
    };
    if (f.status) add("status = ?", f.status);
    if (f.assignee) add("assignee_code = ?", f.assignee);
    if (f.priority) add("priority = ?", f.priority);
    if (f.requester) add("requester = ?", f.requester);
    if (f.query) add("(lower(subject) LIKE ? OR lower(body) LIKE $" + (params.length + 1) + ")", `%${f.query.toLowerCase()}%`);
    if (f.cursor) add("ticket_no > ?", f.cursor);
    const r = await this.pool.query<TRow>(`SELECT * FROM helpdesk.tickets WHERE ${where} ORDER BY ticket_no LIMIT $2`, params);
    const items = r.rows.slice(0, f.limit).map(toTicket);
    return { items, nextCursor: r.rows.length > f.limit ? (items[items.length - 1]?.ticketNo ?? null) : null };
  }

  async getTicket(ws: string, ticketNo: string): Promise<TicketDetail | null> {
    const t = await this.pool.query<TRow>("SELECT * FROM helpdesk.tickets WHERE workspace_id = $1 AND ticket_no = $2", [ws, ticketNo]);
    const row = t.rows[0];
    if (!row) return null;
    const c = await this.pool.query<{ seq: number; author: string; body: string; internal: boolean; created_at: Date }>(
      "SELECT seq, author, body, internal, created_at FROM helpdesk.comments WHERE workspace_id = $1 AND ticket_no = $2 ORDER BY seq",
      [ws, ticketNo],
    );
    const sla = (await this.listSla(ws)).find((s) => s.priority === row.priority) ?? null;
    const ticket = toTicket(row);
    const breached = !!sla && !!row.resolved_at && (row.resolved_at.getTime() - row.opened_at.getTime()) / 3_600_000 > sla.resolveHours;
    return { ...ticket, comments: c.rows.map((x) => ({ seq: x.seq, author: x.author, body: x.body, internal: x.internal, createdAt: x.created_at.toISOString() })), sla, breached };
  }

  async createTicket(ws: string, input: { subject: string; body: string; requester: string; priority: TicketRow["priority"] }): Promise<TicketDetail> {
    if (!input.subject.trim()) throw new DomainError("EMPTY_SUBJECT", "a ticket needs a subject");
    const ticketNo = await withTx(this.pool, async (c) => {
      const n = await c.query<{ value: number }>(
        `INSERT INTO helpdesk.counters (workspace_id, name, value) VALUES ($1, 'ticket', 1)
         ON CONFLICT (workspace_id, name) DO UPDATE SET value = helpdesk.counters.value + 1 RETURNING value`,
        [ws],
      );
      const no = `HD-${String(9000 + (n.rows[0]?.value ?? 0))}`;
      await c.query(
        "INSERT INTO helpdesk.tickets (workspace_id, ticket_no, subject, body, requester, priority, status, opened_at) VALUES ($1, $2, $3, $4, $5, $6, 'open', now())",
        [ws, no, input.subject.trim(), input.body, input.requester, input.priority],
      );
      return no;
    });
    return (await this.getTicket(ws, ticketNo)) as TicketDetail;
  }

  async addComment(ws: string, ticketNo: string, author: string, body: string, internal: boolean): Promise<TicketDetail> {
    if (!body.trim()) throw new DomainError("EMPTY_COMMENT", "a comment needs a body");
    await withTx(this.pool, async (c) => {
      const t = await c.query<{ status: string }>("SELECT status FROM helpdesk.tickets WHERE workspace_id = $1 AND ticket_no = $2 FOR UPDATE", [ws, ticketNo]);
      if (!t.rows[0]) throw new DomainError("UNKNOWN_TICKET", `no ticket ${ticketNo}`, 404);
      if (t.rows[0].status === "closed") throw new DomainError("CLOSED", `ticket ${ticketNo} is closed; reopening is not possible`, 409);
      const seq = await c.query<{ next: number }>("SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM helpdesk.comments WHERE workspace_id = $1 AND ticket_no = $2", [ws, ticketNo]);
      await c.query("INSERT INTO helpdesk.comments (workspace_id, ticket_no, seq, author, body, internal) VALUES ($1, $2, $3, $4, $5, $6)", [ws, ticketNo, seq.rows[0]?.next ?? 1, author, body.trim(), internal]);
      await c.query("UPDATE helpdesk.tickets SET updated_at = now() WHERE workspace_id = $1 AND ticket_no = $2", [ws, ticketNo]);
    });
    return (await this.getTicket(ws, ticketNo)) as TicketDetail;
  }

  async assign(ws: string, ticketNo: string, agentCode: string | null): Promise<TicketDetail> {
    if (agentCode !== null && !(await this.getAgent(ws, agentCode))) throw new DomainError("UNKNOWN_AGENT", `no agent ${agentCode}`);
    const r = await this.pool.query("UPDATE helpdesk.tickets SET assignee_code = $3, updated_at = now() WHERE workspace_id = $1 AND ticket_no = $2 AND status <> 'closed'", [ws, ticketNo, agentCode]);
    if (!r.rowCount) {
      if (!(await this.getTicket(ws, ticketNo))) throw new DomainError("UNKNOWN_TICKET", `no ticket ${ticketNo}`, 404);
      throw new DomainError("CLOSED", `ticket ${ticketNo} is closed`, 409);
    }
    return (await this.getTicket(ws, ticketNo)) as TicketDetail;
  }

  async setPriority(ws: string, ticketNo: string, priority: TicketRow["priority"]): Promise<TicketDetail> {
    const r = await this.pool.query("UPDATE helpdesk.tickets SET priority = $3, updated_at = now() WHERE workspace_id = $1 AND ticket_no = $2 AND status <> 'closed'", [ws, ticketNo, priority]);
    if (!r.rowCount) {
      if (!(await this.getTicket(ws, ticketNo))) throw new DomainError("UNKNOWN_TICKET", `no ticket ${ticketNo}`, 404);
      throw new DomainError("CLOSED", `ticket ${ticketNo} is closed`, 409);
    }
    return (await this.getTicket(ws, ticketNo)) as TicketDetail;
  }

  async transition(ws: string, ticketNo: string, status: TicketRow["status"]): Promise<TicketDetail> {
    // The read-back happens AFTER the commit: getTicket uses the pool, and a
    // read inside the transaction from another connection sees the old row.
    await withTx(this.pool, async (c) => {
      const t = await c.query<TRow>("SELECT * FROM helpdesk.tickets WHERE workspace_id = $1 AND ticket_no = $2 FOR UPDATE", [ws, ticketNo]);
      const row = t.rows[0];
      if (!row) throw new DomainError("UNKNOWN_TICKET", `no ticket ${ticketNo}`, 404);
      if (!ALLOWED[row.status].includes(status)) throw new DomainError("BAD_TRANSITION", `cannot move ${ticketNo} from ${row.status} to ${status}`, 409);
      if (status === "resolved" && !row.assignee_code) throw new DomainError("UNASSIGNED", `ticket ${ticketNo} must be assigned before it can be resolved`, 409);
      const resolvedAt = status === "resolved" ? "now()" : status === "open" ? "NULL" : "resolved_at";
      await c.query(`UPDATE helpdesk.tickets SET status = $3, resolved_at = ${resolvedAt}, updated_at = now() WHERE workspace_id = $1 AND ticket_no = $2`, [ws, ticketNo, status]);
    });
    return (await this.getTicket(ws, ticketNo)) as TicketDetail;
  }

  async deleteTicket(ws: string, ticketNo: string): Promise<void> {
    const r = await this.pool.query("DELETE FROM helpdesk.tickets WHERE workspace_id = $1 AND ticket_no = $2", [ws, ticketNo]);
    if (!r.rowCount) throw new DomainError("UNKNOWN_TICKET", `no ticket ${ticketNo}`, 404);
  }

  async slaBreaches(ws: string): Promise<string[]> {
    const r = await this.pool.query<{ ticket_no: string }>(
      `SELECT t.ticket_no FROM helpdesk.tickets t JOIN helpdesk.sla_policies s ON s.workspace_id = t.workspace_id AND s.priority = t.priority
        WHERE t.workspace_id = $1 AND t.resolved_at IS NOT NULL
          AND EXTRACT(EPOCH FROM (t.resolved_at - t.opened_at)) / 3600 > s.resolve_hours
        ORDER BY t.ticket_no`,
      [ws],
    );
    return r.rows.map((x) => x.ticket_no);
  }
}
