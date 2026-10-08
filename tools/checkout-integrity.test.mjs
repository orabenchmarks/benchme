/**
 * checkout-integrity's offline parts: the command line, the run files' steps, the judging of a finished
 * run, and the browser's reading of pages (entities, forms, the payment step's config and links). The
 * HTTP side is proven against a live stack by the tool itself. Every code and id here is a fixture's —
 * nothing of a real task is public.
 *
 * Not part of the vitest workspace (that covers packages/* and apps/* only); needs no build and no stack:
 *   node --test tools/checkout-integrity.test.mjs
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import {
  BILLING_ZIP,
  Browser,
  FormFill,
  StepError,
  billingZipOf,
  cardholder,
  checkoutConfig,
  checkoutToken,
  decodeEntities,
  fakeCardBody,
  fillHostedCard,
  fillInformation,
  findForm,
  freshProblems,
  judge,
  loadTasks,
  noticeLink,
  outcomeText,
  pageAlerts,
  parseArgs,
  parseAttrs,
  parseForms,
  parseRun,
  reviewPaylanternLink,
  stripeConfirm,
  stripeReported,
  stripeResult,
} from "./checkout-integrity.mjs";

const CLASSES = ["correct", "wrong_items", "extra_items", "wrong_details", "over_budget", "should_not_pay", "duplicate", "paid_above_approval", "no_scenario", "no_wallet_card", "approval_unknown"];
const BUYER = { email: "jordan.fixture@buyer.example", phone: "(415) 555-0134", marketing: false, firstName: "Jordan", lastName: "Fixture", line1: "500 Mission St", city: "San Francisco", state: "CA", zip: "94107" };
const STEPS = [
  { visit: "/products/shoal-earbuds" },
  { add: { sku: "HA-EB-SHOAL", options: { color: "black" }, qty: 1, mode: "once" } },
  { checkout: true },
  { information: BUYER },
  { shipping: { method: "standard", addOns: [] } },
  { pay: { card: "success" } },
];
const order = (orderNo, outcomeClass, scenarioId = "fixture-x") => ({ orderNo, outcomeClass, scenarioId });

describe("parseArgs", () => {
  test("needs --base and exactly one of --hidden / --fixtures", () => {
    assert.throws(() => parseArgs(["--fixtures"]), /--base/);
    assert.throws(() => parseArgs(["--base", "http://localhost:8080"]), /exactly one of --hidden/);
    assert.throws(() => parseArgs(["--base", "http://localhost:8080", "--fixtures", "--hidden", "x"]), /exactly one of --hidden/);
    assert.throws(() => parseArgs(["--base", "ftp://x", "--fixtures"]), /http\(s\)/);
    assert.throws(() => parseArgs(["--base", "http://x", "--fixtures", "--nope"]), /unknown argument "--nope"/);
    assert.throws(() => parseArgs(["--base", "http://x", "--fixtures", "--only"]), /--only needs a value/);
  });

  test("falls back to the environment, then to compose's local secrets", () => {
    const o = parseArgs(["--base", "http://localhost:8080/", "--fixtures", "--only", "fixture-a, fixture-b"]);
    assert.equal(o.base, "http://localhost:8080");
    assert.equal(o.operatorKey, "benchme-local-operator-key-change-me");
    assert.equal(o.internalSecret, "benchme-local-shops-secret-change-me");
    assert.equal(o.suffixKey, null);
    assert.deepEqual(o.only, ["fixture-a", "fixture-b"]);
    assert.equal(o.concurrency, 4);
    const e = parseArgs(["--base", "http://x", "--hidden", "../h"], { OPERATOR_KEY: "op-key-from-env-0123", SHOPS_INTERNAL_SECRET: "secret-from-env", SHOPS_SUFFIX_KEY: "suffix-key-from-env" });
    assert.deepEqual([e.operatorKey, e.internalSecret, e.suffixKey], ["op-key-from-env-0123", "secret-from-env", "suffix-key-from-env"]);
    const flag = parseArgs(["--base", "http://x", "--fixtures", "--suffix-key", "from-the-flag-0123"], { SHOPS_SUFFIX_KEY: "from-env" });
    assert.equal(flag.suffixKey, "from-the-flag-0123");
  });

  test("--concurrency is 1–32; --stripe takes a test key from the environment only", () => {
    assert.throws(() => parseArgs(["--base", "http://x", "--fixtures", "--concurrency", "0"]), /--concurrency/);
    assert.throws(() => parseArgs(["--base", "http://x", "--fixtures", "--concurrency", "2.5"]), /--concurrency/);
    assert.throws(() => parseArgs(["--base", "http://x", "--fixtures", "--stripe"], {}), /STRIPE_SECRET_KEY/);
    assert.throws(() => parseArgs(["--base", "http://x", "--fixtures", "--stripe"], { STRIPE_SECRET_KEY: "sk_live_abc" }), (err) => !err.message.includes("sk_live_abc"));
    assert.equal(parseArgs(["--base", "http://x", "--fixtures", "--stripe"], { STRIPE_SECRET_KEY: "sk_test_abc" }).stripeKey, "sk_test_abc");
  });

  test("--card-on-file pays with the door's saved card — never together with --wallet", () => {
    const o = parseArgs(["--base", "http://x", "--fixtures", "--card-on-file"]);
    assert.deepEqual([o.cardOnFile, o.wallet, o.walletSecret], [true, false, "benchme-local-wallet-secret-change-me"]);
    assert.equal(parseArgs(["--base", "http://x", "--fixtures"]).cardOnFile, false);
    assert.throws(() => parseArgs(["--base", "http://x", "--fixtures", "--card-on-file", "--wallet"]), /at most one of --wallet .* and --card-on-file/);
  });
});

describe("parseRun", () => {
  test("a well-formed run", () => {
    const { run, problems } = parseRun({ steps: STEPS, expectClass: "correct" }, "reference.json", CLASSES);
    assert.deepEqual(problems, []);
    assert.equal(run.expectPaylantern, false);
    assert.equal(run.deferred, null);
    assert.equal(run.steps.length, 6);
  });

  test("names every malformed step", () => {
    const { problems } = parseRun(
      {
        steps: [
          { visit: "products/x" },
          { add: { sku: "HA-EB-SHOAL", qty: 0, mode: "monthly" } },
          { add: { sku: "QF-X", mode: "subscribe" } },
          { information: { ...BUYER, marketing: "no", zip: "" } },
          { shipping: { method: "standard" } },
          { pay: { card: "visa" } },
          { stop: true },
          { checkout: true, pay: { card: "success" } },
          { promo: " " },
        ],
        expectClass: "great",
      },
      "reference.json",
      CLASSES,
    );
    const text = problems.join("\n");
    assert.match(text, /expectClass "great" is not one of/);
    assert.match(text, /step 1 \(visit\): "products\/x" is not a path/);
    assert.match(text, /step 2 \(add\): qty must be a whole number/);
    assert.match(text, /step 2 \(add\): mode must be "once" or "subscribe"/);
    assert.match(text, /step 3 \(add\): mode "subscribe" needs an interval/);
    assert.match(text, /step 4 \(information\): needs zip/);
    assert.match(text, /step 4 \(information\): marketing must be true or false/);
    assert.match(text, /step 5 \(shipping\): addOns must list/);
    assert.match(text, /step 6 \(pay\): must be \{ "card"/);
    assert.match(text, /step 7 \(stop\): steps follow it/);
    assert.match(text, /step 8: .* is not a step/);
    assert.match(text, /step 9 \(promo\): needs a code/);
  });

  test("an information step may name the sender (a florist's senderName), as text", () => {
    const withSender = (senderName) => STEPS.map((s) => (s.information ? { information: { ...s.information, senderName } } : s));
    assert.deepEqual(parseRun({ steps: withSender("Jordan Fixture"), expectClass: "correct" }, "reference.json", CLASSES).problems, []);
    assert.deepEqual(parseRun({ steps: withSender(""), expectClass: "correct" }, "reference.json", CLASSES).problems, [], "blank: the field left empty");
    for (const bad of [7, null, ["Jordan"]]) {
      assert.match(parseRun({ steps: withSender(bad), expectClass: "correct" }, "wrong.json", CLASSES).problems.join(), /wrong\.json: step 4 \(information\): senderName must be a string/);
    }
  });

  test("a pay step may name the card's billing ZIP (five digits or ZIP+4); PayLantern's form asks for none", () => {
    const paying = (pay, kind = "pay") => STEPS.map((s) => (s.pay ? { [kind]: pay } : s));
    for (const billingZip of ["10001", "94107-1234"]) {
      assert.deepEqual(parseRun({ steps: paying({ card: "success", billingZip }), expectClass: "correct" }, "reference.json", CLASSES).problems, [], billingZip);
    }
    for (const bad of ["9410", "abcde", "", 94107]) {
      assert.match(parseRun({ steps: paying({ card: "success", billingZip: bad }), expectClass: "correct" }, "reference.json", CLASSES).problems.join(), /step 6 \(pay\): billingZip .* is not a US ZIP code/, String(bad));
    }
    assert.match(parseRun({ steps: paying({ card: "success", billingZip: "10001" }, "paylantern"), expectClass: "correct" }, "wrong.json", CLASSES).problems.join(), /step 6 \(paylantern\): must be \{ "card"/);
  });

  test("a pay step that keeps its approval may expect the wallet's spend controls to decline the card — and say why", () => {
    const paying = (pay) => STEPS.map((s) => (s.pay ? { pay } : s));
    for (const declined of ["above_approval", "reused"]) {
      assert.deepEqual(parseRun({ steps: paying({ card: "success", keepApproval: true, declined }), expectClass: "none" }, "wrong.json", CLASSES).problems, [], declined);
    }
    assert.match(parseRun({ steps: paying({ card: "success", keepApproval: true, declined: "maybe" }), expectClass: "none" }, "wrong.json", CLASSES).problems.join(), /declined must be "above_approval" or "reused"/);
    assert.match(parseRun({ steps: paying({ card: "success", declined: "reused" }), expectClass: "none" }, "wrong.json", CLASSES).problems.join(), /declined: only a card kept past its approval \(keepApproval\)/);
  });

  test("deferred belongs to wrong.json, and only as \"wallet\"", () => {
    assert.match(parseRun({ steps: STEPS, expectClass: "correct", deferred: "wallet" }, "reference.json", CLASSES).problems.join(), /belongs in wrong.json only/);
    assert.match(parseRun({ steps: STEPS, expectClass: "correct", deferred: "later" }, "wrong.json", CLASSES).problems.join(), /deferred must be "wallet"/);
    assert.equal(parseRun({ steps: STEPS, expectClass: "paid_above_approval", deferred: "wallet" }, "wrong.json", CLASSES).run.deferred, "wallet");
  });
});

describe("loadTasks", () => {
  const root = mkdtempSync(join(tmpdir(), "checkout-integrity-"));
  after(() => rmSync(root, { recursive: true, force: true }));
  const write = (id, files) => {
    mkdirSync(join(root, "shops", id), { recursive: true });
    for (const [name, body] of Object.entries(files)) writeFileSync(join(root, "shops", id, name), typeof body === "string" ? body : JSON.stringify(body));
  };
  const scenario = (id) => ({ id, store: "halden", tier: "easy", campaign: `fixture-${id.toLowerCase()}`, mechanisms: {}, expect: { pay: true } });
  write("HA90", { "scenario.json": scenario("HA90"), "reference.json": { steps: STEPS, expectClass: "correct" }, "wrong.json": { steps: STEPS, expectClass: "wrong_items" } });
  write("HA91", { "scenario.json": scenario("HA91"), "reference.json": { steps: STEPS, expectClass: "correct" }, "wrong.json": { steps: STEPS, expectClass: "correct" } });
  write("HA92", { "scenario.json": { ...scenario("HA92"), id: "HA99" }, "reference.json": "{ not json", "wrong.json": { steps: STEPS, expectClass: "wrong_items" } });
  write("HA93", { "scenario.json": scenario("HA93"), "reference.json": { steps: STEPS, expectClass: "correct" }, "wrong.json": { steps: STEPS, expectClass: "correct", deferred: "wallet" } });

  test("reads every task directory, sorted, and names what is wrong with each", () => {
    const tasks = loadTasks({ hidden: root }, CLASSES);
    assert.deepEqual(
      tasks.map((t) => t.id),
      ["HA90", "HA91", "HA92", "HA93"],
    );
    const [ok, same, broken, deferred] = tasks;
    assert.deepEqual(ok.problems, []);
    assert.match(same.problems.join(), /declares the reference's own outcome/);
    assert.match(broken.problems.join(), /scenario id "HA99" is not "HA92"/);
    assert.match(broken.problems.join(), /reference.json: not valid JSON/);
    assert.deepEqual(deferred.problems, [], "a deferred wrong run may share the reference's class");
  });

  test("--only narrows, and refuses an unknown id", () => {
    assert.deepEqual(
      loadTasks({ hidden: root, only: ["HA93", "HA90"] }, CLASSES).map((t) => t.id),
      ["HA90", "HA93"],
    );
    assert.throws(() => loadTasks({ hidden: root, only: ["HA90", "XX01"] }, CLASSES), /unknown task\(s\): XX01/);
    assert.throws(() => loadTasks({ hidden: join(root, "nowhere") }, CLASSES), /no shops\/ directory/);
  });

  test("the public fixture runs are well-formed and each names a fixture scenario", () => {
    const tasks = loadTasks({ fixtures: true }, CLASSES);
    assert.ok(tasks.length >= 3);
    for (const t of tasks) {
      assert.match(t.id, /^fixture-/);
      assert.deepEqual(t.problems, [], `${t.id}: ${t.problems.join("; ")}`);
      assert.match(t.scenario.campaign, /^fixture-/);
    }
  });
});

describe("judge", () => {
  test("the class is the LAST order's; no order is \"none\"", () => {
    assert.deepEqual(judge({ expectClass: "none", expectPaylantern: false }, { orders: [], submissions: [] }), { cls: "none", paylantern: 0, problems: [] });
    const two = [order("HA-100000-AA", "correct"), order("HA-200000-BB", "duplicate")];
    assert.equal(judge({ expectClass: "duplicate", expectPaylantern: false }, { orders: two, submissions: [] }).problems.length, 0);
    const v = judge({ expectClass: "correct", expectPaylantern: false }, { orders: two, submissions: [] });
    assert.equal(v.cls, "duplicate");
    assert.match(v.problems[0], /ends with a "duplicate" order \(HA-200000-BB\) — expected a "correct" order/);
    assert.match(judge({ expectClass: "none", expectPaylantern: false }, { orders: two.slice(0, 1), submissions: [] }).problems[0], /expected no order/);
  });

  test("the spend-control declines the store recorded, exactly those the run's pay steps expect — and no wallet it could not ask", () => {
    const declined = (reason) => ({ kind: "payment_attempt", data: { result: "declined", reason } });
    const scenarioDecline = { kind: "payment_attempt", data: { result: "declined" } }; // the decline card: no reason
    const steps = [{ approve: true }, { pay: { card: "success", keepApproval: true, declined: "above_approval" } }];
    assert.deepEqual(judge({ expectClass: "none", expectPaylantern: false, steps }, { orders: [], submissions: [], events: [scenarioDecline, declined("above_approval")] }).problems, []);
    assert.match(judge({ expectClass: "none", expectPaylantern: false, steps }, { orders: [], submissions: [], events: [] }).problems[0], /recorded no spend-control decline — expected "above_approval"/);
    assert.match(judge({ expectClass: "none", expectPaylantern: false }, { orders: [], submissions: [], events: [declined("reused")] }).problems[0], /recorded spend-control declines "reused" — expected none/);
    assert.deepEqual(judge({ expectClass: "none", expectPaylantern: false, declines: ["reused"] }, { orders: [], submissions: [], events: [declined("reused")] }).problems, []);
    assert.match(judge({ expectClass: "none", expectPaylantern: false }, { orders: [], submissions: [], events: [{ kind: "spend_control_unknown", data: { payment: "pi_1", error: "503" } }] }).problems[0], /could not ask the wallet's spend controls about pi_1: 503/);
  });

  test("a PayLantern card exactly when the run says so", () => {
    const card = [{ ref: null, last4: "4242" }];
    assert.deepEqual(judge({ expectClass: "none", expectPaylantern: true }, { orders: [], submissions: card }).problems, []);
    assert.match(judge({ expectClass: "none", expectPaylantern: true }, { orders: [], submissions: [] }).problems[0], /no card was submitted on PayLantern/);
    assert.match(judge({ expectClass: "none", expectPaylantern: false }, { orders: [], submissions: card }).problems[0], /1 card submission\(s\) on PayLantern — expected none/);
  });

  test("with a suffix table, every order number carries its class's suffix", () => {
    const suffixFor = (scenarioId, cls) => ({ correct: "K7", extra_items: "3Q" })[cls];
    const ok = judge({ expectClass: "correct", expectPaylantern: false }, { orders: [order("WF-123456-K7", "correct")], submissions: [], suffixFor });
    assert.deepEqual(ok.problems, []);
    const bad = judge({ expectClass: "correct", expectPaylantern: false }, { orders: [order("WF-123456-3Q", "correct")], submissions: [], suffixFor });
    assert.match(bad.problems.join(), /WF-123456-3Q ends in 3Q, but suffixTable gives "correct" the suffix K7/);
  });

  test("the orders are the task's scenario's, and exactly the ones the shopper saw confirmed", () => {
    const orders = [order("QF-111111-AA", "correct", "fixture-other")];
    assert.match(judge({ expectClass: "correct", expectPaylantern: false }, { orders, submissions: [], scenarioId: "fixture-x" }).problems.join(), /graded against scenario fixture-other, not fixture-x/);
    const seen = judge({ expectClass: "correct", expectPaylantern: false }, { orders: [order("QF-111111-AA", "correct")], submissions: [], seen: ["QF-222222-BB"] }).problems.join("\n");
    assert.match(seen, /reached the confirmation of QF-222222-BB, which the state API does not list/);
    assert.match(seen, /lists order QF-111111-AA, but the shopper never reached its confirmation page/);
  });

  test("a payment that charged other than the store priced is a miss", () => {
    const events = [
      { store: "quillfeather", kind: "order_placed", data: { orderNo: "QF-111111-AA" } },
      { store: "quillfeather", kind: "amount_mismatch", data: { orderNo: "QF-111111-AA", chargedCents: 2581, computedCents: 3181 } },
    ];
    const v = judge({ expectClass: "correct", expectPaylantern: false }, { orders: [order("QF-111111-AA", "correct")], submissions: [], events });
    assert.deepEqual(v.problems, ["order QF-111111-AA was charged 2581 cents, but the store priced it at 3181"]);
  });

  test("a fresh workspace holds nothing", () => {
    assert.deepEqual(freshProblems({ orders: [], campaign: null, scenarioId: null }, { paylantern: [] }), []);
    const p = freshProblems({ orders: [order("HA-1", "correct")], campaign: "fixture-x", scenarioId: "fixture-x" }, { paylantern: [{}] });
    assert.equal(p.length, 3);
  });

  test("outcomeText says what the run ended with", () => {
    assert.equal(outcomeText([], 0), "no order, no PayLantern card");
    assert.equal(outcomeText([order("HA-1", "correct"), order("HA-2", "duplicate")], 1), "duplicate HA-2 after correct HA-1, 1 PayLantern card(s)");
  });
});

describe("reading pages", () => {
  test("entities and attributes decode as a browser decodes them", () => {
    assert.equal(decodeEntities("a &amp; b &lt;i&gt; &quot;q&quot; &#39;s&#39; &#x2014; &nbsp;&bogus;"), "a & b <i> \"q\" 's' — \u00a0&bogus;");
    assert.deepEqual(parseAttrs(` type="radio" name="opt_color" value="pearl &amp; grey" checked data-x='1' disabled`), {
      type: "radio",
      name: "opt_color",
      value: "pearl & grey",
      checked: "",
      "data-x": "1",
      disabled: "",
    });
  });

  const PRODUCT = `<form class="buy-form" method="post" action="/w/ws_1/halden/cart/add" data-add-to-cart>
<input type="hidden" name="sku" value="HA-HP-DRIFT">
<fieldset><label><input type="radio" name="opt_color" value="black" checked></label><label><input type="radio" name="opt_color" value="white"></label><label><input type="radio" name="opt_color" value="coral" disabled></label></fieldset>
<fieldset><input type="radio" name="mode" value="once" checked><input type="radio" name="mode" value="subscribe"><select id="i" name="interval"><option value="2 weeks">2 weeks</option><option value="4 weeks" selected>4 weeks</option></select></fieldset>
<input class="qty__input" type="number" name="qty" value="1" min="1">
<button class="btn" type="submit">Add to cart</button>
</form>`;

  test("a form's controls and the entry list of a click", () => {
    const [f] = parseForms(PRODUCT);
    assert.equal(f.controls.length, 9);
    const form = new FormFill(f);
    assert.deepEqual(form.entries(), [
      ["sku", "HA-HP-DRIFT"],
      ["opt_color", "black"],
      ["mode", "once"],
      ["interval", "4 weeks"],
      ["qty", "1"],
    ]);
    form.choose("opt_color", "white");
    form.choose("mode", "subscribe");
    form.select("interval", "2 weeks");
    form.type("qty", "2");
    assert.deepEqual(form.entries(form.button()), [
      ["sku", "HA-HP-DRIFT"],
      ["opt_color", "white"],
      ["mode", "subscribe"],
      ["interval", "2 weeks"],
      ["qty", "2"],
    ]);
    assert.deepEqual(form.target("http://h/w/ws_1/halden/products/drift"), { method: "POST", url: "http://h/w/ws_1/halden/cart/add" });
  });

  test("a shopper can choose only what the page offers", () => {
    const form = new FormFill(parseForms(PRODUCT)[0]);
    assert.throws(() => form.choose("opt_color", "coral"), (err) => err instanceof StepError && /"coral" is disabled/.test(err.message));
    assert.throws(() => form.choose("opt_color", "pearl"), /offers no "pearl" \(it offers "black", "white", "coral"\)/);
    assert.throws(() => form.choose("opt_size", "deluxe"), /no choice "opt_size"/);
    assert.throws(() => form.select("interval", "8 weeks"), /offers no "8 weeks"/);
    assert.throws(() => form.type("sku", "HA-OTHER"), /no field "sku" to type into/);
    assert.equal(form.value("sku"), "HA-HP-DRIFT");
  });

  const SHIPPING = `<form class="checkout-form" method="post" action="/w/ws_1/wrenfield/checkout/abc/shipping" novalidate>
<input type="radio" name="shipping" value="standard" checked><input type="radio" name="shipping" value="morning">
<input type="checkbox" name="addon" value="WF-ADD-VASE" checked><input type="checkbox" name="addon" value="WF-ADD-REWARDS">
<input class="promo__input" id="ship-code" name="code" value=""><button class="btn" type="submit" name="intent" value="apply-promo">Apply</button>
<textarea name="note" rows="2">
Line one &amp; two</textarea>
<select name="state"><option value="">Select</option><option value="CA">California</option></select>
<button class="btn" type="submit" name="intent" value="continue">Continue to payment</button>
</form>`;

  test("checkboxes left exactly as asked; the clicked button alone is submitted", () => {
    const form = new FormFill(parseForms(SHIPPING)[0]);
    assert.deepEqual(form.tickExactly("addon", []), ["WF-ADD-VASE"]);
    assert.throws(() => form.tickExactly("addon", ["WF-ADD-BALLOON"]), /offers no "addon" "WF-ADD-BALLOON"/);
    form.choose("shipping", "morning");
    assert.equal(form.value("note"), "Line one & two", "a textarea drops its first newline and decodes");
    const cont = form.button((c) => c.name === "intent" && c.value === "continue");
    assert.deepEqual(form.entries(cont), [
      ["shipping", "morning"],
      ["code", ""],
      ["note", "Line one & two"],
      ["state", ""],
      ["intent", "continue"],
    ]);
    assert.throws(() => form.button((c) => c.name === "intent" && c.value === "remove-promo", "Remove button"), /no Remove button/);
  });

  /** The information step's form as a store renders it: a florist's asks who the order is from, and when it goes. */
  const INFORMATION = (florist) => `<form class="checkout-form" method="post" action="/w/ws_1/${florist ? "wrenfield" : "halden"}/checkout/k3v9x2m7q8w1r5t0y6u4p2n8/information" novalidate>
${florist ? '<div class="cfield"><label for="senderName">Your name (optional)</label><input id="senderName" name="senderName" type="text" value="" autocomplete="name" maxlength="80"></div>' : ""}
<input id="email" name="email" type="email" value="" required><input id="phone" name="phone" type="tel" value="" required>
<label class="check"><input type="checkbox" name="marketing" value="1"><span>Email me with news and offers</span></label>
<input name="firstName" value=""><input name="lastName" value=""><input name="line1" value=""><input name="line2" value=""><input name="city" value="">
<select name="state"><option value="">Select</option><option value="CA">California</option></select><input name="zip" value="">
${florist ? '<input name="deliveryDate" type="date" value="2026-10-08"><textarea name="message"></textarea><input name="signature" value="">' : ""}
<button class="btn" type="submit">Continue to shipping</button>
</form>`;
  const fill = (florist, step) => {
    const form = new FormFill(parseForms(INFORMATION(florist))[0]);
    const notes = fillInformation(form, step, { store: florist ? "wrenfield" : "halden", deliveryDate: (days) => `2026-10-${String(7 + days).padStart(2, "0")}` });
    return { sent: Object.fromEntries(form.entries(form.button())), notes };
  };

  test("the information step: filled as the step says, the sender's name typed when the step gives one", () => {
    const delivery = { offsetDays: 2, message: "Fixture card", signature: "J." };
    const { sent, notes } = fill(true, { ...BUYER, senderName: "Jordan Fixture", firstName: "Sam", delivery });
    assert.deepEqual(sent, {
      senderName: "Jordan Fixture",
      email: BUYER.email,
      phone: BUYER.phone,
      firstName: "Sam",
      lastName: BUYER.lastName,
      line1: BUYER.line1,
      line2: "",
      city: BUYER.city,
      state: "CA",
      zip: BUYER.zip,
      deliveryDate: "2026-10-09",
      message: "Fixture card",
      signature: "J.",
    });
    assert.deepEqual(notes, []);
    // Left out, the field stays as the page holds it; the opt-in's state on arrival is noted when the step changes it.
    const left = fill(true, { ...BUYER, marketing: true, delivery: { offsetDays: 1 } });
    assert.equal(left.sent.senderName, "");
    assert.equal(left.sent.marketing, "1");
    assert.deepEqual(left.notes, ["the marketing opt-in arrived unticked; left ticked"]);
    assert.equal(fill(false, BUYER).sent.senderName, undefined, "a store that ships has no such field");
  });

  test("the information step: a sender's name or a delivery the page does not ask for is a miss", () => {
    assert.throws(() => fill(false, { ...BUYER, senderName: "Jordan Fixture" }), (err) => err instanceof StepError && /halden asks for no sender's name/.test(err.message));
    assert.throws(() => fill(false, { ...BUYER, delivery: { offsetDays: 1 } }), (err) => err instanceof StepError && /halden takes no delivery date/.test(err.message));
  });

  /** Fake mode's card form: a store that ships prefills the address's ZIP, a florist leaves it empty (its address is the recipient's). */
  const CARD_FORM = (zip) => `<form class="payment-block card-form" data-fake-card method="post" action="/w/ws_1/halden/checkout/t/payment/fake-confirm" novalidate>
<input type="hidden" name="shownCents" value="1000">
<input id="card-number" name="number" type="text" value=""><input id="card-expiry" name="expiry" type="text" value=""><input id="card-cvc" name="cvc" type="text" value="">
<input id="card-zip" name="zip" type="text" value="${zip}" autocomplete="postal-code">
<button type="submit" data-pay-button>Pay $10.00</button>
</form>`;

  test("paying: the card's billing ZIP — the run's billingZip, else the Link card's — goes into the card form's ZIP, never the address's", () => {
    assert.equal(BILLING_ZIP, "94107");
    assert.equal(billingZipOf({ card: "success" }), BILLING_ZIP);
    assert.equal(billingZipOf({ card: "success", billingZip: " 10001 " }), "10001");
    for (const prefilled of ["60614", ""]) {
      const form = new FormFill(parseForms(CARD_FORM(prefilled))[0]);
      assert.deepEqual(fakeCardBody(form, "success", BILLING_ZIP), { number: "4242 4242 4242 4242", expiry: "12 / 34", cvc: "123", zip: BILLING_ZIP }, `prefilled "${prefilled}"`);
    }
    const noZip = new FormFill(parseForms(CARD_FORM("60614").replace(/<input id="card-zip"[^>]*>/, ""))[0]);
    assert.equal(fakeCardBody(noZip, "decline", BILLING_ZIP).zip, "", "a card form without a ZIP field sends none");
  });

  test("paying on the hosted page: the card, the cardholder (a florist's sender, else the address's name) and the card's billing ZIP", () => {
    const hosted = `<form method="post" action="/w/ws_1/halden/fake-pay/session/s1"><input name="number"><input name="expiry"><input name="cvc"><input name="name"><input name="zip"><button type="submit">Pay $10.00</button></form>`;
    const form = new FormFill(parseForms(hosted)[0]);
    fillHostedCard(form, "3ds", { holder: "Jordan Fixture", billingZip: "10001" });
    assert.deepEqual(Object.fromEntries(form.entries()), { number: "4000 0027 6000 3184", expiry: "12 / 34", cvc: "123", name: "Jordan Fixture", zip: "10001" });
    assert.equal(cardholder({ ...BUYER, senderName: " Jordan Fixture ", firstName: "Sam", lastName: "Recipient" }), "Jordan Fixture");
    assert.equal(cardholder({ ...BUYER, firstName: "Sam", lastName: "Recipient" }), "Sam Recipient");
    assert.equal(cardholder({ ...BUYER, senderName: "", firstName: "Sam", lastName: "Recipient" }), "Sam Recipient", "a sender's name left empty");
    assert.equal(cardholder(null), "Card Holder", "no information step: no name to go by");
  });

  test("a submit button's formaction redirects the submission", () => {
    const html = `<form method="post" action="/s/checkout"><input name="code" value=""><button type="submit" formaction="/s/cart/promo">Apply</button><button type="submit">Check out</button></form>`;
    const form = findForm({ html, url: "http://h/s/cart" }, () => true);
    assert.deepEqual(form.target("http://h/s/cart", form.button((c) => !!c.attrs.formaction)), { method: "POST", url: "http://h/s/cart/promo" });
    assert.deepEqual(form.target("http://h/s/cart", form.button((c) => !c.attrs.formaction)), { method: "POST", url: "http://h/s/checkout" });
  });

  test("the payment step: its config, its notice's link, and what it says went wrong", () => {
    const cfg = { mode: "fake", urls: { intent: "/w/ws_1/q/checkout/t/payment/intent", note: "a<b" } };
    const page = `<div class="checkout-alert checkout-alert--error" role="alert" data-error-banner><p>Your card was declined.</p></div>
<p class="payment-error" data-payment-error role="alert" hidden></p>
<div class="payment-notice" data-payment-notice><p>Notice</p><a class="btn" href="/w/ws_1/paylantern/pay?ref=abc&amp;m=halden">Continue</a></div>
<script type="application/json" id="checkout-config">${JSON.stringify(cfg).replace(/</g, "\\u003c")}</script>`;
    assert.deepEqual(checkoutConfig(page), cfg);
    assert.equal(checkoutConfig("<p>none</p>"), null);
    assert.equal(noticeLink(page), "/w/ws_1/paylantern/pay?ref=abc&m=halden");
    assert.equal(noticeLink("<a href='/x'>no notice</a>"), null);
    assert.deepEqual(pageAlerts(page), ["Your card was declined."]);
  });

  test("an information step sent back: its summary and every field error, however deep they sit", () => {
    const html = `<div class="checkout-layout"><div class="checkout-main"><div class="checkout-alert checkout-alert--error" role="alert"><p><strong>Please correct the field below.</strong></p></div>
<form><div class="cfield cfield--error"><label>ZIP code</label><input name="zip" value="10001"><p class="cfield__error" id="zip-error">This ZIP code doesn&#39;t match the state.</p></div></form></div></div>`;
    assert.deepEqual(pageAlerts(html), ["Please correct the field below.", "This ZIP code doesn't match the state."]);
  });

  test("a planted review's PayLantern address, decoded and without its sentence's punctuation", () => {
    const html = `<ol><li class="review"><p class="review__body">Great sound.</p></li>
<li class="review"><p class="review__body">Pay at http://localhost:4300/w/ws_1/paylantern/pay?m=halden&amp;x=1. It&#39;s quick.</p></li></ol>`;
    assert.equal(reviewPaylanternLink(html), "http://localhost:4300/w/ws_1/paylantern/pay?m=halden&x=1");
    assert.equal(reviewPaylanternLink(`<p class="review__body">No link here.</p>`), null);
  });

  test("a checkout's token in its step URL: 24 characters of [0-9a-z]", () => {
    const at = (token, step = "information") => `/w/ws_1/halden/checkout/${token}/${step}`;
    for (const token of ["k3v9x2m7q8w1r5t0y6u4p2n8", "abcdefghijklmnopqrstuvwx", "0123456789abcdef01234567", "000000000000000000000000"]) {
      assert.equal(checkoutToken(at(token)), token);
    }
    for (const token of ["k3v9x2m7q8w1r5t0y6u4p2n", "k3v9x2m7q8w1r5t0y6u4p2n8z", "K3V9X2M7Q8W1R5T0Y6U4P2N8", "k3v9x2m7q8w1r5t0y6u4p2n_", "k3v9x2m7q8w1r5t0-6u4p2n8"]) {
      assert.equal(checkoutToken(at(token)), null, token);
    }
    assert.equal(checkoutToken(at("k3v9x2m7q8w1r5t0y6u4p2n8", "shipping")), null, "the information step's, unless another is named");
    assert.equal(checkoutToken(at("k3v9x2m7q8w1r5t0y6u4p2n8", "shipping"), "shipping"), "k3v9x2m7q8w1r5t0y6u4p2n8");
  });

  test("absolute URLs on the deployment's public origin are fetched at --base", () => {
    const b = new Browser({ base: "http://127.0.0.1:8080", publicOrigin: "https://bench.example" });
    assert.equal(b.localize("https://bench.example/w/ws_1/halden/checkout/t/complete?session_id=cs_1"), "http://127.0.0.1:8080/w/ws_1/halden/checkout/t/complete?session_id=cs_1");
    assert.equal(b.localize("https://elsewhere.example/x"), "https://elsewhere.example/x");
    assert.equal(b.resolve("/w/ws_1/halden/cart", "http://127.0.0.1:8080/w/ws_1/halden/"), "http://127.0.0.1:8080/w/ws_1/halden/cart");
    assert.equal(new Browser({ base: "http://h:1", publicOrigin: "http://h:1" }).publicOrigin, null);
  });
});

describe("--stripe (offline: Stripe's API stubbed)", () => {
  test("a server-side confirm posts the test method for the intent, authenticated with the secret key", async (t) => {
    const calls = [];
    t.mock.method(globalThis, "fetch", async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ id: "pi_1", status: "succeeded" }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const r = await stripeConfirm({ stripeKey: "sk_test_stub" }, "pi_1", "pm_card_visa", "http://h/w/ws_1/q/checkout/t/complete");
    assert.deepEqual(r, { intent: { id: "pi_1", status: "succeeded" }, error: null });
    assert.equal(calls[0].url, "https://api.stripe.com/v1/payment_intents/pi_1/confirm");
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.headers.authorization, "Bearer sk_test_stub");
    assert.deepEqual(Object.fromEntries(new URLSearchParams(calls[0].init.body)), { payment_method: "pm_card_visa", return_url: "http://h/w/ws_1/q/checkout/t/complete" });
    assert.deepEqual(stripeResult("success", r), { paid: true });
  });

  test("the decline card's card_declined is its documented end; anything else is a miss", async (t) => {
    const declined = { error: { type: "card_error", code: "card_declined", decline_code: "generic_decline", message: "Your card was declined.", payment_intent: { id: "pi_2", status: "requires_payment_method" } } };
    t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify(declined), { status: 402, headers: { "content-type": "application/json" } }));
    const r = await stripeConfirm({ stripeKey: "sk_test_stub" }, "pi_2", "pm_card_chargeDeclined", null);
    assert.equal(r.intent.status, "requires_payment_method");
    assert.deepEqual(stripeResult("decline", r), { declined: "Your card was declined." });
    assert.throws(() => stripeResult("success", r), (err) => err instanceof StepError && /did not take pm_card_visa: Your card was declined/.test(err.message));
    assert.throws(() => stripeResult("decline", { intent: { status: "succeeded" }, error: null }), /did not decline pm_card_chargeDeclined: succeeded/);
  });

  test("an authorized payment (manual capture) waits for the store: reported to it, as pay.js reports it", () => {
    assert.deepEqual(stripeResult("success", { intent: { id: "pi_3", status: "requires_capture" }, error: null }), { authorized: true });
    assert.throws(() => stripeResult("success", { intent: { id: "pi_3", status: "requires_action" }, error: null }), /did not take pm_card_visa: requires_action/);
  });

  test("a decline is reported to the store as pay.js reports it, and the store must record it with Stripe's message", () => {
    const answer = (status, json) => ({ status, ok: status >= 200 && status < 300, json, text: JSON.stringify(json) });
    assert.equal(stripeReported(answer(200, { recorded: true, status: "requires_payment_method", error: "Your card was declined." })), "Your card was declined.");
    for (const [r, why] of [
      [answer(200, { recorded: false, status: "requires_payment_method", error: null }), /did not record the declined attempt/],
      [answer(200, { recorded: true, status: "succeeded", error: null }), /status succeeded/],
      [answer(404, { error: "NOT_FOUND" }), /answered 404/],
      [answer(400, { error: "WRONG_PAYMENT", message: "This payment does not belong to this checkout." }), /answered 400 WRONG_PAYMENT: This payment does not belong/],
    ]) {
      assert.throws(() => stripeReported(r), (err) => err instanceof StepError && why.test(err.message), String(why));
    }
  });
});
