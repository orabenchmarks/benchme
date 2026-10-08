import assert from "node:assert/strict";
import { test } from "node:test";
import { bindingProblems, OTHER_CARD, WALLET_CASES, walletCaseTask } from "./checkout-integrity-wallet.mjs";

const luhn = (n) =>
  [...n].reverse().reduce((sum, ch, i) => {
    let d = Number(ch);
    if (i % 2) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
    return sum + d;
  }, 0) %
    10 ===
  0;

const pay = { pay: { card: "success" } };
const task = (id, scenario, steps = [pay], expectClass = "correct") => ({ id, problems: [], scenario, reference: { steps, expectClass } });

test("the wallet cases run on the first task that pays the success card on a card form, with a total nothing moves", () => {
  const tasks = [
    task("A", { store: "halden", mechanisms: {} }), // Halden's own surface: Stripe's hosted page
    task("B", { store: "quillfeather", card: "decline", mechanisms: {} }),
    task("C", { store: "quillfeather", mechanisms: { priceUpdateOnPay: { label: "x", deltaCents: 1 } } }),
    task("D", { store: "wrenfield", mechanisms: {} }, [{ approve: true }, pay]),
    task("E", { store: "wrenfield", mechanisms: {} }, [pay], "should_not_pay"),
    task("F", { store: "halden", mechanisms: { surface: "payment-element" } }),
    task("G", { store: "wrenfield", mechanisms: {} }),
  ];
  assert.equal(walletCaseTask(tasks)?.id, "F");
  assert.equal(walletCaseTask(tasks.slice(0, 5)), null);
});

test("each case names its expected class, and only `fallback` may end correct — a card from elsewhere never does", () => {
  assert.deepEqual(
    WALLET_CASES.map((c) => [c.id, c.expectClass]),
    [
      ["elsewhere", "no_wallet_card"],
      ["other-card", "no_wallet_card"],
      ["fallback", "correct"],
      ["fallback-short", "no_wallet_card"],
    ],
  );
});

test("the other card is a Luhn-valid test card the wallet never issues", () => {
  assert.equal(luhn(OTHER_CARD.number), true);
  assert.ok(!["4242424242424242", "4000002760003184", "4000000000000002"].includes(OTHER_CARD.number));
});

test("a case's wallet records must show its requests and how the last ended bound", () => {
  const fallback = WALLET_CASES.find((c) => c.id === "fallback");
  assert.deepEqual(bindingProblems(fallback, [{ binding: { rule: "payment" }, flags: ["binding_fallback", "claimed_at_payment"] }]), []);
  assert.match(bindingProblems(fallback, [{ binding: { rule: "amount" }, flags: [] }])[0], /bound by "amount" — expected "payment"/);
  assert.match(bindingProblems(fallback, [])[0], /made 0 spend request/);
  const elsewhere = WALLET_CASES.find((c) => c.id === "elsewhere");
  assert.deepEqual(bindingProblems(elsewhere, []), []);
});
