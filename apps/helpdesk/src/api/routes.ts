import { DomainError, apiUser, type AuthService } from "@benchme/site-kit";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { TicketsRepo } from "../db/tickets-repo.js";
import { SESSION_COOKIE } from "../ui/routes.js";

export type ApiDeps = { tickets: TicketsRepo; auth: AuthService };

const priority = z.enum(["low", "normal", "high", "urgent"]);
const status = z.enum(["open", "pending", "resolved", "closed"]);
const listQuery = z.object({ status: status.optional(), assignee: z.string().optional(), priority: priority.optional(), requester: z.string().optional(), query: z.string().optional(), cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(200).default(50) });

/** REST under /api/v1. Reads are open inside the workspace; writes need a bearer token or a session. */
export function registerApi(app: FastifyInstance, d: ApiDeps): void {
  const caller = apiUser(d.auth, SESSION_COOKIE);
  const authed = async (req: FastifyRequest, reply: FastifyReply): Promise<string | null> => {
    const user = await caller(req);
    if (!user) {
      reply.code(401).send({ error: "UNAUTHORIZED", message: "sign in or send Authorization: Bearer <api token>" });
      return null;
    }
    return user.email;
  };
  const run = async (reply: FastifyReply, fn: () => Promise<unknown>, code = 200) => {
    try {
      return reply.code(code).send(await fn());
    } catch (err) {
      if (err instanceof DomainError) return reply.code(err.status).send({ error: err.code, message: err.message });
      throw err;
    }
  };

  app.get("/api/v1/agents", async (req) => d.tickets.listAgents(req.workspaceId));
  app.get("/api/v1/sla", async (req) => d.tickets.listSla(req.workspaceId));
  app.get("/api/v1/sla/breaches", async (req) => d.tickets.slaBreaches(req.workspaceId));
  app.get("/api/v1/tickets", async (req) => {
    const f = listQuery.parse(req.query);
    return d.tickets.listTickets(req.workspaceId, { ...(f.status ? { status: f.status } : {}), ...(f.assignee ? { assignee: f.assignee } : {}), ...(f.priority ? { priority: f.priority } : {}), ...(f.requester ? { requester: f.requester } : {}), ...(f.query ? { query: f.query } : {}), ...(f.cursor ? { cursor: f.cursor } : {}), limit: f.limit });
  });
  app.get<{ Params: { no: string } }>("/api/v1/tickets/:no", async (req, reply) => (await d.tickets.getTicket(req.workspaceId, req.params.no)) ?? reply.code(404).send({ error: "NOT_FOUND" }));
  app.post("/api/v1/tickets", async (req, reply) => {
    if (!(await authed(req, reply))) return;
    const b = z.object({ subject: z.string().min(1), body: z.string().default(""), requester: z.string().min(1), priority: priority.default("normal") }).parse(req.body);
    return run(reply, () => d.tickets.createTicket(req.workspaceId, b), 201);
  });
  app.post<{ Params: { no: string } }>("/api/v1/tickets/:no/comments", async (req, reply) => {
    const who = await authed(req, reply);
    if (!who) return;
    const b = z.object({ body: z.string().min(1), internal: z.boolean().default(false) }).parse(req.body);
    return run(reply, () => d.tickets.addComment(req.workspaceId, req.params.no, who, b.body, b.internal), 201);
  });
  app.post<{ Params: { no: string } }>("/api/v1/tickets/:no/assign", async (req, reply) => {
    if (!(await authed(req, reply))) return;
    const b = z.object({ agentCode: z.string().nullable() }).parse(req.body);
    return run(reply, () => d.tickets.assign(req.workspaceId, req.params.no, b.agentCode));
  });
  app.post<{ Params: { no: string } }>("/api/v1/tickets/:no/priority", async (req, reply) => {
    if (!(await authed(req, reply))) return;
    const b = z.object({ priority }).parse(req.body);
    return run(reply, () => d.tickets.setPriority(req.workspaceId, req.params.no, b.priority));
  });
  app.post<{ Params: { no: string } }>("/api/v1/tickets/:no/status", async (req, reply) => {
    if (!(await authed(req, reply))) return;
    const b = z.object({ status }).parse(req.body);
    return run(reply, () => d.tickets.transition(req.workspaceId, req.params.no, b.status));
  });
  app.delete<{ Params: { no: string } }>("/api/v1/tickets/:no", async (req, reply) => {
    if (!(await authed(req, reply))) return;
    return run(reply, async () => {
      await d.tickets.deleteTicket(req.workspaceId, req.params.no);
      return { deleted: req.params.no };
    });
  });
}
