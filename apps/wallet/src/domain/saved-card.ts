import type { CheckoutMatch } from "../binding/checkout-directory.js";
import { lastFour } from "./cards.js";
import type { CardKind, IssuedCard } from "./types.js";
import { billingAddress, type Holder } from "./view.js";

/**
 * The card-on-file door's vocabulary (pure): which saved card a workspace is shown, how a read is answered, and
 * what a record keeps of it. A run that pays without Link reads the buyer's saved card at
 * <public>/w/<workspaceId>/wallet/card; the card is the one the run's store scenario calls for (DESIGN §6.4) —
 * the same number, expiry, CVC, name and billing ZIP a spend request bound to that store would be issued.
 */

/** Why the door shows no card: the workspace has opened no store yet, or its stores call for different cards. */
export type NoCardReason = "no_store" | "ambiguous";

/** What a door read comes to — `unavailable` when the stores could not be asked. */
export type DoorOutcome = "shown" | NoCardReason | "unavailable";

export type SavedCardChoice = { kind: CardKind; stores: CheckoutMatch[] } | { kind: null; reason: NoCardReason };

/**
 * The saved card a workspace is shown, resolved the way a spend request is bound to its run: from the stores the
 * workspace has been to (a campaign code, a cart or a checkout there), each with the card its scenario calls for.
 * A store the run opened with its campaign code outranks one it wandered into without (which runs no scenario).
 * None at all → `no_store`. Scenario stores calling for different cards → `ambiguous`: a run is one task at one
 * store, so only a run holding two tasks' campaign codes gets there, and it is shown no card rather than a guess.
 */
export function chooseSavedCard(matches: readonly CheckoutMatch[]): SavedCardChoice {
  if (!matches.length) return { kind: null, reason: "no_store" };
  const bound = matches.filter((m) => m.scenarioId !== null);
  const pool = bound.length ? bound : [...matches];
  const kinds = new Set(pool.map((m) => m.card));
  if (kinds.size !== 1) return { kind: null, reason: "ambiguous" };
  return { kind: (pool[0] as CheckoutMatch).card, stores: pool };
}

/**
 * Whether an Accept header asks for JSON at least as much as for HTML. A browser's asks for HTML; `Accept:
 * application/json` (or a client listing it first, at an equal weight) for JSON; no header, `*\/*` or anything
 * else → HTML, which every client can read.
 */
export function prefersJson(accept: string | undefined): boolean {
  if (!accept) return false;
  let json = 0;
  let html = 0;
  for (const range of accept.split(",")) {
    const [type = "", ...params] = range.split(";").map((s) => s.trim().toLowerCase());
    const qParam = params.find((p) => p.startsWith("q="));
    const q = qParam === undefined ? 1 : Number(qParam.slice(2));
    if (!Number.isFinite(q) || q < 0 || q > 1) continue;
    if (type === "application/json") json = Math.max(json, q);
    else if (type === "text/html") html = Math.max(html, q);
  }
  return json > 0 && json >= html;
}

/** The card as the door shows it: what a card form asks for, billed to the wallet's holder — never its kind. */
export function savedCardView(card: IssuedCard, holder: Holder): Record<string, unknown> {
  return {
    brand: card.brand,
    number: card.number,
    exp_month: card.expMonth,
    exp_year: card.expYear,
    cvc: card.cvc,
    name: holder.name,
    billing_address: billingAddress(holder),
  };
}

/** What a record keeps of a saved card: its kind, brand and last four. */
export function savedCardRecord(card: Pick<IssuedCard, "kind" | "brand" | "number">): { kind: CardKind; brand: string; last4: string } {
  return { kind: card.kind, brand: card.brand, last4: lastFour(card.number) };
}

/** "4242424242424242" → "4242 4242 4242 4242", as a card shows it. */
export const groupedNumber = (number: string) => number.replace(/(\d{4})(?=\d)/g, "$1 ");

/** A card's expiry as a card shows it: "07/29". */
export const expiryText = (card: Pick<IssuedCard, "expMonth" | "expYear">) => `${String(card.expMonth).padStart(2, "0")}/${String(card.expYear).slice(-2)}`;
