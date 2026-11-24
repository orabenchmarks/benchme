import {
  DOORS_HEADER,
  DOORS_SIG_HEADER,
  DoorSet,
  FORWARDED_PREFIX_HEADER,
  WORKSPACE_HEADER,
  WORKSPACE_SIG_HEADER,
  doorsFromHeaders,
  isWorkspaceId,
  verifyWorkspaceHeader,
  type Door,
} from "@benchme/core";
import type { FastifyInstance, FastifyReply } from "fastify";
import { BridgeCredential, bridgeSetCookie } from "./doors/bridge-credential.js";
import { isClosed, requestDoor } from "./doors/request-door.js";
import { header } from "./request-header.js";

export { header } from "./request-header.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Bound by the gateway (signed); every tenant query is scoped by it. */
    workspaceId: string;
    /** The public path prefix the gateway stripped ("/w/<id>/<app>"), for links + cookie paths. */
    prefix: string;
    /** The doors the gateway serves this request's workspace through (signed): every door when it named none. */
    doors: DoorSet;
    /** The door this request came through, or null for what is no door (the probes, /internal/). */
    door: Door | null;
    /** This request's WebMCP bridge credential; null on a path outside any workspace. */
    bridge: BridgeCredential | null;
  }
}

const UNSCOPED = new Set(["/healthz", "/readyz"]);

const notThroughGateway = (reply: FastifyReply) => reply.code(401).send({ error: "NO_WORKSPACE", message: "requests must come through the benchme gateway" });

/**
 * Trust the workspace ONLY from the gateway's signed header. A request without
 * it (or with a bad signature) never reaches a tenant query. Paths in
 * `unscopedPrefixes` (internal endpoints authenticated some other way) skip it.
 *
 * The doors come with it, signed for the same workspace (or not at all, from
 * a gateway older than doors: then every door is open). A request through a
 * door its workspace is not served through is told there is no such thing,
 * before any handler, body parser or JSON-RPC reads it: the gateway closes the
 * door by path first, and this is the second lock, the one that knows a
 * page's bridge from a direct MCP client. And a page that renders its WebMCP
 * bridge (`webmcpBridge`) gets the bridge cookie set on its response here.
 */
export function registerWorkspaceScope(app: FastifyInstance, gatewaySecret: string, unscopedPrefixes: readonly string[] = []): void {
  app.decorateRequest("workspaceId", "");
  app.decorateRequest("prefix", "");
  app.decorateRequest("doors");
  app.decorateRequest("door");
  app.decorateRequest("bridge");
  app.addHook("onRequest", async (req, reply) => {
    req.doors = DoorSet.ALL;
    req.door = null;
    req.bridge = null;
    const path = req.url.split("?")[0] ?? "";
    if (UNSCOPED.has(path) || unscopedPrefixes.some((p) => path.startsWith(p))) return;
    const id = header(req, WORKSPACE_HEADER);
    const sig = header(req, WORKSPACE_SIG_HEADER);
    if (!id || !isWorkspaceId(id) || !sig || !verifyWorkspaceHeader(gatewaySecret, id, sig)) return notThroughGateway(reply);
    const doors = doorsFromHeaders(gatewaySecret, id, header(req, DOORS_HEADER), header(req, DOORS_SIG_HEADER));
    if (!doors) return notThroughGateway(reply);
    req.workspaceId = id;
    req.prefix = header(req, FORWARDED_PREFIX_HEADER) ?? "";
    req.doors = doors;
    req.bridge = BridgeCredential.of(gatewaySecret, id, header(req, "cookie"));
    req.door = requestDoor(req, req.bridge);
    if (isClosed(req, gatewaySecret)) return reply.code(404).send({ error: "NOT_FOUND" });
  });
  app.addHook("onSend", async (req, reply, payload) => {
    const minted = req.bridge?.mintedCookie;
    if (minted) reply.header("set-cookie", bridgeSetCookie(minted, `${req.prefix}/`));
    return payload;
  });
}
