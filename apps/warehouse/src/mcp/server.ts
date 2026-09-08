import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { FastifyInstance } from "fastify";
import { DomainError } from "../db/orders-repo.js";
import type { ToolContext, ToolRegistry } from "./tool-registry.js";

export type McpDeps = { tools: ToolRegistry; context: (workspaceId: string) => ToolContext };

/** Build a fresh MCP server bound to one workspace (stateless per request). */
export function buildMcpServer(registry: ToolRegistry, ctx: ToolContext): McpServer {
  const server = new McpServer({ name: "benchme-warehouse", version: "0.1.0" });
  for (const tool of registry.list()) {
    server.tool(tool.name, tool.description, tool.input, async (args) => {
      try {
        const result = await tool.handler(args as never, ctx);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        if (err instanceof DomainError) {
          return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: err.code, message: err.message }) }] };
        }
        throw err;
      }
    });
  }
  return server;
}

/**
 * Streamable HTTP at /mcp. Stateless mode: each request builds a server for
 * the request's workspace, so a workspace's tools never see another's rows.
 */
export function registerMcp(app: FastifyInstance, d: McpDeps): void {
  app.removeAllContentTypeParsers();
  app.addContentTypeParser("*", { parseAs: "buffer" }, (_req, body, done) => done(null, body));
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    try {
      done(null, body.length ? JSON.parse(body as string) : {});
    } catch (err) {
      done(err as Error);
    }
  });
  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_req, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(body as string)));
  });

  app.all("/mcp", async (req, reply) => {
    const server = buildMcpServer(d.tools, d.context(req.workspaceId));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    reply.hijack();
    reply.raw.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req.raw, reply.raw, req.body);
  });
}
