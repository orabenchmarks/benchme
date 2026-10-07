import { WORKSPACE_HEADER, WORKSPACE_SIG_HEADER, isWorkspaceId, verifyWorkspaceHeader } from "@benchme/core";
import { header } from "@benchme/site-kit";
import type { StoreId } from "@benchme/storefront";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Checkout, PaymentRow } from "../db/index.js";
import { STORE_IDS } from "../sites.js";
import { STORES } from "../stores/index.js";
import { payableCents } from "./checkout.js";
import type { RouteDeps } from "./index.js";
import { reconcileStore } from "./pay.js";

/**
 * The workspace the gateway signed for, or null. /s/<site>/internal/ is outside the
 * workspace scope (the read API there authenticates with the internal secret), so a
 * gateway call to it is verified here.
 */
function gatewayWorkspace(req: FastifyRequest, secret: string): string | null {
  const id = header(req, WORKSPACE_HEADER);
  const sig = header(req, WORKSPACE_SIG_HEADER);
  return id && isWorkspaceId(id) && sig && verifyWorkspaceHeader(secret, id, sig) ? id : null;
}

/** The internal secret, compared in constant time. */
function hasSecret(req: FastifyRequest, secret: string): boolean {
  const given = Buffer.from(header(req, "x-benchme-internal-secret") ?? "");
  const want = Buffer.from(secret);
  return given.length === want.length && timingSafeEqual(given, want);
}

type CheckoutRow = {
  token: string;
  store: string;
  status: Checkout["status"];
  contact: Checkout["contact"];
  address: Checkout["address"];
  delivery: Checkout["delivery"];
  shipping_id: string | null;
  add_ons: string[];
  flags: Record<string, unknown>;
  payment_ref: string | null;
  created_at: Date;
  updated_at: Date;
};

/** A workspace's checkouts, oldest first (the repo reads one at a time; the audit wants them all). */
async function checkoutsOf(d: Pick<RouteDeps, "pool">, ws: string): Promise<CheckoutRow[]> {
  const r = await d.pool.query<CheckoutRow>(
    "SELECT token, store, status, contact, address, delivery, shipping_id, add_ons, flags, payment_ref, created_at, updated_at FROM shops.checkouts WHERE workspace_id = $1 ORDER BY created_at, token",
    [ws],
  );
  return r.rows;
}

/**
 * A checkout as the audit reads it: everything but the intent's client secret, plus what it would charge now. The
 * payment claim a step may hold at the moment (db/claims.ts) is the store's own bookkeeping: left out.
 */
async function checkoutView(d: RouteDeps, ws: string, r: CheckoutRow): Promise<object> {
  const { paymentIntent, paymentClaim: _claim, ...flags } = r.flags;
  const intentId = (paymentIntent as { id?: unknown } | undefined)?.id;
  const checkout: Checkout = { token: r.token, store: r.store, status: r.status, contact: r.contact, address: r.address, delivery: r.delivery, shippingId: r.shipping_id, addOns: r.add_ons, flags: r.flags, paymentRef: r.payment_ref };
  const store = STORES[r.store as StoreId];
  return {
    token: r.token,
    store: r.store,
    status: r.status,
    contact: r.contact,
    address: r.address,
    delivery: r.delivery,
    shippingId: r.shipping_id,
    addOns: r.add_ons,
    flags: typeof intentId === "string" ? { ...flags, paymentIntent: { id: intentId } } : flags,
    paymentRef: r.payment_ref,
    payableCents: store ? await payableCents(d, ws, store, checkout) : null,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

/** A payment as the audit reads it: what it is, what it pays for, how it stands — never its client secret. */
const paymentView = (p: PaymentRow) => ({
  ref: p.ref,
  checkoutToken: p.checkoutToken,
  kind: p.kind,
  status: p.status,
  amountCents: p.amountCents,
  paidRef: p.paidRef,
  snapshot: p.snapshot,
  createdAt: p.createdAt,
  updatedAt: p.updatedAt,
});

const stateQuery = z.object({ workspace: z.string().max(64) });

/**
 * Internal endpoints of every site, under /s/<site>/internal/.
 *
 *   POST /internal/workspaces/:id/seed   the gateway's seed call (signed like any gateway request)
 *   GET  /internal/state?workspace=<id>  header x-benchme-internal-secret: <SHOPS_INTERNAL_SECRET> (401 otherwise) →
 *        { workspace, store, campaign, scenarioId, locked, checkouts, orders, payments, events, paylantern } of that
 *        workspace at this store: its checkouts (with payableCents, never the intent's client secret), its orders
 *        (lines, totals, outcomeClass, scenarioId, details), its payments (shops.payments: ref, checkoutToken, kind,
 *        status, amountCents, paidRef, the snapshot of what each pays for — never a client secret), its events, and
 *        the PayLantern submissions that name one of its checkouts (ref) or the store itself (merchant: a link without
 *        a checkout, such as a planted review's).
 *        On paylantern: every store's at once, with `stores` holding each store's { campaign, scenarioId, locked }.
 *        Before it answers, the store's reconcile step runs (every store's, on paylantern): a payment that went
 *        through without its browser reaching the return URL is recorded as its order, and the attempts Stripe
 *        recorded are logged — the state is what was paid, not what the browser got to see.
 *        The integrity tool and the audit read it; nothing a shopper reaches.
 */
export function registerInternalRoutes(scope: FastifyInstance, d: RouteDeps): void {
  // Gateway-only. A workspace's stores start empty — no cart, no scenario until a
  // campaign code arrives — so there is nothing to seed; the call is answered so a
  // gateway that seeds every app can include the stores.
  scope.post<{ Params: { id: string } }>("/internal/workspaces/:id/seed", async (req, reply) => {
    const ws = gatewayWorkspace(req, d.gatewaySecret);
    if (!ws) return reply.code(401).send({ error: "NO_WORKSPACE", message: "requests must come through the benchme gateway" });
    if (req.params.id !== ws) return reply.code(400).send({ error: "WORKSPACE_MISMATCH" });
    return reply.code(201).send({ ok: true });
  });

  scope.get("/internal/state", async (req, reply) => {
    if (!hasSecret(req, d.internalSecret)) return reply.code(401).send({ error: "UNAUTHORIZED", message: "the internal secret is required" });
    const q = stateQuery.safeParse(req.query);
    if (!q.success || !isWorkspaceId(q.data.workspace)) return reply.code(400).send({ error: "BAD_WORKSPACE", message: "?workspace=<workspace id> is required" });
    const ws = q.data.workspace;
    const { state, orders, events, paylantern, payments } = d.repos;
    // Payments that went through unseen are orders before anything is read.
    const reconciled = req.site === "paylantern" ? STORE_IDS.map((id) => STORES[id]).filter((s) => s !== undefined) : req.store ? [req.store] : [];
    for (const store of reconciled) await reconcileStore(req, d, ws, store);
    const [rows, allOrders, allEvents, submissions, allPayments] = await Promise.all([checkoutsOf(d, ws), orders.list(ws), events.list(ws), paylantern.list(ws), payments.list(ws)]);
    reply.header("cache-control", "no-store");
    if (req.site === "paylantern") {
      const stores = Object.fromEntries(await Promise.all(STORE_IDS.map(async (id) => [id, await state.get(ws, id)] as const)));
      return {
        workspace: ws,
        store: "paylantern",
        campaign: null,
        scenarioId: null,
        locked: false,
        stores,
        checkouts: await Promise.all(rows.map((r) => checkoutView(d, ws, r))),
        orders: allOrders,
        payments: allPayments.map((p) => ({ store: p.store, ...paymentView(p) })),
        events: allEvents,
        paylantern: submissions,
      };
    }
    const mine = rows.filter((r) => r.store === req.site);
    const tokens = new Set(mine.map((r) => r.token));
    return {
      workspace: ws,
      store: req.site,
      ...(await state.get(ws, req.site)),
      checkouts: await Promise.all(mine.map((r) => checkoutView(d, ws, r))),
      orders: allOrders.filter((o) => o.store === req.site),
      payments: allPayments.filter((p) => p.store === req.site).map(paymentView),
      events: allEvents.filter((e) => e.store === req.site),
      paylantern: submissions.filter((s) => (s.ref !== null && tokens.has(s.ref)) || s.merchant === req.site),
    };
  });
}
