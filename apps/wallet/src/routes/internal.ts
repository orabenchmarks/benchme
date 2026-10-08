import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { savedCardRecord } from "../domain/saved-card.js";
import { STATUSES, type SpendRequestRow } from "../domain/types.js";
import { recordView } from "../domain/view.js";
import type { SavedCardRow } from "../db/saved-cards-repo.js";
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
const approvalsQuery = z
  .object({
    workspace: z.string().regex(WORKSPACE),
    store: z.string().regex(/^[a-z][a-z0-9-]{1,40}$/),
    /** The payment being classed: what it charged, and the last four of its card ("" — a payment made without a card). */
    amountCents: z.coerce.number().int().positive().max(1_000_000).optional(),
    last4: z.string().regex(/^(\d{4})?$/).optional(),
  })
  .refine((q) => (q.amountCents === undefined) === (q.last4 === undefined), "amountCents and last4 come together");
const forceBody = z.object({ status: z.enum(STATUSES) });

/**
 * The wallet's internal API, behind WALLET_INTERNAL_SECRET (header x-benchme-internal-secret; 401 otherwise) —
 * never for a shopper. Every read first applies what fell due on the clock.
 *
 *   GET  /internal/records?workspace=|session=|request=|since=   the requests (bound to the workspace, made by the
 *        session, the one request, or created since) with their bindings, flags (binding_fallback), the issued
 *        card's kind and last four, and every event of them and their sessions: request, response, status change.
 *        ?workspace= also answers the card-on-file door's side: `savedCards` (each card the door showed the
 *        workspace — kind, brand, last four, the stores it was shown for) and every read of the door among the
 *        events (kind card_on_file: outcome shown | no_store | ambiguous | unavailable, the card's kind and last
 *        four, the stores, the format and the client).
 *   GET  /internal/approvals?workspace=&store=[&amountCents=&last4=]    { approvedCents, walletCard, cardOnFile,
 *        claimed, requests }: the largest live approval for the workspace's store — what the store compares a charge
 *        against ("paid above approval"; the door approves nothing); with the payment being classed, whether its
 *        card (last four; empty for no card) is one the wallet issued for that store (walletCard) — a spend
 *        request's, after binding a fallback request it pays exactly (claimed: its id), or the saved card the door
 *        showed the workspace for that store (cardOnFile: such a payment claims nothing).
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
        const workspaces = q.data.workspace ? [q.data.workspace] : [];
        const events = await d.events.of([...new Set(fresh.map((r) => r.sessionId)), ...(q.data.session ? [q.data.session] : [])], fresh.map((r) => r.id), workspaces);
        reply.header("cache-control", "no-store");
        if (!q.data.workspace) return { requests: fresh.map(recordView), events };
        return { requests: fresh.map(recordView), events, savedCards: (await d.savedCards.ofWorkspace(q.data.workspace)).map(savedCardRecordView) };
      });

      internal.get("/approvals", async (req, reply) => {
        const q = approvalsQuery.safeParse(req.query);
        if (!q.success) return reply.code(400).send({ error: "BAD_QUERY", message: "?workspace=<workspace id>&store=<store>[&amountCents=<cents>&last4=<dddd or empty>]" });
        const { workspace, store, amountCents, last4 } = q.data;
        const paying = amountCents === undefined ? null : { amountCents, last4: last4 || null };
        const a = await d.payments.approvals(workspace, store, paying);
        reply.header("cache-control", "no-store");
        return { workspace, store, approvedCents: a.approvedCents, walletCard: a.walletCard, cardOnFile: a.cardOnFile, claimed: a.claimed, requests: a.requests.map(recordView) };
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

/** A saved card as the records show it: its kind, brand and last four — never the number or CVC — and where it was shown. */
function savedCardRecordView(c: SavedCardRow): Record<string, unknown> {
  return {
    ...savedCardRecord(c.card),
    issuedAt: c.issuedAt.toISOString(),
    stores: c.stores.map((s) => ({ store: s.store, scenarioId: s.scenarioId, shownAt: s.shownAt.toISOString() })),
  };
}
