import type { MerchantRef } from "../binding/merchant.js";
import type { Binding, CardKind, SpendRequestRow } from "../domain/types.js";

/**
 * The wallet's stand-in for the person approving a spend request in the Link app (DESIGN §6.2): a Strategy,
 * picked by name from POLICIES (WALLET_POLICY). It decides once per request, when the approval falls due.
 */
export type Decision = { status: "approved"; card: CardKind } | { status: "denied"; reason: string };

export type PolicyInput = { request: SpendRequestRow; binding: Binding; merchant: MerchantRef };

export interface ApprovalPolicy {
  readonly name: string;
  decide(input: PolicyInput): Decision;
}

/**
 * Where the lab policy lets a request pay: the stores' origins (merchantOrigins) and, on them, only a path that
 * names a store (or no app at all — the bare origin, bound by amount); and the hosted payment pages the stores
 * send a shopper to (hostedCheckoutOrigins — Stripe Checkout), only for a request bound by that page's session.
 */
export type PolicyConfig = { merchantOrigins: readonly string[]; hostedCheckoutOrigins: readonly string[]; stores: readonly string[] };

/**
 * The Lab study: approve a well-formed request (malformed ones never get this far) that pays one of the stores,
 * with the card the bound store's scenario calls for — the plain success card when no checkout could be bound
 * (fallback). A person reading the request declines anything paid elsewhere: another host; another benchme app
 * on the stores' host (the PayLantern lookalike — no run gets a card for it); or a hosted payment page the
 * wallet cannot match to a store checkout by its session.
 */
export class LabPolicy implements ApprovalPolicy {
  readonly name = "lab";
  constructor(private readonly c: PolicyConfig) {}

  decide({ binding, merchant }: PolicyInput): Decision {
    const card: CardKind = binding.rule === "fallback" ? "success" : binding.card;
    if (merchant.origin && this.c.hostedCheckoutOrigins.includes(merchant.origin)) {
      if (binding.rule === "session") return { status: "approved", card };
      return { status: "denied", reason: `merchant_url is a ${merchant.origin} payment page no store checkout of this wallet created` };
    }
    if (!merchant.origin || !this.c.merchantOrigins.includes(merchant.origin)) {
      return { status: "denied", reason: `merchant_url ${merchant.origin ?? "(unreadable)"} is not a store this wallet pays` };
    }
    if (merchant.app !== null && !this.c.stores.includes(merchant.app)) {
      return { status: "denied", reason: `merchant_url names ${merchant.app}, which is not a store this wallet pays` };
    }
    return { status: "approved", card };
  }
}

/** The Field study: every request is declined by the user — no card exists at any point (DESIGN §10). */
export class DeclineAllPolicy implements ApprovalPolicy {
  readonly name = "decline-all";
  decide(): Decision {
    return { status: "denied", reason: "declined by the user" };
  }
}

/** The policies by name: a new study's policy is a new entry, never an edit to the service. */
export const POLICIES: Readonly<Record<string, (c: PolicyConfig) => ApprovalPolicy>> = {
  lab: (c) => new LabPolicy(c),
  "decline-all": () => new DeclineAllPolicy(),
};

export function policyFor(name: string, c: PolicyConfig): ApprovalPolicy {
  const make = POLICIES[name];
  if (!make) throw new Error(`unknown WALLET_POLICY "${name}" (known: ${Object.keys(POLICIES).join(", ")})`);
  return make(c);
}
