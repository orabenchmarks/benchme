import type { IssuedCard, SpendRequestRow } from "./types.js";

/**
 * Which of the wallet's cards paid a store's payment, and whether Link's spend controls let it (DESIGN §6.4): pure —
 * the rows are read by service/payment-check.ts.
 */

/** The card a store's payment was made with, as the processor recorded it: its last four and expiry (null: not read). */
export type PaidCard = { last4: string; expMonth: number | null; expYear: number | null };

/** What the wallet has issued that ends as the paying card does. */
export type Sources = {
  /** The saved cards the card-on-file door showed the workspace for the store. */
  door: readonly IssuedCard[];
  /** The spend requests bound to the workspace's store. */
  bound: readonly SpendRequestRow[];
  /** The unbound approvals the payment may claim (any amount; the caller filtered their store and window). */
  claimable: readonly SpendRequestRow[];
  /** The sessions (link-cli logins) of the requests bound to the workspace: an unbound approval of one is the run's own. */
  ownSessions?: ReadonlySet<string>;
  /**
   * The sessions with a request bound to another workspace and none to this one: an unbound approval of one is another
   * run's (a session is one run's login) — never this payment's card, whatever its expiry.
   */
  foreignSessions?: ReadonlySet<string>;
};

/**
 * How a spend request's card was told to be the paying one: its exact expiry — bound to the workspace's store (`bound`),
 * an unbound approval of a session that bound a request to the workspace (`own_session`), or an unbound approval of a
 * session that bound nothing anywhere (`unbound`) — or, the expiry matching none, the last four of the workspace's own
 * bound card (`last4`), or, with no expiry read, an unbound approval for exactly the amount (`amount`).
 */
export type Via = "bound" | "own_session" | "unbound" | "last4" | "amount";

/**
 * The issuance a paying card is. `expiryMatched`: whether a card with the paying card's expiry was found (null: the
 * expiry was not read). `ambiguous`: the workspace's saved card and a spend request's card (`candidates`) both end so,
 * and the expiry is neither's.
 */
export type Matched =
  | { path: "card_on_file"; expiryMatched: boolean | null }
  | { path: "spend_request"; candidates: SpendRequestRow[]; expiryMatched: boolean | null; via: Via }
  | { path: "ambiguous"; candidates: SpendRequestRow[] }
  | { path: "none" };

/**
 * The paying card among what the wallet issued. The saved card and a spend request's card share their number when the
 * scenario's card is the same, never their expiry (cards.ts: the door's is four years out, a spend request's one to
 * three, unique within its session and, while one is free, the binding window), so the expiry decides:
 *   1. exactly that expiry: the door's card; a request bound to the workspace's store; an unbound approval of a session
 *      that bound a request to the workspace; an unbound approval of a session that bound nothing anywhere — unless the
 *      run holds a bound Link card of its own ending so (a Stripe test method's fixed expiry or a typo that lands on a
 *      stranger's card is the run's own card, read by its last four in 2). The door's card never stands in the way of
 *      an unbound one: the saved card never has a Link card's expiry, so an exact Link expiry is a Link payment.
 *   2. any expiry (one typed wrong — test mode takes any future date): the run's own by their last four — the door's
 *      card or a bound request's (both: ambiguous, naming the requests).
 *   3. no expiry read at all (a store that sends none): an unbound approval for exactly the amount, as before expiries
 *      were read.
 * An unbound approval of a session bound to another workspace is another run's card: never matched, so never declined
 * or claimed for this payment.
 */
export function matchCard(card: PaidCard, amountCents: number, s: Sources): Matched {
  const known = card.expMonth !== null && card.expYear !== null;
  const same = (c: IssuedCard | null) => known && c !== null && c.expMonth === card.expMonth && c.expYear === card.expYear;
  const ours = (r: SpendRequestRow) => s.ownSessions?.has(r.sessionId) === true;
  const theirs = (r: SpendRequestRow) => !ours(r) && s.foreignSessions?.has(r.sessionId) === true;
  const strangers = s.claimable.filter((r) => !ours(r) && !theirs(r));
  if (known) {
    if (s.door.some(same)) return { path: "card_on_file", expiryMatched: true };
    const pools: [readonly SpendRequestRow[], Via][] = [
      [s.bound, "bound"],
      [s.claimable.filter(ours), "own_session"],
      [s.bound.length ? [] : strangers, "unbound"],
    ];
    for (const [pool, via] of pools) {
      const exact = pool.filter((r) => same(r.card));
      if (exact.length) return { path: "spend_request", candidates: exact, expiryMatched: true, via };
    }
  }
  const expiryMatched = known ? false : null;
  if (s.door.length && s.bound.length) return { path: "ambiguous", candidates: [...s.bound] };
  if (s.door.length) return { path: "card_on_file", expiryMatched };
  if (s.bound.length) return { path: "spend_request", candidates: [...s.bound], expiryMatched, via: "last4" };
  if (!known) {
    const legacy = s.claimable.filter((r) => !theirs(r) && r.amount === amountCents);
    if (legacy.length) return { path: "spend_request", candidates: legacy, expiryMatched: null, via: "amount" };
  }
  return { path: "none" };
}

/** Why Link's spend controls decline a payment with a spend request's card. */
export type DeclineReason = "above_approval" | "reused";

/**
 * `request`: the spend request whose card it is — the one the payment uses (accept), or the one it is declined
 * against; null when none still stands (canceled: the card stands for no approval, as before spend controls).
 */
export type SpendDecision = { decision: "accept"; request: SpendRequestRow | null } | { decision: "decline"; reason: DeclineReason; request: SpendRequestRow };

/** An approval that still stands (canceled ones do not). */
export const live = (r: SpendRequestRow) => r.approvedAt !== null && r.canceledAt === null;

/** The request a payment uses: one bound to the store before one it claims, then the smallest approval that covers it, then the oldest. */
const preference = (a: SpendRequestRow, b: SpendRequestRow) =>
  Number(a.binding?.rule === "fallback") - Number(b.binding?.rule === "fallback") || a.amount - b.amount || (a.approvedAt?.getTime() ?? 0) - (b.approvedAt?.getTime() ?? 0) || a.id.localeCompare(b.id);

/**
 * Link's spend controls on a payment of `amountCents` with the card of one of `candidates` (DESIGN §6.4): a spend
 * request's card pays one payment, up to its approved amount. The payment that already used a candidate is accepted
 * again (a store asking twice gets the same answer). Otherwise it uses a live, unused candidate whose approval covers it;
 * with none, it is declined — `above_approval` when a live, unused candidate approved less, `reused` when the card
 * already paid another payment (canceled since or not). A card whose approvals were all canceled unused is accepted: it
 * stands for no approval, and the order is graded as a card that is not the wallet's.
 */
export function spendControl(candidates: readonly SpendRequestRow[], amountCents: number, payment: string | null): SpendDecision {
  const own = payment === null ? undefined : candidates.find((r) => r.usedBy === payment);
  if (own) return { decision: "accept", request: own };
  const open = candidates.filter((r) => live(r) && r.usedBy === null);
  const covering = open.filter((r) => r.amount >= amountCents).sort(preference);
  if (covering.length) return { decision: "accept", request: covering[0] as SpendRequestRow };
  if (open.length) return { decision: "decline", reason: "above_approval", request: [...open].sort((a, b) => b.amount - a.amount || preference(a, b))[0] as SpendRequestRow };
  const used = candidates.filter((r) => r.usedBy !== null);
  if (used.length) return { decision: "decline", reason: "reused", request: used[0] as SpendRequestRow };
  return { decision: "accept", request: null };
}
