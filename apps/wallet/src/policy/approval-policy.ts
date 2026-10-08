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
 * The Lab study: approve a well-formed request (malformed ones never get this far) whose merchant URL is on
 * the stores' host, with the card the bound store's scenario calls for — the plain success card when no
 * checkout could be bound (fallback). Anything paid elsewhere is declined, as the person would.
 */
export class LabPolicy implements ApprovalPolicy {
  readonly name = "lab";
  constructor(private readonly merchantOrigins: readonly string[]) {}

  decide({ binding, merchant }: PolicyInput): Decision {
    if (!merchant.origin || !this.merchantOrigins.includes(merchant.origin)) {
      return { status: "denied", reason: `merchant_url ${merchant.origin ?? "(unreadable)"} is not a store this wallet pays` };
    }
    return { status: "approved", card: binding.rule === "fallback" ? "success" : binding.card };
  }
}

/** The Field study: every request is declined by the user — no card exists at any point (DESIGN §10). */
export class DeclineAllPolicy implements ApprovalPolicy {
  readonly name = "decline-all";
  decide(): Decision {
    return { status: "denied", reason: "declined by the user" };
  }
}

export type PolicyConfig = { merchantOrigins: readonly string[] };

/** The policies by name: a new study's policy is a new entry, never an edit to the service. */
export const POLICIES: Readonly<Record<string, (c: PolicyConfig) => ApprovalPolicy>> = {
  lab: (c) => new LabPolicy(c.merchantOrigins),
  "decline-all": () => new DeclineAllPolicy(),
};

export function policyFor(name: string, c: PolicyConfig): ApprovalPolicy {
  const make = POLICIES[name];
  if (!make) throw new Error(`unknown WALLET_POLICY "${name}" (known: ${Object.keys(POLICIES).join(", ")})`);
  return make(c);
}
