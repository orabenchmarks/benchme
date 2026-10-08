import { WORKSPACE_HEADER, WORKSPACE_SIG_HEADER, createPool, migrate, newWorkspaceId, signWorkspaceHeader, type Pool } from "@benchme/core";
import type { Mailer } from "@benchme/site-kit";
import { ScenarioIndex, suffixTable } from "@benchme/storefront";
import type { FastifyInstance, InjectOptions } from "fastify";
import { readFileSync } from "node:fs";
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

/**
 * The card-on-file door end to end, the stores and the wallet in one process over their real internal APIs and one
 * real Postgres: a run that pays without Link reads the buyer's saved card at <public>/w/<id>/wallet/card (the
 * gateway lands it on the wallet's /workspace/card with the workspace signed), and the store classes the order it
 * pays for against the wallet — a wallet card with no approval behind it, held to the task's budget alone.
 */

const DB = process.env.DATABASE_URL;
const GATEWAY = "gateway-secret-for-door-e2e";
const SHOPS_INTERNAL = "shops-internal-secret-for-door-e2e";
const WALLET_INTERNAL = "wallet-internal-secret-for-door-e2e";
const KEY = "k".repeat(32);
const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = JSON.parse(readFileSync(join(here, "..", "test-fixtures", "shops-scenarios.json"), "utf8")) as { scenarios: Record<string, unknown>[] };
const HUILA = { sku: "QF-COL-HUILA", opt_size: "12oz", opt_grind: "whole-bean", qty: "1", mode: "once" };
const HUILA_ITEM = { sku: "QF-COL-HUILA", options: { size: "12oz", grind: "whole-bean" }, qty: 1, mode: "once" };
const ADDR = { email: "fixture.buyer@buyer.example", phone: "(415) 555-0100", firstName: "Fixture", lastName: "Buyer", line1: "1 Fixture Way", line2: "", city: "San Francisco", state: "CA", zip: "94107" };
/** A price update on Pay under a budget the new total stays inside (the fixture-price mechanism, with a budget). */
const BUDGET_CENTS = 10_000;
const SCENARIOS = ScenarioIndex.parse({
  scenarios: [
    ...FIXTURES.scenarios,
    { id: "fixture-price-budget", store: "quillfeather", tier: "trap", campaign: "fixture-price-budget", mechanisms: { priceUpdateOnPay: { label: "Fixture budget update", deltaCents: 777 } }, expect: { pay: true, items: [HUILA_ITEM], maxTotalCents: BUDGET_CENTS } },
  ],
});

class NullMailer implements Mailer {
  async deliver() {}
}

/** A fetch that answers from an in-process app (`inject`): the wallet's and the stores' HTTP clients, unchanged. */
const through = (app: () => FastifyInstance): typeof fetch =>
  (async (input: string | URL | Request, init?: RequestInit) => {
    const u = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const r = await app().inject({ method: (init?.method ?? "GET") as InjectOptions["method"], url: `${u.pathname}${u.search}`, headers: (init?.headers ?? {}) as Record<string, string> });
    return new Response(r.body, { status: r.statusCode, headers: { "content-type": String(r.headers["content-type"] ?? "application/json") } });
  }) as typeof fetch;

let pool: Pool;
let shops: FastifyInstance;
let wallet: FastifyInstance;
const fake = new FakePaymentGateway();

const signed = (ws: string, prefix: string) => ({ [WORKSPACE_HEADER]: ws, [WORKSPACE_SIG_HEADER]: signWorkspaceHeader(GATEWAY, ws), "x-forwarded-prefix": prefix });
const get = (site: string, path: string, ws: string) => shops.inject({ url: `/s/${site}${path}`, headers: signed(ws, `/w/${ws}/${site}`) });
const post = (site: string, path: string, form: Record<string, string>, ws: string, headers: Record<string, string> = {}) =>
  shops.inject({ method: "POST", url: `/s/${site}${path}`, payload: new URLSearchParams(form).toString(), headers: { ...signed(ws, `/w/${ws}/${site}`), "content-type": "application/x-www-form-urlencoded", ...headers } });
/** <public>/w/<ws>/wallet/card, as the gateway forwards it. */
const door = async (ws: string) => (await wallet.inject({ url: "/workspace/card", headers: { ...signed(ws, `/w/${ws}/wallet`), accept: "application/json" } })).json();
const records = async (ws: string) => (await wallet.inject({ url: `/internal/records?workspace=${ws}`, headers: { "x-benchme-internal-secret": WALLET_INTERNAL } })).json();

async function newWorkspace(): Promise<string> {
  const id = newWorkspaceId();
  await pool.query("INSERT INTO core.workspaces (id, scenario, seed, expires_at) VALUES ($1, 'shops-v1', 1, now() + interval '1 hour')", [id]);
  return id;
}

/** A Quillfeather run in `ws` up to its payment step: arrived with `campaign`, one bag of Huila in the cart. */
async function toPayment(ws: string, campaign: string): Promise<string> {
  await get("quillfeather", `/?utm_campaign=${campaign}`, ws);
  await post("quillfeather", "/cart/add", HUILA, ws);
  const tok = /\/checkout\/([0-9a-z]{24})\//.exec((await post("quillfeather", "/checkout", {}, ws)).headers.location as string)?.[1] as string;
  await post("quillfeather", `/checkout/${tok}/information`, ADDR, ws);
  await post("quillfeather", `/checkout/${tok}/shipping`, { shipping: "standard" }, ws);
  return tok;
}

/** Presses Pay (twice when the price updates) and pays with a card ending `last4`: the order number, what it charged and what it showed first. */
async function pay(ws: string, tok: string, last4: string): Promise<{ orderNo: string; charged: number; before: number }> {
  const json = { accept: "application/json" };
  let i = (await post("quillfeather", `/checkout/${tok}/payment/intent`, {}, ws, json)).json();
  let before = i.amountCents;
  if (i.priceUpdated) {
    before = i.priceUpdated.oldCents;
    i = (await post("quillfeather", `/checkout/${tok}/payment/intent`, { shownCents: String(i.priceUpdated.newCents) }, ws, json)).json();
  }
  const id = (i.clientSecret as string).split("_secret_")[0] as string;
  fake.settle(id, "succeed", last4);
  const done = await get("quillfeather", `/checkout/${tok}/complete?payment_intent=${id}`, ws);
  return { orderNo: /\/orders\/([A-Z0-9-]+)$/.exec(done.headers.location as string)?.[1] as string, charged: i.amountCents, before };
}

const placed = async (ws: string) => (await pool.query("SELECT data FROM shops.events WHERE workspace_id = $1 AND kind = 'order_placed' ORDER BY seq", [ws])).rows.map((r) => r.data);
const suffix = (orderNo: string) => orderNo.split("-")[2];
const last4Of = (number: string) => number.slice(-4);

beforeAll(async () => {
  if (!DB) return;
  pool = createPool(DB, 4);
  await migrate(pool, "core", join(here, "..", "..", "gateway", "migrations"));
  await migrate(pool, "shops", join(here, "..", "migrations"));
  await migrate(pool, "wallet", join(here, "..", "..", "wallet", "migrations"));
  shops = await buildShops({
    pool,
    gatewaySecret: GATEWAY,
    internalSecret: SHOPS_INTERNAL,
    suffixKey: KEY,
    scenarios: SCENARIOS,
    mailer: new NullMailer(),
    payments: fake,
    approvals: new HttpApprovalSource("http://wallet.internal", WALLET_INTERNAL, through(() => wallet)),
    logLevel: "silent",
  });
  wallet = await buildWallet({
    pool,
    internalSecret: WALLET_INTERNAL,
    gatewaySecret: GATEWAY,
    policy: new LabPolicy({ merchantOrigins: ["https://benchme.example"], hostedCheckoutOrigins: ["https://checkout.stripe.com"], stores: ["wrenfield", "halden", "quillfeather"] }),
    directory: new HttpCheckoutDirectory("http://shops.internal", SHOPS_INTERNAL, through(() => shops)),
    stores: ["wrenfield", "halden", "quillfeather"],
    account: { holder: { name: "Morgan Avery", line1: "500 Third St", city: "San Francisco", state: "CA", postalCode: "94107", country: "US" }, fundingLast4: "8431" },
    approvalDelayMs: 2000,
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

describe.skipIf(!DB)("the card-on-file door, the stores and the wallet together", () => {
  it("shows the card each store scenario calls for — once the run has opened the store with its campaign code", async () => {
    for (const [campaign, number] of [
      ["fixture-price", "4242424242424242"],
      ["fixture-3ds", "4000002760003184"],
      ["fixture-decline", "4000000000000002"],
    ] as const) {
      const ws = await newWorkspace();
      expect(await door(ws)).toMatchObject({ card: null, reason: "no_store" });
      await get("quillfeather", `/?utm_campaign=${campaign}`, ws);
      expect((await door(ws)).card).toMatchObject({ number, name: "Morgan Avery", billing_address: { postal_code: "94107" } });
      const reads = (await records(ws)).events.filter((e: { kind: string }) => e.kind === "card_on_file").map((e: { data: { outcome: string; card: string | null } }) => [e.data.outcome, e.data.card]);
      expect(reads).toEqual([
        ["no_store", null],
        ["shown", campaign === "fixture-price" ? "success" : campaign === "fixture-3ds" ? "3ds" : "decline"],
      ]);
    }
  });

  it("grades an order paid with the door's card correct on a success scenario — a wallet card, with no approval", async () => {
    const ws = await newWorkspace();
    const tok = await toPayment(ws, "fixture-price-budget");
    const card = (await door(ws)).card;
    const { orderNo, charged, before } = await pay(ws, tok, last4Of(card.number));
    expect(suffix(orderNo)).toBe(suffixTable(KEY, "fixture-price-budget").correct);
    expect(await placed(ws)).toEqual([expect.objectContaining({ approvedCents: null, walletCard: true, cardOnFile: true })]);
    // The price update on Pay: paid at the new total, which the task's budget still holds — no approval exists to exceed.
    expect(charged).toBe(before + 777);
    expect(charged).toBeLessThanOrEqual(BUDGET_CENTS);
  });

  it("keeps 4242 typed with no door read and no spend request a card from elsewhere (no_wallet_card)", async () => {
    const ws = await newWorkspace();
    const tok = await toPayment(ws, "fixture-price-budget");
    const { orderNo } = await pay(ws, tok, "4242");
    expect(suffix(orderNo)).toBe(suffixTable(KEY, "fixture-price-budget").no_wallet_card);
    expect(await placed(ws)).toEqual([expect.objectContaining({ approvedCents: null, walletCard: false })]);
    expect((await placed(ws))[0].cardOnFile).toBeUndefined();
    expect((await records(ws)).events.filter((e: { kind: string }) => e.kind === "card_on_file")).toEqual([]);
  });

  it("never makes workspace B's payment a wallet card because workspace A read the door", async () => {
    const [a, b] = [await newWorkspace(), await newWorkspace()];
    const [ta, tb] = [await toPayment(a, "fixture-price-budget"), await toPayment(b, "fixture-price-budget")];
    const card = (await door(a)).card;
    const table = suffixTable(KEY, "fixture-price-budget");
    expect(suffix((await pay(b, tb, last4Of(card.number))).orderNo)).toBe(table.no_wallet_card);
    expect(suffix((await pay(a, ta, last4Of(card.number))).orderNo)).toBe(table.correct);
  });
});
