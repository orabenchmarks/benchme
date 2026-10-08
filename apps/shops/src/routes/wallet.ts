import { isWorkspaceId } from "@benchme/core";
import { header } from "@benchme/site-kit";
import type { StoreId } from "@benchme/storefront";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { STORE_IDS } from "../sites.js";
import { STORES } from "../stores/index.js";
import { payableCents, scenarioOf } from "./checkout.js";
import type { RouteDeps } from "./index.js";

/** The internal secret, compared in constant time. */
function hasSecret(req: FastifyRequest, secret: string): boolean {
  const given = Buffer.from(header(req, "x-benchme-internal-secret") ?? "");
  const want = Buffer.from(secret);
  return given.length === want.length && timingSafeEqual(given, want);
}

/** What the wallet binds a spend request to: a workspace's store, its newest open checkout, and the card its scenario calls for. */
export type WalletMatch = {
  workspace: string;
  store: StoreId;
  checkout: string | null;
  payableCents: number | null;
  scenarioId: string | null;
  card: "success" | "3ds" | "decline";
};

const query = z.union([
  z.object({ workspace: z.string().max(64) }).strict(),
  z.object({ amountCents: z.coerce.number().int().positive().max(1_000_000), withinMinutes: z.coerce.number().int().positive().max(24 * 60).default(60) }).strict(),
  z.object({ session: z.string().regex(/^cs_[a-z]+_[A-Za-z0-9]{1,255}$/) }).strict(),
]);

/** The most open checkouts the amount search reads (a busy hour of a full study is well under it). */
const AMOUNT_SCAN_LIMIT = 2000;

async function matchOf(d: RouteDeps, ws: string, store: StoreId, token: string | null): Promise<WalletMatch> {
  const def = STORES[store];
  const checkout = token ? await d.repos.checkouts.get(ws, token) : await d.repos.checkouts.latestOpen(ws, store);
  const scenario = await scenarioOf(d, ws, store);
  return {
    workspace: ws,
    store,
    checkout: checkout?.token ?? null,
    payableCents: checkout && def ? await payableCents(d, ws, def, checkout) : null,
    scenarioId: scenario?.id ?? null,
    card: scenario?.card ?? "success",
  };
}

/**
 * GET /s/<store>/internal/wallet-matches — the wallet stand-in (apps/wallet) asks which run a spend request
 * pays for (DESIGN §6.3), behind the internal secret (401 otherwise). On a store's site it answers for that
 * store; on paylantern for every store (as the state API does).
 *
 *   ?workspace=<id>                          the stores of that workspace a shopper has been to (a campaign code,
 *                                            a cart or a checkout there), each with its newest open checkout
 *   ?amountCents=<n>&withinMinutes=<m>       the open checkouts started in the last m minutes, in workspaces that
 *                                            have no paid order at that store, that would charge exactly n now —
 *                                            one per workspace's store
 *   ?session=<Checkout Session id>           the checkout a store created that hosted payment page for (Stripe's
 *                                            checkout.stripe.com/c/pay/<id>, or fake mode's own): none, or one
 *
 * Each match: { workspace, store, checkout, payableCents, scenarioId, card } — card is what the store's scenario
 * calls for (success, 3ds or decline; success without a scenario).
 */
export function registerWalletRoutes(scope: FastifyInstance, d: RouteDeps): void {
  scope.get("/internal/wallet-matches", async (req, reply) => {
    if (!hasSecret(req, d.internalSecret)) return reply.code(401).send({ error: "UNAUTHORIZED", message: "the internal secret is required" });
    const q = query.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "BAD_QUERY", message: "?workspace=<id>, ?amountCents=<cents>[&withinMinutes=<m>] or ?session=<Checkout Session id>" });
    const stores = req.site === "paylantern" ? [...STORE_IDS] : [req.site as StoreId];
    reply.header("cache-control", "no-store");

    if ("workspace" in q.data) {
      const ws = q.data.workspace;
      if (!isWorkspaceId(ws)) return { matches: [] };
      const visited = await d.pool.query<{ store: StoreId }>(
        `SELECT store FROM shops.store_state WHERE workspace_id = $1 AND store = ANY($2)
         UNION SELECT store FROM shops.carts WHERE workspace_id = $1 AND store = ANY($2)
         UNION SELECT store FROM shops.checkouts WHERE workspace_id = $1 AND store = ANY($2)`,
        [ws, stores],
      );
      const found = STORE_IDS.filter((s) => visited.rows.some((r) => r.store === s));
      return { matches: await Promise.all(found.map((s) => matchOf(d, ws, s, null))) };
    }

    if ("session" in q.data) {
      const made = await d.pool.query<{ workspace_id: string; store: StoreId; checkout_token: string }>(
        "SELECT workspace_id, store, checkout_token FROM shops.payments WHERE payment_ref = $1 AND kind = 'session' AND store = ANY($2)",
        [q.data.session, stores],
      );
      return { matches: await Promise.all(made.rows.map((r) => matchOf(d, r.workspace_id, r.store, r.checkout_token))) };
    }

    const { amountCents, withinMinutes } = q.data;
    const open = await d.pool.query<{ workspace_id: string; store: StoreId; token: string }>(
      `SELECT DISTINCT ON (c.workspace_id, c.store) c.workspace_id, c.store, c.token
       FROM shops.checkouts c
       WHERE c.status = 'open' AND c.store = ANY($1) AND c.created_at >= now() - make_interval(mins => $2)
         AND NOT EXISTS (SELECT 1 FROM shops.orders o WHERE o.workspace_id = c.workspace_id AND o.store = c.store)
       ORDER BY c.workspace_id, c.store, c.created_at DESC, c.token DESC
       LIMIT ${AMOUNT_SCAN_LIMIT}`,
      // The database's clock, which stamped created_at.
      [stores, withinMinutes],
    );
    const all = await Promise.all(open.rows.map((r) => matchOf(d, r.workspace_id, r.store, r.token)));
    return { matches: all.filter((m) => m.payableCents === amountCents) };
  });
}
