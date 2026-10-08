import { describe, expect, it } from "vitest";
import { attemptsOf, newestAttempt } from "./attempts.js";
import type { Charge, Intent } from "./gateway.js";

/**
 * Stripe's record of an intent read as the attempts fake mode logs at the card form: one per charge (its id the
 * key), with the 3-D Secure step before a challenged charge — or before no charge at all — keyed by the card.
 */

const intent = (o: Partial<Intent> = {}): Intent => ({
  id: "pi_1",
  status: "requires_payment_method",
  amountCents: 4900,
  metadata: {},
  lastError: null,
  lastErrorCode: null,
  attemptMethod: null,
  latestCharge: null,
  ...o,
});
let clock = 1000;
const charge = (id: string, status: Charge["status"], o: Partial<Charge> = {}): Charge => ({ id, status, captured: status === "succeeded", paymentMethod: `pm_${id}`, threeDSecure: null, card: null, created: clock++, ...o });
const challenged = (result: string) => ({ flow: "challenge", result });

describe("attemptsOf: Stripe's record of an intent, in fake mode's words", () => {
  it("is empty while nothing was tried", () => {
    expect(attemptsOf(intent(), [])).toEqual([]);
  });

  it("leaves an authorized charge undecided while the store has not taken it — its 3-D Secure step logged — and reads one it released as declined", () => {
    const held = charge("ch_h", "succeeded", { captured: false, paymentMethod: "pm_h", threeDSecure: challenged("authenticated") });
    expect(attemptsOf(intent({ status: "requires_capture", latestCharge: "ch_h" }), [held])).toEqual([{ attempt: "pm_h", result: "requires_action" }]);
    expect(attemptsOf(intent({ status: "canceled", latestCharge: "ch_h" }), [held])).toEqual([
      { attempt: "pm_h", result: "requires_action" },
      { attempt: "ch_h", result: "declined" },
    ]);
    expect(attemptsOf(intent({ status: "succeeded", latestCharge: "ch_h" }), [{ ...held, captured: true }])).toEqual([
      { attempt: "pm_h", result: "requires_action" },
      { attempt: "ch_h", result: "authenticated" },
    ]);
  });

  it("reads one event per charge: a decline, then the card that paid", () => {
    const charges = [charge("ch_1", "failed"), charge("ch_2", "succeeded")];
    expect(attemptsOf(intent({ status: "succeeded", latestCharge: "ch_2" }), charges)).toEqual([
      { attempt: "ch_1", result: "declined" },
      { attempt: "ch_2", result: "succeeded" },
    ]);
  });

  it("reads a challenged charge as fake mode's two steps: the card asked for 3-D Secure, then authenticated", () => {
    const c = charge("ch_3", "succeeded", { paymentMethod: "pm_3ds", threeDSecure: challenged("authenticated") });
    expect(attemptsOf(intent({ status: "succeeded", latestCharge: "ch_3" }), [c])).toEqual([
      { attempt: "pm_3ds", result: "requires_action" },
      { attempt: "ch_3", result: "authenticated" },
    ]);
  });

  it("reads 3-D Secure the shopper never saw (frictionless) as a plain success", () => {
    const c = charge("ch_4", "succeeded", { threeDSecure: { flow: "frictionless", result: "authenticated" } });
    expect(attemptsOf(intent({ status: "succeeded" }), [c])).toEqual([{ attempt: "ch_4", result: "succeeded" }]);
  });

  it("reads a challenge waiting for the shopper, which has no charge yet, by its card", () => {
    expect(attemptsOf(intent({ status: "requires_action", attemptMethod: "pm_wait" }), [])).toEqual([{ attempt: "pm_wait", result: "requires_action" }]);
  });

  it("reads a challenge the shopper failed — Stripe makes no charge for it — by its card: asked, then failed", () => {
    const i = intent({ lastError: "We are unable to authenticate your payment method.", lastErrorCode: "payment_intent_authentication_failure", attemptMethod: "pm_fail" });
    expect(attemptsOf(i, [charge("ch_0", "failed")])).toEqual([
      { attempt: "ch_0", result: "declined" },
      { attempt: "pm_fail", result: "requires_action" },
      { attempt: "pm_fail", result: "authentication_failed" },
    ]);
  });

  it("reads a charge whose challenge failed, and one declined after its challenge", () => {
    const failedAuth = charge("ch_5", "failed", { paymentMethod: "pm_5", threeDSecure: challenged("failed") });
    const declinedAfter = charge("ch_6", "failed", { paymentMethod: "pm_6", threeDSecure: challenged("authenticated") });
    expect(attemptsOf(intent({ lastErrorCode: "card_declined", attemptMethod: "pm_6" }), [failedAuth, declinedAfter])).toEqual([
      { attempt: "pm_5", result: "requires_action" },
      { attempt: "ch_5", result: "authentication_failed" },
      { attempt: "pm_6", result: "requires_action" },
      { attempt: "ch_6", result: "declined" },
    ]);
  });

  it("skips a charge still pending, and never reads a card twice: the intent's own step is not repeated once its card has a charge", () => {
    expect(attemptsOf(intent({ status: "processing", latestCharge: "ch_7" }), [charge("ch_7", "pending")])).toEqual([]);
    const c = charge("ch_8", "failed", { paymentMethod: "pm_8" });
    expect(attemptsOf(intent({ lastErrorCode: "card_declined", attemptMethod: "pm_8" }), [c])).toEqual([{ attempt: "ch_8", result: "declined" }]);
  });
});

describe("newestAttempt: what to look for in the store's records before reading the charges again", () => {
  it("names the newest step Stripe shows on the intent itself, or nothing when nothing was tried", () => {
    expect(newestAttempt(intent())).toBeNull();
    expect(newestAttempt(intent({ status: "requires_action", attemptMethod: "pm_w", latestCharge: "ch_1" }))).toEqual({ attempt: "pm_w", result: "requires_action" });
    expect(newestAttempt(intent({ lastErrorCode: "payment_intent_authentication_failure", attemptMethod: "pm_f", latestCharge: "ch_1" }))).toEqual({ attempt: "pm_f", result: "authentication_failed" });
    expect(newestAttempt(intent({ status: "succeeded", latestCharge: "ch_2" }))).toEqual({ attempt: "ch_2", result: null });
    expect(newestAttempt(intent({ lastErrorCode: "card_declined", attemptMethod: "pm_d", latestCharge: "ch_3" }))).toEqual({ attempt: "ch_3", result: null });
  });
});
