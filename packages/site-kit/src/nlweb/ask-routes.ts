import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { registerMcp } from "../mcp-server.js";
import { ToolRegistry } from "../tool-registry.js";
import { parseAskParams } from "./ask-params.js";
import { AskService } from "./ask-service.js";
import { streamAsk } from "./ask-sse.js";
import { registerSchemaRoutes, type SchemaDeps } from "./schema-routes.js";

/**
 * Mounts a site's whole NLWeb surface on the scope it is given: /ask (JSON and
 * SSE), the ask-only MCP server at /ask/mcp, and the crawler routes. A site
 * supplies items + a ranker and gets every surface, identical everywhere.
 */
export type NlwebDeps = SchemaDeps & { version?: string };

type AskCtx = { workspaceId: string };

export async function registerNlweb(app: FastifyInstance, d: NlwebDeps): Promise<void> {
  const service = new AskService(d);

  const answer = async (req: FastifyRequest, reply: FastifyReply, source: unknown): Promise<unknown> => {
    const parsed = parseAskParams(source);
    // 422, not 400: the request is well-formed HTTP the site simply cannot answer.
    if (!parsed.ok) return reply.code(422).send({ error: parsed.error });
    const { params } = parsed;
    // Minted here rather than in the service so the SSE error path can still
    // close the stream with the id the client is correlating on.
    const queryId = params.queryId ?? randomUUID();
    if (params.streaming) return streamAsk(reply, service, req.workspaceId, params, queryId);
    return reply.send(await service.ask(req.workspaceId, { query: params.query, prev: params.prev, queryId }));
  };

  app.get("/ask", async (req, reply) => answer(req, reply, req.query));
  app.post("/ask", async (req, reply) => answer(req, reply, req.body));
  registerSchemaRoutes(app, d);

  // The ask MCP server is deliberately ONE read-only tool: it is the "site
  // answers questions" capability, not the site's full tool surface (that lives
  // at /mcp). Nested scope because registerMcp swaps the content-type parsers
  // for the scope it is registered in — /ask itself must keep the JSON parser.
  const tools = new ToolRegistry<AskCtx>().register({
    name: "ask",
    description: `Ask a natural-language question about ${d.site} and get matching items back as schema.org JSON-LD.`,
    input: { query: z.string(), prev: z.array(z.string()).optional() },
    handler: async (args, ctx) => service.ask(ctx.workspaceId, { query: args.query, ...(args.prev ? { prev: args.prev } : {}) }),
  });
  await app.register(
    async (scope) =>
      registerMcp<AskCtx>(scope, {
        serverName: `benchme-${d.site}-ask`,
        version: d.version ?? "0.1.0",
        tools,
        context: (workspaceId) => ({ workspaceId }),
      }),
    { prefix: "/ask" },
  );
}
