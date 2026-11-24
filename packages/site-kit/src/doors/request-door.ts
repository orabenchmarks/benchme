import { VERIFIER_SIG_HEADER, verifyVerifierHeader, type Door } from "@benchme/core";
import type { FastifyRequest } from "fastify";
import { header } from "../request-header.js";
import { BRIDGE_TOKEN_HEADER, type BridgeCredential } from "./bridge-credential.js";
import { doorOf } from "./door.js";

/**
 * The path a request was routed by: its route's own pattern, so an escape
 * (`/%61pi/v1/…`, which the router decodes to the REST route) cannot pass the
 * REST API off as a page; the URL's path where no route matched.
 */
export function routedPath(req: FastifyRequest): string {
  return req.routeOptions.url ?? req.url.split("?")[0] ?? "";
}

/** The door `req` came through: its route, and at /mcp whether it proves it is a page's bridge. */
export function requestDoor(req: FastifyRequest, bridge: BridgeCredential): Door | null {
  return doorOf(routedPath(req), bridge.proves(header(req, BRIDGE_TOKEN_HEADER)));
}

/** The verifier reading state after the fact: its own signature, made with the gateway secret, for this workspace. */
export function isObserver(req: FastifyRequest, gatewaySecret: string): boolean {
  return verifyVerifierHeader(gatewaySecret, req.workspaceId, header(req, VERIFIER_SIG_HEADER) ?? "");
}

/**
 * Whether `req` came through a door its workspace is not served through. The
 * verifier's own reads are no visitor's, so no door is closed to them: only a
 * holder of the gateway secret can sign one, and the gateway itself never does.
 */
export function isClosed(req: FastifyRequest, gatewaySecret: string): boolean {
  return req.door !== null && !req.doors.has(req.door) && !isObserver(req, gatewaySecret);
}
