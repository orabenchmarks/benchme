import { lastFour } from "./cards.js";
import type { SpendRequestRow } from "./types.js";

/** The wallet holder: the name and billing address every issued card carries. */
export type Holder = {
  name: string;
  line1: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
};

export const billingAddress = (h: Holder) => ({ name: h.name, line1: h.line1, city: h.city, state: h.state, postal_code: h.postalCode, country: h.country });

const iso = (d: Date) => d.toISOString();
const unix = (d: Date) => Math.floor(d.getTime() / 1000);

/**
 * A spend request as Link answers it — the fields link-cli 0.26.0 parses (id, status, created_at, updated_at,
 * line_items, totals, recurring) plus those its output shows. `card` only on `retrieve --include card` of an
 * approved request, with the holder's billing address and the credential's validity, as real Link returns it.
 */
export function spendRequestView(r: SpendRequestRow, o: { includeCard: boolean; approvalUrl: string; holder: Holder }): Record<string, unknown> {
  const view: Record<string, unknown> = {
    id: r.id,
    status: r.status,
    credential_type: r.credentialType,
    payment_details: r.paymentDetails,
    amount: r.amount,
    currency: r.currency,
    merchant_name: r.merchantName,
    merchant_url: r.merchantUrl,
    context: r.context,
    line_items: r.lineItems ?? [],
    totals: r.totals ?? [],
    metadata: r.metadata ?? {},
    recurring: r.recurring,
    status_details: r.statusDetails,
    expires_at: unix(r.expiresAt),
    created_at: iso(r.createdAt),
    updated_at: iso(r.updatedAt),
  };
  if (r.approvalRequestedAt) view.approval_url = o.approvalUrl;
  if (r.card) {
    view.card_brand = r.card.brand;
    view.card_last4 = lastFour(r.card.number);
  }
  if (o.includeCard && r.card && r.status === "approved") {
    view.card = {
      id: r.card.id,
      brand: r.card.brand,
      number: r.card.number,
      cvc: r.card.cvc,
      exp_month: r.card.expMonth,
      exp_year: r.card.expYear,
      billing_address: billingAddress(o.holder),
      valid_until: iso(r.expiresAt),
    };
  }
  return view;
}

/**
 * Flags the audit reads off a request (DESIGN §6.3): a request no checkout could be found for when it was decided
 * (binding_fallback) — still flagged once a store's payment bound it (claimed_at_payment); one denied because the
 * stores could not be asked (binding_unavailable: an infrastructure failure, never the run's).
 */
export function flagsOf(r: Pick<SpendRequestRow, "binding">): string[] {
  if (r.binding?.rule === "fallback") return ["binding_fallback"];
  if (r.binding?.rule === "payment") return ["binding_fallback", "claimed_at_payment"];
  if (r.binding?.rule === "unavailable") return ["binding_unavailable"];
  return [];
}

/** A request as the records show it: everything the audit needs, the card reduced to its kind and last four. */
export function recordView(r: SpendRequestRow): Record<string, unknown> {
  return {
    id: r.id,
    session: r.sessionId,
    status: r.status,
    amount: r.amount,
    currency: r.currency,
    merchantName: r.merchantName,
    merchantUrl: r.merchantUrl,
    context: r.context,
    lineItems: r.lineItems,
    totals: r.totals,
    metadata: r.metadata,
    test: r.test,
    binding: r.binding,
    flags: flagsOf(r),
    card: r.card ? { kind: r.card.kind, brand: r.card.brand, last4: lastFour(r.card.number) } : null,
    denialReason: r.denialReason,
    statusDetails: r.statusDetails,
    approvalRequestedAt: r.approvalRequestedAt && iso(r.approvalRequestedAt),
    decidedAt: r.decidedAt && iso(r.decidedAt),
    approvedAt: r.approvedAt && iso(r.approvedAt),
    canceledAt: r.canceledAt && iso(r.canceledAt),
    expiresAt: iso(r.expiresAt),
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}
