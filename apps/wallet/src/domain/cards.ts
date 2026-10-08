import { randomBytes, randomInt } from "node:crypto";
import type { Binding, CardKind, IssuedCard } from "./types.js";

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

/** Where a card's expiry may fall: the years after the year it is issued, and the months. */
export type ExpiryRange = { years: readonly number[]; months: readonly number[] };

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

/**
 * A spend request's card: one to three years out, never December — the month a card typed from memory most
 * often carries. Within it every card is given an expiry no other recent card of its kind has (`taken`), so a
 * payment's expiry, which the processor records with the last four, tells one issued card from another.
 */
export const SPEND_REQUEST_EXPIRY: ExpiryRange = { years: [1, 2, 3], months: MONTHS.slice(0, 11) };

/** The saved card the card-on-file door shows: four years out — an expiry no spend request's card can have. */
export const SAVED_CARD_EXPIRY: ExpiryRange = { years: [4], months: MONTHS };

/** A card's expiry as one key ("7/2029"). */
export const expiryKey = (e: { expMonth: number; expYear: number }) => `${e.expMonth}/${e.expYear}`;

/**
 * A fresh virtual card of `kind`: a new id and CVC, and an expiry in `range` (any future date pays in test mode) that
 * is not in `taken` while one is free.
 */
export function issueCard(kind: CardKind, now: Date, range: ExpiryRange = SPEND_REQUEST_EXPIRY, taken: ReadonlySet<string> = new Set()): IssuedCard {
  const { number, brand } = CARDS[kind];
  const all = range.years.flatMap((y) => range.months.map((m) => ({ expMonth: m, expYear: now.getUTCFullYear() + y })));
  const free = all.filter((e) => !taken.has(expiryKey(e)));
  const pool = free.length ? free : all;
  const expiry = pool[randomInt(pool.length)] as { expMonth: number; expYear: number };
  return {
    id: `lcard_${randomBytes(8).toString("hex")}`,
    kind,
    brand,
    number,
    cvc: String(randomInt(100, 1000)),
    ...expiry,
  };
}

/**
 * The card a decision issues for a request bound as `b`: the bound store's scenario's — or, unbound, the card every
 * checkout its rules found calls for when they agree, else the plain success card.
 */
export function cardKindOf(b: Binding): CardKind {
  if (b.rule === "fallback") return b.card ?? "success";
  if (b.rule === "unavailable") return "success";
  return b.card;
}

/** The last four digits of a card number: all a record ever keeps of it. */
export function lastFour(number: string): string {
  return number.replace(/\D/g, "").slice(-4);
}
