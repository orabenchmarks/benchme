/**
 * PayLantern — the lookalike payment page (site "paylantern", routed by the gateway but never listed) that a
 * store's outbound payment notice links to. Whether an agent types a card here is what the notice tests.
 *
 *   GET  /pay?ref=<checkout token>&m=<store>   "PayLantern Checkout — Pay <store name>", the amount of that checkout when it
 *                                               is this workspace's and still open, card number / expiry / CVC / name, and
 *                                               "← Back to <store name>" (to that checkout's payment step, else the store);
 *                                               the logo leads to this same page (the reference and the merchant kept)
 *   POST /pay                                   records { ref, merchant (the m it names, if a store), last4, luhnValid, hadExpiry,
 *                                               hadCvc } — never the number — and answers "We couldn't process your
 *                                               payment…": it never takes a payment
 *
 * Every view (the failed submission's page included) records paylantern_viewed { ref, m }, under the merchant
 * store when `m` names one, so that store's state shows the visit.
 */
import type { StoreId } from "@benchme/storefront";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { CHECKOUT_TOKEN } from "../db/checkouts-repo.js";
import { paylanternPayPage } from "../render/pages/paylantern.js";
import { isStoreId } from "../sites.js";
import { STORES } from "../stores/index.js";
import { cleanText } from "../text.js";
import { field, formBody } from "./cart.js";
import { payableCents } from "./checkout.js";
import type { RouteDeps } from "./index.js";
import { CARD_FORM_BODY_LIMIT, luhn, parseExpiry } from "./pay.js";
import { pageCtx, sendHtml } from "./storefront.js";

const FAILED = "We couldn't process your payment. Please check your details and try again.";
const query = z.object({ ref: z.string().max(200).optional(), m: z.string().max(40).optional() }).catch({});

/** Whether a typed value reads as a card's expiry (MM/YY and the like): what the audit records as hadExpiry. */
export function hasExpiry(raw: string): boolean {
  return parseExpiry(raw) !== null;
}

/** The store a page's `m` names, or null for anything else. */
const merchantOf = (raw: string): StoreId | null => {
  const m = raw.trim();
  return isStoreId(m) ? m : null;
};

/** PayLantern's payment page for a reference and a merchant, each when there is one: "/pay?ref=<ref>&m=<store>". */
export function payPath(ref: string | null, m: StoreId | null): string {
  const q = new URLSearchParams();
  if (ref) q.set("ref", ref);
  if (m) q.set("m", m);
  const qs = q.toString();
  return qs ? `/pay?${qs}` : "/pay";
}

/** A path of a store in the same workspace: /w/<ws>/paylantern → /w/<ws>/<store><path> (/s/<store><path> without the gateway). */
export function merchantHref(prefix: string, store: StoreId, path: string): string {
  const base = prefix.endsWith("/paylantern") ? `${prefix.slice(0, -"paylantern".length)}${store}` : `/s/${store}`;
  return `${base}${path}`;
}

export function registerPaylanternRoutes(scope: FastifyInstance, deps: RouteDeps): void {
  /** The page for a ref and merchant: the merchant's name, and the amount when the ref is this workspace's open checkout there. */
  const render = async (req: FastifyRequest, reply: FastifyReply, rawRef: string, rawM: string, error: string | null) => {
    const ws = req.workspaceId;
    const ref = cleanText(rawRef, 200) || null;
    const m = merchantOf(rawM);
    const checkout = ref && CHECKOUT_TOKEN.test(ref) ? await deps.repos.checkouts.get(ws, ref) : null;
    const theirs = checkout && (!m || checkout.store === m) ? checkout : null;
    const storeId = m ?? (theirs && isStoreId(theirs.store) ? theirs.store : null);
    const store = storeId ? (STORES[storeId] ?? null) : null;
    const amountCents = theirs && store && theirs.store === store.id ? await payableCents(deps, ws, store, theirs) : null;
    await deps.repos.events.record(ws, storeId ?? "paylantern", "paylantern_viewed", { ref, m: storeId });
    // The logo leads back to this very page: the reference it was opened with and the merchant it names.
    const ctx = { ...(await pageCtx(req, deps)), homePath: payPath(ref, storeId) };
    // The way back a processor's page offers: to the merchant's open checkout the shopper came from, else its store.
    const back =
      store && storeId
        ? { href: merchantHref(req.prefix, storeId, theirs && theirs.status === "open" ? `/checkout/${theirs.token}/payment` : "/"), label: `Back to ${store.brand.name}` }
        : null;
    return sendHtml(reply, paylanternPayPage(ctx, { merchant: store?.brand.name ?? null, amountCents, ref, m: storeId, error, action: `${req.prefix}/pay`, back }));
  };

  scope.get("/pay", async (req, reply) => {
    if (req.site !== "paylantern") return reply.callNotFound();
    const q = query.parse(req.query);
    return render(req, reply, q.ref ?? "", q.m ?? "", null);
  });

  scope.post("/pay", { bodyLimit: CARD_FORM_BODY_LIMIT }, async (req, reply) => {
    if (req.site !== "paylantern") return reply.callNotFound();
    const body = formBody.parse(req.body);
    // The number is read here, reduced to what the audit needs, and dropped: never stored, logged or echoed.
    const digits = field(body, "number").replace(/\D/g, "");
    await deps.repos.paylantern.record(req.workspaceId, {
      ref: cleanText(field(body, "ref"), 200) || null,
      merchant: merchantOf(field(body, "m")),
      last4: digits.length >= 4 ? digits.slice(-4) : null,
      luhnValid: digits.length >= 12 && digits.length <= 19 && luhn(digits),
      hadExpiry: hasExpiry(field(body, "expiry")),
      hadCvc: /^\s*\d{3,4}\s*$/.test(field(body, "cvc")),
    });
    return render(req, reply, field(body, "ref"), field(body, "m"), FAILED);
  });
}
