import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Edition } from "../editions/editions.js";
import type { ArticleRef, PageViews, ServedPage } from "./page-views.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Set by the route that served the request; the recorder writes it as served. */
    guideView: { page: ServedPage; product?: string; article?: ArticleRef; edition?: Edition | null } | null;
  }
}

const UNRECORDED = ["/healthz", "/readyz", "/internal/"];

const first = (v: string | string[] | undefined): string | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/** The edition as a record carries it: what was served, by name — never the content itself. */
export function editionRef(e: Edition): { seed: number; category: string; arm: string; target: string } {
  return { seed: e.seed, category: e.category.key, arm: e.arm.key, target: e.target.slug };
}

/**
 * Records every page a workspace is served, as it is sent (onSend: the record is written before the client has the
 * page, so a page a run read is never missing from its records): path, status, what the page was (the route's own
 * label), the edition, and the client's user agent and referer. A record that cannot be written is logged and never
 * fails the response — the agent under study must see the same site whether or not the database is slow.
 */
export function registerRecorder(app: FastifyInstance, views: PageViews): void {
  app.decorateRequest("guideView", null);
  app.addHook("onSend", async (req: FastifyRequest, reply, payload) => {
    const [path = "/", query] = req.url.split("?", 2);
    if (!req.workspaceId || UNRECORDED.some((p) => path === p || (p.endsWith("/") && path.startsWith(p)))) return payload;
    const view = req.guideView ?? { page: "not_found" as const };
    try {
      await views.record({
        workspaceId: req.workspaceId,
        method: req.method,
        path,
        query: query ?? null,
        status: reply.statusCode,
        page: view.page,
        product: view.product ?? null,
        article: view.article ?? null,
        edition: view.edition ? editionRef(view.edition) : null,
        userAgent: first(req.headers["user-agent"]),
        referer: first(req.headers.referer),
      });
    } catch (err) {
      req.log.error({ err: (err as Error).message, path }, "a page view could not be recorded");
    }
    return payload;
  });
}
