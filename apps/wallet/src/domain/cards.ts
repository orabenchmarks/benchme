import { randomBytes, randomInt } from "node:crypto";
import type { CardKind, IssuedCard } from "./types.js";

/**
 * The cards the wallet issues (DESIGN §6.4): Stripe's public test-mode numbers, one per outcome a scenario
 * calls for — a payment that goes through, one that needs a 3-D Secure challenge, one that is declined.
 * A registry, not a switch: a new outcome is a new entry. Link's own test-mode card (4000009990001984)
 * fails the Luhn check and cannot pay on a Stripe card form (§6.4, spike S1), so it is not one of them.
 */
export const CARDS: Readonly<Record<CardKind, { number: string; brand: string }>> = {
  success: { number: "4242424242424242", brand: "visa" },
  "3ds": { number: "4000002760003184", brand: "visa" },
  decline: { number: "4000000000000002", brand: "visa" },
};

export const CARD_KINDS = Object.keys(CARDS) as CardKind[];

export function isCardKind(value: unknown): value is CardKind {
  return typeof value === "string" && value in CARDS;
}

/** A fresh virtual card of `kind`: a new id, CVC and an expiry a few years out (any future date pays in test mode). */
export function issueCard(kind: CardKind, now: Date): IssuedCard {
  const { number, brand } = CARDS[kind];
  return {
    id: `lcard_${randomBytes(8).toString("hex")}`,
    kind,
    brand,
    number,
    cvc: String(randomInt(100, 1000)),
    expMonth: randomInt(1, 13),
    expYear: now.getUTCFullYear() + 3,
  };
}

/** The last four digits of a card number: all a record ever keeps of it. */
export function lastFour(number: string): string {
  return number.replace(/\D/g, "").slice(-4);
}
