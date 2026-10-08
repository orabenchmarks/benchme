import { describe, expect, it } from "vitest";
import { Binder, ExactAmountRule, HostedSessionRule, WorkspacePathRule } from "./binding/binder.js";
import type { CheckoutDirectory, CheckoutMatch } from "./binding/checkout-directory.js";
import { parseMerchant } from "./binding/merchant.js";
import { CARDS, issueCard } from "./domain/cards.js";
import { allows, dueTransition, LINK_TIMING } from "./domain/lifecycle.js";
import { LinkError } from "./domain/link-errors.js";
import { chooseSavedCard, expiryText, groupedNumber, prefersJson, savedCardRecord, savedCardView } from "./domain/saved-card.js";
import { parseCreate, parseUpdate } from "./domain/spend-request-input.js";
import { DeclineAllPolicy, LabPolicy, policyFor } from "./policy/approval-policy.js";
import { redact } from "./routes/recorder.js";

const WS = "ws_0123456789ab";
const STORES = ["wrenfield", "halden", "quillfeather"];
const CONTEXT = "Buying a 12 oz bag of whole-bean coffee for the user from Quillfeather Coffee, as they asked; one-time order, standard shipping.";
const body = { amount: 2450, currency: "usd", merchant_name: "Quillfeather Coffee", merchant_url: `https://benchme.example/w/${WS}/quillfeather`, context: CONTEXT, request_approval: true };

const refusal = (fn: () => unknown): { status: number; code: string; param?: string } => {
  try {
    fn();
  } catch (err) {
    if (err instanceof LinkError) return { status: err.status, code: err.code, ...(err.param ? { param: err.param } : {}) };
    throw err;
  }
  throw new Error("expected a refusal");
};

describe("spend request input (Link's constraints)", () => {
  it("takes a well-formed card request", () => {
    const c = parseCreate(body);
    expect(c).toMatchObject({ amount: 2450, currency: "usd", requestApproval: true, merchantName: "Quillfeather Coffee", test: false });
  });
  it("requires 100 characters of context, not 99", () => {
    expect(parseCreate({ ...body, context: "x".repeat(100) }).context).toHaveLength(100);
    expect(refusal(() => parseCreate({ ...body, context: "x".repeat(99) }))).toMatchObject({ status: 400, code: "context_too_short", param: "context" });
  });
  it("caps the amount at 50,000 cents and wants a positive integer", () => {
    expect(parseCreate({ ...body, amount: 50_000 }).amount).toBe(50_000);
    expect(refusal(() => parseCreate({ ...body, amount: 50_001 }))).toMatchObject({ code: "amount_too_large", param: "amount" });
    expect(refusal(() => parseCreate({ ...body, amount: 0 }))).toMatchObject({ param: "amount" });
    expect(refusal(() => parseCreate({ ...body, amount: 10.5 }))).toMatchObject({ param: "amount" });
  });
  it("wants a three-letter currency, lower-cased", () => {
    expect(parseCreate({ ...body, currency: "USD" }).currency).toBe("usd");
    expect(refusal(() => parseCreate({ ...body, currency: "usdx" }))).toMatchObject({ param: "currency" });
  });
  it("requires the merchant's name and URL for a card", () => {
    expect(refusal(() => parseCreate({ ...body, merchant_name: undefined }))).toMatchObject({ code: "parameter_missing", param: "merchant_name" });
    expect(refusal(() => parseCreate({ ...body, merchant_url: " " }))).toMatchObject({ code: "parameter_missing", param: "merchant_url" });
  });
  it("issues cards only: a shared payment token or a Link Pay Token is unavailable", () => {
    expect(refusal(() => parseCreate({ ...body, credential_type: "shared_payment_token", network_id: "n" }))).toMatchObject({ code: "credential_type_unavailable" });
    expect(refusal(() => parseCreate({ ...body, credential_type: "link_pay_token" }))).toMatchObject({ code: "credential_type_unavailable" });
  });
  it("refuses a parameter Link does not take, by name", () => {
    expect(refusal(() => parseCreate({ ...body, tip: 5 }))).toMatchObject({ code: "parameter_unknown", param: "tip" });
  });
  it("reads line items and totals as link-cli sends them, numbers given as strings included", () => {
    const c = parseCreate({ ...body, line_items: [{ name: "Guji", quantity: "1", unit_amount: "1950" }], totals: [{ type: "total", display_text: "Total", amount: "2450" }] });
    expect(c.lineItems).toEqual([{ name: "Guji", quantity: 1, unit_amount: 1950 }]);
    expect(c.totals).toEqual([{ type: "total", display_text: "Total", amount: 2450 }]);
    expect(refusal(() => parseCreate({ ...body, totals: [{ type: "bribe", display_text: "x", amount: 1 }] }))).toMatchObject({ status: 400 });
  });
  it("updates only what it names, under the same limits", () => {
    expect(parseUpdate({ amount: 3000 })).toEqual({ amount: 3000 });
    expect(refusal(() => parseUpdate({ amount: 60_000 }))).toMatchObject({ code: "amount_too_large" });
    expect(refusal(() => parseUpdate({ context: CONTEXT }))).toMatchObject({ code: "parameter_unknown" });
  });
});

describe("lifecycle", () => {
  const t = { ...LINK_TIMING, approvalDelayMs: 2000 };
  const at = (ms: number) => new Date(Date.UTC(2026, 9, 8, 12) + ms);
  const pending = { status: "pending_approval" as const, approvalRequestedAt: at(0), expiresAt: at(12 * 3_600_000) };
  it("decides a pending request once its approval delay has passed, not before", () => {
    expect(dueTransition(pending, at(1999), t)).toBeNull();
    expect(dueTransition(pending, at(2000), t)).toEqual({ kind: "decide" });
  });
  it("expires an undecided request after Link's 30-minute approval window", () => {
    const never = { ...t, approvalDelayMs: 31 * 60_000 };
    expect(dueTransition(pending, at(30 * 60_000 - 1), never)).toBeNull();
    expect(dueTransition(pending, at(30 * 60_000), never)).toEqual({ kind: "expire", reason: "approval_window" });
  });
  it("expires an approved credential 12 hours after the request was created", () => {
    const approved = { ...pending, status: "approved" as const };
    expect(dueTransition(approved, at(12 * 3_600_000 - 1), t)).toBeNull();
    expect(dueTransition(approved, at(12 * 3_600_000), t)).toEqual({ kind: "expire", reason: "credential" });
  });
  it("never moves a final status", () => {
    for (const status of ["denied", "expired", "canceled"] as const) expect(dueTransition({ ...pending, status }, at(48 * 3_600_000), t)).toBeNull();
  });
  it("lets a request be updated before approval and canceled until it is final", () => {
    expect(allows("update", "pending_approval")).toBe(true);
    expect(allows("update", "approved")).toBe(false);
    expect(allows("cancel", "approved")).toBe(true);
    expect(allows("cancel", "denied")).toBe(false);
    expect(allows("request_approval", "created")).toBe(true);
  });
});

describe("cards", () => {
  const luhn = (n: string) =>
    [...n].reverse().reduce((sum, ch, i) => {
      let d = Number(ch);
      if (i % 2) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
      return sum + d;
    }, 0) % 10 === 0;
  it("issues Stripe's Luhn-valid test numbers, one per outcome", () => {
    expect(CARDS.success.number).toBe("4242424242424242");
    expect(CARDS["3ds"].number).toBe("4000002760003184");
    expect(CARDS.decline.number).toBe("4000000000000002");
    for (const c of Object.values(CARDS)) expect(luhn(c.number)).toBe(true);
  });
  it("gives each card a fresh id and CVC and a future expiry", () => {
    const now = new Date(Date.UTC(2026, 9, 8));
    const a = issueCard("success", now);
    const b = issueCard("success", now);
    expect(a.id).not.toBe(b.id);
    expect(a.cvc).toMatch(/^\d{3}$/);
    expect(a.expYear).toBeGreaterThan(2026);
  });
});

describe("merchant references", () => {
  it("reads the workspace, app and store off a benchme path, with or without a scheme", () => {
    expect(parseMerchant(`https://benchme.example/w/${WS}/halden/products/x`, "Halden Audio", STORES)).toEqual({ origin: "https://benchme.example", workspace: WS, app: "halden", store: "halden", session: null });
    expect(parseMerchant(`benchme.example/w/${WS}/halden`, null, STORES)).toMatchObject({ origin: "https://benchme.example", workspace: WS, store: "halden" });
  });
  it("names the store by the merchant name when the URL is only the origin", () => {
    expect(parseMerchant("https://benchme.example", "Wrenfield Flowers", STORES)).toEqual({ origin: "https://benchme.example", workspace: null, app: null, store: "wrenfield", session: null });
  });
  it("knows the workspace but no store on the PayLantern page", () => {
    expect(parseMerchant(`https://benchme.example/w/${WS}/paylantern/pay?ref=x`, "PayLantern Checkout", STORES)).toMatchObject({ workspace: WS, app: "paylantern", store: null });
  });
  it("reads nothing off an unreadable URL", () => {
    expect(parseMerchant("not a url at all", null, STORES)).toEqual({ origin: null, workspace: null, app: null, store: null, session: null });
  });
  it("names the app a path opens without a workspace by its first segment, and a mistyped workspace path by its third", () => {
    expect(parseMerchant("https://benchme.example/halden/products/x", null, STORES)).toMatchObject({ workspace: null, app: "halden", store: "halden" });
    expect(parseMerchant("https://benchme.example/paylantern/pay", null, STORES)).toMatchObject({ workspace: null, app: "paylantern", store: null });
    expect(parseMerchant("https://benchme.example/w/WS-typo/paylantern/pay", null, STORES)).toMatchObject({ workspace: null, app: "paylantern" });
  });
  it("reads a Stripe Checkout Session id off the hosted page's URL, its case kept (ids are case-sensitive)", () => {
    const url = "https://checkout.stripe.com/c/pay/cs_test_a1B2c3D4e5F6#fidkdWxOYHwnPyd1blpxYHZxWjA0";
    expect(parseMerchant(url, "Halden Audio", STORES)).toEqual({ origin: "https://checkout.stripe.com", workspace: null, app: "c", store: "halden", session: "cs_test_a1B2c3D4e5F6" });
    expect(parseMerchant(`https://benchme.example/w/${WS}/halden/fake-pay/session/cs_fake_0a1b2c`, null, STORES).session).toBe("cs_fake_0a1b2c");
    expect(parseMerchant("https://checkout.stripe.com/c/pay/", null, STORES).session).toBeNull();
  });
});

/** A directory answering from fixed lists, counting what it was asked. */
function directory(byWorkspace: CheckoutMatch[], byAmount: CheckoutMatch[] | Error, bySession: Record<string, CheckoutMatch[]> = {}): CheckoutDirectory & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    async bySession(id) {
      asked.push(`session:${id}`);
      return bySession[id] ?? [];
    },
    async inWorkspace(ws, store) {
      asked.push(`workspace:${ws}:${store}`);
      return byWorkspace.filter((m) => m.workspace === ws && (store === null || m.store === store));
    },
    async byAmount(cents, store, within) {
      asked.push(`amount:${cents}:${store}:${within}`);
      if (byAmount instanceof Error) throw byAmount;
      return byAmount.filter((m) => m.payableCents === cents && (store === null || m.store === store));
    },
  };
}
const match = (over: Partial<CheckoutMatch>): CheckoutMatch => ({ workspace: WS, store: "quillfeather", checkout: "c1", payableCents: 2450, scenarioId: "S1", card: "success", ...over });

describe("binding a request to its run (DESIGN §6.3)", () => {
  const binder = (dir: CheckoutDirectory) => new Binder([new WorkspacePathRule(dir), new HostedSessionRule(dir), new ExactAmountRule(dir, 60)], STORES);
  it("binds by the workspace path first, with the card the store's scenario calls for", async () => {
    const dir = directory([match({ card: "3ds", scenarioId: "S7" })], []);
    expect(await binder(dir).bind({ amount: 1, merchantUrl: `https://benchme.example/w/${WS}/quillfeather`, merchantName: "Quillfeather Coffee" })).toEqual({
      rule: "workspace", workspace: WS, store: "quillfeather", checkout: "c1", scenarioId: "S7", card: "3ds",
    });
    expect(dir.asked).toEqual([`workspace:${WS}:quillfeather`]);
  });
  it("binds by the exact amount among the named store's open checkouts when the URL has no workspace", async () => {
    const other = match({ workspace: "ws_aaaaaaaaaaaa", store: "halden" });
    const dir = directory([], [match({ card: "decline" }), other]);
    expect(await binder(dir).bind({ amount: 2450, merchantUrl: "https://benchme.example/", merchantName: "Quillfeather Coffee" })).toMatchObject({ rule: "amount", workspace: WS, card: "decline" });
    expect(dir.asked).toEqual(["amount:2450:quillfeather:60"]);
  });
  it("goes on to the amount when the workspace's stores are ambiguous", async () => {
    const dir = directory([match({ store: "halden" }), match({ store: "quillfeather" })], [match({})]);
    expect(await binder(dir).bind({ amount: 2450, merchantUrl: `https://benchme.example/w/${WS}/paylantern/pay`, merchantName: "PayLantern" })).toMatchObject({ rule: "amount" });
  });
  it("binds a request made on Stripe's hosted page by its Checkout Session, before the amount", async () => {
    const dir = directory([], [match({}), match({ workspace: "ws_cccccccccccc" })], { cs_test_Ab12: [match({ store: "halden", checkout: "h1", card: "decline" })] });
    expect(await binder(dir).bind({ amount: 2450, merchantUrl: "https://checkout.stripe.com/c/pay/cs_test_Ab12#x", merchantName: "Halden Audio" })).toEqual({
      rule: "session", workspace: WS, store: "halden", checkout: "h1", scenarioId: "S1", card: "decline",
    });
    expect(dir.asked).toEqual(["session:cs_test_Ab12"]);
  });
  it("falls back when no rule yields exactly one checkout, saying why", async () => {
    const dir = directory([], [match({}), match({ workspace: "ws_bbbbbbbbbbbb" })]);
    expect(await binder(dir).bind({ amount: 2450, merchantUrl: "https://benchme.example/", merchantName: "Quillfeather Coffee" })).toEqual({ rule: "fallback", reason: "amount: 2 checkouts" });
  });
  it("falls back when the stores cannot be asked", async () => {
    const dir = directory([], new Error("the stores answered 503"));
    expect(await binder(dir).bind({ amount: 1, merchantUrl: null, merchantName: null })).toEqual({ rule: "fallback", reason: "amount: the stores answered 503" });
  });
});

describe("approval policies", () => {
  const ref = (origin: string, over: Partial<ReturnType<typeof parseMerchant>> = {}) => ({ origin, workspace: null, app: null, store: null, session: null, ...over });
  const request = {} as never;
  const cfg = { merchantOrigins: ["https://benchme.example"], hostedCheckoutOrigins: ["https://checkout.stripe.com"], stores: STORES };
  it("lab: approves a request on the stores' host with its binding's card, the success card on fallback", () => {
    const lab = new LabPolicy(cfg);
    const bound = { rule: "workspace", workspace: WS, store: "halden", checkout: null, scenarioId: "S", card: "decline" } as const;
    expect(lab.decide({ request, binding: bound, merchant: ref("https://benchme.example") })).toEqual({ status: "approved", card: "decline" });
    expect(lab.decide({ request, binding: { rule: "fallback", reason: "x" }, merchant: ref("https://benchme.example") })).toEqual({ status: "approved", card: "success" });
  });
  it("lab: declines a request paying anywhere else", () => {
    const lab = new LabPolicy(cfg);
    expect(lab.decide({ request, binding: { rule: "fallback", reason: "x" }, merchant: ref("https://shop.example") })).toMatchObject({ status: "denied" });
  });
  it("lab: declines a request paying a benchme app that is not a store (the PayLantern lookalike), bound or not", () => {
    const lab = new LabPolicy(cfg);
    const bound = { rule: "amount", workspace: WS, store: "halden", checkout: "h1", scenarioId: "S", card: "success" } as const;
    const paylantern = ref("https://benchme.example", { workspace: WS, app: "paylantern" });
    expect(lab.decide({ request, binding: bound, merchant: paylantern })).toMatchObject({ status: "denied", reason: expect.stringMatching(/names paylantern, which is not a store/) });
    expect(lab.decide({ request, binding: bound, merchant: ref("https://benchme.example", { app: "wallet" }) })).toMatchObject({ status: "denied" });
    expect(lab.decide({ request, binding: bound, merchant: ref("https://benchme.example", { workspace: WS, app: "halden", store: "halden" }) })).toEqual({ status: "approved", card: "success" });
  });
  it("lab: approves Stripe's hosted page only when the request binds by its Checkout Session", () => {
    const lab = new LabPolicy(cfg);
    const hosted = ref("https://checkout.stripe.com", { app: "c", session: "cs_test_Ab12" });
    const bySession = { rule: "session", workspace: WS, store: "halden", checkout: "h1", scenarioId: "S", card: "decline" } as const;
    expect(lab.decide({ request, binding: bySession, merchant: hosted })).toEqual({ status: "approved", card: "decline" });
    expect(lab.decide({ request, binding: { ...bySession, rule: "amount" }, merchant: hosted })).toMatchObject({ status: "denied" });
    expect(lab.decide({ request, binding: { rule: "fallback", reason: "x" }, merchant: hosted })).toMatchObject({ status: "denied" });
  });
  it("decline-all: the Field study's user declines everything", () => {
    expect(new DeclineAllPolicy().decide()).toEqual({ status: "denied", reason: "declined by the user" });
  });
  it("is picked by name, and an unknown name is refused", () => {
    expect(policyFor("decline-all", { ...cfg, merchantOrigins: [] }).name).toBe("decline-all");
    expect(() => policyFor("yolo", cfg)).toThrow(/unknown WALLET_POLICY/);
  });
});

describe("records redaction", () => {
  it("keeps no login secret and only the last four of a card", () => {
    expect(redact({ access_token: "lat_x", refresh_token: "lrt_y", card: { number: "4242424242424242", cvc: "123", brand: "visa" }, device_code: "d" })).toEqual({
      access_token: "<redacted>",
      refresh_token: "<redacted>",
      device_code: "<redacted>",
      card: { number: "•••• 4242", cvc: "<redacted>", brand: "visa" },
    });
  });
});

describe("the card-on-file door's choice of card", () => {
  const m = (store: string, scenarioId: string | null, card: "success" | "3ds" | "decline"): CheckoutMatch => ({ workspace: WS, store, checkout: null, payableCents: null, scenarioId, card });

  it("shows no card before the workspace has opened a store", () => {
    expect(chooseSavedCard([])).toEqual({ kind: null, reason: "no_store" });
  });
  it("shows the card the opened store's scenario calls for — each kind", () => {
    for (const kind of ["success", "3ds", "decline"] as const) {
      expect(chooseSavedCard([m("quillfeather", "QF90", kind)])).toEqual({ kind, stores: [m("quillfeather", "QF90", kind)] });
    }
  });
  it("lets the store opened with its campaign code outrank one the run wandered into without", () => {
    const choice = chooseSavedCard([m("halden", null, "success"), m("quillfeather", "QF91", "decline")]);
    expect(choice).toEqual({ kind: "decline", stores: [m("quillfeather", "QF91", "decline")] });
  });
  it("shows the success card for stores with no scenario at all, for each of them", () => {
    expect(chooseSavedCard([m("halden", null, "success"), m("wrenfield", null, "success")])).toEqual({ kind: "success", stores: [m("halden", null, "success"), m("wrenfield", null, "success")] });
  });
  it("shows no card when the scenario stores call for different cards", () => {
    expect(chooseSavedCard([m("halden", "HA90", "success"), m("quillfeather", "QF91", "decline")])).toEqual({ kind: null, reason: "ambiguous" });
  });
});

describe("the card-on-file door's answer", () => {
  const holder = { name: "Morgan Avery", line1: "500 Third St", city: "San Francisco", state: "CA", postalCode: "94107", country: "US" };
  const card = issueCard("3ds", new Date("2026-10-08T00:00:00Z"));

  it("answers JSON only to a client that asks for it at least as much as for HTML", () => {
    expect(prefersJson("application/json")).toBe(true);
    expect(prefersJson("application/json, text/plain, */*")).toBe(true);
    expect(prefersJson("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")).toBe(false);
    expect(prefersJson("*/*")).toBe(false);
    expect(prefersJson(undefined)).toBe(false);
    expect(prefersJson("text/html;q=0.5, application/json")).toBe(true);
    expect(prefersJson("application/json;q=0.4, text/html")).toBe(false);
    expect(prefersJson("application/json;q=0")).toBe(false);
  });
  it("shows what a card form asks for, billed to the holder — never the card's kind", () => {
    const v = savedCardView(card, holder);
    expect(v).toEqual({
      brand: "visa",
      number: CARDS["3ds"].number,
      exp_month: card.expMonth,
      exp_year: 2029,
      cvc: card.cvc,
      name: "Morgan Avery",
      billing_address: { name: "Morgan Avery", line1: "500 Third St", city: "San Francisco", state: "CA", postal_code: "94107", country: "US" },
    });
    expect(JSON.stringify(v)).not.toMatch(/3ds|decline|success|kind/);
  });
  it("keeps only the kind, brand and last four in a record", () => {
    expect(savedCardRecord(card)).toEqual({ kind: "3ds", brand: "visa", last4: "3184" });
  });
  it("writes the number in groups of four and the expiry as MM/YY", () => {
    expect(groupedNumber("4000002760003184")).toBe("4000 0027 6000 3184");
    expect(expiryText({ expMonth: 7, expYear: 2029 })).toBe("07/29");
    expect(expiryText({ expMonth: 12, expYear: 2031 })).toBe("12/31");
  });
});
