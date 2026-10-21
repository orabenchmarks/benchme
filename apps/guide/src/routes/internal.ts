import type { FastifyInstance, FastifyRequest } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { corpusEntry } from "../editions/corpus.js";
import type { EditionTable } from "../editions/editions.js";
import type { PageViews } from "../records/page-views.js";

/** The gateway's operator header: the same key that lets a benchmark's own tooling skip the mint rate limit. */
export const OPERATOR_HEADER = "x-benchme-operator-key";

const recordsQuery = z
  .object({
    workspace: z.string().min(1).optional(),
    since: z.coerce.number().int().min(0).optional(),
    limit: z.coerce.number().int().min(1).max(5000).default(1000),
  })
  .refine((q) => (q.workspace === undefined) !== (q.since === undefined), { message: "name exactly one of workspace or since" });

function authorized(req: FastifyRequest, key: string): boolean {
  const raw = req.headers[OPERATOR_HEADER];
  const given = Buffer.from((Array.isArray(raw) ? raw[0] : raw) ?? "");
  const want = Buffer.from(key);
  return given.length === want.length && timingSafeEqual(given, want);
}

/**
 * The study's doors, behind the operator key (never the workspace): every page a workspace was served, a bulk export
 * of all of them, and the edition corpus a study builds its prompts from. Reachable in-cluster and — with the key —
 * through any workspace's /w/<id>/guide/internal/ path; an agent under study holds no key.
 */
export function registerInternal(app: FastifyInstance, d: { operatorKey: string; views: PageViews; table: EditionTable }): void {
  app.register(
    async (internal) => {
      internal.addHook("onRequest", async (req, reply) => {
        if (!authorized(req, d.operatorKey)) return reply.code(401).send({ error: "UNAUTHORIZED" });
      });
      internal.get("/records", async (req) => {
        const q = recordsQuery.parse(req.query);
        if (q.workspace !== undefined) return { workspace: q.workspace, views: await d.views.ofWorkspace(q.workspace) };
        const views = await d.views.since(q.since as number, q.limit);
        return { views, next: views.at(-1)?.seq ?? q.since };
      });
      internal.get("/editions", async () => ({ scenario: "guide-v1", editions: d.table.all().map(corpusEntry) }));
    },
    { prefix: "/internal" },
  );
}
