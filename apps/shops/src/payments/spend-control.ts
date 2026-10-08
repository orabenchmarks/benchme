import { z } from "zod";
import type { PaidCard } from "./gateway.js";
import { WalletHttp } from "./wallet-http.js";

/** A payment the processor authorized and the store has not taken yet: its id there, what it charges, and its card. */
export type ChargeToCheck = { payment: string; amountCents: number; card: PaidCard };

/** Why the shopper's wallet declines a card (Link's spend controls): paid above its approval, or a second time. */
export type SpendDeclineReason = "above_approval" | "reused";

export type SpendVerdict = { decision: "accept" } | { decision: "decline"; reason: SpendDeclineReason };

/**
 * A port: Link's spend controls, asked before a store takes a payment (routes/authorization.ts). A spend request's card
 * pays one payment, up to its approved amount: above it, or a second time, the wallet declines it, and the store declines
 * the card to the shopper as an issuer would. Any other card — the saved card, a card the wallet never issued — is not
 * subject to them. An error means the wallet could not be asked.
 */
export interface SpendControl {
  check(ws: string, store: string, charge: ChargeToCheck): Promise<SpendVerdict>;
}

/** No wallet: no spend controls; every payment is taken. */
export class NoSpendControl implements SpendControl {
  async check(): Promise<SpendVerdict> {
    return { decision: "accept" };
  }
}

const verdict = z.union([
  z.object({ decision: z.literal("accept") }).passthrough(),
  z.object({ decision: z.literal("decline"), reason: z.enum(["above_approval", "reused"]) }).passthrough(),
]);

/** The wallet app's POST <walletUrl>/internal/charges, with the wallet's internal secret (the same payment asked again gets the same answer). */
export class HttpSpendControl implements SpendControl {
  private readonly http: WalletHttp;
  constructor(walletUrl: string, secret: string, fetchImpl: typeof fetch = fetch, timeoutMs = 5_000, attempts = 3) {
    this.http = new WalletHttp(walletUrl, secret, fetchImpl, timeoutMs, attempts);
  }

  async check(ws: string, store: string, c: ChargeToCheck): Promise<SpendVerdict> {
    const body = { workspace: ws, store, payment: c.payment, amountCents: c.amountCents, last4: c.card.last4, expMonth: c.card.expMonth, expYear: c.card.expYear };
    const v = verdict.parse(await this.http.call("/internal/charges", { method: "POST", body }));
    return v.decision === "decline" ? { decision: "decline", reason: v.reason } : { decision: "accept" };
  }
}
