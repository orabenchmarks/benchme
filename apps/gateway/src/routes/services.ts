import { WORKSPACE_HEADER, WORKSPACE_SIG_HEADER } from "@benchme/core";
import type { FastifyInstance } from "fastify";

/** Paths the gateway answers itself: a service may not take them. */
export const RESERVED_SERVICE_NAMES = ["w", "api", "registry", "robots.txt", "healthz", "readyz"] as const;

const NAME = /^[a-z][a-z0-9-]{1,40}$/;

/** Checks SERVICE_TARGETS names: a path segment of their own, none the gateway answers itself. */
export function checkServiceNames(services: Record<string, string>): void {
  for (const name of Object.keys(services)) {
    if ((RESERVED_SERVICE_NAMES as readonly string[]).includes(name)) throw new Error(`SERVICE_TARGETS names "${name}", a path the gateway answers itself`);
    if (!NAME.test(name)) throw new Error(`SERVICE_TARGETS names "${name}": a service name is a lowercase path segment`);
  }
}

export type ServicesDeps = {
  /** name → base URL: /<name>/x is served by <url>/x. */
  services: Record<string, string>;
  /** The gateway's own public URL: what the service must advertise (reply-from rewrites Host to the target). */
  publicBaseUrl: string;
};

/** The request-target after "/<name>/", exactly as the client sent it (path and query). */
function rawRest(url: string, name: string): string {
  return url.slice(name.length + 2);
}

function decodable(url: string): boolean {
  try {
    decodeURIComponent(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Services the gateway fronts at its ROOT, outside any workspace: /<name>/* → <url>/*. For a tool a run is
 * configured with before it has a workspace — the wallet stand-in link-cli is pointed at (LINK_API_BASE_URL =
 * <public>/wallet/api) — which binds what it serves to a run by its own means. No workspace header is ever
 * forwarded (a client's own is dropped); the public host and scheme and the stripped prefix are, so the
 * service can write its own links.
 */
export async function registerServices(app: FastifyInstance, d: ServicesDeps): Promise<void> {
  checkServiceNames(d.services);
  const publicUrl = new URL(d.publicBaseUrl);
  const forwardedProto = publicUrl.protocol.replace(/:$/, "");
  for (const [name, target] of Object.entries(d.services)) {
    const base = target.replace(/\/+$/, "");
    app.all(`/${name}/*`, async (req, reply) => {
      const source = `${base}/${rawRest(req.raw.url ?? "", name)}`;
      if (!decodable(source)) return reply.code(400).send({ error: "BAD_URL", message: "the address has a malformed percent-escape" });
      return reply.from(source, {
        rewriteRequestHeaders: (_r, headers) => {
          const { [WORKSPACE_HEADER]: _ws, [WORKSPACE_SIG_HEADER]: _sig, ...rest } = headers;
          return { ...rest, "x-forwarded-prefix": `/${name}`, "x-forwarded-host": publicUrl.host, "x-forwarded-proto": forwardedProto };
        },
      });
    });
    app.all(`/${name}`, async (req, reply) => {
      const at = req.raw.url?.indexOf("?") ?? -1;
      return reply.redirect(`/${name}/${at >= 0 ? (req.raw.url as string).slice(at) : ""}`, 302);
    });
  }
}
