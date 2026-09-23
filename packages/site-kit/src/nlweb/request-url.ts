import type { FastifyRequest } from "fastify";

/** First value of a possibly-repeated, possibly-comma-chained forwarding header. */
function forwarded(req: FastifyRequest, name: string): string | undefined {
  const raw = req.headers[name];
  const first = Array.isArray(raw) ? raw[0] : raw;
  return first?.split(",")[0]?.trim() || undefined;
}

/**
 * The standard `SchemaDeps.publicBaseUrl`: the gateway's forwarded proto and
 * host, plus the request-time forwarded prefix (`req.prefix` — which, under a
 * `shared-<scenario>-<seed>` alias, is NOT the same as a prefix rebuilt from
 * `req.workspaceId`; see `AskDeps.items`'s doc comment). Every app wires this
 * one function rather than carrying its own copy; a site behind a different
 * edge can still supply its own.
 *
 * `x-forwarded-host` WINS over `host`: the gateway proxies with reply-from,
 * which rewrites Host to the INTERNAL target ("warehouse:3000"), so a site
 * trusting `host` would advertise a robots.txt / schema map URL no crawler
 * can reach (live-verified). Only the first value of a comma-separated chain
 * is used — that is the original client's host; the rest are inner hops.
 */
export function defaultPublicBaseUrl(req: FastifyRequest): string {
  const host = forwarded(req, "x-forwarded-host") ?? req.headers.host;
  return `${forwarded(req, "x-forwarded-proto") ?? "http"}://${host}${req.prefix}`;
}
