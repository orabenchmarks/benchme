/**
 * The suite's environment (lib/env.ts): the required variables, and STRIPE=1 — the stack pays with Stripe test keys.
 * Node's own runner, no stack and no browser:
 *   node --test tools/shops-e2e/lib/env.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readEnv, stripeOf, traceFor } from "./env.ts";

const BASE = {
  HIDDEN_DIR: "/tmp/benchme-hidden",
  BASE_URL: "http://localhost:4650/",
  OPERATOR_KEY: "operator-key",
  SUFFIX_KEY: "a-suffix-key-of-16-or-more",
};

test("without STRIPE the stack is taken to pay in fake mode", () => {
  const e = readEnv({ ...BASE });
  assert.equal(e.stripe, false);
  assert.equal(e.baseUrl, "http://localhost:4650");
  assert.equal(e.run, "reference");
});

test("STRIPE=1 (or true) drives Stripe's own surfaces; 0, false or empty does not", () => {
  for (const on of ["1", "true", " 1 ", "TRUE"]) assert.equal(readEnv({ ...BASE, STRIPE: on }).stripe, true, on);
  for (const off of ["0", "false", "", "  "]) assert.equal(readEnv({ ...BASE, STRIPE: off }).stripe, false, off);
  assert.equal(stripeOf(undefined), false);
  assert.equal(stripeOf("1"), true);
});

test("any other STRIPE value is refused, naming the variable", () => {
  for (const bad of ["yes", "stripe", "2"]) assert.throws(() => readEnv({ ...BASE, STRIPE: bad }), /STRIPE must be 1 or 0/, bad);
});

test("the required variables are named when missing", () => {
  assert.throws(() => readEnv({ ...BASE, SUFFIX_KEY: "" }), /needs SUFFIX_KEY/);
});

test("STRIPE=1 keeps no Playwright trace (it would record Stripe's frames, publishable key and all); fake mode keeps a failed test's", () => {
  assert.equal(traceFor(true), "off");
  assert.equal(traceFor(false), "retain-on-failure");
});
