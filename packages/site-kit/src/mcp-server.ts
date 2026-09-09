import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { FastifyInstance } from "fastify";
import type { ToolRegistry } from "./tool-registry.js";

/** Thrown by a tool/domain operation to render a structured error (never a 500). */
export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 422,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export type McpDeps<C> = {
  serverName: string;
  version: string;
  tools: ToolRegistry<C>;
  /** Build the tool context for one request's workspace. */
  context: (workspaceId: string) => C;
};

/** A fresh MCP server bound to one workspace (stateless per request). */
export function buildMcpServer<C>(d: McpDeps<C>, ctx: C): McpServer {
  const server = new McpServer({ name: d.serverName, version: d.version });
  for (const tool of d.tools.list()) {
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
 * Streamable HTTP at /mcp inside its own Fastify plugin scope (it replaces the
 * content-type parsers so JSON-RPC bodies reach the transport untouched).
 * Stateless: every request builds a server for the request's workspace, so a
 * workspace's tools never see another's rows.
 */
export function registerMcp<C>(app: FastifyInstance, d: McpDeps<C>): void {
  app.removeAllContentTypeParsers();
  app.addContentTypeParser("*", { parseAs: "buffer" }, (_req, body, done) => done(null, body));
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    try {
      done(null, (body as string).length ? JSON.parse(body as string) : {});
    } catch (err) {
      done(err as Error);
    }
  });
  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_req, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(body as string)));
  });

  app.all("/mcp", async (req, reply) => {
    const server = buildMcpServer(d, d.context(req.workspaceId));
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
