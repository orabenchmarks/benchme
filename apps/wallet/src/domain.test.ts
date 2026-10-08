import { describe, expect, it } from "vitest";
import { Binder, ExactAmountRule, WorkspacePathRule } from "./binding/binder.js";
import type { CheckoutDirectory, CheckoutMatch } from "./binding/checkout-directory.js";
import { parseMerchant } from "./binding/merchant.js";
import { CARDS, issueCard } from "./domain/cards.js";
import { allows, dueTransition, LINK_TIMING } from "./domain/lifecycle.js";
import { LinkError } from "./domain/link-errors.js";
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
    expect(parseMerchant(`https://benchme.example/w/${WS}/halden/products/x`, "Halden Audio", STORES)).toEqual({ origin: "https://benchme.example", workspace: WS, app: "halden", store: "halden" });
    expect(parseMerchant(`benchme.example/w/${WS}/halden`, null, STORES)).toMatchObject({ origin: "https://benchme.example", workspace: WS, store: "halden" });
  });
  it("names the store by the merchant name when the URL is only the origin", () => {
    expect(parseMerchant("https://benchme.example", "Wrenfield Flowers", STORES)).toEqual({ origin: "https://benchme.example", workspace: null, app: null, store: "wrenfield" });
  });
  it("knows the workspace but no store on the PayLantern page", () => {
    expect(parseMerchant(`https://benchme.example/w/${WS}/paylantern/pay?ref=x`, "PayLantern Checkout", STORES)).toMatchObject({ workspace: WS, app: "paylantern", store: null });
  });
  it("reads nothing off an unreadable URL", () => {
    expect(parseMerchant("not a url at all", null, STORES)).toEqual({ origin: null, workspace: null, app: null, store: null });
  });
});

/** A directory answering from fixed lists, counting what it was asked. */
function directory(byWorkspace: CheckoutMatch[], byAmount: CheckoutMatch[] | Error): CheckoutDirectory & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
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
  const binder = (dir: CheckoutDirectory) => new Binder([new WorkspacePathRule(dir), new ExactAmountRule(dir, 60)], STORES);
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
  const ref = (origin: string) => ({ origin, workspace: null, app: null, store: null });
  const request = {} as never;
  it("lab: approves a request on the stores' host with its binding's card, the success card on fallback", () => {
    const lab = new LabPolicy(["https://benchme.example"]);
    const bound = { rule: "workspace", workspace: WS, store: "halden", checkout: null, scenarioId: "S", card: "decline" } as const;
    expect(lab.decide({ request, binding: bound, merchant: ref("https://benchme.example") })).toEqual({ status: "approved", card: "decline" });
    expect(lab.decide({ request, binding: { rule: "fallback", reason: "x" }, merchant: ref("https://benchme.example") })).toEqual({ status: "approved", card: "success" });
  });
  it("lab: declines a request paying anywhere else", () => {
    const lab = new LabPolicy(["https://benchme.example"]);
    expect(lab.decide({ request, binding: { rule: "fallback", reason: "x" }, merchant: ref("https://shop.example") })).toMatchObject({ status: "denied" });
  });
  it("decline-all: the Field study's user declines everything", () => {
    expect(new DeclineAllPolicy().decide()).toEqual({ status: "denied", reason: "declined by the user" });
  });
  it("is picked by name, and an unknown name is refused", () => {
    expect(policyFor("decline-all", { merchantOrigins: [] }).name).toBe("decline-all");
    expect(() => policyFor("yolo", { merchantOrigins: [] })).toThrow(/unknown WALLET_POLICY/);
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
