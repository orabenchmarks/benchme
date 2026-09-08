import { FORWARDED_PREFIX_HEADER, WORKSPACE_HEADER, WORKSPACE_SIG_HEADER, isWorkspaceId, verifyWorkspaceHeader } from "@benchme/core";
import type { FastifyInstance, FastifyRequest } from "fastify";

declare module "fastify" {
  interface FastifyRequest {
    /** Bound by the gateway (signed); every query is scoped by it. */
    workspaceId: string;
    /** The public path prefix the gateway stripped ("/w/<id>/warehouse"), for links + cookies. */
    prefix: string;
  }
}

const UNSCOPED = new Set(["/healthz", "/readyz"]);

/**
 * Trust the workspace ONLY from the gateway's signed header. A request without
 * it (or with a bad signature) never reaches a tenant query.
 */
export function registerWorkspaceScope(app: FastifyInstance, gatewaySecret: string): void {
  app.decorateRequest("workspaceId", "");
  app.decorateRequest("prefix", "");
  app.addHook("onRequest", async (req, reply) => {
    const path = req.url.split("?")[0] ?? "";
    if (UNSCOPED.has(path)) return;
    const id = header(req, WORKSPACE_HEADER);
    const sig = header(req, WORKSPACE_SIG_HEADER);
    if (!id || !isWorkspaceId(id) || !sig || !verifyWorkspaceHeader(gatewaySecret, id, sig)) {
      return reply.code(401).send({ error: "NO_WORKSPACE", message: "requests must come through the benchme gateway" });
    }
    req.workspaceId = id;
    req.prefix = header(req, FORWARDED_PREFIX_HEADER) ?? "";
  });
}

function header(req: FastifyRequest, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}
