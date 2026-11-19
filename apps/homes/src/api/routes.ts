import { DomainError, apiUser, type AuthService } from "@benchme/site-kit";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { HomesRepo } from "../db/homes-repo.js";
import { SESSION_COOKIE } from "../ui/routes.js";
import { filled, given, moment, searchSchema, toQuery, viewingSchema } from "./inputs.js";

export type ApiDeps = { homes: HomesRepo; auth: AuthService };

const agentsQuery = z.object({ city: z.string().optional() });
const slotsQuery = z.object({ from: given(moment.optional()), free: given(z.enum(["true", "false"]).optional()) });
const viewingsQuery = z.object({
  email: z.string().optional(),
  listing: z.string().optional(),
  agent: z.string().optional(),
  status: given(z.enum(["requested", "cancelled"]).optional()),
  cursor: z.string().optional(),
  limit: given(z.coerce.number().int().min(1).max(200).default(50)),
});

/** REST under /api/v1. Reads are open inside the workspace; requesting and cancelling a viewing need a bearer token or a session. */
export function registerApi(app: FastifyInstance, d: ApiDeps): void {
  const caller = apiUser(d.auth, SESSION_COOKIE);
  const authed = async (req: FastifyRequest, reply: FastifyReply): Promise<boolean> => {
    if (await caller(req)) return true;
    reply.code(401).send({ error: "UNAUTHORIZED", message: "sign in or send Authorization: Bearer <api token>" });
    return false;
  };
  const run = async (reply: FastifyReply, fn: () => Promise<unknown>, code = 200) => {
    try {
      return reply.code(code).send(await fn());
    } catch (err) {
      if (err instanceof DomainError) return reply.code(err.status).send({ error: err.code, message: err.message });
      throw err;
    }
  };
  /** A bad query is the caller's to fix: 400 with zod's own words, not a 500. */
  const parse = <S extends z.ZodTypeAny>(schema: S, data: unknown, reply: FastifyReply): z.output<S> | null => {
    const r = schema.safeParse(data);
    if (r.success) return r.data;
    reply.code(400).send({ error: "BAD_REQUEST", message: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
    return null;
  };
  const notFound = (reply: FastifyReply) => reply.code(404).send({ error: "NOT_FOUND" });

  app.get("/api/v1/cities", async (req) => d.homes.cities(req.workspaceId));
  app.get("/api/v1/listings", async (req, reply) => {
    const s = parse(searchSchema, filled(req.query as Record<string, unknown>), reply);
    if (!s) return;
    return d.homes.search(req.workspaceId, toQuery(s));
  });
  app.get<{ Params: { code: string } }>("/api/v1/listings/:code", async (req, reply) => (await d.homes.getListing(req.workspaceId, req.params.code)) ?? notFound(reply));
  app.get<{ Params: { code: string } }>("/api/v1/listings/:code/slots", async (req, reply) => {
    const f = parse(slotsQuery, req.query, reply);
    if (!f) return;
    return run(reply, () => d.homes.slots(req.workspaceId, req.params.code, { ...(f.from ? { from: f.from } : {}), freeOnly: f.free === "true" }));
  });
  app.get("/api/v1/agents", async (req, reply) => {
    const f = parse(agentsQuery, req.query, reply);
    if (!f) return;
    return d.homes.listAgents(req.workspaceId, f.city);
  });
  app.get<{ Params: { code: string } }>("/api/v1/agents/:code", async (req, reply) => (await d.homes.getAgent(req.workspaceId, req.params.code)) ?? notFound(reply));
  app.get("/api/v1/viewings", async (req, reply) => {
    const f = parse(viewingsQuery, req.query, reply);
    if (!f) return;
    return d.homes.listViewings(req.workspaceId, { ...(f.email ? { email: f.email } : {}), ...(f.listing ? { listing: f.listing } : {}), ...(f.agent ? { agent: f.agent } : {}), ...(f.status ? { status: f.status } : {}), ...(f.cursor ? { cursor: f.cursor } : {}), limit: f.limit });
  });
  app.get<{ Params: { no: string } }>("/api/v1/viewings/:no", async (req, reply) => (await d.homes.getViewing(req.workspaceId, req.params.no)) ?? notFound(reply));
  app.post("/api/v1/viewings", async (req, reply) => {
    if (!(await authed(req, reply))) return;
    const v = parse(viewingSchema, req.body, reply);
    if (!v) return;
    return run(reply, () => d.homes.requestViewing(req.workspaceId, v), 201);
  });
  app.post<{ Params: { no: string } }>("/api/v1/viewings/:no/cancel", async (req, reply) => {
    if (!(await authed(req, reply))) return;
    return run(reply, () => d.homes.cancelViewing(req.workspaceId, req.params.no));
  });
}
