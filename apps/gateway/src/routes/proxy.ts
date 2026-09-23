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

/**
 * /w/:id/<app>/* → <app>/*, with the workspace bound as a signed header and the
 * stripped prefix forwarded so the app can render links and cookie paths.
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

    const rest = req.params["*"] ?? "";
    const qs = req.raw.url?.includes("?") ? req.raw.url.slice(req.raw.url.indexOf("?")) : "";
    return reply.from(`${target.baseUrl}/${rest}${qs}`, {
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

  // "/w/:id/<app>" (no trailing path) → the app root.
  app.all<{ Params: { id: string; app: string } }>("/w/:id/:app", async (req, reply) => {
    return reply.redirect(`/w/${req.params.id}/${req.params.app}/`, 302);
  });
}
