import type { Charge, Intent } from "./gateway.js";

/**
 * Payment attempts in the words fake mode logs them with at its card form (routes/pay.ts): a card that paid
 * ("succeeded"), was declined ("declined"), or was asked for 3-D Secure ("requires_action") — and then that step
 * completed ("authenticated") or failed ("authentication_failed").
 */
export type AttemptResult = "succeeded" | "declined" | "requires_action" | "authenticated" | "authentication_failed";

/**
 * One attempt as Stripe recorded it. `attempt` is what makes recording it idempotent: the charge's id (ch_…) — or,
 * for the 3-D Secure step, which comes before any charge (and a failed step makes none), the card's own id (pm_…,
 * one payment method per card submitted). A key may carry two results (a card asked for 3-D Secure, then failed it).
 * `reason`: why a card the processor authorized was declined by the shopper's wallet (routes/authorization.ts) —
 * above_approval or reused; the store records that one itself.
 */
export type Attempt = { attempt: string; result: AttemptResult; reason?: string };

const AUTHENTICATION_FAILURE = "payment_intent_authentication_failure";

/**
 * Stripe's record of an intent as the attempts fake mode would have logged for the same cards, oldest first: one
 * per charge — "succeeded", or "authenticated" after a challenge; "declined", or "authentication_failed" when the
 * challenge failed — each challenged charge preceded by its card's "requires_action" step; then what the intent
 * shows of an attempt without a charge: a challenge waiting for the shopper, or one the shopper failed. A pending
 * charge is not read yet; 3-D Secure the shopper never saw (frictionless) is a plain success. A charge authorized but
 * not captured is not decided yet while its intent waits for the store (requires_capture), and was declined once the
 * store released it (the intent canceled — the store records why: routes/authorization.ts).
 */
export function attemptsOf(intent: Intent, charges: readonly Charge[]): Attempt[] {
  const out: Attempt[] = [];
  const charged = new Set<string>();
  for (const c of charges) {
    if (c.status === "pending") continue;
    if (c.paymentMethod) charged.add(c.paymentMethod);
    const tds = c.threeDSecure;
    const challenge = tds?.flow === "challenge";
    if (challenge && c.paymentMethod) out.push({ attempt: c.paymentMethod, result: "requires_action" });
    const held = c.status === "succeeded" && !c.captured;
    if (held && intent.status === "requires_capture") continue;
    if (held && intent.status === "canceled") out.push({ attempt: c.id, result: "declined" });
    else if (c.status === "succeeded") out.push({ attempt: c.id, result: challenge && tds?.result === "authenticated" ? "authenticated" : "succeeded" });
    else out.push({ attempt: c.id, result: tds?.result === "failed" ? "authentication_failed" : "declined" });
  }
  const card = intent.attemptMethod;
  if (card && !charged.has(card)) {
    if (intent.status === "requires_action") out.push({ attempt: card, result: "requires_action" });
    else if (intent.lastErrorCode === AUTHENTICATION_FAILURE) out.push({ attempt: card, result: "requires_action" }, { attempt: card, result: "authentication_failed" });
  }
  return out;
}

/**
 * The newest attempt the intent itself shows (null: nothing tried): the step waiting for or failing 3-D Secure,
 * else its latest charge (`result` null: whatever it was read as). Recorded already, so is everything before it —
 * an intent's attempts are recorded together — and its charges need not be read again.
 */
export function newestAttempt(intent: Intent): { attempt: string; result: AttemptResult | null } | null {
  if (intent.attemptMethod && intent.status === "requires_action") return { attempt: intent.attemptMethod, result: "requires_action" };
  if (intent.attemptMethod && intent.lastErrorCode === AUTHENTICATION_FAILURE) return { attempt: intent.attemptMethod, result: "authentication_failed" };
  return intent.latestCharge ? { attempt: intent.latestCharge, result: null } : null;
}
