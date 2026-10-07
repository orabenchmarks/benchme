/**
 * The card's billing ZIP a run types (lib/billing.ts): the pay step's billingZip, else the one the Link card carries —
 * never the delivery address's. Node's own runner, no stack and no browser:
 *   node --test tools/shops-e2e/lib/billing.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { billingZipOf, DEFAULT_BILLING_ZIP } from "./billing.ts";

test("a pay step without a billingZip types the Link card's billing ZIP", () => {
  assert.equal(DEFAULT_BILLING_ZIP, "94107");
  assert.equal(billingZipOf({ card: "success" }), DEFAULT_BILLING_ZIP);
  assert.equal(billingZipOf({ card: "decline", billingZip: "  " }), DEFAULT_BILLING_ZIP, "blank: none given");
});

test("a pay step's billingZip is typed as given (trimmed)", () => {
  assert.equal(billingZipOf({ card: "success", billingZip: "10001" }), "10001");
  assert.equal(billingZipOf({ card: "3ds", billingZip: " 94107-1234 " }), "94107-1234");
});
