import { VERIFIER_SIG_HEADER, verifyVerifierHeader } from "@benchme/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { header } from "../request-header.js";
import type { LedgerPage } from "./entry.js";
import type { Ledger } from "./ledger.js";

/** Where the verifier reads a workspace's ledger, on the app's own address. */
export const ledgerPath = (workspaceId: string): string => `/internal/workspaces/${workspaceId}/ledger`;

const query = z.object({ cursor: z.coerce.number().int().min(0).default(0), limit: z.coerce.number().int().min(1).max(1000).default(500) });

/**
 * The ledger's only reader is the verifier, behind two locks. The route sits
 * under /internal/workspaces/, which the gateway never proxies, so no address
 * an agent can open leads here. And it answers only a request that carries the
 * verifier's signature, made with the gateway secret no client holds: a
 * request without one is told there is no such page.
 */
export function registerLedgerRoute(app: FastifyInstance, d: { ledger: Ledger; gatewaySecret: string }): void {
  app.get<{ Params: { id: string } }>("/internal/workspaces/:id/ledger", async (req, reply): Promise<LedgerPage | undefined> => {
    const fromVerifier = verifyVerifierHeader(d.gatewaySecret, req.workspaceId, header(req, VERIFIER_SIG_HEADER) ?? "");
    if (!fromVerifier || req.params.id !== req.workspaceId) return reply.code(404).send({ error: "NOT_FOUND" });
    const q = query.parse(req.query);
    const rows = await d.ledger.list(req.workspaceId, q.cursor, q.limit + 1);
    const items = rows.slice(0, q.limit);
    return { items, nextCursor: rows.length > q.limit ? String(items[items.length - 1]?.seq ?? q.cursor) : null };
  });
}
