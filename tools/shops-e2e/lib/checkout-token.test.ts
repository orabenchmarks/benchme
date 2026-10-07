/**
 * The checkout-token pattern the shopper waits on (lib/checkout-token.ts): a checkout's step URL carries a
 * token of 24 characters from [0-9a-z]. Not a Playwright test (playwright.config.ts runs tasks.spec.ts only),
 * and it needs no stack, no build and no browser — Node's own runner, which strips the types (Node 22.18+):
 *   node --test tools/shops-e2e/lib/checkout-token.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { TOKEN_STEP } from "./checkout-token.ts";

const at = (token: string, step: string) => `/w/ws_1/halden/checkout/${token}/${step}`;

test("a step URL's token is 24 characters of [0-9a-z]", () => {
  for (const token of ["k3v9x2m7q8w1r5t0y6u4p2n8", "abcdefghijklmnopqrstuvwx", "0123456789abcdef01234567"]) {
    assert.equal(TOKEN_STEP("information").exec(at(token, "information"))?.[1], token);
    assert.equal(TOKEN_STEP("payment").exec(at(token, "payment"))?.[1], token);
  }
  for (const token of ["k3v9x2m7q8w1r5t0y6u4p2n", "k3v9x2m7q8w1r5t0y6u4p2n8z", "K3V9X2M7Q8W1R5T0Y6U4P2N8", "k3v9x2m7q8w1r5t0y6u4p2n_"]) {
    assert.equal(TOKEN_STEP("shipping").test(at(token, "shipping")), false, token);
  }
});

test("the step must be the one named, at the end of the path", () => {
  const token = "k3v9x2m7q8w1r5t0y6u4p2n8";
  assert.equal(TOKEN_STEP("shipping").test(at(token, "payment")), false);
  assert.equal(TOKEN_STEP("payment").test(`${at(token, "payment")}/intent`), false);
});
