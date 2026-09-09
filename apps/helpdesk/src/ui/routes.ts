import { DomainError, registerAuthRoutes, requireSession, sessionUser, shell, type AuthService, type ShellCtx } from "@benchme/site-kit";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { TicketsRepo } from "../db/tickets-repo.js";
import * as pages from "./pages.js";

export const SESSION_COOKIE = "hd_session";
export type UiDeps = { tickets: TicketsRepo; auth: AuthService };

type Q = Record<string, string | undefined>;
const q = (req: FastifyRequest): Q => (req.query ?? {}) as Q;
const form = (req: FastifyRequest): Q => (req.body ?? {}) as Q;
const NAV = [
  { href: "/tickets", label: "Tickets" },
  { href: "/agents", label: "Agents" },
  { href: "/sla", label: "SLA" },
];

export function registerUi(app: FastifyInstance, d: UiDeps): void {
  const user = sessionUser(d.auth, SESSION_COOKIE);
  const ctx = async (req: FastifyRequest, flash?: string): Promise<ShellCtx> => ({ site: "Helpdesk", accent: "#5b2a86", prefix: req.prefix, nav: NAV, user: await user(req), flash });
  const html = (reply: FastifyReply, body: string) => reply.type("text/html; charset=utf-8").send(body);
  const authDeps = { auth: d.auth, cookie: SESSION_COOKIE, shellCtx: ctx };
  const requireUser = requireSession(authDeps);
  registerAuthRoutes(app, authDeps);
  const withDomainError = async (req: FastifyRequest, reply: FastifyReply, ticketNo: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
      return reply.redirect(`${req.prefix}/tickets/${ticketNo}`, 303);
    } catch (err) {
      if (err instanceof DomainError) {
        const t = await d.tickets.getTicket(req.workspaceId, ticketNo);
        const c = await ctx(req, err.message);
        return reply.code(err.status).type("text/html").send(shell(c, ticketNo, t ? pages.ticketDetail(req.prefix, t, await d.tickets.listAgents(req.workspaceId), !!c.user) : "<h1>No such ticket</h1>"));
      }
      throw err;
    }
  };

  app.get("/", async (req, reply) => {
    const ws = req.workspaceId;
    const [open, pending, all, breaches] = await Promise.all([
      d.tickets.listTickets(ws, { status: "open", limit: 1000 }).then((r) => r.items),
      d.tickets.listTickets(ws, { status: "pending", limit: 1000 }).then((r) => r.items.length),
      d.tickets.listTickets(ws, { limit: 1000 }).then((r) => r.items),
      d.tickets.slaBreaches(ws).then((b) => b.length),
    ]);
    const unassigned = all.filter((t) => t.assigneeCode === null && (t.status === "open" || t.status === "pending")).length;
    return html(reply, shell(await ctx(req), "Dashboard", pages.dashboard(req.prefix, { open: open.length, pending, unassigned, breaches })));
  });

  app.get("/tickets", async (req, reply) => {
    const f = q(req);
    const page = await d.tickets.listTickets(req.workspaceId, {
      ...(f.status ? { status: f.status } : {}),
      ...(f.assignee ? { assignee: f.assignee } : {}),
      ...(f.priority ? { priority: f.priority } : {}),
      ...(f.query ? { query: f.query } : {}),
      ...(f.cursor ? { cursor: f.cursor } : {}),
      limit: 25,
    });
    return html(reply, shell(await ctx(req), "Tickets", pages.ticketsList(req.prefix, page.items, page.nextCursor, { status: f.status, assignee: f.assignee, priority: f.priority, query: f.query })));
  });

  app.get("/tickets/new", async (req, reply) => {
    const c = await requireUser(req, reply);
    if (!c) return;
    return html(reply, shell(c, "New ticket", pages.ticketForm(req.prefix)));
  });

  app.post("/tickets", async (req, reply) => {
    const c = await requireUser(req, reply);
    if (!c) return;
    const f = form(req);
    try {
      const t = await d.tickets.createTicket(req.workspaceId, { subject: f.subject ?? "", body: f.body ?? "", requester: f.requester ?? "", priority: (f.priority as "low" | "normal" | "high" | "urgent") ?? "normal" });
      return reply.redirect(`${req.prefix}/tickets/${t.ticketNo}`, 303);
    } catch (err) {
      if (err instanceof DomainError) return html(reply, shell({ ...c, flash: err.message }, "New ticket", pages.ticketForm(req.prefix)));
      throw err;
    }
  });

  app.get<{ Params: { no: string } }>("/tickets/:no", async (req, reply) => {
    const c = await ctx(req);
    const t = await d.tickets.getTicket(req.workspaceId, req.params.no);
    if (!t) return reply.code(404).type("text/html").send(shell(c, "Not found", "<h1>No such ticket</h1>"));
    return html(reply, shell(c, t.ticketNo, pages.ticketDetail(req.prefix, t, await d.tickets.listAgents(req.workspaceId), !!c.user)));
  });

  app.post<{ Params: { no: string } }>("/tickets/:no/assign", async (req, reply) => {
    const c = await requireUser(req, reply);
    if (!c) return;
    const agent = form(req).agent || null;
    return withDomainError(req, reply, req.params.no, () => d.tickets.assign(req.workspaceId, req.params.no, agent));
  });

  app.post<{ Params: { no: string } }>("/tickets/:no/status", async (req, reply) => {
    const c = await requireUser(req, reply);
    if (!c) return;
    return withDomainError(req, reply, req.params.no, () => d.tickets.transition(req.workspaceId, req.params.no, (form(req).status ?? "open") as "open" | "pending" | "resolved" | "closed"));
  });

  app.post<{ Params: { no: string } }>("/tickets/:no/comments", async (req, reply) => {
    const c = await requireUser(req, reply);
    if (!c || !c.user) return;
    const f = form(req);
    return withDomainError(req, reply, req.params.no, () => d.tickets.addComment(req.workspaceId, req.params.no, c.user?.email ?? "user", f.body ?? "", f.internal === "1"));
  });

  app.get("/agents", async (req, reply) => html(reply, shell(await ctx(req), "Agents", pages.agentsList(req.prefix, await d.tickets.listAgents(req.workspaceId)))));
  app.get("/sla", async (req, reply) => html(reply, shell(await ctx(req), "SLA", pages.slaPage(await d.tickets.listSla(req.workspaceId), await d.tickets.slaBreaches(req.workspaceId)))));
}
