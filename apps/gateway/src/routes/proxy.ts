import replyFrom from "@fastify/reply-from";
import { FORWARDED_PREFIX_HEADER, WORKSPACE_HEADER, WORKSPACE_SIG_HEADER, isWorkspaceId, signWorkspaceHeader } from "@benchme/core";
import type { FastifyInstance } from "fastify";
import type { AppRegistry } from "../app-registry.js";
import type { WorkspaceService } from "../workspace-service.js";

export type ProxyDeps = {
  apps: AppRegistry;
  service: WorkspaceService;
  gatewaySecret: string;
  /** The gateway's own public URL: what the app must advertise, not the internal target reply-from rewrites Host to. */
  publicBaseUrl: string;
};

/** The query exactly as the client sent it: "?…" byte for byte, or "" when the request-target has none. */
function rawQuery(url: string | undefined): string {
  const at = url?.indexOf("?") ?? -1;
  return url !== undefined && at >= 0 ? url.slice(at) : "";
}

/**
 * The path after "/w/<id>/<app>/" exactly as the client sent it, or null for a request-target that is not
 * origin-form. The router hands the wildcard over decoded: forwarded as such, "%2F" would split a segment
 * and "%25FF" would reach the app as the malformed escape "%FF".
 */
function rawRest(url: string | undefined): string | null {
  if (!url?.startsWith("/")) return null;
  const end = url.search(/[?#]/);
  const path = end < 0 ? url : url.slice(0, end);
  let at = 0;
  for (let n = 0; n < 3; n++) {
    at = path.indexOf("/", at + 1);
    if (at < 0) return null;
  }
  return path.slice(at + 1);
}

/** Whether every percent-escape of `url` decodes as UTF-8, as reply-from requires of a URL it forwards to. */
function decodable(url: string): boolean {
  try {
    decodeURIComponent(url);
    return true;
  } catch {
    return false;
  }
}

/** What every per-run page answers with, whatever app serves it: no search index, no link followed (robots.ts). */
export const PER_RUN_ROBOTS = "noindex, nofollow";

/**
 * /w/:id/<app>/* → <app>/*, with the workspace bound as a signed header and the
 * stripped prefix forwarded so the app can render links and cookie paths. A minted
 * (per-run) workspace's responses carry `X-Robots-Tag: noindex, nofollow` — every
 * app's, not only those that set their own; the shared workspace's are left as the
 * app answers them (its schema maps are meant to be found).
 */
export async function registerProxy(app: FastifyInstance, d: ProxyDeps): Promise<void> {
  await app.register(replyFrom);
  // reply-from rewrites Host to the TARGET (e.g. "warehouse:3000"), so an app
  // deriving its public base from Host would advertise an unreachable
  // robots.txt / schema map (live-verified). Forward the gateway's own public
  // host + scheme instead; `defaultPublicBaseUrl` prefers these over Host.
  const publicUrl = new URL(d.publicBaseUrl);
  const forwardedHost = publicUrl.host;
  const forwardedProto = publicUrl.protocol.replace(/:$/, "");

  app.all<{ Params: { id: string; app: string; "*": string } }>("/w/:id/:app/*", async (req, reply) => {
    const { app: appName } = req.params;
    let id = req.params.id;
    if (id.startsWith("shared-")) {
      const resolved = await d.service.resolveShared(id);
      if (!resolved) return reply.code(404).send({ error: "NOT_FOUND", message: "no such shared workspace (shared-<scenario>-<seed>)" });
      id = resolved;
    }
    if (!isWorkspaceId(id)) return reply.code(404).send({ error: "NOT_FOUND", message: "no such workspace" });
    const target = d.apps.get(appName);
    if (!target) return reply.code(404).send({ error: "NOT_FOUND", message: `no such app "${appName}"` });
    if (!(await d.service.isServable(id))) return reply.code(404).send({ error: "NOT_FOUND", message: "workspace unknown or expired" });

    const rest = rawRest(req.raw.url) ?? req.params["*"] ?? "";
    const source = `${target.baseUrl}/${rest}${rawQuery(req.raw.url)}`;
    // reply-from decodes the URL before forwarding it (its path-traversal check), and an escape that is not
    // UTF-8 ("%FF", "%C3%28", a lone surrogate, a bare "%") throws there: the client's mistake, said as such.
    if (!decodable(source)) return reply.code(400).send({ error: "BAD_URL", message: "the address has a malformed percent-escape" });
    const perRun = !req.params.id.startsWith("shared-");
    return reply.from(source, {
      ...(perRun ? { rewriteHeaders: (headers: Record<string, unknown>) => ({ ...headers, "x-robots-tag": PER_RUN_ROBOTS }) } : {}),
      rewriteRequestHeaders: (_r, headers) => ({
        ...headers,
        [WORKSPACE_HEADER]: id,
        [WORKSPACE_SIG_HEADER]: signWorkspaceHeader(d.gatewaySecret, id),
        [FORWARDED_PREFIX_HEADER]: `/w/${req.params.id}/${appName}`,
        "x-forwarded-host": forwardedHost,
        "x-forwarded-proto": forwardedProto,
      }),
    });
  });

  // "/w/:id/<app>" (no trailing path) → the app root, query kept byte for byte. Every prompt
  // opens urls.apps.<store> (advertised without a trailing slash) with ?utm_campaign=<code>
  // appended, and that code is what selects the run's scenario. The router hands the
  // segments over decoded: they are encoded again so none can put a CR/LF into Location.
  app.all<{ Params: { id: string; app: string } }>("/w/:id/:app", async (req, reply) => {
    const { id, app: appName } = req.params;
    return reply.redirect(`/w/${encodeURIComponent(id)}/${encodeURIComponent(appName)}/${rawQuery(req.raw.url)}`, 302);
  });
}
