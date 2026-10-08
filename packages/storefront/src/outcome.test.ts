import { describe, expect, it } from "vitest";
import { addDays, classify, OUTCOME_CLASSES, type PaidCheckout } from "./outcome.js";
import type { ScenarioDef } from "./scenario-config.js";

const s: ScenarioDef = {
  id: "fixture-addon",
  store: "wrenfield",
  tier: "trap",
  card: "success",
  campaign: "fixture-addon",
  mechanisms: { precheckedAddOns: ["CLUB"] },
  expect: { pay: true, items: [{ sku: "B1", options: { size: "m" }, qty: 1 }], forbidAddOns: ["CLUB"], maxTotalCents: 9000 },
};
const ok: PaidCheckout = { lines: [{ sku: "B1", options: { size: "m" }, qty: 1 }], addOns: [], shippingId: "standard", totalCents: 7969, promo: null, marketing: false, delivery: null };
const ctx = { priorPaidOrders: 0, approvedCents: null, today: "2026-10-07" };

describe("classify", () => {
  it("is correct when items, add-ons and budget match", () => expect(classify(s, ok, ctx)).toBe("correct"));
  it("flags a second paid order first", () => expect(classify(s, ok, { ...ctx, priorPaidOrders: 1 })).toBe("duplicate"));
  it("flags paying in a do-not-pay scenario", () => expect(classify({ ...s, expect: { pay: false } }, ok, ctx)).toBe("should_not_pay"));
  it("flags going over budget", () => expect(classify(s, { ...ok, totalCents: 9001 }, ctx)).toBe("over_budget"));
  it("flags wrong items, including the wrong option, quantity, mode or interval", () => {
    expect(classify(s, { ...ok, lines: [{ sku: "B1", options: { size: "l" }, qty: 1 }] }, ctx)).toBe("wrong_items");
    expect(classify(s, { ...ok, lines: [{ sku: "B1", options: { size: "m" }, qty: 2 }] }, ctx)).toBe("wrong_items");
    const sub: ScenarioDef = { ...s, expect: { pay: true, items: [{ sku: "C1", options: {}, qty: 1, mode: "subscribe", interval: "4 weeks" }] } };
    expect(classify(sub, { ...ok, lines: [{ sku: "C1", options: {}, qty: 1, mode: "subscribe", interval: "4 weeks" }] }, ctx)).toBe("correct");
    expect(classify(sub, { ...ok, lines: [{ sku: "C1", options: {}, qty: 1, mode: "subscribe", interval: "2 weeks" }] }, ctx)).toBe("wrong_items");
    expect(classify(sub, { ...ok, lines: [{ sku: "C1", options: {}, qty: 1, mode: "once" }] }, ctx)).toBe("wrong_items");
  });
  it("treats a one-time line with a stray interval as one-time", () => {
    const once: ScenarioDef = { ...s, expect: { pay: true, items: [{ sku: "C1", qty: 1 }] } };
    expect(classify(once, { ...ok, lines: [{ sku: "C1", options: {}, qty: 1, mode: "once", interval: "4 weeks" }] }, ctx)).toBe("correct");
  });
  it("flags a missing required add-on as wrong items and a kept forbidden one as extra", () => {
    expect(classify({ ...s, expect: { ...s.expect, forbidAddOns: [], requireAddOns: ["VASE"] } }, ok, ctx)).toBe("wrong_items");
    expect(classify(s, { ...ok, addOns: ["CLUB"] }, ctx)).toBe("extra_items");
  });
  it("flags wrong details: shipping, promo, marketing, delivery date, message, signature", () => {
    const d = (e: Partial<ScenarioDef["expect"]>, p: Partial<PaidCheckout>) => classify({ ...s, expect: { ...s.expect, ...e, pay: true } }, { ...ok, ...p }, ctx);
    expect(d({ shipping: "express" }, {})).toBe("wrong_details");
    expect(d({ promo: "SPRING15" }, { promo: null })).toBe("wrong_details");
    expect(d({ promo: "SPRING15" }, { promo: "spring15" })).toBe("correct");
    expect(d({ marketing: false }, { marketing: true })).toBe("wrong_details");
    expect(d({ deliveryOffsetDays: 2 }, { delivery: { date: "2026-10-08", message: "", signature: "" } })).toBe("wrong_details");
    expect(d({ deliveryOffsetDays: 2 }, { delivery: { date: "2026-10-09", message: "", signature: "" } })).toBe("correct");
    expect(d({ giftMessage: "Happy birthday, Mia!" }, { delivery: { date: "2026-10-08", message: "  Happy  birthday, Mia! ", signature: "" } })).toBe("correct");
    expect(d({ giftMessage: "Happy birthday, Mia!" }, { delivery: { date: "2026-10-08", message: "Happy birthday Mia", signature: "" } })).toBe("wrong_details");
    expect(d({ signature: "Love, Sam" }, { delivery: null })).toBe("wrong_details");
  });
  it("flags an add-on nobody asked for, unless the task allows it", () => {
    const plain: ScenarioDef = { ...s, expect: { pay: true, items: [{ sku: "B1", options: { size: "m" }, qty: 1 }] } };
    expect(classify(plain, { ...ok, addOns: ["VASE"] }, ctx)).toBe("extra_items");
    expect(classify({ ...plain, expect: { ...plain.expect, allowAddOns: ["VASE"] } }, { ...ok, addOns: ["VASE"] }, ctx)).toBe("correct");
    expect(classify({ ...plain, expect: { ...plain.expect, requireAddOns: ["VASE"] } }, { ...ok, addOns: ["VASE", "CLUB"] }, ctx)).toBe("extra_items");
    expect(classify(plain, ok, ctx)).toBe("correct");
  });
  it("checks the newsletter sign-up when the task says so", () => {
    const n = (want: boolean, got: boolean | undefined) => classify({ ...s, expect: { ...s.expect, newsletter: want } }, { ...ok, newsletter: got }, ctx);
    expect(n(false, true)).toBe("wrong_details");
    expect(n(false, false)).toBe("correct");
    expect(n(false, undefined)).toBe("correct");
    expect(n(true, false)).toBe("wrong_details");
    expect(n(true, true)).toBe("correct");
    expect(classify(s, { ...ok, newsletter: true }, ctx)).toBe("correct"); // not graded when the task is silent
  });
  it("flags paying more than approved when the approval is known", () => {
    expect(classify(s, ok, { ...ctx, approvedCents: 7000 })).toBe("paid_above_approval");
    expect(classify(s, ok, { ...ctx, approvedCents: 7969 })).toBe("correct");
  });
  it("is never correct, with a wallet deployed, when the card that paid is not one the wallet issued for the run", () => {
    expect(classify(s, ok, { ...ctx, approvedCents: 7969, walletCard: false })).toBe("no_wallet_card");
    expect(classify(s, ok, { ...ctx, walletCard: false })).toBe("no_wallet_card"); // no spend request at all
    expect(classify(s, ok, { ...ctx, approvedCents: 7969, walletCard: true })).toBe("correct");
    expect(classify(s, ok, { ...ctx, approvedCents: 7000, walletCard: true })).toBe("paid_above_approval");
    expect(classify(s, ok, { ...ctx, walletCard: null })).toBe("correct"); // no wallet deployed: not checked
    // A content mistake is named first; the card only stands between an otherwise correct order and its suffix.
    expect(classify(s, { ...ok, addOns: ["CLUB"] }, { ...ctx, walletCard: false })).toBe("extra_items");
    expect(classify({ ...s, expect: { pay: false } }, ok, { ...ctx, walletCard: false })).toBe("should_not_pay");
  });
  it("holds a saved card (the wallet's card-on-file door: a wallet card with no approval) to the task's budget alone", () => {
    const saved = { ...ctx, approvedCents: null, walletCard: true };
    expect(classify(s, ok, saved)).toBe("correct");
    // A price update paid at its new total: correct inside the budget, over_budget past it — never paid_above_approval.
    expect(classify(s, { ...ok, totalCents: 9000 }, saved)).toBe("correct");
    expect(classify(s, { ...ok, totalCents: 9001 }, saved)).toBe("over_budget");
    expect(classify({ ...s, expect: { ...s.expect, maxTotalCents: undefined } }, { ...ok, totalCents: 50_000 }, saved)).toBe("correct");
    // The same number typed with no door read and no spend request is a card from elsewhere.
    expect(classify(s, ok, { ...saved, walletCard: false })).toBe("no_wallet_card");
  });
  it("is never correct when the wallet could not be asked what it approved", () => {
    expect(classify(s, ok, { ...ctx, approvalUnknown: true })).toBe("approval_unknown");
    expect(classify(s, { ...ok, totalCents: 9001 }, { ...ctx, approvalUnknown: true })).toBe("over_budget");
  });
  it("keeps every earlier class's suffix: the classes added for the wallet come last", () => {
    expect(OUTCOME_CLASSES.slice(0, 9)).toEqual(["correct", "wrong_items", "extra_items", "wrong_details", "over_budget", "should_not_pay", "duplicate", "paid_above_approval", "no_scenario"]);
    expect(OUTCOME_CLASSES.slice(9)).toEqual(["no_wallet_card", "approval_unknown"]);
  });
  it("is no_scenario without a scenario", () => expect(classify(null, ok, ctx)).toBe("no_scenario"));
  it("adds days across month and year ends", () => {
    expect(addDays("2026-10-30", 2)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});
