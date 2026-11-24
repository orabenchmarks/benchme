import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { refusalOf } from "./refusal.js";
import type { ToolRegistry } from "./tool-registry.js";

export { DomainError } from "./domain-error.js";

export type McpDeps<C> = {
  serverName: string;
  version: string;
  tools: ToolRegistry<C>;
  /** Build the tool context for one request's workspace. `prefix` is the gateway-forwarded `req.prefix` (existing callers that only take `workspaceId` still type-check and simply ignore it). */
  context: (workspaceId: string, prefix: string) => C;
  /** Register anything beyond tools (resources, prompts) — run after the tool loop. */
  extras?: (server: McpServer, ctx: C) => void;
  /**
   * For a site whose tools sign in (`Doors.withSignIn`): hand each client a
   * session id when it initializes, which it then repeats on every request and
   * a sign-in is kept under, and answer a page's bridge in one JSON body so
   * the answer can carry the browser's session cookie. The server stays
   * stateless either way: the id is a name, held nowhere here.
   */
  sessions?: boolean;
};

/** An MCP session's id, told apart at a glance from a site's own session tokens. */
export const newMcpSessionId = (): string => `mcp-${randomUUID()}`;

/** A fresh MCP server bound to one workspace (stateless per request). */
export function buildMcpServer<C>(d: McpDeps<C>, ctx: C): McpServer {
  const server = new McpServer({ name: d.serverName, version: d.version });
  for (const tool of d.tools.list()) {
    server.tool(tool.name, tool.description, tool.input, async (args) => {
      try {
        const result = await tool.handler(args as never, ctx);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        // A rule's refusal, a sign-in's, or a write by nobody: the tool's own answer, never a protocol error.
        const refusal = refusalOf(err);
        if (refusal) return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: refusal.code, message: refusal.message }) }] };
        throw err;
      }
    });
  }
  d.extras?.(server, ctx);
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
    const server = buildMcpServer(d, d.context(req.workspaceId, req.prefix));
    const transport = new StreamableHTTPServerTransport(d.sessions ? sessionOptions(req) : { sessionIdGenerator: undefined });
    reply.hijack();
    reply.raw.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req.raw, reply.raw, req.body);
  });
}

/**
 * One transport per request, as ever. The request that initializes gets a
 * session id to repeat; every later one is taken as it comes, with no session
 * held here to check it against. A page's bridge (a call that proved it is
 * one: `req.door`, from the workspace scope) reads one JSON body.
 */
function sessionOptions(req: FastifyRequest): ConstructorParameters<typeof StreamableHTTPServerTransport>[0] {
  const messages: unknown[] = Array.isArray(req.body) ? req.body : [req.body];
  return {
    sessionIdGenerator: messages.some((m) => isInitializeRequest(m)) ? newMcpSessionId : undefined,
    enableJsonResponse: req.door === "webmcp",
  };
}
