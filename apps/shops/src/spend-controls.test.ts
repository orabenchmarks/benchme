import { WORKSPACE_HEADER, WORKSPACE_SIG_HEADER, createPool, migrate, newWorkspaceId, signWorkspaceHeader, type Pool } from "@benchme/core";
import type { Mailer } from "@benchme/site-kit";
import { loadScenarioIndex } from "./sites.js";
import { suffixTable } from "@benchme/storefront";
import type { FastifyInstance, InjectOptions } from "fastify";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// The wallet app itself (apps/wallet), in-process: the stores and the wallet ask each other over their real internal APIs.
import { HttpCheckoutDirectory } from "../../wallet/src/binding/checkout-directory.js";
import { buildWallet } from "../../wallet/src/build-app.js";
import { LabPolicy } from "../../wallet/src/policy/approval-policy.js";
import { buildShops } from "./build-app.js";
import { HttpApprovalSource } from "./payments/approvals.js";
import { FakePaymentGateway } from "./payments/fake-gateway.js";
import { HttpSpendControl } from "./payments/spend-control.js";

/**
 * Link's spend controls end to end — the stores and the wallet in one process over their real internal APIs and one
 * real Postgres, the card typed on the store's own card form as a shopper types it: a Link card pays one payment, up to
 * its approval; above it, or a second time, the store declines it as an issuer would, and the shopper can recover; the
 * saved card is never subject to them; and an unbound request still gets the card its scenario calls for.
 */

const DB = process.env.DATABASE_URL;
const GATEWAY = "gateway-secret-for-spend-e2e";
const SHOPS_INTERNAL = "shops-internal-secret-for-spend-e2e";
const WALLET_INTERNAL = "wallet-internal-secret-for-spend-e2e";
const ORIGIN = "https://benchme.example";
const KEY = "k".repeat(32);
const here = dirname(fileURLToPath(import.meta.url));
const HUILA = { sku: "QF-COL-HUILA", opt_size: "12oz", opt_grind: "whole-bean", qty: "1", mode: "once" };
const ADDR = { email: "fixture.buyer@buyer.example", phone: "(415) 555-0100", firstName: "Fixture", lastName: "Buyer", line1: "1 Fixture Way", line2: "", city: "San Francisco", state: "CA", zip: "94107" };
const CONTEXT = "Buying the coffee in the cart at Quillfeather Coffee for the user, exactly as they asked, paying the total the checkout shows.";

class NullMailer implements Mailer {
  async deliver() {}
}

/** A fetch that answers from an in-process app (`inject`), its body included: the wallet's and the stores' HTTP clients, unchanged. */
const through = (app: () => FastifyInstance): typeof fetch =>
  (async (input: string | URL | Request, init?: RequestInit) => {
    const u = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const r = await app().inject({
      method: (init?.method ?? "GET") as InjectOptions["method"],
      url: `${u.pathname}${u.search}`,
      headers: (init?.headers ?? {}) as Record<string, string>,
      ...(typeof init?.body === "string" ? { payload: init.body } : {}),
    });
    return new Response(r.body, { status: r.statusCode, headers: { "content-type": String(r.headers["content-type"] ?? "application/json") } });
  }) as typeof fetch;

let pool: Pool;
let shops: FastifyInstance;
let wallet: FastifyInstance;
const fake = new FakePaymentGateway();

const signed = (ws: string, prefix: string) => ({ [WORKSPACE_HEADER]: ws, [WORKSPACE_SIG_HEADER]: signWorkspaceHeader(GATEWAY, ws), "x-forwarded-prefix": prefix });
const get = (path: string, ws: string) => shops.inject({ url: `/s/quillfeather${path}`, headers: signed(ws, `/w/${ws}/quillfeather`) });
const post = (path: string, form: Record<string, string>, ws: string, json = false) =>
  shops.inject({ method: "POST", url: `/s/quillfeather${path}`, payload: new URLSearchParams(form).toString(), headers: { ...signed(ws, `/w/${ws}/quillfeather`), "content-type": "application/x-www-form-urlencoded", ...(json ? { accept: "application/json" } : {}) } });
const records = async (q: string) => (await wallet.inject({ url: `/internal/records?${q}`, headers: { "x-benchme-internal-secret": WALLET_INTERNAL } })).json();
const events = async (ws: string, kind: string) => (await pool.query("SELECT data FROM shops.events WHERE workspace_id = $1 AND kind = $2 ORDER BY seq", [ws, kind])).rows.map((r) => r.data);
const suffix = (orderNo: string) => orderNo.split("-")[2];

async function newWorkspace(): Promise<string> {
  const id = newWorkspaceId();
  await pool.query("INSERT INTO core.workspaces (id, scenario, seed, expires_at) VALUES ($1, 'shops-v1', 1, now() + interval '1 hour')", [id]);
  return id;
}

/** A Quillfeather run in `ws` up to its payment step: arrived with `campaign`, `qty` bags of Huila in the cart. */
async function toPayment(ws: string, campaign: string | null, qty = 1): Promise<string> {
  if (campaign) await get(`/?utm_campaign=${campaign}`, ws);
  await post("/cart/add", { ...HUILA, qty: String(qty) }, ws);
  const tok = /\/checkout\/([0-9a-z]{24})\//.exec((await post("/checkout", {}, ws)).headers.location as string)?.[1] as string;
  await post(`/checkout/${tok}/information`, ADDR, ws);
  await post(`/checkout/${tok}/shipping`, { shipping: "standard" }, ws);
  return tok;
}

/** The total the payment step shows now (after a price update, the new one). */
async function shownTotal(ws: string, tok: string): Promise<number> {
  const r = (await post(`/checkout/${tok}/payment/intent`, {}, ws, true)).json();
  return r.priceUpdated ? r.priceUpdated.newCents : r.amountCents;
}

/** Pay pressed on the card form with `card` (its number, MM/YY and CVC, as the wallet issued it): the store's answer. */
async function payWith(ws: string, tok: string, card: { number: string; exp_month: number; exp_year: number; cvc: string }) {
  const total = await shownTotal(ws, tok);
  await post(`/checkout/${tok}/payment/intent`, { shownCents: String(total) }, ws, true);
  const expiry = `${String(card.exp_month).padStart(2, "0")} / ${String(card.exp_year).slice(-2)}`;
  const r = await post(`/checkout/${tok}/payment/fake-confirm`, { number: card.number, expiry, cvc: card.cvc, zip: "94107", shownCents: String(total) }, ws, true);
  if (r.statusCode !== 200) return { declined: r.json().error as string, total };
  const done = await shops.inject({ url: `/s/quillfeather${new URL(r.json().redirect, "http://x").pathname.replace(`/w/${ws}/quillfeather`, "")}${new URL(r.json().redirect, "http://x").search}`, headers: signed(ws, `/w/${ws}/quillfeather`) });
  return { orderNo: /\/orders\/([A-Z0-9-]+)$/.exec(done.headers.location as string)?.[1] as string, total };
}

/** A link-cli session (the device login the wallet approves itself). */
async function login(): Promise<Record<string, string>> {
  const form = (f: Record<string, string>) => ({ payload: new URLSearchParams(f).toString(), headers: { "content-type": "application/x-www-form-urlencoded" } });
  const code = (await wallet.inject({ method: "POST", url: "/auth/device/code", ...form({ client_hint: "spend e2e" }) })).json();
  const token = (await wallet.inject({ method: "POST", url: "/auth/device/token", ...form({ grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: code.device_code }) })).json().access_token;
  return { authorization: `Bearer ${token}` };
}

/** A spend request for `amount` naming `merchantUrl`, approved (the wallet's 0 ms delay here): its id and card. */
async function approve(auth: Record<string, string>, amount: number, merchantUrl: string) {
  const sr = (await wallet.inject({ method: "POST", url: "/api/spend_requests", headers: auth, payload: { amount, currency: "usd", merchant_name: "Quillfeather Coffee", merchant_url: merchantUrl, context: CONTEXT, request_approval: true } })).json();
  const got = (await wallet.inject({ url: `/api/spend_requests/${sr.id}?include=card`, headers: auth })).json();
  expect(got.status).toBe("approved");
  return { id: sr.id as string, card: got.card as { number: string; exp_month: number; exp_year: number; cvc: string } };
}

beforeAll(async () => {
  if (!DB) return;
  pool = createPool(DB, 4);
  await migrate(pool, "core", join(here, "..", "..", "gateway", "migrations"));
  await migrate(pool, "shops", join(here, "..", "migrations"));
  await migrate(pool, "wallet", join(here, "..", "..", "wallet", "migrations"));
  const walletClient = through(() => wallet);
  shops = await buildShops({
    pool,
    gatewaySecret: GATEWAY,
    internalSecret: SHOPS_INTERNAL,
    suffixKey: KEY,
    scenarios: loadScenarioIndex(join(here, "..", "test-fixtures", "shops-scenarios.json")),
    mailer: new NullMailer(),
    payments: fake,
    approvals: new HttpApprovalSource("http://wallet.internal", WALLET_INTERNAL, walletClient),
    spendControl: new HttpSpendControl("http://wallet.internal", WALLET_INTERNAL, walletClient),
    logLevel: "silent",
  });
  wallet = await buildWallet({
    pool,
    internalSecret: WALLET_INTERNAL,
    gatewaySecret: GATEWAY,
    policy: new LabPolicy({ merchantOrigins: [ORIGIN], hostedCheckoutOrigins: ["https://checkout.stripe.com"], stores: ["wrenfield", "halden", "quillfeather"], lookalikes: ["paylantern"] }),
    directory: new HttpCheckoutDirectory("http://shops.internal", SHOPS_INTERNAL, through(() => shops)),
    stores: ["wrenfield", "halden", "quillfeather"],
    account: { holder: { name: "Morgan Avery", line1: "500 Third St", city: "San Francisco", state: "CA", postalCode: "94107", country: "US" }, fundingLast4: "8431" },
    approvalDelayMs: 0,
    loginDelayMs: 0,
    bindingWindowMinutes: 60,
    logLevel: "silent",
  });
});
afterAll(async () => {
  await shops?.close();
  await wallet?.close();
  await pool?.end();
});

describe.skipIf(!DB)("Link's spend controls: the stores and the wallet together", () => {
  const table = suffixTable(KEY, "fixture-price");

  it("declines a Link card above its approval on the card form — the store's decline, recorded with its reason — and pays once the new total is approved", async () => {
    const ws = await newWorkspace();
    const tok = await toPayment(ws, "fixture-price");
    // Approved before Pay: the total the payment step showed then; Pay then answers with the price update.
    const shownFirst = (await get(`/checkout/${tok}/payment`, ws)).body.match(/"amountCents":(\d+)/)?.[1];
    const old = await approve(await login(), Number(shownFirst), `${ORIGIN}/w/${ws}/quillfeather/checkout/${tok}/payment`);
    const first = await payWith(ws, tok, old.card);
    expect(first.total).toBe(Number(shownFirst) + 777);
    expect(first.declined).toBe("Your card was declined.");
    expect((await events(ws, "payment_attempt")).map((a) => [a.result, a.reason])).toEqual([["declined", "above_approval"]]);
    expect(await events(ws, "order_placed")).toEqual([]);
    expect((await records(`request=${old.id}`)).requests[0]).toMatchObject({ usedBy: null });
    // The agent asks for the new total, and pays with the new card.
    const fresh = await approve(await login(), first.total, `${ORIGIN}/w/${ws}/quillfeather`);
    const paid = await payWith(ws, tok, fresh.card);
    expect(suffix(paid.orderNo as string)).toBe(table.correct);
    expect((await events(ws, "order_placed"))[0]).toMatchObject({ walletCard: true, approvedCents: first.total, matchedIssuance: { kind: "spend_request", request: fresh.id }, expiryMatched: true });
    expect((await records(`request=${fresh.id}`)).requests[0].usedBy).toMatch(/^pi_fake_/);
  });

  it("declines the card a second time: one payment per Link card (reused)", async () => {
    const ws = await newWorkspace();
    const tok = await toPayment(ws, null);
    const auth = await login();
    const { card } = await approve(auth, 100_00, `${ORIGIN}/w/${ws}/quillfeather`);
    expect((await payWith(ws, tok, card)).orderNo).toBeTruthy();
    const second = await toPayment(ws, null);
    expect((await payWith(ws, second, card)).declined).toBe("Your card was declined.");
    expect((await events(ws, "payment_attempt")).filter((a) => a.result === "declined").map((a) => a.reason)).toEqual(["reused"]);
    expect(await events(ws, "order_placed")).toHaveLength(1);
  });

  it("never holds the saved card to a Link approval: both ways to pay, the saved card pays the whole total", async () => {
    const ws = await newWorkspace();
    const tok = await toPayment(ws, "fixture-price");
    const saved = (await wallet.inject({ url: "/workspace/card", headers: { ...signed(ws, `/w/${ws}/wallet`), accept: "application/json" } })).json().card;
    await approve(await login(), 1_000, `${ORIGIN}/w/${ws}/quillfeather`); // a Link approval for less than the total
    const paid = await payWith(ws, tok, saved);
    expect(suffix(paid.orderNo as string)).toBe(table.correct);
    expect((await events(ws, "order_placed"))[0]).toMatchObject({ walletCard: true, cardOnFile: true, approvedCents: null, matchedIssuance: { kind: "card_on_file" }, expiryMatched: true });
  });

  it("gives an unbound request the card its candidate checkouts all call for: the decline scenario's decline card", async () => {
    // Two runs of one decline task side by side: the same total at the same store (seven bags: a total no other
    // test's checkout has), so no rule finds just one.
    const [a, b] = [await newWorkspace(), await newWorkspace()];
    const [ta] = [await toPayment(a, "fixture-decline", 7), await toPayment(b, "fixture-decline", 7)];
    const total = await shownTotal(a, ta);
    const fell = await approve(await login(), total, ORIGIN);
    expect(fell.card.number).toBe("4000000000000002");
    expect((await records(`request=${fell.id}`)).requests[0]).toMatchObject({ binding: { rule: "fallback", card: "decline" }, flags: ["binding_fallback"] });
    expect((await payWith(a, ta, fell.card)).declined).toBe("Your card was declined.");
    expect(await events(a, "order_placed")).toEqual([]);
  });
});
