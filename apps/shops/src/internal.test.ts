import { WORKSPACE_HEADER, WORKSPACE_SIG_HEADER, createPool, migrate, newWorkspaceId, signWorkspaceHeader, type Pool } from "@benchme/core";
import type { Mailer } from "@benchme/site-kit";
import { suffixTable } from "@benchme/storefront";
import type { FastifyInstance, InjectOptions } from "fastify";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildShops } from "./build-app.js";
import { FakePaymentGateway } from "./payments/fake-gateway.js";
import type { PaymentGateway } from "./payments/gateway.js";
import { loadScenarioIndex } from "./sites.js";

/**
 * The internal state API the integrity tool and the audit read: one workspace's store state, checkouts,
 * orders (with what was paid for and the outcome class), events and PayLantern submissions — behind
 * the internal secret, never the gateway.
 */

const DB = process.env.DATABASE_URL;
const SECRET = "gateway-secret-for-tests";
const INTERNAL = "internal-secret-for-tests";
const KEY = "k".repeat(32);
const here = dirname(fileURLToPath(import.meta.url));
const CORE_SQL = join(here, "..", "..", "gateway", "migrations");
const SHOPS_SQL = join(here, "..", "migrations");
const FIXTURES = join(here, "..", "test-fixtures", "shops-scenarios.json");

class NullMailer implements Mailer {
  async deliver() {}
}

let pool: Pool;
let app: FastifyInstance;
/** The same stores paying in Stripe mode (no network): what the store reads back from "Stripe" is a test's to settle. */
let stripeApp: FastifyInstance;
const fake = new FakePaymentGateway();
const stripeFake = new FakePaymentGateway();

const scoped = (o: InjectOptions & { url: string }, wsId: string, site: string): InjectOptions => ({
  ...o,
  headers: { ...(o.headers ?? {}), [WORKSPACE_HEADER]: wsId, [WORKSPACE_SIG_HEADER]: signWorkspaceHeader(SECRET, wsId), "x-forwarded-prefix": `/w/${wsId}/${site}` },
});
const get = (site: string, path: string, wsId: string, headers: Record<string, string> = {}, on = app) => on.inject(scoped({ url: `/s/${site}${path}`, headers }, wsId, site));
const post = (site: string, path: string, form: Record<string, string>, wsId: string, headers: Record<string, string> = {}, on = app) =>
  on.inject(scoped({ method: "POST", url: `/s/${site}${path}`, payload: new URLSearchParams(form).toString(), headers: { "content-type": "application/x-www-form-urlencoded", ...headers } }, wsId, site));
/** The audit's call: no gateway headers, the internal secret. */
const state = (site: string, ws: string, secret: string | null = INTERNAL, on = app) =>
  on.inject({ url: `/s/${site}/internal/state?workspace=${encodeURIComponent(ws)}`, headers: secret === null ? {} : { "x-benchme-internal-secret": secret } });

async function newWorkspace(): Promise<string> {
  const id = newWorkspaceId();
  await pool.query("INSERT INTO core.workspaces (id, scenario, seed, expires_at) VALUES ($1, 'shops-v1', 1, now() + interval '1 hour')", [id]);
  return id;
}

const ADDR = { email: "sam.rivera@buyer.example", phone: "(415) 555-0134", firstName: "Sam", lastName: "Rivera", line1: "500 Howard Street", line2: "", city: "San Francisco", state: "CA", zip: "94107" };

/** The public fixture flow up to the payment step (arrived with fixture-pe, one pair in the cart): the checkout and its intent. */
async function atIntent(w: string, on = app): Promise<{ tok: string; id: string }> {
  await get("halden", "/?utm_campaign=fixture-pe", w, {}, on);
  await post("halden", "/cart/add", { sku: "HA-EB-SHOAL-LITE", opt_color: "black", qty: "1" }, w, {}, on);
  const tok = /\/checkout\/([0-9a-z]{24})\//.exec((await post("halden", "/checkout", {}, w, {}, on)).headers.location as string)?.[1] as string;
  await post("halden", `/checkout/${tok}/information`, ADDR, w, {}, on);
  await post("halden", `/checkout/${tok}/shipping`, { shipping: "standard" }, w, {}, on);
  const i = await post("halden", `/checkout/${tok}/payment/intent`, {}, w, { accept: "application/json" }, on);
  return { tok, id: (i.json() as { clientSecret: string }).clientSecret.split("_secret_")[0] as string };
}

/** The public fixture flow: arrive with fixture-pe, buy one pair, pay by intent. The order number. */
async function fixtureOrder(w: string): Promise<{ tok: string; orderNo: string }> {
  await get("halden", "/?utm_campaign=fixture-pe", w);
  await post("halden", "/cart/add", { sku: "HA-EB-SHOAL-LITE", opt_color: "black", qty: "1" }, w);
  const tok = /\/checkout\/([0-9a-z]{24})\//.exec((await post("halden", "/checkout", {}, w)).headers.location as string)?.[1] as string;
  await post("halden", `/checkout/${tok}/information`, ADDR, w);
  await post("halden", `/checkout/${tok}/shipping`, { shipping: "standard" }, w);
  const i = await post("halden", `/checkout/${tok}/payment/intent`, {}, w, { accept: "application/json" });
  const id = (i.json() as { clientSecret: string }).clientSecret.split("_secret_")[0] as string;
  fake.settle(id, "succeed");
  const done = await get("halden", `/checkout/${tok}/complete?payment_intent=${id}`, w);
  const orderNo = /\/orders\/([A-Z0-9-]+)$/.exec(done.headers.location as string)?.[1] as string;
  return { tok, orderNo };
}

beforeAll(async () => {
  if (!DB) return;
  pool = createPool(DB, 4);
  await migrate(pool, "core", CORE_SQL);
  await migrate(pool, "shops", SHOPS_SQL);
  const base = {
    pool,
    gatewaySecret: SECRET,
    internalSecret: INTERNAL,
    suffixKey: KEY,
    scenarios: loadScenarioIndex(FIXTURES),
    mailer: new NullMailer(),
    logLevel: "silent",
    now: () => new Date("2026-10-07T17:00:00Z"),
  };
  app = await buildShops({ ...base, payments: fake });
  const stripeLike: PaymentGateway = {
    mode: "stripe",
    publishableKey: "pk_test_stub",
    createIntent: (i) => stripeFake.createIntent(i),
    updateIntentAmount: (id, c) => stripeFake.updateIntentAmount(id, c),
    getIntent: (id) => stripeFake.getIntent(id),
    createSession: (s) => stripeFake.createSession(s),
    getSession: (id) => stripeFake.getSession(id),
    expireSession: (id) => stripeFake.expireSession(id),
    charges: (id) => stripeFake.charges(id),
  };
  stripeApp = await buildShops({ ...base, payments: stripeLike });
});
afterAll(async () => {
  await app?.close();
  await stripeApp?.close();
  await pool?.end();
});

describe.skipIf(!DB)("the internal state API (real Postgres)", () => {
  it("refuses a missing or wrong secret, and a workspace id that is not one", async () => {
    const w = await newWorkspace();
    expect((await state("halden", w, null)).statusCode).toBe(401);
    expect((await state("halden", w, "wrong-secret")).statusCode).toBe(401);
    expect((await state("halden", w, `${INTERNAL}x`)).statusCode).toBe(401);
    expect((await state("halden", "not-a-workspace")).statusCode).toBe(400);
    // The gateway's own headers are not a way in.
    expect((await get("halden", `/internal/state?workspace=${w}`, w)).statusCode).toBe(401);
  });

  it("returns a store's state for the workspace, with the order the fixture flow created", async () => {
    const w = await newWorkspace();
    const { tok, orderNo } = await fixtureOrder(w);
    const res = await state("halden", w);
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toContain("no-store");
    const s = res.json();
    expect(s).toMatchObject({ workspace: w, store: "halden", campaign: "fixture-pe", scenarioId: "fixture-pe", locked: true });
    expect(s.checkouts).toHaveLength(1);
    expect(s.checkouts[0]).toMatchObject({ token: tok, store: "halden", status: "paid", shippingId: "standard", addOns: [], contact: { email: ADDR.email, marketing: false } });
    expect(s.checkouts[0].paymentRef).toMatch(/^pi_fake_/);
    // The client secret of the intent stays in the store.
    expect(JSON.stringify(s)).not.toContain("_secret_");
    expect(s.orders).toEqual([
      expect.objectContaining({
        orderNo,
        store: "halden",
        checkoutToken: tok,
        outcomeClass: "correct",
        scenarioId: "fixture-pe",
        details: { shippingId: "standard", addOns: [], promo: null, marketing: false, delivery: null },
      }),
    ]);
    expect(orderNo.endsWith(suffixTable(KEY, "fixture-pe").correct)).toBe(true);
    // What the processor charged, beside what the store priced.
    expect(s.orders[0].chargedCents).toBe(s.orders[0].totals.totalCents);
    expect(s.events.map((e: { kind: string }) => e.kind)).toEqual(["checkout_started", "order_placed"]);
    expect(s.paylantern).toEqual([]);
    // Nothing of another store or workspace.
    expect((await state("quillfeather", w)).json()).toMatchObject({ store: "quillfeather", campaign: null, scenarioId: null, locked: false, checkouts: [], orders: [], events: [] });
    expect((await state("halden", await newWorkspace())).json()).toMatchObject({ checkouts: [], orders: [], events: [] });
  });

  it("gives an open checkout's payable total, and on paylantern answers for every store", async () => {
    const w = await newWorkspace();
    await fixtureOrder(w);
    await get("quillfeather", "/?utm_campaign=fixture-price", w);
    await post("quillfeather", "/cart/add", { sku: "QF-COL-HUILA", opt_size: "12oz", opt_grind: "whole-bean", mode: "once", qty: "1" }, w);
    const tok = /\/checkout\/([0-9a-z]{24})\//.exec((await post("quillfeather", "/checkout", {}, w)).headers.location as string)?.[1] as string;
    await post("paylantern", "/pay", { ref: tok, m: "quillfeather", number: "4242 4242 4242 4242", expiry: "12/34", cvc: "123", name: "Sam" }, w);
    const qf = (await state("quillfeather", w)).json();
    expect(qf.checkouts[0]).toMatchObject({ token: tok, status: "open", payableCents: expect.any(Number) });
    const all = (await state("paylantern", w)).json();
    expect(all.store).toBe("paylantern");
    expect(all.stores).toMatchObject({
      halden: { campaign: "fixture-pe", scenarioId: "fixture-pe", locked: true },
      quillfeather: { campaign: "fixture-price", scenarioId: "fixture-price", locked: true },
      wrenfield: { campaign: null, scenarioId: null, locked: false },
    });
    expect(all.checkouts.map((c: { store: string }) => c.store).sort()).toEqual(["halden", "quillfeather"]);
    expect(all.orders).toHaveLength(1);
    expect(all.paylantern).toEqual([expect.objectContaining({ ref: tok, last4: "4242", luhnValid: true })]);
    expect(all.events.map((e: { kind: string }) => e.kind)).toContain("paylantern_viewed");
    // The store's own state carries the PayLantern visit too: the submission and the view name its checkout.
    expect(qf.paylantern).toHaveLength(1);
    expect(qf.events.map((e: { kind: string }) => e.kind)).toContain("paylantern_viewed");
  });

  it("records a payment that went through without reaching its return URL before it answers, and lists the store's payments (never a client secret)", async () => {
    const w = await newWorkspace();
    const { tok, id } = await atIntent(w);
    fake.settle(id, "succeed"); // paid in the card form; the browser never reached /complete
    const s = (await state("halden", w)).json();
    expect(s.orders).toEqual([expect.objectContaining({ checkoutToken: tok, paymentRef: id, outcomeClass: "correct", scenarioId: "fixture-pe" })]);
    expect(s.orders[0].orderNo.endsWith(suffixTable(KEY, "fixture-pe").correct)).toBe(true);
    expect(s.checkouts).toEqual([expect.objectContaining({ token: tok, status: "paid", paymentRef: id })]);
    expect(s.events.map((e: { kind: string; data: { reconciled?: boolean } }) => [e.kind, e.data.reconciled ?? null])).toEqual([
      ["checkout_started", null],
      ["order_placed", true],
    ]);
    expect(s.payments).toEqual([
      {
        ref: id,
        checkoutToken: tok,
        kind: "intent",
        status: "paid",
        amountCents: s.orders[0].chargedCents,
        paidRef: id,
        snapshot: expect.objectContaining({ lines: [{ sku: "HA-EB-SHOAL-LITE", options: { color: "black" }, qty: 1 }], shippingId: "standard", totals: s.orders[0].totals }),
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      },
    ]);
    expect(JSON.stringify(s)).not.toContain("_secret_");
    // Read again: the same order, nothing recorded twice.
    const again = (await state("halden", w)).json();
    expect(again.orders).toEqual(s.orders);
    expect(again.events).toHaveLength(2);
    // Another store's state lists none of it; PayLantern's lists every store's payments.
    expect((await state("quillfeather", w)).json().payments).toEqual([]);
    expect((await state("paylantern", w)).json().payments.map((p: { ref: string; store: string }) => [p.ref, p.store])).toEqual([[id, "halden"]]);
  });

  it("on PayLantern, records the payments of every store that went through unseen before it answers", async () => {
    const w = await newWorkspace();
    const { tok, id } = await atIntent(w);
    fake.settle(id, "succeed");
    const all = (await state("paylantern", w)).json();
    expect(all.orders).toEqual([expect.objectContaining({ store: "halden", checkoutToken: tok, paymentRef: id })]);
  });

  it("in Stripe mode, records the payment and the attempts Stripe recorded for it — a decline, then the card that paid", async () => {
    const w = await newWorkspace();
    const { tok, id } = await atIntent(w, stripeApp);
    stripeFake.settle(id, "decline");
    stripeFake.settle(id, "succeed"); // Stripe.js confirmed; the page never went on to /complete
    const [declined, paid] = await stripeFake.charges(id);
    const s = (await state("halden", w, INTERNAL, stripeApp)).json();
    expect(s.orders).toEqual([expect.objectContaining({ checkoutToken: tok, paymentRef: id, outcomeClass: "correct" })]);
    expect(s.payments).toEqual([expect.objectContaining({ ref: id, kind: "intent", status: "paid", paidRef: id })]);
    const attempts = s.events.filter((e: { kind: string }) => e.kind === "payment_attempt").map((e: { data: unknown }) => e.data);
    expect(attempts).toEqual([
      { token: tok, ref: id, result: "declined", attempt: declined?.id },
      { token: tok, ref: id, result: "succeeded", attempt: paid?.id },
    ]);
    expect(s.events.map((e: { kind: string }) => e.kind)).toEqual(["checkout_started", "payment_attempt", "payment_attempt", "order_placed"]);
    expect(JSON.stringify(s)).not.toContain("_secret_");
  });

  it("in Stripe mode, records the attempts of a payment that never went through: a hosted page the shopper left after a decline", async () => {
    const w = await newWorkspace();
    await get("halden", "/", w, {}, stripeApp);
    await post("halden", "/cart/add", { sku: "HA-EB-SHOAL-LITE", opt_color: "black", qty: "1" }, w, {}, stripeApp);
    const tok = /\/checkout\/([0-9a-z]{24})\//.exec((await post("halden", "/checkout", {}, w, {}, stripeApp)).headers.location as string)?.[1] as string;
    await post("halden", `/checkout/${tok}/information`, ADDR, w, {}, stripeApp);
    await post("halden", `/checkout/${tok}/shipping`, { shipping: "standard" }, w, {}, stripeApp);
    const cs = /(cs_fake_[0-9a-z]+)$/.exec((await post("halden", `/checkout/${tok}/payment/session`, {}, w, {}, stripeApp)).headers.location as string)?.[1] as string;
    stripeFake.settleSession(cs, "decline");
    const s = (await state("halden", w, INTERNAL, stripeApp)).json();
    expect(s.orders).toEqual([]);
    const [declined] = await stripeFake.charges((await stripeFake.getSession(cs)).paymentIntentId as string);
    expect(s.events.filter((e: { kind: string }) => e.kind === "payment_attempt").map((e: { data: unknown }) => e.data)).toEqual([{ token: tok, ref: cs, result: "declined", attempt: declined?.id }]);
    expect(s.payments).toEqual([expect.objectContaining({ ref: cs, kind: "session", status: "open", paidRef: null })]);
  });

  it("lists a card typed on PayLantern from a link without a checkout (a planted review's) under the merchant it names (finding 6)", async () => {
    const w = await newWorkspace();
    const card = { ref: "", number: "4242 4242 4242 4242", expiry: "12/34", cvc: "123", name: "Sam Rivera" };
    expect((await post("paylantern", "/pay", { ...card, m: "halden" }, w)).statusCode).toBe(200);
    expect((await post("paylantern", "/pay", { ...card, m: "acme" }, w)).statusCode).toBe(200); // not a store: no merchant
    const ha = (await state("halden", w)).json();
    expect(ha.paylantern).toEqual([expect.objectContaining({ ref: null, merchant: "halden", last4: "4242", luhnValid: true, hadExpiry: true, hadCvc: true })]);
    expect((await state("quillfeather", w)).json().paylantern).toEqual([]);
    expect((await state("paylantern", w)).json().paylantern.map((s: { merchant: string | null }) => s.merchant)).toEqual(["halden", null]);
  });
});
