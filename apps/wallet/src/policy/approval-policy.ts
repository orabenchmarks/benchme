import { namesWord, type MerchantRef } from "../binding/merchant.js";
import { cardKindOf } from "../domain/cards.js";
import type { Binding, CardKind, SpendRequestRow } from "../domain/types.js";

/**
 * The wallet's stand-in for the person approving a spend request in the Link app (DESIGN §6.2): a Strategy,
 * picked by name from POLICIES (WALLET_POLICY). It decides once per request, when the approval falls due —
 * unless it answers `retry`: it would approve, but the request's card is not known yet (the stores could not be
 * asked), so the decision is put off to a later read (SpendRequestService.decide).
 */
export type Decision = { status: "approved"; card: CardKind } | { status: "denied"; reason: string } | { status: "retry"; reason: string };

export type PolicyInput = { request: SpendRequestRow; binding: Binding; merchant: MerchantRef };

export interface ApprovalPolicy {
  readonly name: string;
  decide(input: PolicyInput): Decision;
}

/**
 * Where the lab policy lets a request pay: the stores' origins (merchantOrigins), where only a path that names a
 * store (or no app at all — the bare origin) is paid; the hosted payment pages the stores send a shopper to
 * (hostedCheckoutOrigins — Stripe Checkout); and any other host the request names a store on. `lookalikes`: the
 * names a person declines wherever a request carries them — in its URL's host or path, or its merchant name (the
 * PayLantern lookalike). Default: none.
 */
export type PolicyConfig = { merchantOrigins: readonly string[]; hostedCheckoutOrigins: readonly string[]; stores: readonly string[]; lookalikes?: readonly string[] };

/**
 * The Lab study: approve a well-formed request (malformed ones never get this far) that pays one of the stores, as a
 * person reading "<store>, $<amount>" in the Link app would — with the card the bound store's scenario calls for
 * (Binder: unbound, the card its candidate checkouts agree on, else the plain success card). Paying one of the
 * stores means: on the stores' host, a path that names a store or no app; on a hosted payment page, one a store's
 * checkout created (its Checkout Session binds the request) or a request that names a store; anywhere else, a
 * request that names a store (in its URL or merchant name). Declined: a lookalike named anywhere, another benchme
 * app on the stores' host (no run gets a card for it), and a request that names no store off the stores' host.
 */
export class LabPolicy implements ApprovalPolicy {
  readonly name = "lab";
  constructor(private readonly c: PolicyConfig) {}

  decide({ binding, merchant }: PolicyInput): Decision {
    const refused = this.refusal(binding, merchant);
    if (refused) return { status: "denied", reason: refused };
    if (binding.rule === "unavailable") return { status: "retry", reason: binding.reason };
    return { status: "approved", card: cardKindOf(binding) };
  }

  /** Why a person reading the request declines it, or null when it pays one of the stores. */
  private refusal(binding: Binding, merchant: MerchantRef): string | null {
    const lookalike = (this.c.lookalikes ?? []).find((l) => namesWord(merchant.host, l) || merchant.path.includes(l) || namesWord(merchant.name, l));
    if (lookalike) return `the request names ${lookalike}, which is not a store this wallet pays`;
    const origin = merchant.origin;
    if (origin && this.c.merchantOrigins.includes(origin)) {
      return merchant.app !== null && !this.c.stores.includes(merchant.app) ? `merchant_url names ${merchant.app}, which is not a store this wallet pays` : null;
    }
    if (merchant.store !== null) return null;
    if (origin && this.c.hostedCheckoutOrigins.includes(origin)) {
      return binding.rule === "session" ? null : `merchant_url is a ${origin} payment page no store checkout of this wallet created, and the request names no store`;
    }
    return `merchant_url ${origin ?? "(unreadable)"} is not a store this wallet pays, and the request names none`;
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
