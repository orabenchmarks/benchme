/**
 * The pure pieces of the Stripe surfaces' helpers (lib/stripe.ts): what the Payment Element's tabs offer beyond
 * the card form, the hosted page's US-dollar price among its currency choices, Stripe's decline messages, and the
 * run record a test attaches for the ledger. Not a Playwright test (playwright.config.ts runs the spec files only),
 * and it needs no stack, no build and no browser — Node's own runner, which strips the types (Node 22.18+):
 *   node --test tools/shops-e2e/lib/stripe.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { DECLINED, extraMethods, runRecord, usdChoice } from "./stripe.ts";

test("the card form is all a card-only store may offer: any other tab is extra, its name read as one line", () => {
  assert.deepEqual(extraMethods([]), []);
  assert.deepEqual(extraMethods(["Card"]), []);
  assert.deepEqual(extraMethods(["Card", "$5 back\nBank", "Klarna"]), ["$5 back Bank", "Klarna"]);
  assert.deepEqual(extraMethods([" Card ", "Cash App Pay", "  "]), ["Cash App Pay"]);
});

test("the hosted page's US-dollar choice: its name and its amount in cents; none without one", () => {
  assert.deepEqual(usdChoice(["IL ₪1,109.95", "US $349.56"]), { name: "US $349.56", cents: 34956 });
  assert.deepEqual(usdChoice(["US  $1,204.00"]), { name: "US  $1,204.00", cents: 120400 });
  assert.equal(usdChoice(["IL ₪1,109.95", "EU €320.10"]), null);
  assert.equal(usdChoice([]), null);
  assert.equal(usdChoice(["USD"]), null);
});

test("a decline reads as declined in the API's words, in Stripe.js's and on Stripe Checkout's hosted page", () => {
  assert.match("Your card was declined.", DECLINED);
  assert.match("Your card has been declined.", DECLINED);
  // Stripe Checkout names the kind of card and suggests another.
  assert.match("Your credit card was declined. Try paying with a debit card instead.", DECLINED);
  assert.match("Your debit card was declined. Try paying with a credit card instead.", DECLINED);
  assert.match("Your prepaid card has been declined.", DECLINED);
  assert.match("Your card was declined. Try a different card.", DECLINED);
  assert.doesNotMatch("Your card number is invalid.", DECLINED);
  assert.doesNotMatch("Your card's security code is incomplete.", DECLINED);
  assert.doesNotMatch("We are unable to authenticate your payment method.", DECLINED);
  assert.doesNotMatch("Your card was not declined.", DECLINED);
});

test("the run record: what the ledger needs to find the run's payments, nothing a task holds beyond its id", () => {
  const r = runRecord({
    task: "XX01",
    run: "reference",
    stripe: true,
    store: "halden",
    workspace: "ws_0123456789ab",
    storeUrl: "http://localhost:4650/w/ws_0123456789ab/halden/",
    expectClass: "correct",
    cards: ["success"],
    orders: ["HA-123456-K7"],
  });
  assert.deepEqual(r, {
    task: "XX01",
    run: "reference",
    payments: "stripe",
    store: "halden",
    workspace: "ws_0123456789ab",
    storeUrl: "http://localhost:4650/w/ws_0123456789ab/halden",
    expectClass: "correct",
    cards: ["success"],
    orders: ["HA-123456-K7"],
  });
  const none = runRecord({ task: "XX02", run: "wrong", stripe: false, store: "wrenfield", workspace: null, storeUrl: null, expectClass: "none", cards: [], orders: [] });
  assert.equal(none.payments, "fake");
  assert.equal(none.workspace, null);
  assert.equal(none.storeUrl, null);
});
