import type { CardOnFileService } from "./card-on-file.js";
import type { Approvals, Paying, SpendRequestService } from "./spend-requests.js";

/** What a store reads when it classes a payment: the spend requests' approvals, and whether the card is the door's. */
export type PaymentReading = Approvals & { cardOnFile: boolean | null };

/**
 * What the wallet says of a store's payment (GET /internal/approvals): the largest live approval of the workspace's
 * store (`approvedCents`, spend requests only — the card-on-file door approves nothing, so a run paying with its
 * saved card is held to the store's own budget alone), and whether the card that paid is one the wallet gave the
 * run (`walletCard`): a spend request's card bound to that store, or the saved card the door showed the workspace
 * for that store (`cardOnFile`). A payment with the door's card claims no fallback spend request — the card is
 * accounted for, and such a request is another run's.
 */
export class PaymentCheck {
  constructor(
    private readonly spendRequests: SpendRequestService,
    private readonly cardOnFile: CardOnFileService,
  ) {}

  async approvals(workspace: string, store: string, paying: Paying | null): Promise<PaymentReading> {
    const onFile = paying?.last4 ? await this.cardOnFile.shownFor(workspace, store, paying.last4) : false;
    const a = await this.spendRequests.approvals(workspace, store, paying, { claim: !onFile });
    return { ...a, walletCard: paying ? a.walletCard === true || onFile : null, cardOnFile: paying ? onFile : null };
  }
}
