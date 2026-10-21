import { FORWARDED_PREFIX_HEADER, PgWorkspaceRepo, WORKSPACE_HEADER, WORKSPACE_SIG_HEADER, createApp, isWorkspaceId, verifyWorkspaceHeader, type Pool } from "@benchme/core";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { EditionTable } from "./editions/editions.js";
import { WorkspaceEditionResolver, defaultEditionTable } from "./editions/resolver.js";
import { PgPageViews, type PageViews } from "./records/page-views.js";
import { registerRecorder } from "./records/recorder.js";
import { registerInternal } from "./routes/internal.js";
import { registerPages } from "./routes/pages.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Bound by the gateway (signed). */
    workspaceId: string;
    /** The public path prefix the gateway stripped ("/w/<id>/guide"): every link is built on it. */
    prefix: string;
  }
}

export type BuildDeps = {
  pool: Pool;
  gatewaySecret: string;
  /** Guards /internal/* (records, editions): the gateway's operator key. */
  operatorKey: string;
  /** The edition table; the shipped one when absent (tests inject their own). */
  table?: EditionTable;
  /** Where page views are recorded; guide.page_views when absent. */
  views?: PageViews;
  logLevel?: string;
};

const header = (req: FastifyRequest, name: string): string | undefined => {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
};

/** The workspace comes ONLY from the gateway's signed header; /internal/* is authenticated by the operator key instead. */
function registerScope(app: FastifyInstance, secret: string): void {
  app.decorateRequest("workspaceId", "");
  app.decorateRequest("prefix", "");
  app.addHook("onRequest", async (req, reply) => {
    const path = req.url.split("?")[0] ?? "";
    if (path === "/healthz" || path === "/readyz" || path.startsWith("/internal/")) return;
    const id = header(req, WORKSPACE_HEADER);
    const sig = header(req, WORKSPACE_SIG_HEADER);
    if (!id || !isWorkspaceId(id) || !sig || !verifyWorkspaceHeader(secret, id, sig)) {
      return reply.code(401).send({ error: "NO_WORKSPACE", message: "requests must come through the benchme gateway" });
    }
    req.workspaceId = id;
    req.prefix = header(req, FORWARDED_PREFIX_HEADER) ?? "";
  });
}

/** The buyer's guide: pages chosen by the workspace's edition, and a record of every page each workspace was served. */
export async function buildGuide(d: BuildDeps): Promise<FastifyInstance> {
  const app = createApp({ name: "guide", readiness: async () => (await d.pool.query("SELECT 1")).rowCount === 1, ...(d.logLevel ? { logLevel: d.logLevel } : {}) });
  const table = d.table ?? defaultEditionTable();
  const views = d.views ?? new PgPageViews(d.pool);
  registerScope(app, d.gatewaySecret);
  registerRecorder(app, views);
  registerPages(app, new WorkspaceEditionResolver(new PgWorkspaceRepo(d.pool), table));
  registerInternal(app, { operatorKey: d.operatorKey, views, table });
  return app;
}
