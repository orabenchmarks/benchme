import { MAX_AMOUNT } from "../domain/spend-request-input.js";
import type { Session } from "../domain/types.js";
import type { Holder } from "../domain/view.js";

/**
 * The account behind every session: one wallet holder with one saved card (the funding method a spend request
 * draws on — never the card it issues), no saved shipping address, and an approval policy of one rule. What
 * link-cli's `payment-methods`, `user-info`, `approval-policy` and `shipping-address` commands read.
 */
export type Account = { holder: Holder; fundingLast4: string };

/** A session's one payment method id (`csmrpd_…`, as Link's): stable per session, so a request may name it. */
export function paymentMethodIdOf(session: Pick<Session, "id">): string {
  return `csmrpd_${session.id.replace(/^lwses_/, "")}`;
}

export function paymentMethodView(session: Session, a: Account): Record<string, unknown> {
  return {
    id: paymentMethodIdOf(session),
    type: "card",
    is_default: true,
    name: `Visa •••• ${a.fundingLast4}`,
    nickname: null,
    card_details: { brand: "visa", last4: a.fundingLast4, exp_month: 9, exp_year: session.createdAt.getUTCFullYear() + 4 },
    bank_account_details: null,
    capabilities: { agentic_card: { eligible: true, ineligibility_reasons: [] } },
  };
}

export function userInfoView(session: Session, a: Account, spent: { daily: number; thirtyDay: number }): Record<string, unknown> {
  const [first, ...rest] = a.holder.name.split(" ");
  return {
    id: `lusr_${session.id.replace(/^lwses_/, "")}`,
    email: null,
    name: a.holder.name,
    first_name: first ?? null,
    last_name: rest.join(" ") || null,
    phone: null,
    address: { line1: a.holder.line1, line2: null, city: a.holder.city, state: a.holder.state, postal_code: a.holder.postalCode, country: a.holder.country },
    eligible_for_balance: false,
    agent_wallet_spend_limits: {
      per_transaction: { limit: MAX_AMOUNT },
      daily: { limit: 500_000, used: spent.daily, remaining: Math.max(0, 500_000 - spent.daily) },
      thirty_day: { limit: 2_000_000, used: spent.thirtyDay, remaining: Math.max(0, 2_000_000 - spent.thirtyDay) },
    },
    agent_wallet_step_up: { status: "not_required", action_url: null },
  };
}

export function approvalPolicyView(): Record<string, unknown> {
  return { rules: [{ action: "spend_request_create", limits: { per_purchase: { amount: MAX_AMOUNT, currency: "usd" } } }] };
}
