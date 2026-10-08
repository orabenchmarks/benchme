import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { STATUSES, type SpendRequestRow } from "../domain/types.js";
import { recordView } from "../domain/view.js";
import { hasInternalSecret, publicBase, type RouteDeps } from "./deps.js";

const WORKSPACE = /^ws_[0-9a-f]{12}$/;
const recordsQuery = z
  .object({
    workspace: z.string().regex(WORKSPACE).optional(),
    session: z.string().regex(/^lwses_[0-9a-f]{24}$/).optional(),
    request: z.string().regex(/^lsrq_[0-9a-f]{24}$/).optional(),
    since: z.string().datetime({ offset: true }).optional(),
    limit: z.coerce.number().int().positive().max(5000).default(1000),
  })
  .refine((q) => [q.workspace, q.session, q.request, q.since].filter((v) => v !== undefined).length === 1, "exactly one of workspace, session, request, since");
const approvalsQuery = z.object({ workspace: z.string().regex(WORKSPACE), store: z.string().regex(/^[a-z][a-z0-9-]{1,40}$/) });
const forceBody = z.object({ status: z.enum(STATUSES) });

/**
 * The wallet's internal API, behind WALLET_INTERNAL_SECRET (header x-benchme-internal-secret; 401 otherwise) —
 * never for a shopper. Every read first applies what fell due on the clock.
 *
 *   GET  /internal/records?workspace=|session=|request=|since=   the requests (bound to the workspace, made by the
 *        session, the one request, or created since) with their bindings, flags (binding_fallback), the issued
 *        card's kind and last four, and every event of them and their sessions: request, response, status change.
 *   GET  /internal/approvals?workspace=&store=    { approvedCents, requests }: the largest live approval for the
 *        workspace's store — what the store compares a charge against ("paid above approval").
 *   POST /internal/spend-requests/:id/status {status}   sets a status by hand: how the contract checks reach every
 *        status link-cli knows (requires_action with an auto-resuming 3-D Secure step, expired, denied, …).
 */
export function registerInternalRoutes(app: FastifyInstance, d: RouteDeps): void {
  app.register(
    async (internal) => {
      internal.addHook("onRequest", async (req, reply) => {
        if (!hasInternalSecret(req, d.internalSecret)) return reply.code(401).send({ error: "UNAUTHORIZED", message: "the internal secret is required" });
      });

      internal.get("/records", async (req, reply) => {
        const q = recordsQuery.safeParse(req.query);
        if (!q.success) return reply.code(400).send({ error: "BAD_QUERY", message: q.error.issues[0]?.message ?? "bad query" });
        let rows: SpendRequestRow[];
        if (q.data.workspace) rows = await d.requests.bound(q.data.workspace, null);
        else if (q.data.session) rows = await d.requests.ofSession(q.data.session, true);
        else if (q.data.request) rows = (await d.requests.get(q.data.request).then((r) => (r ? [r] : []))) as SpendRequestRow[];
        else rows = await d.requests.since(new Date(q.data.since as string), q.data.limit);
        const fresh = await Promise.all(rows.map((r) => d.spendRequests.refresh(r)));
        const events = await d.events.of([...new Set(fresh.map((r) => r.sessionId)), ...(q.data.session ? [q.data.session] : [])], fresh.map((r) => r.id));
        reply.header("cache-control", "no-store");
        return { requests: fresh.map(recordView), events };
      });

      internal.get("/approvals", async (req, reply) => {
        const q = approvalsQuery.safeParse(req.query);
        if (!q.success) return reply.code(400).send({ error: "BAD_QUERY", message: "?workspace=<workspace id>&store=<store> are required" });
        const { approvedCents, requests } = await d.spendRequests.approvals(q.data.workspace, q.data.store);
        reply.header("cache-control", "no-store");
        return { workspace: q.data.workspace, store: q.data.store, approvedCents, requests: requests.map(recordView) };
      });

      internal.post<{ Params: { id: string } }>("/spend-requests/:id/status", async (req, reply) => {
        const b = forceBody.safeParse(req.body);
        if (!b.success) return reply.code(400).send({ error: "BAD_STATUS", message: `status must be one of ${STATUSES.join(", ")}` });
        const r = await d.spendRequests.force(req.params.id, b.data.status, `${publicBase(req, d.publicUrl)}/approvals/${req.params.id}`);
        return recordView(r);
      });
    },
    { prefix: "/internal" },
  );
}
