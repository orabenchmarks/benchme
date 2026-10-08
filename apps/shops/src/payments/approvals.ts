import { z } from "zod";

/** The payment being classed: what it charged, and how to read the last four of the card it was made with (null: no card). */
export type Paying = { amountCents: number; last4: () => Promise<string | null> };

/**
 * What the shopper's wallet says of a payment (DESIGN §8.2): the largest live approval for the workspace's store —
 * what a charge is held against ("paid above approval"), null for none — and whether the card that paid is one the
 * wallet issued for that store (`walletCard`: null when there is no wallet to ask): a spend request's card, or the
 * saved card the wallet's card-on-file door showed the run (`cardOnFile`: true then; the door approves nothing, so
 * such a payment is held to the store's budget alone). `claimed`: a spend request no checkout was found for when it
 * was decided, bound to this payment by the wallet (its id), for the audit.
 */
export type ApprovalAnswer = { approvedCents: number | null; walletCard: boolean | null; claimed: string | null; cardOnFile?: boolean | null };

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

// cardOnFile: absent from a wallet without the card-on-file door.
const answer = z.object({ approvedCents: z.number().int().nullable(), walletCard: z.boolean(), claimed: z.string().nullable(), cardOnFile: z.boolean().nullable().optional() });

/**
 * The wallet app's GET <walletUrl>/internal/approvals?workspace=&store=&amountCents=&last4=, with the wallet's internal
 * secret. A transient failure is tried again (`attempts` in all) before it is an error: a wallet that cannot be asked
 * leaves the order ungraded (approval_unknown), which no run should pay for a blip.
 */
export class HttpApprovalSource implements ApprovalSource {
  constructor(
    private readonly walletUrl: string,
    private readonly secret: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 5_000,
    private readonly attempts = 3,
  ) {}

  async approvalFor(ws: string, store: string, paying: Paying): Promise<ApprovalAnswer> {
    const last4 = (await paying.last4()) ?? "";
    const url = `${this.walletUrl.replace(/\/+$/, "")}/internal/approvals?${new URLSearchParams({ workspace: ws, store, amountCents: String(paying.amountCents), last4 })}`;
    let last: Error = new Error("the wallet was not asked");
    for (let attempt = 1; attempt <= this.attempts; attempt++) {
      try {
        const res = await this.fetchImpl(url, { headers: { "x-benchme-internal-secret": this.secret }, signal: AbortSignal.timeout(this.timeoutMs) });
        if (res.ok) return answer.parse(await res.json());
        last = new Error(`the wallet answered ${res.status}`);
        if (res.status < 500) break; // refused, not failing: asking again changes nothing
      } catch (err) {
        last = err as Error;
      }
    }
    throw last;
  }
}
