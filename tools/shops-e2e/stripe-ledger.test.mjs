/**
 * stripe-ledger.mjs, its pure parts: the arguments, the run records read out of Playwright's results.json, the
 * payment ids a store's state names, and the audit of one run against what Stripe holds. No stack, no Stripe:
 *   node --test tools/shops-e2e/stripe-ledger.test.mjs
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { auditRun, knownRefs, parseArgs, recordsOf, redact, UsageError } from "./stripe-ledger.mjs";

const KEY = { STRIPE_SECRET_KEY: "sk_test_stub" };
const WS = "ws_0123456789ab";

/* ------------------------------------------------------------------ arguments */

test("the inputs are OUT_DIRs or results.json files; the key comes from the environment, test mode only", () => {
  const o = parseArgs(["/tmp/a", "/tmp/b/results.json"], KEY);
  assert.deepEqual(o.inputs, ["/tmp/a", "/tmp/b/results.json"]);
  assert.equal(o.stripeKey, KEY.STRIPE_SECRET_KEY);
  assert.equal(o.searchWaitMs, 90_000);
  assert.ok(o.internalSecret.length >= 16, "the dev stack's secret by default");
  assert.equal(parseArgs(["/tmp/a"], { ...KEY, SHOPS_INTERNAL_SECRET: "from-env-0123456789" }).internalSecret, "from-env-0123456789");
  assert.equal(parseArgs(["--internal-secret", "flag-0123456789abcd", "/tmp/a"], KEY).internalSecret, "flag-0123456789abcd");
  assert.equal(parseArgs(["--search-wait", "5", "/tmp/a"], KEY).searchWaitMs, 5_000);
  assert.equal(parseArgs(["--help"], {}).help, true);
});

test("a missing input, a live or missing key, or an unknown flag is a usage error that never echoes the key", () => {
  assert.throws(() => parseArgs([], KEY), (e) => e instanceof UsageError && /OUT_DIR/.test(e.message));
  assert.throws(() => parseArgs(["/tmp/a"], {}), (e) => e instanceof UsageError && /sk_test_/.test(e.message));
  const live = "sk_live_stub";
  assert.throws(() => parseArgs(["/tmp/a"], { STRIPE_SECRET_KEY: live }), (e) => e instanceof UsageError && !e.message.includes(live));
  assert.throws(() => parseArgs(["--bogus", "/tmp/a"], KEY), UsageError);
  assert.throws(() => parseArgs(["--search-wait", "x", "/tmp/a"], KEY), UsageError);
});

test("redact hides any Stripe key, masked or not", () => {
  assert.equal(redact("Invalid API Key provided: sk_test_****************wxyz"), "Invalid API Key provided: sk_test_[REDACTED]");
  assert.equal(redact("pk_test_abc and rk_live_def"), "pk_test_[REDACTED] and rk_live_[REDACTED]");
  assert.equal(redact("nothing here"), "nothing here");
});

/* ------------------------------------------------------------------ run records */

const b64 = (v) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64");
const record = (over = {}) => ({
  task: "XX01",
  run: "reference",
  payments: "stripe",
  store: "halden",
  workspace: WS,
  storeUrl: `http://localhost:4650/w/${WS}/halden`,
  expectClass: "correct",
  cards: ["success"],
  orders: ["HA-123456-K7"],
  ...over,
});

test("run records come out of results.json: each test's run.json attachment, with its title and status", () => {
  const results = {
    suites: [
      {
        title: "tasks.spec.ts",
        specs: [
          {
            title: "XX01 halden easy [Stripe]",
            tests: [{ results: [{ status: "passed", attachments: [{ name: "shopper.log", contentType: "text/plain", body: b64("log") }, { name: "run.json", contentType: "application/json", body: b64(record()) }] }] }],
          },
        ],
        suites: [
          {
            title: "nested",
            specs: [
              { title: "XX02 wrenfield medium [Stripe]", tests: [{ results: [{ status: "failed", attachments: [{ name: "run.json", contentType: "application/json", body: b64(record({ task: "XX02", store: "wrenfield" })) }] }] }] },
              { title: "no record", tests: [{ results: [{ status: "failed", attachments: [] }] }] },
            ],
          },
        ],
      },
    ],
  };
  const rs = recordsOf(results, "results.json");
  assert.deepEqual(
    rs.map((r) => [r.task, r.store, r.title, r.status]),
    [
      ["XX01", "halden", "XX01 halden easy [Stripe]", "passed"],
      ["XX02", "wrenfield", "XX02 wrenfield medium [Stripe]", "failed"],
    ],
  );
  assert.deepEqual(recordsOf({ suites: [] }, "x"), []);
});

/* ------------------------------------------------------------------ the payment ids a store's state names */

test("a store's state names its payments: orders, checkouts (their intent), payment attempts and hosted sessions", () => {
  const state = {
    orders: [{ orderNo: "HA-1", paymentRef: "pi_order" }],
    checkouts: [
      { token: "t1", paymentRef: "pi_checkout", flags: { paymentIntent: { id: "pi_flag" } } },
      { token: "t2", paymentRef: null, flags: {} },
    ],
    events: [
      { kind: "payment_attempt", data: { ref: "pi_attempt" } },
      { kind: "session_created", data: { session: "cs_test_session" } },
      { kind: "order_placed", data: { paymentRef: "pi_order" } },
      { kind: "newsletter", data: {} },
    ],
  };
  assert.deepEqual(knownRefs(state), { intents: ["pi_attempt", "pi_checkout", "pi_flag", "pi_order"], sessions: ["cs_test_session"] });
  assert.deepEqual(knownRefs({ orders: [], checkouts: [], events: [] }), { intents: [], sessions: [] });
});

/* ------------------------------------------------------------------ the audit of one run */

const order = (over = {}) => ({ orderNo: "HA-123456-K7", checkoutToken: "k3v9x2m7q8w1r5t0y6u4p2n8", paymentRef: "pi_1", chargedCents: 34956, totals: { totalCents: 34956 }, ...over });
const intent = (over = {}) => ({
  id: "pi_1",
  status: "succeeded",
  amount: 34956,
  currency: "usd",
  livemode: false,
  metadata: { workspace: WS, store: "halden", checkout: "k3v9x2m7q8w1r5t0y6u4p2n8", scenario: "XX01" },
  last_payment_error: null,
  latest_charge: { id: "ch_1", status: "succeeded", payment_method_details: { card: { three_d_secure: null } } },
  ...over,
});
const facts = (over = {}) => ({ orders: [order()], intents: new Map([["pi_1", intent()]]), charges: new Map(), requiresAction: new Set(), ...over });

test("a paid order whose one succeeded intent matches it in amount, currency, mode and metadata is clean", () => {
  const { row, problems } = auditRun(record(), facts());
  assert.deepEqual(problems, []);
  assert.equal(row.orders, 1);
  assert.equal(row.paid, 1);
  assert.equal(row.amounts, "1/1");
  assert.equal(row.verdict, "ok");
});

test("an intent that disagrees with its order is a mismatch, every way it disagrees named", () => {
  const bad = intent({ amount: 34900, currency: "eur", livemode: true, metadata: { workspace: "ws_other", store: "halden", checkout: "x" } });
  const { row, problems } = auditRun(record(), facts({ intents: new Map([["pi_1", bad]]) }));
  assert.equal(row.verdict, "MISMATCH");
  // One line for the order, naming everything; an intent of another workspace is not counted as this one's payment.
  assert.equal(problems.length, 1, problems.join("\n"));
  const all = problems.join("\n");
  for (const want of ["amount 34900", "chargedCents 34956", "currency eur", "livemode", 'metadata.workspace "ws_other"', 'metadata.checkout "x"']) assert.ok(all.includes(want), `${want} in ${all}`);
  assert.equal(row.paid, 0);
});

test("an order Stripe has no succeeded intent for, or a charge the store never recorded, is a mismatch", () => {
  const missing = auditRun(record(), facts({ intents: new Map() }));
  assert.match(missing.problems.join("\n"), /HA-123456-K7: Stripe has no PaymentIntent pi_1/);
  const pending = auditRun(record(), facts({ intents: new Map([["pi_1", intent({ status: "requires_payment_method" })]]) }));
  assert.match(pending.problems.join("\n"), /status requires_payment_method/);
  const extra = auditRun(record(), facts({ intents: new Map([["pi_1", intent()], ["pi_2", intent({ id: "pi_2", amount: 1200 })]]) }));
  assert.match(extra.problems.join("\n"), /Stripe took \$12\.00 in pi_2, but the store has no order for it/);
  assert.equal(extra.row.paid, 2);
  const shared = auditRun(record({ orders: ["HA-1", "HA-2"] }), facts({ orders: [order({ orderNo: "HA-1" }), order({ orderNo: "HA-2" })] }));
  assert.match(shared.problems.join("\n"), /HA-1 and HA-2 share the payment pi_1/);
});

test("an order charged in another currency than it was shown in, or charged off its own total, is a mismatch", () => {
  const presented = auditRun(record(), facts({ intents: new Map([["pi_1", intent({ presentment_details: { presentment_amount: 110995, presentment_currency: "ils" } })]]) }));
  assert.match(presented.problems.join("\n"), /presented to the shopper in ILS/);
  const dollars = auditRun(record(), facts({ intents: new Map([["pi_1", intent({ presentment_details: { presentment_amount: 34956, presentment_currency: "usd" } })]]) }));
  assert.deepEqual(dollars.problems, []);
  const total = auditRun(record(), facts({ orders: [order({ totals: { totalCents: 34000 } })] }));
  assert.match(total.problems.join("\n"), /charged \$349\.56 but the order's total is \$340\.00/);
  const unset = auditRun(record(), facts({ orders: [order({ chargedCents: null })] }));
  assert.match(unset.problems.join("\n"), /chargedCents null/);
});

test("a run that must end without an order: no order, no succeeded intent", () => {
  const none = record({ expectClass: "none", cards: [], orders: [] });
  assert.deepEqual(auditRun(none, facts({ orders: [], intents: new Map() })).problems, []);
  assert.match(auditRun(none, facts()).problems.join("\n"), /should end without an order, but the store lists HA-123456-K7/);
  const placed = auditRun(record(), facts({ orders: [], intents: new Map() }));
  assert.match(placed.problems.join("\n"), /should have placed an order, but the store lists none/);
  const unseen = auditRun(record({ orders: ["HA-999999-ZZ"] }), facts());
  assert.match(unseen.problems.join("\n"), /reached HA-999999-ZZ, which the store does not list/);
});

test("the decline: an intent with a declined last_payment_error and no order — or, paid after, a declined charge", () => {
  const declinedIntent = intent({ status: "requires_payment_method", last_payment_error: { code: "card_declined", decline_code: "generic_decline", message: "Your card was declined." }, latest_charge: null });
  const run = record({ expectClass: "none", cards: ["decline"], orders: [] });
  const ok = auditRun(run, facts({ orders: [], intents: new Map([["pi_1", declinedIntent]]) }));
  assert.deepEqual(ok.problems, []);
  assert.equal(ok.row.decline, "declined");
  const notDeclined = auditRun(run, facts({ orders: [], intents: new Map([["pi_1", intent({ status: "requires_payment_method", latest_charge: null })]]) }));
  assert.match(notDeclined.problems.join("\n"), /no PaymentIntent with a declined last_payment_error/);
  const paidAfter = record({ expectClass: "should_not_pay", cards: ["decline", "success"] });
  const failedCharge = { id: "ch_0", status: "failed", failure_code: "card_declined", outcome: { type: "issuer_declined" } };
  const withCharge = auditRun(paidAfter, facts({ charges: new Map([["pi_1", [failedCharge, { id: "ch_1", status: "succeeded" }]]]) }));
  assert.deepEqual(withCharge.problems, []);
  assert.equal(withCharge.row.decline, "declined");
  const noTrace = auditRun(paidAfter, facts());
  assert.match(noTrace.problems.join("\n"), /the decline card left no declined charge/);
});

test("3D Secure: each order's intent went through requires_action and its charge shows an authenticated challenge", () => {
  const run = record({ cards: ["3ds"] });
  const tds = { latest_charge: { id: "ch_1", status: "succeeded", payment_method_details: { card: { three_d_secure: { result: "authenticated", authentication_flow: "challenge", version: "2.2.0" } } } } };
  const ok = auditRun(run, facts({ intents: new Map([["pi_1", intent(tds)]]), requiresAction: new Set(["pi_1"]) }));
  assert.deepEqual(ok.problems, []);
  assert.equal(ok.row.threeDs, "challenged");
  const noEvent = auditRun(run, facts({ intents: new Map([["pi_1", intent(tds)]]) }));
  assert.match(noEvent.problems.join("\n"), /pi_1 never went through requires_action/);
  const noAuth = auditRun(run, facts({ requiresAction: new Set(["pi_1"]) }));
  assert.match(noAuth.problems.join("\n"), /no authenticated 3D Secure/);
  assert.equal(auditRun(record(), facts()).row.threeDs, "-");
});

test("a run without a workspace, or a fake-mode run, is reported, not looked up", () => {
  assert.match(auditRun(record({ workspace: null }), facts()).problems.join("\n"), /minted no workspace/);
  const fake = auditRun(record({ payments: "fake" }), facts());
  assert.deepEqual(fake.problems, []);
  assert.equal(fake.row.verdict, "skipped");
});
