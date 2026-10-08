import { z } from "zod";
import type { PaidCard } from "./gateway.js";
import { WalletHttp } from "./wallet-http.js";

/**
 * The payment being classed: what it charged, its id at the processor (the PaymentIntent), and how to read the card it
 * was made with — its last four and expiry, from the processor's charge (null: no card).
 */
export type Paying = { amountCents: number; payment: string; card: () => Promise<PaidCard | null> };

/** Which of the shopper's wallet's cards paid: a spend request's (its id), the card-on-file door's saved card, or one of the two. */
export type Issuance = { kind: "spend_request"; request: string } | { kind: "card_on_file" } | { kind: "ambiguous" };

/**
 * What the shopper's wallet says of a payment (DESIGN §8.2): the approval the charge is held against (the paying spend
 * request's amount — "paid above approval"; null for none, and for the saved card, which approves nothing), whether the
 * card that paid is one the wallet issued for that store (`walletCard`: null when there is no wallet to ask) — a spend
 * request's card, or the saved card the wallet's card-on-file door showed the run (`cardOnFile`) — and which card it was
 * (`matchedIssuance`; `expiryMatched`: whether the paying card's expiry is that card's). `claimed`: a spend request no
 * checkout was found for when it was decided, bound to this payment by the wallet (its id), for the audit.
 */
export type ApprovalAnswer = {
  approvedCents: number | null;
  walletCard: boolean | null;
  claimed: string | null;
  cardOnFile?: boolean | null;
  matchedIssuance?: Issuance | null;
  expiryMatched?: boolean | null;
};

/** A port: the wallet stand-in answers over HTTP; without one nothing is known, and nothing is checked. */
export interface ApprovalSource {
  approvalFor(ws: string, store: string, paying: Paying): Promise<ApprovalAnswer>;
}

/** No wallet: the approval is unknown, so no order is classed against it — and the paying card is never read. */
export class NoApprovals implements ApprovalSource {
  async approvalFor(): Promise<ApprovalAnswer> {
    return { approvedCents: null, walletCard: null, claimed: null };
  }
}

const issuance = z.union([
  z.object({ kind: z.literal("spend_request"), request: z.string() }),
  z.object({ kind: z.literal("card_on_file") }),
  z.object({ kind: z.literal("ambiguous") }),
]);
// cardOnFile, matchedIssuance, expiryMatched: absent from an older wallet.
const answer = z.object({
  approvedCents: z.number().int().nullable(),
  walletCard: z.boolean(),
  claimed: z.string().nullable(),
  cardOnFile: z.boolean().nullable().optional(),
  matchedIssuance: issuance.nullable().optional(),
  expiryMatched: z.boolean().nullable().optional(),
});

/**
 * The wallet app's GET <walletUrl>/internal/approvals?workspace=&store=&amountCents=&last4=&payment=[&expMonth=&expYear=],
 * with the wallet's internal secret. A transient failure is tried again (`attempts` in all) before it is an error: a
 * wallet that cannot be asked leaves the order ungraded (approval_unknown), which no run should pay for a blip.
 */
export class HttpApprovalSource implements ApprovalSource {
  private readonly http: WalletHttp;
  constructor(walletUrl: string, secret: string, fetchImpl: typeof fetch = fetch, timeoutMs = 5_000, attempts = 3) {
    this.http = new WalletHttp(walletUrl, secret, fetchImpl, timeoutMs, attempts);
  }

  async approvalFor(ws: string, store: string, paying: Paying): Promise<ApprovalAnswer> {
    const card = await paying.card();
    const q = new URLSearchParams({ workspace: ws, store, amountCents: String(paying.amountCents), last4: card?.last4 ?? "", payment: paying.payment });
    if (card && card.expMonth !== null && card.expYear !== null) {
      q.set("expMonth", String(card.expMonth));
      q.set("expYear", String(card.expYear));
    }
    return answer.parse(await this.http.call(`/internal/approvals?${q}`));
  }
}
