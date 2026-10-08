import type { EventsRepo } from "../db/events-repo.js";
import { live, matchCard, spendControl, type DeclineReason, type Matched, type PaidCard } from "../domain/spend-controls.js";
import type { SpendRequestRow } from "../domain/types.js";
import type { CardOnFileService } from "./card-on-file.js";
import type { SpendRequestService } from "./spend-requests.js";

/** A store's payment: its workspace and store, the processor's id for it (null: not given), what it charges, and its card (null: none — a wallet button). */
export type ChargeInput = { workspace: string; store: string; payment: string | null; amountCents: number; card: PaidCard | null };

/** Which issuance paid: a spend request (its id), the card-on-file door's saved card, or one of the two (the expiry was neither's). */
export type Issuance = { kind: "spend_request"; request: string } | { kind: "card_on_file" } | { kind: "ambiguous" };

/**
 * What a store reads when it classes a payment (DESIGN §8.2). `approvedCents`: the approval the charge is held against —
 * the amount of the spend request whose card paid; null for the saved card (the door approves nothing: the task's own
 * budget alone holds it); the largest live approval of the workspace's store otherwise (and with no payment named).
 * `walletCard`: whether the card is one the wallet gave the run for that store (null: no payment named). `claimed`: an
 * unbound approval this payment bound (claimed_at_payment). `matchedIssuance`: which card it was; `expiryMatched`:
 * whether the paying card's expiry is that card's (null: not read).
 */
export type PaymentReading = {
  approvedCents: number | null;
  walletCard: boolean | null;
  cardOnFile: boolean | null;
  claimed: string | null;
  matchedIssuance: Issuance | null;
  expiryMatched: boolean | null;
  requests: SpendRequestRow[];
};

/** Link's spend controls on a store's payment (POST /internal/charges): accept it, or decline it as the card's issuer would. */
export type ChargeAnswer = PaymentReading & ({ decision: "accept" } | { decision: "decline"; reason: DeclineReason });

/** Whether a reading may record the card's use (a payment that went through) or must decide first (a payment about to be taken). */
type Mode = "record" | "enforce";

const largestLive = (rows: readonly SpendRequestRow[]) => {
  const approved = rows.filter(live).map((r) => r.amount);
  return approved.length ? Math.max(...approved) : null;
};

/**
 * The wallet's side of a store's payment. `check` (POST /internal/charges) is Link's spend controls, asked before the
 * store takes a payment: a spend request's card pays one payment, up to its approved amount — above it, or a second
 * time, the store declines the card to the shopper as an issuer's decline. `approvals` (GET /internal/approvals) is what
 * the store classes the order with once the payment went through: never a decline — the card's use is recorded. Both
 * find the paying card the same way (domain/spend-controls.ts matchCard): the saved card the door showed the workspace
 * (never subject to spend controls), a spend request's card bound to the workspace's store, or an unbound approval it
 * claims; anything else is a card typed from elsewhere (walletCard false).
 */
export class PaymentCheck {
  constructor(
    private readonly spendRequests: SpendRequestService,
    private readonly cardOnFile: CardOnFileService,
    private readonly events: EventsRepo,
  ) {}

  async check(c: ChargeInput): Promise<ChargeAnswer> {
    const a = await this.resolve(c, "enforce");
    await this.events.record({
      workspace: c.workspace,
      kind: "charge",
      data: { store: c.store, payment: c.payment, amountCents: c.amountCents, last4: c.card?.last4 ?? null, expiryMatched: a.expiryMatched, decision: a.decision, ...(a.decision === "decline" ? { reason: a.reason } : {}), matched: a.matchedIssuance },
    });
    return a;
  }

  async approvals(workspace: string, store: string, paying: { amountCents: number; payment: string | null; card: PaidCard | null } | null): Promise<PaymentReading> {
    if (!paying) {
      const rows = await this.spendRequests.boundTo(workspace, store);
      return { approvedCents: largestLive(rows), walletCard: null, cardOnFile: null, claimed: null, matchedIssuance: null, expiryMatched: null, requests: rows };
    }
    const { decision: _, ...reading } = await this.resolve({ workspace, store, ...paying }, "record");
    return reading;
  }

  private async resolve(c: ChargeInput, mode: Mode, attempt = 1): Promise<ChargeAnswer> {
    const rows = await this.spendRequests.boundTo(c.workspace, c.store);
    const base = { requests: rows, claimed: null, expiryMatched: null };
    const none = (expiryMatched: boolean | null = null): ChargeAnswer => ({ ...base, expiryMatched, decision: "accept", approvedCents: largestLive(rows), walletCard: false, cardOnFile: false, matchedIssuance: null });
    if (!c.card) return none();
    const last4 = c.card.last4;
    const ofCard = (r: SpendRequestRow) => r.card !== null && r.card.number.endsWith(last4);
    const own = c.payment === null ? undefined : rows.find((r) => r.usedBy === c.payment);
    if (own) {
      const sameExpiry = c.card.expMonth === null ? null : own.card?.expMonth === c.card.expMonth && own.card?.expYear === c.card.expYear;
      return this.spendRequestAnswer(own, rows, null, sameExpiry, "accept");
    }
    const m: Matched = matchCard(c.card, c.amountCents, {
      door: await this.cardOnFile.shownFor(c.workspace, c.store, last4),
      bound: rows.filter(ofCard),
      claimable: await this.spendRequests.claimable(c.store, last4),
    });
    if (m.path === "card_on_file") return { ...base, expiryMatched: m.expiryMatched, decision: "accept", approvedCents: null, walletCard: true, cardOnFile: true, matchedIssuance: { kind: "card_on_file" } };
    if (m.path === "ambiguous") return { ...base, decision: "accept", approvedCents: null, walletCard: true, cardOnFile: null, matchedIssuance: { kind: "ambiguous" } };
    if (m.path === "none") return none(c.card.expMonth === null ? null : false);
    const d = spendControl(m.candidates, c.amountCents, c.payment);
    if (d.decision === "decline" && mode === "enforce") {
      await this.spendRequests.declined(d.request, c.payment, d.reason, c.amountCents);
      return { ...this.spendRequestAnswer(d.request, rows, null, m.expiryMatched, "accept"), decision: "decline", reason: d.reason };
    }
    if (!d.request) return none(m.expiryMatched);
    // The payment uses the card: an unbound approval is bound to it first (claimed_at_payment), then marked used by it.
    let r = d.request;
    let claimed: string | null = null;
    if (r.binding?.rule === "fallback") {
      const bound = await this.spendRequests.claim(r, c.workspace, c.store);
      if (!bound) return attempt < 3 ? this.resolve(c, mode, attempt + 1) : none(m.expiryMatched); // another payment claimed it a moment before
      r = bound;
      claimed = r.id;
    }
    if (c.payment !== null && r.usedBy === null) {
      const used = await this.spendRequests.use(r, c.payment);
      if (!used) return attempt < 3 ? this.resolve(c, mode, attempt + 1) : none(m.expiryMatched); // another payment used it a moment before
      r = used;
    }
    return this.spendRequestAnswer(r, claimed ? [...rows, r] : rows, claimed, m.expiryMatched, "accept");
  }

  private spendRequestAnswer(r: SpendRequestRow, rows: SpendRequestRow[], claimed: string | null, expiryMatched: boolean | null, decision: "accept"): ChargeAnswer {
    const stands = live(r);
    return { requests: rows, claimed, expiryMatched, decision, approvedCents: stands ? r.amount : largestLive(rows), walletCard: stands, cardOnFile: false, matchedIssuance: { kind: "spend_request", request: r.id } };
  }
}
