import type { FastifyRequest } from "fastify";

/**
 * The standard `SchemaDeps.publicBaseUrl`: the gateway's forwarded proto and
 * host, plus the request-time forwarded prefix (`req.prefix` — which, under a
 * `shared-<scenario>-<seed>` alias, is NOT the same as a prefix rebuilt from
 * `req.workspaceId`; see `AskDeps.items`'s doc comment). Every app wires this
 * one function rather than carrying its own copy; a site behind a different
 * edge can still supply its own.
 */
export function defaultPublicBaseUrl(req: FastifyRequest): string {
  return `${req.headers["x-forwarded-proto"] ?? "http"}://${req.headers.host}${req.prefix}`;
}
