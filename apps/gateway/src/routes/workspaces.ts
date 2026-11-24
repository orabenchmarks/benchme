import type { Workspace } from "@benchme/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { RateLimiter } from "../rate-limit.js";
import { WorkspaceError, type WorkspaceService } from "../workspace-service.js";

const createBody = z.object({
  scenario: z.string().min(1).max(60),
  seed: z.number().int().min(1).max(2_147_483_646).optional(),
  ttlSeconds: z.number().int().positive().optional(),
  // Names, checked against DOORS by the service (422 UNKNOWN_DOOR), so the answer can say which doors there are.
  doors: z.array(z.string().min(1).max(40)).max(16).optional(),
});

export const OPERATOR_HEADER = "x-benchme-operator-key";

export type WorkspaceRoutesDeps = {
  service: WorkspaceService;
  limiter: RateLimiter;
  operatorKey: string;
};

function sendError(reply: { code: (n: number) => { send: (b: unknown) => unknown } }, err: unknown): unknown {
  if (err instanceof WorkspaceError) return reply.code(err.status).send({ error: err.code, message: err.message });
  throw err;
}

export function registerWorkspaceRoutes(app: FastifyInstance, d: WorkspaceRoutesDeps): void {
  app.post("/api/workspaces", async (req, reply) => {
    const body = createBody.parse(req.body ?? {});
    try {
      d.service.validate(body); // a 422 must not spend a rate-limit unit
    } catch (err) {
      return sendError(reply, err);
    }
    const isOperator = req.headers[OPERATOR_HEADER] === d.operatorKey;
    if (!isOperator && !(await d.limiter.consume(req.ip))) {
      return reply.code(429).send({ error: "RATE_LIMITED", message: "too many workspaces created from this address; try later" });
    }
    try {
      const w = await d.service.create(body);
      return reply.code(201).send({ ...serialize(w, d.service), urls: d.service.urls(w) });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get<{ Params: { id: string } }>("/api/workspaces/:id", async (req, reply) => {
    try {
      const w = await d.service.get(req.params.id);
      return { ...serialize(w, d.service), urls: d.service.urls(w) };
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post<{ Params: { id: string } }>("/api/workspaces/:id/finalize", async (req, reply) => {
    try {
      const { workspace, receipt } = await d.service.finalize(req.params.id);
      return { ...serialize(workspace, d.service), receipt };
    } catch (err) {
      return sendError(reply, err);
    }
  });
}

/** A workspace as the API shows it. `doors`: the doors it is served through, its own or the deployment's. */
function serialize(w: Workspace, service: Pick<WorkspaceService, "doorsOf">) {
  return {
    id: w.id,
    scenario: w.scenario,
    seed: w.seed,
    doors: service.doorsOf(w).list(),
    createdAt: w.createdAt.toISOString(),
    expiresAt: w.expiresAt.toISOString(),
    finalizedAt: w.finalizedAt ? w.finalizedAt.toISOString() : null,
  };
}
