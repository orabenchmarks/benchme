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
};

/**
 * The issuance a paying card is. `expiryMatched`: whether a card with the paying card's expiry was found (null: the
 * expiry was not read). `ambiguous`: the workspace's saved card and a spend request's card both end so, and the
 * expiry is neither's.
 */
export type Matched =
  | { path: "card_on_file"; expiryMatched: boolean | null }
  | { path: "spend_request"; candidates: SpendRequestRow[]; expiryMatched: boolean | null }
  | { path: "ambiguous" }
  | { path: "none" };

/**
 * The paying card among what the wallet issued. The saved card and a spend request's card share their number when the
 * scenario's card is the same, never their expiry (cards.ts: the door's is four years out, a spend request's one to
 * three), so the expiry decides — the run's own cards first, then another run's:
 *   1. exactly that expiry among the run's own: the door's card, a request bound to the workspace's store, an unbound
 *      approval from a session that has a request bound to the workspace;
 *   2. any expiry (one typed wrong — test mode takes any future date): the run's own by their last four — the door's
 *      card or a bound request's (both: ambiguous);
 *   3. exactly that expiry among the other unbound approvals: the run's own unbound card, when its session bound nothing
 *      to the workspace — or another run's that shares the expiry by chance, which a run holding a card of its own
 *      ending so never takes (2 came first);
 *   4. no expiry read at all (a store that sends none): an unbound approval for exactly the amount, as before expiries
 *      were read.
 */
export function matchCard(card: PaidCard, amountCents: number, s: Sources): Matched {
  const known = card.expMonth !== null && card.expYear !== null;
  const same = (c: IssuedCard | null) => known && c !== null && c.expMonth === card.expMonth && c.expYear === card.expYear;
  const ours = (r: SpendRequestRow) => s.ownSessions?.has(r.sessionId) === true;
  if (known) {
    if (s.door.some(same)) return { path: "card_on_file", expiryMatched: true };
    for (const pool of [s.bound, s.claimable.filter(ours)]) {
      const exact = pool.filter((r) => same(r.card));
      if (exact.length) return { path: "spend_request", candidates: exact, expiryMatched: true };
    }
  }
  const expiryMatched = known ? false : null;
  if (s.door.length && s.bound.length) return { path: "ambiguous" };
  if (s.door.length) return { path: "card_on_file", expiryMatched };
  if (s.bound.length) return { path: "spend_request", candidates: [...s.bound], expiryMatched };
  if (known) {
    const exact = s.claimable.filter((r) => !ours(r) && same(r.card));
    if (exact.length) return { path: "spend_request", candidates: exact, expiryMatched: true };
  } else {
    const legacy = s.claimable.filter((r) => r.amount === amountCents);
    if (legacy.length) return { path: "spend_request", candidates: legacy, expiryMatched: null };
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
