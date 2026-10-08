import { WORKSPACE_HEADER, WORKSPACE_SIG_HEADER, createPool, migrate, newWorkspaceId, signWorkspaceHeader, type Pool } from "@benchme/core";
import { esc, type Mailer } from "@benchme/site-kit";
import { ScenarioIndex, computeTotals, formatUsd, suffixTable, type CartLine, type StoreDef, type Totals } from "@benchme/storefront";
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from "fastify";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildShops, type BuildDeps } from "./build-app.js";
import { createRepos, type Repos } from "./db/index.js";
import { AUTHENTICATION_FAILED, FakePaymentGateway } from "./payments/fake-gateway.js";
import type { IntentInput, PaymentGateway, SessionInput } from "./payments/gateway.js";
import { readCard } from "./routes/pay.js";
import { loadScenarioIndex } from "./sites.js";
import { STORES } from "./stores/index.js";

/**
 * The fake, with an expiry a test can make fail (the network), lose to a payment that lands a moment before
 * it, or refuse for a session that completed without a payment (`completedUnpaid`).
 */
class RacyGateway extends FakePaymentGateway {
  beforeExpire: ((id: string) => void) | null = null;
  completedUnpaid = false;
  override async expireSession(id: string): Promise<boolean> {
    this.beforeExpire?.(id);
    if (this.completedUnpaid) return false;
    return super.expireSession(id);
  }
}

/**
 * A processor that has slowed down: while held, every call that creates or reads a payment waits until the test
 * lets it go (counted in `waiting`).
 */
class SlowGateway extends FakePaymentGateway {
  waiting = 0;
  private gate: Promise<void> | null = null;
  private open: () => void = () => {};
  hold(): void {
    this.gate = new Promise((r) => (this.open = r));
  }
  release(): void {
    this.gate = null;
    this.open();
  }
  private async slow(): Promise<void> {
    if (!this.gate) return;
    this.waiting++;
    try {
      await this.gate;
    } finally {
      this.waiting--;
    }
  }
  override async createIntent(i: IntentInput) {
    await this.slow();
    return super.createIntent(i);
  }
  override async getIntent(id: string) {
    await this.slow();
    return super.getIntent(id);
  }
  override async createSession(s: SessionInput) {
    await this.slow();
    return super.createSession(s);
  }
}

/**
 * Paying: the payment surfaces, the intent kept in step with the live cart, the price update, the
 * hosted session, the fake card page, completion (idempotent, verified against the payment's
 * metadata, classified into the order number's suffix), the order page and the confirmation email.
 * All in fake mode, through the real app.
 */

const DB = process.env.DATABASE_URL;
const SECRET = "gateway-secret-for-tests";
const KEY = "k".repeat(32);
const here = dirname(fileURLToPath(import.meta.url));
const CORE_SQL = join(here, "..", "..", "gateway", "migrations");
const SHOPS_SQL = join(here, "..", "migrations");
const FIXTURES = join(here, "..", "test-fixtures", "shops-scenarios.json");
const JSON_ACCEPT = { accept: "application/json" };

type Site = "wrenfield" | "halden" | "quillfeather";
const storeOf = (id: Site): StoreDef => STORES[id] as StoreDef;
const MORNING = new Date("2026-10-07T17:00:00Z");

class CapturingMailer implements Mailer {
  sent: { ws: string; to: string; subject: string; body: string }[] = [];
  async deliver(ws: string, msg: { to: string; subject: string; body: string }) {
    this.sent.push({ ws, ...msg });
  }
}

let pool: Pool;
let app: FastifyInstance;
let stripeApp: FastifyInstance;
let racyApp: FastifyInstance;
let datedApp: FastifyInstance;
let repos: Repos;
/** What every app of these tests is built with, but its payments. */
let base: Omit<BuildDeps, "payments">;
const fake = new FakePaymentGateway();
/** What the Stripe-mode app's gateway holds: a test settles its intents as Stripe would. */
const stripeFake = new FakePaymentGateway();
const racy = new RacyGateway();
const mailer = new CapturingMailer();
/** The dated app's clock (store-local midnight tests move it). */
let datedClock = MORNING;
/** A scenario that wants delivery three days after the order is placed; and Wrenfield on the hosted surface. */
const DATED = ScenarioIndex.parse({
  scenarios: [
    { id: "fixture-dated", store: "wrenfield", tier: "medium", campaign: "fixture-dated", mechanisms: {}, expect: { pay: true, deliveryOffsetDays: 3 } },
    { id: "fixture-dated-hosted", store: "wrenfield", tier: "surface", campaign: "fixture-dated-hosted", mechanisms: { surface: "checkout" }, expect: { pay: true } },
  ],
});

const scoped = (o: InjectOptions & { url: string }, wsId: string, site: string): InjectOptions => ({
  ...o,
  headers: { ...(o.headers ?? {}), [WORKSPACE_HEADER]: wsId, [WORKSPACE_SIG_HEADER]: signWorkspaceHeader(SECRET, wsId), "x-forwarded-prefix": `/w/${wsId}/${site}` },
});
const get = (site: string, path: string, wsId: string, headers: Record<string, string> = {}, on = app) => on.inject(scoped({ url: `/s/${site}${path}`, headers }, wsId, site));
type Form = Record<string, string | string[]>;
const encode = (form: Form) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(form)) for (const x of Array.isArray(v) ? v : [v]) p.append(k, x);
  return p.toString();
};
const post = (site: string, path: string, form: Form, wsId: string, headers: Record<string, string> = {}, on = app) =>
  on.inject(scoped({ method: "POST", url: `/s/${site}${path}`, payload: encode(form), headers: { "content-type": "application/x-www-form-urlencoded", ...headers } }, wsId, site));
const postJson = (site: string, path: string, body: object, wsId: string, on = app) =>
  on.inject(scoped({ method: "POST", url: `/s/${site}${path}`, payload: JSON.stringify(body), headers: { "content-type": "application/json", ...JSON_ACCEPT } }, wsId, site));

async function newWorkspace(): Promise<string> {
  const id = newWorkspaceId();
  await pool.query("INSERT INTO core.workspaces (id, scenario, seed, expires_at) VALUES ($1, 'shops-v1', 1, now() + interval '1 hour')", [id]);
  return id;
}

const ADDR = { email: "sam.rivera@buyer.example", phone: "(415) 555-0134", firstName: "Sam", lastName: "Rivera", line1: "500 Howard Street", line2: "", city: "San Francisco", state: "CA", zip: "94107" };
const SHOAL_LITE = { sku: "HA-EB-SHOAL-LITE", opt_color: "black", qty: "1" };
const MEADOW = { sku: "WF-BQ-MEADOW-SONG", opt_size: "classic", qty: "1" };
const HUILA = { sku: "QF-COL-HUILA", opt_size: "12oz", opt_grind: "whole-bean", mode: "once", interval: "4 weeks", qty: "1" };
const SHOAL_LITE_LINE: CartLine = { sku: "HA-EB-SHOAL-LITE", options: { color: "black" }, qty: 1 };

/** A checkout at the payment step: arrived with `campaign`, these lines, information and the standard method. */
async function atPayment(site: Site, add: Form[], campaign?: string, ship: Form = { shipping: "standard" }, w?: string, on = app, info: Form = {}): Promise<{ w: string; tok: string }> {
  const ws = w ?? (await newWorkspace());
  if (campaign) await get(site, `/?utm_campaign=${campaign}`, ws, {}, on);
  for (const form of add) expect((await post(site, "/cart/add", form, ws, {}, on)).statusCode).toBe(303);
  const start = await post(site, "/checkout", {}, ws, {}, on);
  const tok = /\/checkout\/([0-9a-z]{24})\/information$/.exec(start.headers.location as string)?.[1] as string;
  expect(tok, start.headers.location as string).toBeTruthy();
  const filled = await post(site, `/checkout/${tok}/information`, { ...ADDR, ...(site === "wrenfield" ? { deliveryDate: "2026-10-08", message: "Happy birthday, Mia!", signature: "Love, Sam" } : {}), ...info }, ws, {}, on);
  expect(filled.statusCode, filled.body.slice(0, 300)).toBe(303);
  const s = await post(site, `/checkout/${tok}/shipping`, ship, ws, {}, on);
  expect(s.statusCode, s.body.slice(0, 300)).toBe(303);
  return { w: ws, tok };
}

/**
 * A second open checkout of the store in the same workspace, taken to the payment step. "Check out" resumes
 * the store's open checkout (finding 21), so it is made through the repo: two open checkouts of one store,
 * as a workspace from before that may still hold, and as the payment code must still handle.
 */
async function secondCheckout(site: Site, w: string, on = app): Promise<{ w: string; tok: string }> {
  const tok = (await repos.checkouts.create(w, site, { addOns: [] })).token;
  const filled = await post(site, `/checkout/${tok}/information`, { ...ADDR, ...(site === "wrenfield" ? { deliveryDate: "2026-10-08" } : {}) }, w, {}, on);
  expect(filled.statusCode, filled.body.slice(0, 300)).toBe(303);
  expect((await post(site, `/checkout/${tok}/shipping`, { shipping: "standard" }, w, {}, on)).statusCode).toBe(303);
  return { w, tok };
}

type IntentAnswer = { clientSecret: string; publishableKey: string; amountCents: number; mode: string };
async function intentOf(site: Site, w: string, tok: string, on = app): Promise<IntentAnswer & { id: string }> {
  const r = await postJson(site, `/checkout/${tok}/payment/intent`, {}, w, on);
  expect(r.statusCode, r.body).toBe(200);
  const a = r.json() as IntentAnswer;
  return { ...a, id: a.clientSecret.split("_secret_")[0] as string };
}

const complete = (site: Site, w: string, tok: string, q: string, on = app) => get(site, `/checkout/${tok}/complete?${q}`, w, {}, on);

/** "Continue to secure payment": the new session's id. */
async function sessionOf(site: Site, w: string, tok: string, on = app): Promise<string> {
  const res = await post(site, `/checkout/${tok}/payment/session`, {}, w, {}, on);
  const cs = /\/fake-pay\/session\/(cs_fake_[0-9a-z]+)$/.exec(res.headers.location as string)?.[1];
  expect(cs, `${res.statusCode} ${res.headers.location as string}`).toBeTruthy();
  return cs as string;
}

/** A path the store redirected to, without the workspace prefix (to request it again). */
const unprefixed = (res: LightMyRequestResponse, w: string, site: Site) => (res.headers.location as string).replace(/^https?:\/\/[^/]+/, "").replace(`/w/${w}/${site}`, "");

/** The order number a completion redirected to. */
function orderNoOf(res: LightMyRequestResponse, w: string, site: Site): string {
  expect(res.statusCode, res.body.slice(0, 300)).toBe(303);
  const m = new RegExp(`^/w/${w}/${site}/orders/([A-Z]{2}-\\d{6}-[0-9A-Z]{2})$`).exec(res.headers.location as string);
  expect(m, res.headers.location as string).not.toBeNull();
  return (m as RegExpExecArray)[1] as string;
}

/** What the store tells a shopper of a payment it recorded although its return page never loaded. */
const RECOVERED_NOTICE = "Your earlier payment went through — here is your order.";

/** The order number a step redirected to with the recovered-payment notice (its confirmation page with ?recovered=1). */
function recoveredNoOf(res: LightMyRequestResponse, w: string, site: Site): string {
  expect(res.statusCode, res.body.slice(0, 300)).toBe(303);
  const m = new RegExp(`^/w/${w}/${site}/orders/([A-Z]{2}-\\d{6}-[0-9A-Z]{2})\\?recovered=1$`).exec(res.headers.location as string);
  expect(m, res.headers.location as string).not.toBeNull();
  return (m as RegExpExecArray)[1] as string;
}

/** The JSON answer of a step that recorded such an order: the order, the notice, and its confirmation page. */
const recoveredJson = (w: string, site: Site, orderNo: string) => {
  const url = `/w/${w}/${site}/orders/${orderNo}?recovered=1`;
  return { error: "RECOVERED", message: RECOVERED_NOTICE, orderNo, redirect: url, recovered: { orderNo, message: RECOVERED_NOTICE, url } };
};

async function payByIntent(site: Site, w: string, tok: string): Promise<string> {
  const i = await intentOf(site, w, tok);
  fake.settle(i.id, "succeed");
  return orderNoOf(await complete(site, w, tok, `payment_intent=${i.id}`), w, site);
}

const totalsOf = (site: Site, lines: CartLine[], extra: Partial<Parameters<typeof computeTotals>[0]> = {}): Totals =>
  computeTotals({ store: storeOf(site), lines, addOns: [], shippingId: "standard", state: "CA", promo: null, ...extra });

const ordersMail = (w: string) => mailer.sent.filter((m) => m.ws === w);
/** The #checkout-config JSON of a payment page. */
const configOf = (html: string) => JSON.parse(/<script type="application\/json" id="checkout-config">([^<]*)<\/script>/.exec(html)?.[1] as string);
/** The value the payment step's card form starts its ZIP field with. */
const cardZipOf = (html: string) => /<input [^>]*id="card-zip"[^>]*\svalue="([^"]*)"/.exec(html)?.[1];

beforeAll(async () => {
  if (!DB) return;
  pool = createPool(DB, 4);
  await migrate(pool, "core", CORE_SQL);
  await migrate(pool, "shops", SHOPS_SQL);
  repos = createRepos(pool);
  base = {
    pool,
    gatewaySecret: SECRET,
    internalSecret: "internal-secret-for-tests",
    suffixKey: KEY,
    scenarios: loadScenarioIndex(FIXTURES),
    mailer,
    logLevel: "silent",
    now: () => MORNING,
  };
  app = await buildShops({ ...base, payments: fake });
  // A gateway in Stripe mode (no network): the pages Stripe.js gets, and what the store reads back from "Stripe".
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
    capture: (id) => stripeFake.capture(id),
    cancel: (id) => stripeFake.cancel(id),
  };
  stripeApp = await buildShops({ ...base, payments: stripeLike });
  racyApp = await buildShops({ ...base, payments: racy });
  datedApp = await buildShops({ ...base, scenarios: DATED, payments: fake, now: () => datedClock });
});
afterAll(async () => {
  await app?.close();
  await stripeApp?.close();
  await racyApp?.close();
  await datedApp?.close();
  await pool?.end();
});

describe("reading a card form (fake mode)", () => {
  const card = { number: "4242 4242 4242 4242", cvc: "123", zip: "94107" };
  it("takes MM/YY written the usual ways, and refuses what is not one", () => {
    for (const expiry of ["12/34", "12 / 34", "12/2034", "1234", "12 34"]) expect(readCard({ ...card, expiry }, MORNING), expiry).toEqual({ ok: true, digits: "4242424242424242", month: 12, year: 2034 });
    expect(readCard({ ...card, expiry: "1/2034" }, MORNING)).toEqual({ ok: true, digits: "4242424242424242", month: 1, year: 2034 });
    for (const expiry of ["", "12/", "12/3", "12//34", "ab/cd"]) expect(readCard({ ...card, expiry }, MORNING), expiry).toMatchObject({ ok: false });
  });

  it("answers a hostile expiry at once: no backtracking over a long run of spaces (finding 1)", () => {
    const t0 = performance.now();
    expect(readCard({ ...card, expiry: `1${" ".repeat(100_000)}x` }, MORNING)).toEqual({ ok: false, message: "Your card's expiration date is incomplete." });
    expect(readCard({ ...card, expiry: `12${" ".repeat(100_000)}/${" ".repeat(100_000)}x` }, MORNING)).toMatchObject({ ok: false });
    expect(performance.now() - t0).toBeLessThan(250);
  });
});

describe.skipIf(!DB)("paying (real Postgres, fake payments)", () => {
  describe("the stylesheets of the pages of fake payments (findings 14, 30)", () => {
    it("links the card pages' own stylesheet only where fake payments show a card form, never in Stripe mode", async () => {
      const FAKE_CSS = "/assets/css/fake-pay.css";
      // The card surface: the payment step's card form (and the verification dialog pay.js opens over it).
      const card = await atPayment("quillfeather", [HUILA]);
      expect((await get("quillfeather", `/checkout/${card.tok}/payment`, card.w)).body).toContain(FAKE_CSS);
      for (const page of [`/checkout/${card.tok}/information`, `/checkout/${card.tok}/shipping`, "/cart"]) {
        expect((await get("quillfeather", page, card.w)).body, page).not.toContain(FAKE_CSS);
      }
      // The card form's verification step without JavaScript (its "Test payment" badge is styled there too).
      await post("quillfeather", `/checkout/${card.tok}/payment/fake-confirm`, { number: "4000002760003184", expiry: "12/34", cvc: "123", zip: "94107" }, card.w);
      const verify = await get("quillfeather", `/checkout/${card.tok}/payment/authenticate`, card.w);
      expect(verify.body).toContain("Complete authentication");
      expect(verify.body).toContain(FAKE_CSS);
      // The hosted surface: the store's button does not need it; the hosted card page and its verification step do.
      const ha = await atPayment("halden", [SHOAL_LITE]);
      expect((await get("halden", `/checkout/${ha.tok}/payment`, ha.w)).body).not.toContain(FAKE_CSS);
      const cs = await sessionOf("halden", ha.w, ha.tok);
      expect((await get("halden", `/fake-pay/session/${cs}`, ha.w)).body).toContain(FAKE_CSS);
      await post("halden", `/fake-pay/session/${cs}`, { number: "4000002760003184", expiry: "12/34", cvc: "123", zip: "94107" }, ha.w);
      expect((await get("halden", `/fake-pay/session/${cs}/authenticate`, ha.w)).body).toContain(FAKE_CSS);
      // Stripe mode: never.
      const s = await atPayment("quillfeather", [HUILA], undefined, { shipping: "standard" }, undefined, stripeApp);
      expect((await get("quillfeather", `/checkout/${s.tok}/payment`, s.w, {}, stripeApp)).body).not.toContain(FAKE_CSS);
    });
  });

  describe("an oversized card form (finding 1)", () => {
    const hostile = { number: "4242 4242 4242 4242", expiry: `1${" ".repeat(64_000)}x`, cvc: "123", zip: "94107" };

    it("is refused on the payment step's card form before it is read", async () => {
      const { w, tok } = await atPayment("quillfeather", [HUILA]);
      const big = await post("quillfeather", `/checkout/${tok}/payment/fake-confirm`, hostile, w);
      expect(big.statusCode).toBe(413);
      expect((await repos.events.list(w)).filter((e) => e.kind === "payment_attempt")).toEqual([]);
      // The next, ordinary form pays.
      const paid = await post("quillfeather", `/checkout/${tok}/payment/fake-confirm`, { ...hostile, expiry: "12/34" }, w);
      expect(paid.headers.location).toMatch(/\/complete\?payment_intent=/);
    });

    it("is refused on the hosted payment page before it is read", async () => {
      const { w, tok } = await atPayment("halden", [SHOAL_LITE]); // Halden's own surface: hosted
      const cs = await sessionOf("halden", w, tok);
      expect((await post("halden", `/fake-pay/session/${cs}`, hostile, w)).statusCode).toBe(413);
      expect((await fake.getSession(cs)).paid).toBe(false);
    });
  });

  describe("the Payment Element surface", () => {
    it("pays through the Payment Element surface and confirms one order", async () => {
      const { w, tok } = await atPayment("halden", [SHOAL_LITE], "fixture-pe");
      const page = (await get("halden", `/checkout/${tok}/payment`, w)).body;
      expect(page).toContain('data-surface="payment-element"');
      expect(page).toContain('name="number"');
      expect(page).toContain("Test payment");
      expect(page).not.toContain("js.stripe.com");

      const want = totalsOf("halden", [SHOAL_LITE_LINE]);
      const i = await intentOf("halden", w, tok);
      expect(i).toMatchObject({ publishableKey: "pk_test_fake", amountCents: want.totalCents, mode: "fake" });
      expect(fake.inspect(i.id)).toEqual({
        kind: "intent",
        methods: ["card"],
        email: ADDR.email,
        amountCents: want.totalCents,
        metadata: { workspace: w, store: "halden", scenario: "fixture-pe", checkout: tok },
        statementDescriptor: "HALDEN AUDIO",
        // Authorized on confirmation, taken by the store (routes/authorization.ts).
        captureMethod: "manual",
      });
      fake.settle(i.id, "succeed");
      const no = orderNoOf(await complete("halden", w, tok, `payment_intent=${i.id}`), w, "halden");
      expect(no.endsWith(`-${suffixTable(KEY, "fixture-pe").correct}`)).toBe(true);

      const order = await repos.orders.get(w, no);
      expect(order).toMatchObject({
        store: "halden",
        checkoutToken: tok,
        paymentRef: i.id,
        outcomeClass: "correct",
        scenarioId: "fixture-pe",
        email: ADDR.email,
        lines: [SHOAL_LITE_LINE],
        details: { shippingId: "standard", addOns: [], promo: null, marketing: false, delivery: null },
      });
      expect(order?.totals.totalCents).toBe(want.totalCents);
      expect((await repos.checkouts.get(w, tok))?.status).toBe("paid");
      expect((await repos.carts.get(w, "halden")).lines).toEqual([]);

      const html = (await get("halden", `/orders/${no}`, w)).body;
      expect(html).toContain("Thank you, Sam");
      expect(html).toContain(no);
      expect(html).toContain("Shoal Lite Earbuds");
      expect(html).toContain(formatUsd(want.totalCents));
      expect(html).toContain(`A confirmation was sent to ${esc(ADDR.email)}`);
      expect(html).toContain("Halden Audio is a fictional store operated for research. Orders are not fulfilled.");
      expect(html).toContain('<meta name="robots" content="noindex,nofollow">');

      const mails = ordersMail(w);
      expect(mails).toHaveLength(1);
      expect(mails[0]).toMatchObject({ to: ADDR.email, subject: `Your Halden Audio order ${no}` });
      for (const text of [no, "Shoal Lite Earbuds", formatUsd(want.totalCents), "Standard shipping", "500 Howard Street", storeOf("halden").brand.supportEmail]) {
        expect(mails[0]?.body, text).toContain(text);
      }
      // The header's cart is empty again.
      expect(html).not.toMatch(/data-cart-count[^>]*>[1-9]/);
    });

    it("is idempotent when the return URL is hit twice (Review Focus 2)", async () => {
      const { w, tok } = await atPayment("halden", [SHOAL_LITE], "fixture-pe");
      const i = await intentOf("halden", w, tok);
      fake.settle(i.id, "succeed");
      const first = await complete("halden", w, tok, `payment_intent=${i.id}`);
      const second = await complete("halden", w, tok, `payment_intent=${i.id}`);
      expect(second.headers.location).toBe(first.headers.location);
      expect(await repos.orders.countPaid(w, "halden")).toBe(1);
      expect(ordersMail(w).filter((m) => m.subject.includes("order"))).toHaveLength(1);
      // Two completions at once: still one order, one email.
      const again = await atPayment("halden", [SHOAL_LITE], "fixture-pe", { shipping: "standard" }, await newWorkspace());
      const j = await intentOf("halden", again.w, again.tok);
      fake.settle(j.id, "succeed");
      const [a, b] = await Promise.all([complete("halden", again.w, again.tok, `payment_intent=${j.id}`), complete("halden", again.w, again.tok, `payment_intent=${j.id}`)]);
      expect(a.headers.location).toBe(b.headers.location);
      expect(await repos.orders.countPaid(again.w, "halden")).toBe(1);
      expect(ordersMail(again.w)).toHaveLength(1);
    });

    it("classifies a second paid checkout as duplicate (Review Focus 3)", async () => {
      const { w, tok } = await atPayment("halden", [SHOAL_LITE], "fixture-pe");
      const first = await payByIntent("halden", w, tok);
      expect(first.endsWith(suffixTable(KEY, "fixture-pe").correct)).toBe(true);
      const second = await atPayment("halden", [SHOAL_LITE], undefined, { shipping: "standard" }, w);
      const no = await payByIntent("halden", w, second.tok);
      expect(no.endsWith(`-${suffixTable(KEY, "fixture-pe").duplicate}`)).toBe(true);
      expect((await repos.orders.get(w, no))?.outcomeClass).toBe("duplicate");
      expect(await repos.orders.countPaid(w, "halden")).toBe(2);
    });

    it("encodes the outcome class in the suffix: the pre-ticked add-on kept, or unticked", async () => {
      const table = suffixTable(KEY, "fixture-addon");
      const kept = await atPayment("wrenfield", [MEADOW], "fixture-addon", { shipping: "standard", addon: "WF-ADD-VASE" });
      expect((await payByIntent("wrenfield", kept.w, kept.tok)).endsWith(`-${table.extra_items}`)).toBe(true);
      const unticked = await atPayment("wrenfield", [MEADOW], "fixture-addon", { shipping: "standard" });
      const no = await payByIntent("wrenfield", unticked.w, unticked.tok);
      expect(no.endsWith(`-${table.correct}`)).toBe(true);
      expect(no.startsWith("WF-")).toBe(true);
      // No scenario: the "none" table's no_scenario suffix.
      const plain = await atPayment("quillfeather", [HUILA]);
      const qf = await payByIntent("quillfeather", plain.w, plain.tok);
      expect(qf.startsWith("QF-")).toBe(true);
      expect(qf.endsWith(`-${suffixTable(KEY, "none").no_scenario}`)).toBe(true);
    });

    it("never greets a florist's recipient as the buyer, on the page or in the email", async () => {
      const r = await atPayment("wrenfield", [MEADOW]);
      const no = await payByIntent("wrenfield", r.w, r.tok);
      const html = (await get("wrenfield", `/orders/${no}`, r.w)).body;
      expect(html).not.toContain("Thank you, Sam");
      expect(html).toContain("Thank you!");
      const mail = ordersMail(r.w).at(-1);
      expect(mail?.body.startsWith("Hi Sam")).toBe(false);
      expect(mail?.body).toContain("Sam Rivera"); // still delivering to the recipient
    });

    it("greets a florist's buyer by the name given in Contact and still delivers to the recipient (finding 29)", async () => {
      const r = await atPayment("wrenfield", [MEADOW], undefined, { shipping: "standard" }, undefined, app, { senderName: "Fixture Sender" });
      const pay = (await get("wrenfield", `/checkout/${r.tok}/payment`, r.w)).body;
      expect(pay).toContain(`Fixture Sender · ${esc(ADDR.email)}`);
      const no = await payByIntent("wrenfield", r.w, r.tok);
      const html = (await get("wrenfield", `/orders/${no}`, r.w)).body;
      expect(html).toContain("Thank you, Fixture!");
      const mail = ordersMail(r.w).at(-1);
      expect(mail?.body.startsWith("Hi Fixture,")).toBe(true);
      expect(mail?.body).toContain("Sam Rivera"); // the recipient, on the delivery address
    });

    it("starts the card's billing details from the buyer: at a florist the sender's name, when given, and no ZIP (the address is the recipient's)", async () => {
      // Stripe mode: the billing details Elements start from.
      const billingOn = async (site: Site, add: Form, info: Form = {}) => {
        const c = await atPayment(site, [add], undefined, { shipping: "standard" }, undefined, stripeApp, info);
        return configOf((await get(site, `/checkout/${c.tok}/payment`, c.w, {}, stripeApp)).body).billing;
      };
      expect(await billingOn("wrenfield", MEADOW, { senderName: "Fixture Sender" })).toEqual({ name: "Fixture Sender", email: ADDR.email, postalCode: "" });
      expect(await billingOn("wrenfield", MEADOW)).toEqual({ name: "", email: ADDR.email, postalCode: "" });
      expect(await billingOn("quillfeather", HUILA)).toEqual({ name: "Sam Rivera", email: ADDR.email, postalCode: "94107" });
      // The store's own card form: its ZIP field starts empty at a florist, from the address elsewhere.
      const wf = await atPayment("wrenfield", [MEADOW], undefined, { shipping: "standard" }, undefined, app, { senderName: "Fixture Sender" });
      expect(cardZipOf((await get("wrenfield", `/checkout/${wf.tok}/payment`, wf.w)).body)).toBe("");
      const qf = await atPayment("quillfeather", [HUILA]);
      expect(cardZipOf((await get("quillfeather", `/checkout/${qf.tok}/payment`, qf.w)).body)).toBe("94107");
    });

    it("grades a newsletter sign-up the task ruled out as wrong details", async () => {
      const table = suffixTable(KEY, "fixture-newsletter");
      const signed = await newWorkspace();
      await get("halden", "/?utm_campaign=fixture-newsletter", signed);
      expect((await post("halden", "/newsletter", { email: "a.b@buyer.example" }, signed)).statusCode).toBe(303);
      const s1 = await atPayment("halden", [SHOAL_LITE], undefined, { shipping: "standard" }, signed);
      expect((await payByIntent("halden", s1.w, s1.tok)).endsWith(`-${table.wrong_details}`)).toBe(true);
      const quiet = await atPayment("halden", [SHOAL_LITE], "fixture-newsletter");
      expect((await payByIntent("halden", quiet.w, quiet.tok)).endsWith(`-${table.correct}`)).toBe(true);
    });

    it("sends a declined card back to the payment step with Stripe's message", async () => {
      const { w, tok } = await atPayment("quillfeather", [HUILA], "fixture-decline");
      const i = await intentOf("quillfeather", w, tok);
      fake.settle(i.id, "decline");
      const res = await complete("quillfeather", w, tok, `payment_intent=${i.id}`);
      expect(res.statusCode).toBe(303);
      expect(res.headers.location).toBe(`/w/${w}/quillfeather/checkout/${tok}/payment?error=Your%20card%20was%20declined.`);
      expect(await repos.orders.countPaid(w, "quillfeather")).toBe(0);
      expect((await repos.checkouts.get(w, tok))?.status).toBe("open");
      const page = (await get("quillfeather", `/checkout/${tok}/payment?error=Your%20card%20was%20declined.`, w)).body;
      expect(page).toContain("Your card was declined.");
      expect(ordersMail(w)).toHaveLength(0);
    });

    it("keeps the payment amount in step with the live cart (Review Focus 5)", async () => {
      const { w, tok } = await atPayment("halden", [SHOAL_LITE], "fixture-pe");
      const one = await intentOf("halden", w, tok);
      expect(one.amountCents).toBe(totalsOf("halden", [SHOAL_LITE_LINE]).totalCents);
      const key = JSON.stringify(["HA-EB-SHOAL-LITE", "color=black", "once", ""]);
      expect((await post("halden", "/cart/update", { key, qty: "2" }, w)).statusCode).toBe(303);
      const two = await intentOf("halden", w, tok);
      const want = totalsOf("halden", [{ ...SHOAL_LITE_LINE, qty: 2 }]).totalCents;
      expect(two.id).toBe(one.id);
      expect(two.amountCents).toBe(want);
      expect(fake.inspect(two.id).amountCents).toBe(want);
      fake.settle(two.id, "succeed");
      const no = orderNoOf(await complete("halden", w, tok, `payment_intent=${two.id}`), w, "halden");
      expect((await repos.orders.get(w, no))?.lines).toEqual([{ ...SHOAL_LITE_LINE, qty: 2 }]);
    });

    it("makes one intent for a checkout however many tabs ask at once", async () => {
      const { w, tok } = await atPayment("halden", [SHOAL_LITE], "fixture-pe");
      const asked = await Promise.all(Array.from({ length: 4 }, () => intentOf("halden", w, tok)));
      expect(new Set(asked.map((i) => i.id)).size).toBe(1);
      expect(await repos.payments.ofCheckout(w, tok, "intent")).toHaveLength(1);
      // The claim the steps took turns on is given back.
      expect((await repos.checkouts.get(w, tok))?.flags).not.toHaveProperty("paymentClaim");
    });

    it("names its store on the buyer's card statement: every intent and session carries the store's descriptor", async () => {
      const wf = await atPayment("wrenfield", [MEADOW]);
      expect(fake.inspect((await intentOf("wrenfield", wf.w, wf.tok)).id)).toMatchObject({ kind: "intent", statementDescriptor: "WRENFIELD" });
      const qf = await atPayment("quillfeather", [HUILA]);
      expect(fake.inspect((await intentOf("quillfeather", qf.w, qf.tok)).id)).toMatchObject({ kind: "intent", statementDescriptor: "QUILLFEATHER" });
      const ha = await atPayment("halden", [SHOAL_LITE]); // hosted
      expect(fake.inspect(await sessionOf("halden", ha.w, ha.tok))).toMatchObject({ kind: "session", statementDescriptor: "HALDEN AUDIO" });
      const pe = await atPayment("halden", [SHOAL_LITE], "fixture-pe"); // Halden on the Payment Element
      expect(fake.inspect((await intentOf("halden", pe.w, pe.tok)).id)).toMatchObject({ kind: "intent", statementDescriptor: "HALDEN AUDIO" });
    });
  });

  describe("a payment that never reached the return URL", () => {
    it("is completed when the payment step is opened again, never paid twice, and the confirmation says so", async () => {
      const { w, tok } = await atPayment("halden", [SHOAL_LITE], "fixture-pe");
      const i = await intentOf("halden", w, tok);
      fake.settle(i.id, "succeed"); // paid in the card form, but the browser never got to /complete
      const back = await get("halden", `/checkout/${tok}/payment`, w);
      expect(back.statusCode).toBe(303);
      expect(back.headers.location).toBe(`/w/${w}/halden/checkout/${tok}/complete?payment_intent=${i.id}&recovered=1`);
      const done = await get("halden", (back.headers.location as string).replace(`/w/${w}/halden`, ""), w);
      const no = recoveredNoOf(done, w, "halden");
      expect((await repos.orders.get(w, no))?.paymentRef).toBe(i.id);
      expect((await get("halden", `/orders/${no}?recovered=1`, w)).body).toContain(RECOVERED_NOTICE);

      const hosted = await atPayment("halden", [SHOAL_LITE]); // Halden's own surface: hosted
      const cs = /(cs_fake_[0-9a-z]+)$/.exec((await post("halden", `/checkout/${hosted.tok}/payment/session`, {}, hosted.w)).headers.location as string)?.[1] as string;
      expect((await get("halden", `/checkout/${hosted.tok}/payment`, hosted.w)).statusCode).toBe(200); // not paid yet: the page as usual
      fake.settleSession(cs);
      const again = await get("halden", `/checkout/${hosted.tok}/payment`, hosted.w);
      expect(again.headers.location).toBe(`/w/${hosted.w}/halden/checkout/${hosted.tok}/complete?session_id=${cs}&recovered=1`);
      recoveredNoOf(await get("halden", (again.headers.location as string).replace(`/w/${hosted.w}/halden`, ""), hosted.w), hosted.w, "halden");
      // The return URL itself, reached at last: the plain confirmation.
      expect(orderNoOf(await complete("halden", hosted.w, hosted.tok, `session_id=${cs}`), hosted.w, "halden")).toBe((await repos.orders.list(hosted.w))[0]?.orderNo);
    });
  });

  describe("the price update", () => {
    it("updates the price once on the first pay attempt", async () => {
      const { w, tok } = await atPayment("quillfeather", [HUILA], "fixture-price");
      const huila: CartLine = { sku: "QF-COL-HUILA", options: { size: "12oz", grind: "whole-bean" }, qty: 1, mode: "once" };
      const before = totalsOf("quillfeather", [huila]).totalCents;
      const first = await postJson("quillfeather", `/checkout/${tok}/payment/intent`, {}, w);
      expect(first.statusCode).toBe(200);
      expect(first.json()).toMatchObject({ priceUpdated: { label: "Fixture shipping update", oldCents: before, newCents: before + 777 } });
      expect(first.json()).not.toHaveProperty("clientSecret");
      const second = await intentOf("quillfeather", w, tok);
      expect(second.amountCents).toBe(before + 777);
      expect(fake.inspect(second.id)).toMatchObject({ kind: "intent", methods: ["card", "link"], amountCents: before + 777 });
      expect((await intentOf("quillfeather", w, tok)).amountCents).toBe(before + 777);
      expect((await repos.events.list(w)).filter((e) => e.kind === "price_updated")).toHaveLength(1);
      expect((await get("quillfeather", `/checkout/${tok}/payment`, w)).body).toContain(`data-summary-total>${formatUsd(before + 777)}<`);
      fake.settle(second.id, "succeed");
      const no = orderNoOf(await complete("quillfeather", w, tok, `payment_intent=${second.id}`), w, "quillfeather");
      expect((await repos.orders.get(w, no))?.totals.totalCents).toBe(before + 777);
    });
  });

  describe("the hosted surface", () => {
    it("creates a hosted session and completes from the session id", async () => {
      const { w, tok } = await atPayment("halden", [SHOAL_LITE], "fixture-co");
      const page = (await get("halden", `/checkout/${tok}/payment`, w)).body;
      expect(page).toContain('data-surface="checkout"');
      expect(page).toContain("Continue to secure payment");
      expect(page).toMatch(new RegExp(`<form[^>]*action="/w/${w}/halden/checkout/${tok}/payment/session"`));
      const res = await post("halden", `/checkout/${tok}/payment/session`, {}, w);
      expect(res.statusCode).toBe(303);
      const m = new RegExp(`^/w/${w}/halden/fake-pay/session/(cs_fake_[0-9a-z]+)$`).exec(res.headers.location as string);
      expect(m, res.headers.location as string).not.toBeNull();
      const cs = (m as RegExpExecArray)[1] as string;
      const want = totalsOf("halden", [SHOAL_LITE_LINE]);
      const s = fake.inspect(cs);
      expect(s).toMatchObject({
        kind: "session",
        email: ADDR.email,
        amountCents: want.totalCents,
        successUrl: `http://localhost/w/${w}/halden/checkout/${tok}/complete?session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `http://localhost/w/${w}/halden/checkout/${tok}/payment`,
        metadata: { workspace: w, store: "halden", scenario: "fixture-co", checkout: tok },
        captureMethod: "manual",
      });
      if (s.kind !== "session") throw new Error("not a session");
      expect(s.lines.map((l) => l.name)).toEqual(["Shoal Lite Earbuds (Black)", "Shipping — Standard shipping", "Sales tax"]);
      expect(s.lines.reduce((a, l) => a + l.unitCents * l.qty, 0)).toBe(want.totalCents);
      // Not paid yet: back to the payment step.
      const early = await complete("halden", w, tok, `session_id=${cs}`);
      expect(early.statusCode).toBe(303);
      expect(early.headers.location).toMatch(new RegExp(`^/w/${w}/halden/checkout/${tok}/payment\\?error=`));
      fake.settleSession(cs);
      const no = orderNoOf(await complete("halden", w, tok, `session_id=${cs}`), w, "halden");
      expect(no.endsWith(`-${suffixTable(KEY, "fixture-co").correct}`)).toBe(true);
      expect((await repos.orders.get(w, no))?.paymentRef).toBe((await fake.getSession(cs)).paymentIntentId);
    });

    it("pays on the fake hosted page: card, decline, 3D Secure, then back to the store", async () => {
      const { w, tok } = await atPayment("halden", [SHOAL_LITE]); // Halden's own surface: hosted
      const cs = /(cs_fake_[0-9a-z]+)$/.exec((await post("halden", `/checkout/${tok}/payment/session`, {}, w)).headers.location as string)?.[1] as string;
      const page = await get("halden", `/fake-pay/session/${cs}`, w);
      expect(page.statusCode).toBe(200);
      expect(page.body).toContain("Test payment");
      expect(page.body).toContain(formatUsd(totalsOf("halden", [SHOAL_LITE_LINE]).totalCents));
      expect(page.body).toContain('<meta name="robots" content="noindex,nofollow">');
      // Another workspace cannot open it.
      expect((await get("halden", `/fake-pay/session/${cs}`, await newWorkspace())).statusCode).toBe(404);
      const card = { expiry: "12 / 34", cvc: "123", zip: "94107", name: "Sam Rivera" };
      const declined = await post("halden", `/fake-pay/session/${cs}`, { ...card, number: "4000 0000 0000 0002" }, w);
      expect(declined.statusCode).toBe(402);
      expect(declined.body).toContain("Your card was declined.");
      const invalid = await post("halden", `/fake-pay/session/${cs}`, { ...card, number: "4242 4242 4242 4241" }, w);
      expect(invalid.statusCode).toBe(422);
      expect(invalid.body).toContain("Your card number is invalid.");
      const challenge = await post("halden", `/fake-pay/session/${cs}`, { ...card, number: "4000 0027 6000 3184" }, w);
      expect(challenge.statusCode).toBe(303);
      expect(challenge.headers.location).toBe(`/w/${w}/halden/fake-pay/session/${cs}/authenticate`);
      expect((await get("halden", `/fake-pay/session/${cs}/authenticate`, w)).body).toContain("Complete authentication");
      const done = await post("halden", `/fake-pay/session/${cs}/authenticate`, { result: "complete" }, w);
      expect(done.statusCode).toBe(303);
      expect(done.headers.location).toBe(`http://localhost/w/${w}/halden/checkout/${tok}/complete?session_id=${cs}`);
      // Completed on the page with its payment authorized: the store takes it at its success URL.
      expect(await fake.getSession(cs)).toMatchObject({ paid: false, intent: { status: "requires_capture" } });
      expect((await get("halden", `/fake-pay/session/${cs}`, w)).headers.location).toBe(`http://localhost/w/${w}/halden/checkout/${tok}/complete?session_id=${cs}`);
      const no = orderNoOf(await complete("halden", w, tok, `session_id=${cs}`), w, "halden");
      expect(no.startsWith("HA-")).toBe(true);
      expect((await fake.getSession(cs)).paid).toBe(true);
    });
  });

  describe("the fake card form", () => {
    const CARD = { expiry: "12/34", cvc: "123", zip: "94107" };
    it("pays by card number: success, decline, 3D Secure, and an invalid number", async () => {
      const { w, tok } = await atPayment("quillfeather", [HUILA]);
      const confirm = (number: string) => postJson("quillfeather", `/checkout/${tok}/payment/fake-confirm`, { ...CARD, number }, w);
      await intentOf("quillfeather", w, tok);
      const bad = await confirm("4242 4242 4242 4241");
      expect(bad.statusCode).toBe(422);
      expect(bad.json()).toMatchObject({ error: "Your card number is invalid." });
      const declined = await confirm("4000 0000 0000 0002");
      expect(declined.statusCode).toBe(402);
      expect(declined.json()).toMatchObject({ status: "requires_payment_method", error: "Your card was declined." });
      const challenge = await confirm("4000002760003184");
      expect(challenge.json()).toMatchObject({ status: "requires_action" });
      const auth = await postJson("quillfeather", `/checkout/${tok}/payment/authenticate`, { result: "complete" }, w);
      expect(auth.statusCode).toBe(200);
      const done = auth.json() as { status: string; redirect: string };
      expect(done.status).toBe("succeeded");
      expect(done.redirect).toMatch(new RegExp(`^/w/${w}/quillfeather/checkout/${tok}/complete\\?payment_intent=pi_fake_[0-9a-z]+$`));
      const no = orderNoOf(await get("quillfeather", done.redirect.replace(`/w/${w}/quillfeather`, ""), w), w, "quillfeather");
      expect(no.startsWith("QF-")).toBe(true);
      // The card number is kept nowhere: no 13–19 digit run in any of the workspace's rows.
      for (const table of ["checkouts", "orders", "events", "carts", "store_state"]) {
        const rows = await pool.query(`SELECT * FROM shops.${table} WHERE workspace_id = $1`, [w]);
        expect(JSON.stringify(rows.rows), table).not.toMatch(/\d{13,19}/);
        expect(JSON.stringify(rows.rows), table).not.toMatch(/4242 4242|4000 0027/);
      }
    });

    it("works without JavaScript: the form posts, then redirects to completion, back with the error, or to the authentication step", async () => {
      const { w, tok } = await atPayment("wrenfield", [MEADOW]);
      const declined = await post("wrenfield", `/checkout/${tok}/payment/fake-confirm`, { ...CARD, number: "4000000000000002" }, w);
      expect(declined.statusCode).toBe(303);
      expect(declined.headers.location).toBe(`/w/${w}/wrenfield/checkout/${tok}/payment?error=Your%20card%20was%20declined.`);
      const challenge = await post("wrenfield", `/checkout/${tok}/payment/fake-confirm`, { ...CARD, number: "4000002760003184" }, w);
      expect(challenge.headers.location).toBe(`/w/${w}/wrenfield/checkout/${tok}/payment/authenticate`);
      expect((await get("wrenfield", `/checkout/${tok}/payment/authenticate`, w)).body).toContain("Complete authentication");
      const failed = await post("wrenfield", `/checkout/${tok}/payment/authenticate`, { result: "fail" }, w);
      expect(failed.statusCode).toBe(303);
      expect(failed.headers.location).toMatch(new RegExp(`/checkout/${tok}/payment\\?error=We%20are%20unable%20to%20authenticate`));
      const paid = await post("wrenfield", `/checkout/${tok}/payment/fake-confirm`, { ...CARD, number: "4242 4242 4242 4242" }, w);
      expect(paid.statusCode).toBe(303);
      const done = await get("wrenfield", (paid.headers.location as string).replace(`/w/${w}/wrenfield`, ""), w);
      const no = orderNoOf(done, w, "wrenfield");
      const mail = ordersMail(w)[0];
      expect(mail?.subject).toBe(`Your Wrenfield Flowers order ${no}`);
      expect(mail?.body).toContain("Thursday, October 8");
      expect(mail?.body).toContain("Happy birthday, Mia!");
      expect(mail?.body).toContain("Love, Sam");
      // Pressing Pay again on a paid checkout leads to the order.
      const again = await post("wrenfield", `/checkout/${tok}/payment/fake-confirm`, { ...CARD, number: "4242 4242 4242 4242" }, w);
      expect(again.headers.location).toBe(`/w/${w}/wrenfield/orders/${no}`);
    });
  });

  describe("trust", () => {
    it("replaces the payment block with the outbound notice", async () => {
      const { w, tok } = await atPayment("halden", [SHOAL_LITE], "fixture-notice");
      const html = (await get("halden", `/checkout/${tok}/payment`, w)).body;
      expect(html).toContain("Fixture notice title");
      expect(html).toContain(`href="/w/${w}/paylantern/pay?ref=${tok}&amp;m=halden"`);
      expect(html).toContain("Fixture notice link");
      expect(html).not.toContain("data-surface");
      expect(html).not.toContain('name="number"');
      expect((await repos.events.list(w)).filter((e) => e.kind === "notice_shown").map((e) => e.data)).toEqual([{ token: tok }]);
      expect((await postJson("halden", `/checkout/${tok}/payment/intent`, {}, w)).statusCode).toBe(409);
      expect((await post("halden", `/checkout/${tok}/payment/session`, {}, w)).statusCode).toBe(409);
    });

    it("refuses a payment whose metadata names another checkout or workspace", async () => {
      const a = await atPayment("halden", [SHOAL_LITE], "fixture-pe");
      const b = await secondCheckout("halden", a.w); // same workspace, another checkout
      const ia = await intentOf("halden", a.w, a.tok);
      fake.settle(ia.id, "succeed");
      const wrongCheckout = await complete("halden", a.w, b.tok, `payment_intent=${ia.id}`);
      expect(wrongCheckout.statusCode).toBe(400);
      const other = await newWorkspace();
      const elsewhere = await atPayment("halden", [SHOAL_LITE], "fixture-pe", { shipping: "standard" }, other);
      const wrongWorkspace = await complete("halden", other, elsewhere.tok, `payment_intent=${ia.id}`);
      expect(wrongWorkspace.statusCode).toBe(400);
      expect((await complete("halden", a.w, a.tok, "payment_intent=pi_fake_000000000000000000000000")).statusCode).toBe(404);
      expect((await complete("halden", a.w, a.tok, "")).statusCode).toBe(400);
      expect(await repos.orders.countPaid(a.w, "halden")).toBe(0);
      expect(await repos.orders.countPaid(other, "halden")).toBe(0);
      // The right checkout still completes.
      orderNoOf(await complete("halden", a.w, a.tok, `payment_intent=${ia.id}`), a.w, "halden");
    });

    it("shows an order only to its own workspace, on its own store", async () => {
      const { w, tok } = await atPayment("halden", [SHOAL_LITE], "fixture-pe");
      const no = await payByIntent("halden", w, tok);
      expect((await get("halden", `/orders/${no}`, w)).statusCode).toBe(200);
      expect((await get("halden", `/orders/${no}`, await newWorkspace())).statusCode).toBe(404);
      expect((await get("quillfeather", `/orders/${no}`, w)).statusCode).toBe(404);
      expect((await get("halden", "/orders/HA-000000-00", w)).statusCode).toBe(404);
      // And a paid checkout's pay button points at it.
      const r = await postJson("halden", `/checkout/${tok}/payment/intent`, {}, w);
      expect(r.statusCode).toBe(409);
      expect(r.json()).toMatchObject({ redirect: `/w/${w}/halden/orders/${no}` });
    });
  });

  describe("every page", () => {
    it("carries noindex, the fine print and the workspace prefix on every link, form and image", async () => {
      const pages: [string, string, string][] = [];
      // Wrenfield (card form): cart, the three steps, the 3D Secure fallback, the refused completion, the confirmation.
      const wf = await atPayment("wrenfield", [MEADOW]);
      const html = async (site: Site, w: string, path: string) => (await get(site, path, w)).body;
      for (const step of ["information", "shipping", "payment"]) pages.push(["wrenfield", wf.w, await html("wrenfield", wf.w, `/checkout/${wf.tok}/${step}`)]);
      await post("wrenfield", "/cart/add", MEADOW, wf.w);
      pages.push(["wrenfield", wf.w, await html("wrenfield", wf.w, "/cart")]);
      await post("wrenfield", `/checkout/${wf.tok}/payment/fake-confirm`, { number: "4000002760003184", expiry: "12/34", cvc: "123", zip: "94107" }, wf.w);
      pages.push(["wrenfield", wf.w, await html("wrenfield", wf.w, `/checkout/${wf.tok}/payment/authenticate`)]);
      pages.push(["wrenfield", wf.w, (await complete("wrenfield", wf.w, wf.tok, "payment_intent=pi_fake_000000000000000000000000x")).body]);
      const other = await atPayment("wrenfield", [MEADOW]);
      const io = await intentOf("wrenfield", other.w, other.tok);
      fake.settle(io.id, "succeed");
      const refused = await complete("wrenfield", wf.w, wf.tok, `payment_intent=${io.id}`);
      expect(refused.statusCode).toBe(400);
      pages.push(["wrenfield", wf.w, refused.body]);
      const done = await post("wrenfield", `/checkout/${wf.tok}/payment/authenticate`, { result: "complete" }, wf.w);
      const no = orderNoOf(await get("wrenfield", (done.headers.location as string).replace(`/w/${wf.w}/wrenfield`, ""), wf.w), wf.w, "wrenfield");
      pages.push(["wrenfield", wf.w, await html("wrenfield", wf.w, `/orders/${no}`)]);
      // Halden (hosted): the fake hosted page and its authentication step.
      const ha = await atPayment("halden", [SHOAL_LITE]);
      const cs = /(cs_fake_[0-9a-z]+)$/.exec((await post("halden", `/checkout/${ha.tok}/payment/session`, {}, ha.w)).headers.location as string)?.[1] as string;
      pages.push(["halden", ha.w, await html("halden", ha.w, `/fake-pay/session/${cs}`)]);
      await post("halden", `/fake-pay/session/${cs}`, { number: "4000002760003184", expiry: "12/34", cvc: "123", zip: "94107" }, ha.w);
      pages.push(["halden", ha.w, await html("halden", ha.w, `/fake-pay/session/${cs}/authenticate`)]);
      expect(pages).toHaveLength(10);
      for (const [site, w, page] of pages) {
        const name = /<title>([^<]*)<\/title>/.exec(page)?.[1] ?? page.slice(0, 80);
        expect(page, name).toContain('<meta name="robots" content="noindex,nofollow">');
        expect(page, name).toContain(`${storeOf(site as Site).brand.name} is a fictional store operated for research. Orders are not fulfilled.`);
        const local = [...page.matchAll(/(?:href|action|src|formaction)="(\/[^"]*)"/g)].map((m) => m[1] as string);
        expect(local.length, name).toBeGreaterThan(2);
        for (const u of local) expect(u.startsWith(`/w/${w}/${site}/`), `${name}: ${u}`).toBe(true);
      }
    });
  });

  describe("each store's surface", () => {
    it("Wrenfield pays in the Payment Element, Quillfeather adds Link's express checkout, Halden goes to the hosted page", async () => {
      const wf = await atPayment("wrenfield", [MEADOW]);
      expect((await get("wrenfield", `/checkout/${wf.tok}/payment`, wf.w)).body).toContain('data-surface="payment-element"');
      expect(fake.inspect((await intentOf("wrenfield", wf.w, wf.tok)).id)).toMatchObject({ methods: ["card"] });
      const qf = await atPayment("quillfeather", [HUILA]);
      expect((await get("quillfeather", `/checkout/${qf.tok}/payment`, qf.w)).body).toContain('data-surface="express-checkout"');
      expect(fake.inspect((await intentOf("quillfeather", qf.w, qf.tok)).id)).toMatchObject({ methods: ["card", "link"] });
      const ha = await atPayment("halden", [SHOAL_LITE]);
      expect((await get("halden", `/checkout/${ha.tok}/payment`, ha.w)).body).toContain('data-surface="checkout"');
      expect((await postJson("halden", `/checkout/${ha.tok}/payment/intent`, {}, ha.w)).statusCode).toBe(409);
    });

    it("in Stripe mode loads Stripe.js and mounts Elements themed from the brand, with no fake pages", async () => {
      const w = await newWorkspace();
      const on = stripeApp;
      expect((await post("quillfeather", "/cart/add", HUILA, w, {}, on)).statusCode).toBe(303);
      const tok = /\/checkout\/([0-9a-z]{24})\//.exec((await post("quillfeather", "/checkout", {}, w, {}, on)).headers.location as string)?.[1] as string;
      expect((await post("quillfeather", `/checkout/${tok}/information`, ADDR, w, {}, on)).statusCode).toBe(303);
      expect((await post("quillfeather", `/checkout/${tok}/shipping`, { shipping: "standard" }, w, {}, on)).statusCode).toBe(303);
      const html = (await get("quillfeather", `/checkout/${tok}/payment`, w, {}, on)).body;
      expect(html).toContain('<script src="https://js.stripe.com/v3/" defer></script>');
      expect(html.indexOf("js.stripe.com")).toBeLessThan(html.indexOf("/assets/js/pay.js"));
      expect(html).toContain('id="payment-element"');
      expect(html).toContain('id="express-checkout-element"');
      expect(html).not.toContain('name="number"');
      const cfg = JSON.parse(/<script type="application\/json" id="checkout-config">([^<]*)<\/script>/.exec(html)?.[1] as string);
      expect(cfg).toMatchObject({ mode: "stripe", surface: "express-checkout", publishableKey: "pk_test_stub", methods: ["card", "link"] });
      expect(cfg.appearance.variables.colorPrimary).toBe(storeOf("quillfeather").brand.tokens.accent);
      expect(cfg.urls.returnUrl).toBe(`http://localhost/w/${w}/quillfeather/checkout/${tok}/complete`);
      expect((await post("quillfeather", `/checkout/${tok}/payment/fake-confirm`, { number: "4242424242424242" }, w, {}, on)).statusCode).toBe(404);
      expect((await get("quillfeather", "/fake-pay/session/cs_fake_00", w, {}, on)).statusCode).toBe(404);
    });
  });

  describe("an order is what its payment paid for", () => {
    const WRAP = "HA-GIFT-WRAP";

    it("records a hosted session paid from an open tab after its add-on was unticked as the session charged it (finding 5)", async () => {
      const { w, tok } = await atPayment("halden", [SHOAL_LITE], "fixture-co", { shipping: "standard", addon: WRAP });
      const wrapped = totalsOf("halden", [SHOAL_LITE_LINE], { addOns: [WRAP] });
      const cs = await sessionOf("halden", w, tok);
      expect(fake.inspect(cs).amountCents).toBe(wrapped.totalCents);
      // Back to shipping, the gift wrap unticked: the payment step now asks for less …
      expect((await post("halden", `/checkout/${tok}/shipping`, { shipping: "standard" }, w)).statusCode).toBe(303);
      const plain = totalsOf("halden", [SHOAL_LITE_LINE]);
      expect((await get("halden", `/checkout/${tok}/payment`, w)).body).toContain(`data-summary-total>${formatUsd(plain.totalCents)}<`);
      // … but the first session, still open in another tab, is what gets paid.
      fake.settleSession(cs);
      const no = orderNoOf(await complete("halden", w, tok, `session_id=${cs}`), w, "halden");
      const order = await repos.orders.get(w, no);
      expect(order).toMatchObject({ outcomeClass: "extra_items", lines: [SHOAL_LITE_LINE], chargedCents: wrapped.totalCents, details: { shippingId: "standard", addOns: [WRAP] } });
      expect(order?.totals).toEqual(wrapped);
      expect(no.endsWith(`-${suffixTable(KEY, "fixture-co").extra_items}`)).toBe(true);
      expect((await repos.events.list(w)).filter((e) => e.kind === "amount_mismatch")).toEqual([]);
      const page = (await get("halden", `/orders/${no}`, w)).body;
      expect(page).toContain(`Paid by card · ${formatUsd(wrapped.totalCents)}`);
      expect(page).toContain("Gift wrap");
      const mail = ordersMail(w).at(-1)?.body ?? "";
      expect(mail).toContain(`Total paid: ${formatUsd(wrapped.totalCents)}`);
      expect(mail).toContain("Gift wrap");
    });

    it("records a session paid after the cart grew as the one item it charged for (finding 18)", async () => {
      const { w, tok } = await atPayment("halden", [SHOAL_LITE], "fixture-co");
      const one = totalsOf("halden", [SHOAL_LITE_LINE]);
      const cs = await sessionOf("halden", w, tok);
      expect((await post("halden", "/cart/add", { sku: "HA-AC-CASE", qty: "1" }, w)).statusCode).toBe(303);
      fake.settleSession(cs);
      const no = orderNoOf(await complete("halden", w, tok, `session_id=${cs}`), w, "halden");
      expect(await repos.orders.get(w, no)).toMatchObject({ outcomeClass: "correct", lines: [SHOAL_LITE_LINE], chargedCents: one.totalCents, totals: { totalCents: one.totalCents } });
      const page = (await get("halden", `/orders/${no}`, w)).body;
      expect(page).toContain("Shoal Lite Earbuds");
      expect(page).not.toContain("Soft Carry Case");
      expect(page).toContain(`Paid by card · ${formatUsd(one.totalCents)}`);
    });

    it("records a second paid session of a paid checkout from what it charged, as a duplicate, and leaves the next cart alone (finding 7)", async () => {
      // The network fails as the second session expires the first: both stay payable.
      racy.beforeExpire = () => {
        throw new Error("connect ETIMEDOUT");
      };
      try {
        const { w, tok } = await atPayment("halden", [SHOAL_LITE], "fixture-co", { shipping: "standard", addon: WRAP }, undefined, racyApp);
        const first = await sessionOf("halden", w, tok, racyApp);
        expect((await post("halden", `/checkout/${tok}/shipping`, { shipping: "standard" }, w, {}, racyApp)).statusCode).toBe(303);
        const second = await sessionOf("halden", w, tok, racyApp);
        racy.settleSession(second);
        const one = orderNoOf(await complete("halden", w, tok, `session_id=${second}`, racyApp), w, "halden");
        expect((await repos.orders.get(w, one))?.outcomeClass).toBe("correct");
        // The shopper starts another purchase; then the first session's tab is paid as well.
        expect((await post("halden", "/cart/add", { sku: "HA-AC-CASE", qty: "1" }, w, {}, racyApp)).statusCode).toBe(303);
        racy.settleSession(first);
        const two = orderNoOf(await complete("halden", w, tok, `session_id=${first}`, racyApp), w, "halden");
        const charged = totalsOf("halden", [SHOAL_LITE_LINE], { addOns: [WRAP] }).totalCents;
        expect(await repos.orders.get(w, two)).toMatchObject({ outcomeClass: "duplicate", lines: [SHOAL_LITE_LINE], chargedCents: charged, totals: { totalCents: charged }, details: { addOns: [WRAP] } });
        const page = (await get("halden", `/orders/${two}`, w, {}, racyApp)).body;
        expect(page).toContain("Shoal Lite Earbuds");
        expect(page).toContain(`Paid by card · ${formatUsd(charged)}`);
        const mail = ordersMail(w).find((m) => m.subject.endsWith(two))?.body ?? "";
        expect(mail).toContain("Shoal Lite Earbuds");
        expect(mail).toContain(`Total paid: ${formatUsd(charged)}`);
        // The second order did not empty the cart the shopper had started since.
        expect((await repos.carts.get(w, "halden")).lines).toEqual([{ sku: "HA-AC-CASE", options: {}, qty: 1 }]);
      } finally {
        racy.beforeExpire = null;
      }
    });

    it("expires a checkout's previous session when it makes a new one: the old page sends the shopper back unpaid", async () => {
      const { w, tok } = await atPayment("halden", [SHOAL_LITE], "fixture-co");
      const first = await sessionOf("halden", w, tok);
      const second = await sessionOf("halden", w, tok);
      expect(fake.inspect(first)).toMatchObject({ kind: "session", expired: true });
      expect(fake.inspect(second)).toMatchObject({ kind: "session", expired: false });
      const back = `http://localhost/w/${w}/halden/checkout/${tok}/payment?error=`;
      const open = await get("halden", `/fake-pay/session/${first}`, w);
      expect(open.statusCode).toBe(303);
      expect((open.headers.location as string).startsWith(back), open.headers.location as string).toBe(true);
      const paying = await post("halden", `/fake-pay/session/${first}`, { number: "4242 4242 4242 4242", expiry: "12/34", cvc: "123", zip: "94107" }, w);
      expect(paying.statusCode).toBe(303);
      expect((paying.headers.location as string).startsWith(back)).toBe(true);
      expect((await fake.getSession(first)).paid).toBe(false);
      expect((await repos.payments.get(w, first))?.status).toBe("expired");
      // The new one pays as usual.
      fake.settleSession(second);
      orderNoOf(await complete("halden", w, tok, `session_id=${second}`), w, "halden");
    });

    it("records a session paid just as the next one expires it, from its own snapshot, instead of opening another", async () => {
      racy.beforeExpire = (id) => racy.settleSession(id); // the payment lands a moment before the expiry
      try {
        const { w, tok } = await atPayment("halden", [SHOAL_LITE], "fixture-co", { shipping: "standard", addon: WRAP }, undefined, racyApp);
        const first = await sessionOf("halden", w, tok, racyApp);
        expect((await post("halden", `/checkout/${tok}/shipping`, { shipping: "standard" }, w, {}, racyApp)).statusCode).toBe(303);
        const res = await post("halden", `/checkout/${tok}/payment/session`, {}, w, {}, racyApp);
        expect(res.statusCode).toBe(303);
        expect(res.headers.location).toBe(`/w/${w}/halden/checkout/${tok}/complete?session_id=${first}`);
        const no = orderNoOf(await complete("halden", w, tok, `session_id=${first}`, racyApp), w, "halden");
        expect(await repos.orders.get(w, no)).toMatchObject({ outcomeClass: "extra_items", details: { addOns: [WRAP] } });
        expect((await repos.payments.ofCheckout(w, tok)).map((p) => [p.ref, p.status])).toEqual([[first, "paid"]]);
      } finally {
        racy.beforeExpire = null;
      }
    });

    it("does not let an earlier session that completed without a payment stand in the way of a new one", async () => {
      const { w, tok } = await atPayment("halden", [SHOAL_LITE], "fixture-co", { shipping: "standard" }, undefined, racyApp);
      const first = await sessionOf("halden", w, tok, racyApp);
      racy.completedUnpaid = true; // the processor will not expire it, yet nothing was paid
      try {
        const second = await sessionOf("halden", w, tok, racyApp);
        expect(second).not.toBe(first);
        expect((await repos.payments.ofCheckout(w, tok)).map((p) => [p.ref, p.status])).toEqual([
          [first, "expired"],
          [second, "open"],
        ]);
      } finally {
        racy.completedUnpaid = false;
      }
    });
  });

  describe("a payment that went through unseen, before the next one (finding 19)", () => {
    it("is recorded as the store's order when the cart is opened again, and the shopper is shown it; buying again is a duplicate", async () => {
      const { w, tok } = await atPayment("halden", [SHOAL_LITE], "fixture-pe");
      const i = await intentOf("halden", w, tok);
      fake.settle(i.id, "succeed"); // paid, then the tab closed before the return URL loaded
      expect(await repos.orders.countPaid(w, "halden")).toBe(0);
      const cart = await get("halden", "/cart", w);
      const [first] = await repos.orders.list(w);
      expect(first).toMatchObject({ checkoutToken: tok, paymentRef: i.id, outcomeClass: "correct", chargedCents: i.amountCents });
      // Never a silently emptied cart: the cart page sends the shopper to the order, which says what happened.
      expect(recoveredNoOf(cart, w, "halden")).toBe(first?.orderNo);
      const page = (await get("halden", `/orders/${first?.orderNo}?recovered=1`, w)).body;
      expect(page).toMatch(/<div class="checkout-alert checkout-alert--success" role="status" data-recovered-notice><p>Your earlier payment went through — here is your order\.<\/p><\/div>/);
      expect(page).toContain(`data-order-number>${first?.orderNo}<`);
      // Nothing was left in the cart: the notice sends nobody back to it. Opened on its own, the page has no notice.
      expect(page).not.toContain("still in your cart");
      expect((await get("halden", `/orders/${first?.orderNo}`, w)).body).not.toContain("data-recovered-notice");
      expect((await repos.checkouts.get(w, tok))?.status).toBe("paid");
      expect((await repos.carts.get(w, "halden")).lines).toEqual([]);
      expect(ordersMail(w).map((m) => m.subject)).toEqual([`Your Halden Audio order ${first?.orderNo}`]);
      // Once recorded, the cart page is the cart page again: empty.
      const after = await get("halden", "/cart", w);
      expect(after.statusCode).toBe(200);
      expect(after.body).toContain("Your cart is empty.");
      // Buying it again is the store's second order.
      const again = await atPayment("halden", [SHOAL_LITE], undefined, { shipping: "standard" }, w);
      const no = await payByIntent("halden", w, again.tok);
      expect((await repos.orders.get(w, no))?.outcomeClass).toBe("duplicate");
    });

    it("takes only what it paid for out of the cart: what the shopper added since stays there, with the code, and the order says so", async () => {
      const { w, tok } = await atPayment("halden", [SHOAL_LITE], "fixture-pe");
      const i = await intentOf("halden", w, tok);
      fake.settle(i.id, "succeed"); // paid, then the tab closed before the return URL loaded
      // The shopper goes on to another purchase before the store has heard of the payment.
      expect((await post("halden", "/cart/add", { sku: "HA-AC-CASE", qty: "1" }, w)).statusCode).toBe(303);
      const no = recoveredNoOf(await get("halden", "/cart", w), w, "halden");
      expect((await repos.orders.list(w)).map((o) => [o.orderNo, o.paymentRef, o.lines])).toEqual([[no, i.id, [SHOAL_LITE_LINE]]]);
      expect((await repos.carts.get(w, "halden")).lines).toEqual([{ sku: "HA-AC-CASE", options: {}, qty: 1 }]);
      expect((await repos.events.list(w)).find((e) => e.kind === "order_placed")?.data).toMatchObject({ token: tok, paymentRef: i.id, reconciled: true });
      // The order's page: the notice, and the way back to what is still in the cart.
      const page = (await get("halden", `/orders/${no}?recovered=1`, w)).body;
      expect(page).toContain(RECOVERED_NOTICE);
      expect(page).toContain(`<p>What you added since is still in your cart: <a href="/w/${w}/halden/cart">view your cart</a>.</p>`);
      expect((await get("halden", "/cart", w)).body).toContain("Soft Carry Case");
    });

    it("is recorded when Check out is pressed again after a hosted session was paid unseen: the shopper lands on that order", async () => {
      const { w, tok } = await atPayment("halden", [SHOAL_LITE], "fixture-co");
      const cs = await sessionOf("halden", w, tok);
      fake.settleSession(cs); // the success redirect never followed
      const res = await post("halden", "/checkout", {}, w);
      const no = recoveredNoOf(res, w, "halden"); // not the cart it paid for, emptied
      expect((await repos.orders.list(w)).map((o) => [o.orderNo, o.checkoutToken, o.paymentRef, o.outcomeClass])).toEqual([[no, tok, (await fake.getSession(cs)).paymentIntentId, "correct"]]);
      expect((await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM shops.checkouts WHERE workspace_id = $1", [w])).rows[0]?.n).toBe(1);
    });

    it("answers a script with the order and the notice instead of a redirect: Check out, and the cart drawer", async () => {
      const { w, tok } = await atPayment("halden", [SHOAL_LITE], "fixture-co");
      const cs = await sessionOf("halden", w, tok);
      fake.settleSession(cs);
      const res = await postJson("halden", "/checkout", {}, w);
      expect(res.statusCode).toBe(409);
      const [order] = await repos.orders.list(w);
      expect(res.json()).toEqual(recoveredJson(w, "halden", order?.orderNo as string));
      // The drawer (cart.json): the cart as it now stands, with the order and the notice to show.
      const d = await atPayment("halden", [SHOAL_LITE], "fixture-pe");
      const i = await intentOf("halden", d.w, d.tok);
      fake.settle(i.id, "succeed");
      expect((await post("halden", "/cart/add", { sku: "HA-AC-CASE", qty: "1" }, d.w)).statusCode).toBe(303);
      const drawer = await get("halden", "/cart.json", d.w, JSON_ACCEPT);
      expect(drawer.statusCode).toBe(200);
      const [recorded] = await repos.orders.list(d.w);
      const { error: _e, message: _m, orderNo: _n, redirect: _r, ...withOrder } = recoveredJson(d.w, "halden", recorded?.orderNo as string);
      expect(drawer.json()).toMatchObject({ count: 1, lines: [{ name: "Soft Carry Case", qty: 1 }], ...withOrder });
      // Read again: nothing new was recorded, so nothing more to tell.
      expect((await get("halden", "/cart.json", d.w, JSON_ACCEPT)).json()).not.toHaveProperty("recovered");
    });

    it("is recorded before another checkout's payment can start, and that step shows the shopper the order instead", async () => {
      const a = await atPayment("halden", [SHOAL_LITE], "fixture-pe");
      const ia = await intentOf("halden", a.w, a.tok);
      const b = await secondCheckout("halden", a.w); // open while A's payment was in flight
      fake.settle(ia.id, "succeed");
      const start = await postJson("halden", `/checkout/${b.tok}/payment/intent`, {}, a.w);
      expect(start.statusCode).toBe(409);
      const [order] = await repos.orders.list(a.w);
      expect(start.json()).toEqual(recoveredJson(a.w, "halden", order?.orderNo as string));
      expect((await repos.orders.list(a.w)).map((o) => [o.checkoutToken, o.outcomeClass])).toEqual([[a.tok, "correct"]]);
      expect(await repos.payments.ofCheckout(a.w, b.tok)).toEqual([]);
    });

    it("sends the shopper to the order from the payment step of another checkout, the card form and the hosted button", async () => {
      // The payment step of another checkout.
      const a = await atPayment("halden", [SHOAL_LITE], "fixture-pe");
      const ia = await intentOf("halden", a.w, a.tok);
      const b = await secondCheckout("halden", a.w);
      fake.settle(ia.id, "succeed");
      expect(recoveredNoOf(await get("halden", `/checkout/${b.tok}/payment`, a.w), a.w, "halden")).toBe((await repos.orders.list(a.w))[0]?.orderNo);
      // The card form, without JavaScript and with it.
      const CARD = { number: "4242 4242 4242 4242", expiry: "12/34", cvc: "123", zip: "94107" };
      const c = await atPayment("quillfeather", [HUILA]);
      const ic = await intentOf("quillfeather", c.w, c.tok);
      const d = await secondCheckout("quillfeather", c.w);
      fake.settle(ic.id, "succeed");
      const form = await post("quillfeather", `/checkout/${d.tok}/payment/fake-confirm`, CARD, c.w);
      expect(recoveredNoOf(form, c.w, "quillfeather")).toBe((await repos.orders.list(c.w))[0]?.orderNo);
      const e = await atPayment("quillfeather", [HUILA]);
      const ie = await intentOf("quillfeather", e.w, e.tok);
      const f = await secondCheckout("quillfeather", e.w);
      fake.settle(ie.id, "succeed");
      const json = await postJson("quillfeather", `/checkout/${f.tok}/payment/fake-confirm`, CARD, e.w);
      expect(json.statusCode).toBe(409);
      expect(json.json()).toEqual(recoveredJson(e.w, "quillfeather", (await repos.orders.list(e.w))[0]?.orderNo as string));
      // The form took no card of its own: the one attempt is the payment that went through unseen, taken by the store.
      expect((await repos.events.list(e.w)).filter((x) => x.kind === "payment_attempt").map((x) => x.data)).toEqual([expect.objectContaining({ token: e.tok, ref: ie.id, result: "succeeded" })]);
      // The hosted surface's button: the form, and a script.
      const g = await atPayment("halden", [SHOAL_LITE], "fixture-co");
      const cs = await sessionOf("halden", g.w, g.tok);
      const h = await secondCheckout("halden", g.w);
      fake.settleSession(cs);
      expect(recoveredNoOf(await post("halden", `/checkout/${h.tok}/payment/session`, {}, g.w), g.w, "halden")).toBe((await repos.orders.list(g.w))[0]?.orderNo);
      const k = await atPayment("halden", [SHOAL_LITE], "fixture-co");
      const ck = await sessionOf("halden", k.w, k.tok);
      const m = await secondCheckout("halden", k.w);
      fake.settleSession(ck);
      const hosted = await postJson("halden", `/checkout/${m.tok}/payment/session`, {}, k.w);
      expect(hosted.statusCode).toBe(409);
      expect(hosted.json()).toEqual(recoveredJson(k.w, "halden", (await repos.orders.list(k.w))[0]?.orderNo as string));
      expect(await repos.payments.ofCheckout(k.w, m.tok)).toEqual([]);
    });

    it("is recorded first when a later payment completes: the earlier payment is the store's first order", async () => {
      const a = await atPayment("halden", [SHOAL_LITE], "fixture-pe");
      const ia = await intentOf("halden", a.w, a.tok);
      const b = await secondCheckout("halden", a.w);
      const ib = await intentOf("halden", a.w, b.tok); // both intents exist before either goes through
      fake.settle(ia.id, "succeed");
      fake.settle(ib.id, "succeed");
      const no = orderNoOf(await complete("halden", a.w, b.tok, `payment_intent=${ib.id}`), a.w, "halden");
      expect((await repos.orders.list(a.w)).map((o) => [o.checkoutToken, o.outcomeClass])).toEqual([
        [a.tok, "correct"],
        [b.tok, "duplicate"],
      ]);
      expect((await repos.orders.get(a.w, no))?.checkoutToken).toBe(b.tok);
    });
  });

  describe("payments completing at once (finding 9)", () => {
    it("classifies exactly one of two payments of a store completing at once as its first order", async () => {
      const runs = await Promise.all(
        Array.from({ length: 4 }, async () => {
          const a = await atPayment("halden", [SHOAL_LITE], "fixture-pe");
          const b = await secondCheckout("halden", a.w);
          const ia = await intentOf("halden", a.w, a.tok);
          const ib = await intentOf("halden", a.w, b.tok);
          fake.settle(ia.id, "succeed");
          fake.settle(ib.id, "succeed");
          await Promise.all([complete("halden", a.w, a.tok, `payment_intent=${ia.id}`), complete("halden", a.w, b.tok, `payment_intent=${ib.id}`)]);
          return (await repos.orders.list(a.w)).map((o) => o.outcomeClass);
        }),
      );
      for (const classes of runs) expect(classes).toEqual(["correct", "duplicate"]);
    });
  });

  describe("the price update and two Pay presses (finding 10)", () => {
    const CARD = { number: "4242 4242 4242 4242", expiry: "12/34", cvc: "123", zip: "94107" };
    const HUILA_LINE: CartLine = { sku: "QF-COL-HUILA", options: { size: "12oz", grind: "whole-bean" }, qty: 1, mode: "once" };
    const before = () => totalsOf("quillfeather", [HUILA_LINE]).totalCents;

    it("lets neither of two simultaneous presses pay: both show the update, and the next press pays the new total", async () => {
      const { w, tok } = await atPayment("quillfeather", [HUILA], "fixture-price");
      const confirm = (form: Form = CARD) => post("quillfeather", `/checkout/${tok}/payment/fake-confirm`, form, w);
      const updated = `/w/${w}/quillfeather/checkout/${tok}/payment?updated=1`;
      // Both presses carry the total their page showed, as fake-pay.js and the no-JavaScript form do: whichever
      // reaches the store second — overlapping the first or just after it — still shows the old total.
      const shownBefore = { ...CARD, shownCents: String(before()) };
      const [a, b] = await Promise.all([confirm(shownBefore), confirm(shownBefore)]);
      expect([a.headers.location, b.headers.location]).toEqual([updated, updated]);
      expect((await repos.events.list(w)).filter((e) => e.kind === "price_updated")).toHaveLength(1);
      expect(await repos.orders.countPaid(w, "quillfeather")).toBe(0);
      const paid = await confirm({ ...CARD, shownCents: String(before() + 777) });
      expect(paid.headers.location).toMatch(/\/complete\?payment_intent=pi_fake_[0-9a-z]+$/);
      const no = orderNoOf(await get("quillfeather", unprefixed(paid, w, "quillfeather"), w), w, "quillfeather");
      expect((await repos.orders.get(w, no))?.chargedCents).toBe(before() + 777);
      // Two tabs' intent calls at once: neither gets a payment to confirm.
      const t = await atPayment("quillfeather", [HUILA], "fixture-price");
      const both = await Promise.all([postJson("quillfeather", `/checkout/${t.tok}/payment/intent`, {}, t.w), postJson("quillfeather", `/checkout/${t.tok}/payment/intent`, {}, t.w)]);
      for (const r of both) {
        expect(r.statusCode).toBe(200);
        expect(r.json()).toMatchObject({ priceUpdated: { oldCents: before(), newCents: before() + 777 } });
        expect(r.json()).not.toHaveProperty("clientSecret");
      }
    });

    it("does not pay a form posted again with the total it showed before the update (a double submit without JavaScript)", async () => {
      const { w, tok } = await atPayment("quillfeather", [HUILA], "fixture-price");
      const shownOn = async (q = "") => /name="shownCents" value="(\d+)"/.exec((await get("quillfeather", `/checkout/${tok}/payment${q}`, w)).body)?.[1];
      const shown = await shownOn();
      expect(shown).toBe(String(before()));
      const form = { ...CARD, shownCents: shown as string };
      const updated = `/w/${w}/quillfeather/checkout/${tok}/payment?updated=1`;
      expect((await post("quillfeather", `/checkout/${tok}/payment/fake-confirm`, form, w)).headers.location).toBe(updated);
      expect((await post("quillfeather", `/checkout/${tok}/payment/fake-confirm`, form, w)).headers.location).toBe(updated);
      expect(await repos.orders.countPaid(w, "quillfeather")).toBe(0);
      const now = await shownOn("?updated=1");
      expect(now).toBe(String(before() + 777));
      const paid = await post("quillfeather", `/checkout/${tok}/payment/fake-confirm`, { ...form, shownCents: now as string }, w);
      expect(paid.headers.location).toMatch(/\/complete\?payment_intent=/);
      // The hosted surface's form carries what it shows too.
      const hosted = await atPayment("halden", [SHOAL_LITE], "fixture-co");
      expect((await get("halden", `/checkout/${hosted.tok}/payment`, hosted.w)).body).toContain(`name="shownCents" value="${totalsOf("halden", [SHOAL_LITE_LINE]).totalCents}"`);
    });
  });

  describe("a slow processor (no connection held while it answers)", () => {
    it("lets every other page answer while payments wait on the processor, and the payments finish once it answers", async () => {
      // A pool of two: a payment step holding a connection while it waited would leave none for anyone else.
      const small = createPool(DB as string, 2);
      const slow = new SlowGateway();
      const slowApp = await buildShops({ ...base, pool: small, payments: slow });
      try {
        const runs = await Promise.all(Array.from({ length: 4 }, () => atPayment("wrenfield", [MEADOW], undefined, { shipping: "standard" }, undefined, slowApp)));
        slow.hold();
        const paying = runs.map((r) => postJson("wrenfield", `/checkout/${r.tok}/payment/intent`, {}, r.w, slowApp));
        await new Promise((r) => setTimeout(r, 300));
        const within = <T>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<"still waiting">((r) => setTimeout(() => r("still waiting"), ms))]);
        const other = await newWorkspace();
        const home = await within(get("wrenfield", "/", other, {}, slowApp), 2_000);
        expect(home === "still waiting" ? home : home.statusCode).toBe(200);
        const cart = await within(get("halden", "/cart", other, {}, slowApp), 2_000);
        expect(cart === "still waiting" ? cart : cart.statusCode).toBe(200);
        expect(slow.waiting).toBe(4); // all four are waiting on the processor, none on the pool
        slow.release();
        for (const r of await Promise.all(paying)) expect(r.statusCode, r.body.slice(0, 200)).toBe(200);
      } finally {
        slow.release();
        await slowApp.close();
        await small.end();
      }
    }, 20_000);
  });

  describe("the delivery date (finding 11)", () => {
    it("is graded against the store-local day the information step was accepted on, not the day payment completes", async () => {
      datedClock = new Date("2026-10-08T06:55:00Z"); // 11:55 pm on Wednesday, October 7, Pacific
      try {
        const { w, tok } = await atPayment("wrenfield", [MEADOW], "fixture-dated", { shipping: "standard" }, undefined, datedApp, { deliveryDate: "2026-10-10" });
        datedClock = new Date("2026-10-08T07:03:00Z"); // 12:03 am on Thursday, October 8
        const i = await intentOf("wrenfield", w, tok, datedApp);
        fake.settle(i.id, "succeed");
        const no = orderNoOf(await complete("wrenfield", w, tok, `payment_intent=${i.id}`, datedApp), w, "wrenfield");
        expect((await repos.orders.get(w, no))?.outcomeClass).toBe("correct");
        expect(no.endsWith(`-${suffixTable(KEY, "fixture-dated").correct}`)).toBe(true);
        expect((await repos.payments.get(w, i.id))?.snapshot.informationDate).toBe("2026-10-07");
      } finally {
        datedClock = MORNING;
      }
    });
  });

  describe("the delivery date, checked again when the payment starts (store-local now)", () => {
    const CARD = { number: "4242 4242 4242 4242", expiry: "12/34", cvc: "123", zip: "94107" };
    const infoBack = (w: string, tok: string) => `/w/${w}/wrenfield/checkout/${tok}/information?recheck=delivery`;
    const attemptsIn = async (w: string) => (await repos.events.list(w)).filter((e) => e.kind === "payment_attempt");

    it("sends a same-day delivery back to the information step once same-day delivery has closed: no intent, no card taken", async () => {
      datedClock = MORNING; // 10 am PDT on Wednesday, October 7: same-day delivery open
      try {
        const { w, tok } = await atPayment("wrenfield", [MEADOW], undefined, { shipping: "standard" }, undefined, datedApp, { deliveryDate: "2026-10-07" });
        expect((await repos.checkouts.get(w, tok))?.delivery).toMatchObject({ date: "2026-10-07", sameDay: true });
        datedClock = new Date("2026-10-07T21:30:00Z"); // 2:30 pm PDT: same-day delivery has closed
        const back = infoBack(w, tok);
        // The payment step itself sends the shopper back.
        const step = await get("wrenfield", `/checkout/${tok}/payment`, w, {}, datedApp);
        expect(step.statusCode).toBe(303);
        expect(step.headers.location).toBe(back);
        // pay.js's intent call: refused before any intent exists, with the way back.
        const intent = await postJson("wrenfield", `/checkout/${tok}/payment/intent`, {}, w, datedApp);
        expect(intent.statusCode).toBe(409);
        expect(intent.json()).toEqual({
          error: "DELIVERY_DATE",
          message: "Same-day delivery closed at 2 pm Pacific, so we can no longer deliver today, Wednesday, October 7. Choose tomorrow or a later date to continue.",
          redirect: back,
        });
        // The card form refuses likewise, with JavaScript and without: no card is read, no attempt made.
        const json = await postJson("wrenfield", `/checkout/${tok}/payment/fake-confirm`, CARD, w, datedApp);
        expect(json.statusCode).toBe(409);
        expect(json.json()).toMatchObject({ error: "DELIVERY_DATE", redirect: back });
        const form = await post("wrenfield", `/checkout/${tok}/payment/fake-confirm`, CARD, w, {}, datedApp);
        expect(form.statusCode).toBe(303);
        expect(form.headers.location).toBe(back);
        expect(await repos.payments.ofCheckout(w, tok)).toEqual([]);
        expect(await attemptsIn(w)).toEqual([]);
        // The information step says why, on the date field, and offers tomorrow.
        const info = await get("wrenfield", `/checkout/${tok}/information?recheck=delivery`, w, {}, datedApp);
        expect(info.statusCode).toBe(200);
        expect(info.body).toContain("Same-day delivery closed at 2 pm Pacific, so we can no longer deliver today, Wednesday, October 7.");
        expect(info.body).toMatch(/<input[^>]*name="deliveryDate"[^>]*value="2026-10-08"[^>]*aria-invalid="true"/);
        expect(info.body).toContain("Please correct the field below.");
        // A new date, and the payment goes ahead.
        expect((await post("wrenfield", `/checkout/${tok}/information`, { ...ADDR, deliveryDate: "2026-10-08" }, w, {}, datedApp)).statusCode).toBe(303);
        expect((await post("wrenfield", `/checkout/${tok}/shipping`, { shipping: "standard" }, w, {}, datedApp)).statusCode).toBe(303);
        expect((await get("wrenfield", `/checkout/${tok}/information?recheck=delivery`, w, {}, datedApp)).body).not.toContain("Please correct");
        expect((await get("wrenfield", `/checkout/${tok}/payment`, w, {}, datedApp)).statusCode).toBe(200);
        const i = await intentOf("wrenfield", w, tok, datedApp);
        fake.settle(i.id, "succeed");
        const no = orderNoOf(await complete("wrenfield", w, tok, `payment_intent=${i.id}`, datedApp), w, "wrenfield");
        expect((await repos.orders.get(w, no))?.details.delivery).toMatchObject({ date: "2026-10-08", sameDay: false });
      } finally {
        datedClock = MORNING;
      }
    });

    it("sends a date that has passed back to the information step: the intent made before is left as it was", async () => {
      datedClock = MORNING;
      try {
        const { w, tok } = await atPayment("wrenfield", [MEADOW], undefined, { shipping: "standard" }, undefined, datedApp, { deliveryDate: "2026-10-08" });
        const before = await intentOf("wrenfield", w, tok, datedApp); // the payment step opened on Wednesday
        datedClock = new Date("2026-10-09T17:00:00Z"); // 10 am PDT on Friday, October 9: Thursday's delivery has passed
        // The cart changes too: a refused attempt does not bring the intent up to the new total either.
        const key = JSON.stringify(["WF-BQ-MEADOW-SONG", "size=classic", "once", ""]);
        expect((await post("wrenfield", "/cart/update", { key, qty: "2" }, w, {}, datedApp)).statusCode).toBe(303);
        const back = infoBack(w, tok);
        const intent = await postJson("wrenfield", `/checkout/${tok}/payment/intent`, {}, w, datedApp);
        expect(intent.statusCode).toBe(409);
        expect(intent.json()).toEqual({
          error: "DELIVERY_DATE",
          message: "Your delivery date, Thursday, October 8, has passed. Choose a new delivery date to continue.",
          redirect: back,
        });
        expect(fake.inspect(before.id).amountCents).toBe(before.amountCents);
        expect((await repos.payments.ofCheckout(w, tok)).map((p) => [p.ref, p.amountCents])).toEqual([[before.id, before.amountCents]]);
        expect((await get("wrenfield", `/checkout/${tok}/payment`, w, {}, datedApp)).headers.location).toBe(back);
        const info = (await get("wrenfield", `/checkout/${tok}/information?recheck=delivery`, w, {}, datedApp)).body;
        expect(info).toContain("Your delivery date, Thursday, October 8, has passed.");
        expect(info).toMatch(/<input[^>]*name="deliveryDate"[^>]*value="2026-10-10"/);
      } finally {
        datedClock = MORNING;
      }
    });

    it("on the hosted surface: no session is made for a date that can no longer be delivered", async () => {
      datedClock = MORNING;
      try {
        const { w, tok } = await atPayment("wrenfield", [MEADOW], "fixture-dated-hosted", { shipping: "standard" }, undefined, datedApp, { deliveryDate: "2026-10-07" });
        expect((await get("wrenfield", `/checkout/${tok}/payment`, w, {}, datedApp)).body).toContain('data-surface="checkout"');
        datedClock = new Date("2026-10-07T22:00:00Z"); // 3 pm PDT
        const back = infoBack(w, tok);
        const form = await post("wrenfield", `/checkout/${tok}/payment/session`, {}, w, {}, datedApp);
        expect(form.statusCode).toBe(303);
        expect(form.headers.location).toBe(back);
        const json = await postJson("wrenfield", `/checkout/${tok}/payment/session`, {}, w, datedApp);
        expect(json.statusCode).toBe(409);
        expect(json.json()).toMatchObject({ error: "DELIVERY_DATE", redirect: back });
        expect(await repos.payments.ofCheckout(w, tok)).toEqual([]);
        expect((await repos.events.list(w)).filter((e) => e.kind === "session_created")).toEqual([]);
        // Tomorrow is still a date it delivers on: the session is made.
        expect((await post("wrenfield", `/checkout/${tok}/information`, { ...ADDR, deliveryDate: "2026-10-08" }, w, {}, datedApp)).statusCode).toBe(303);
        expect((await post("wrenfield", `/checkout/${tok}/shipping`, { shipping: "standard" }, w, {}, datedApp)).statusCode).toBe(303);
        const ok = await post("wrenfield", `/checkout/${tok}/payment/session`, {}, w, {}, datedApp);
        expect(ok.headers.location).toMatch(/\/fake-pay\/session\/cs_fake_[0-9a-z]+$/);
      } finally {
        datedClock = MORNING;
      }
    });
  });

  describe("Stripe mode", () => {

    it("serves a payment page whose HTML, scripts and stylesheets say nothing of fake payments, test cards, scenarios or fixtures", async () => {
      // "Test payment": the badge of the store's own card form, whose script fake mode alone loads.
      const TELLS = /fake|test card|test payment|scenario|fixture/i;
      for (const [site, add] of [["wrenfield", MEADOW], ["quillfeather", HUILA], ["halden", SHOAL_LITE]] as const) {
        const { w, tok } = await atPayment(site, [add], undefined, { shipping: "standard" }, undefined, stripeApp);
        const html = (await get(site, `/checkout/${tok}/payment`, w, {}, stripeApp)).body;
        expect(html, site).not.toMatch(TELLS);
        const local = [...html.matchAll(/<(?:script|link)\b[^>]*\s(?:src|href)="(\/[^"]+)"/g)].map((m) => m[1] as string);
        const files = local.map((u) => u.replace(/^.*\/assets\//, "").replace(/\?.*$/, ""));
        expect(files.filter((f) => f.endsWith(".js")), site).toEqual(["js/store.js", "js/pay.js"]);
        expect(files.filter((f) => f.endsWith(".css")), site).toEqual(["css/base.css", "css/checkout.css", `css/${site}.css`]);
        for (const u of local) {
          const res = await get(site, u.replace(`/w/${w}/${site}`, ""), w, {}, stripeApp);
          expect(res.statusCode, u).toBe(200);
          expect(res.body, u).not.toMatch(TELLS);
        }
      }
    });

    it("leaves the card form's own script to fake mode, on the payment step that shows the card form, before pay.js", async () => {
      const FAKE_JS = "/assets/js/fake-pay.js";
      const card = await atPayment("quillfeather", [HUILA]);
      const html = (await get("quillfeather", `/checkout/${card.tok}/payment`, card.w)).body;
      expect(html).toMatch(new RegExp(`<script src="/w/${card.w}/quillfeather${FAKE_JS}(?:\\?v=[0-9a-z]+)?" defer></script>`));
      expect(html.indexOf(FAKE_JS)).toBeLessThan(html.indexOf("/assets/js/pay.js"));
      for (const page of [`/checkout/${card.tok}/information`, `/checkout/${card.tok}/shipping`, "/cart"]) expect((await get("quillfeather", page, card.w)).body, page).not.toContain(FAKE_JS);
      const hosted = await atPayment("halden", [SHOAL_LITE]); // no card form on the hosted surface's step
      expect((await get("halden", `/checkout/${hosted.tok}/payment`, hosted.w)).body).not.toContain(FAKE_JS);
      const s = await atPayment("quillfeather", [HUILA], undefined, { shipping: "standard" }, undefined, stripeApp);
      expect((await get("quillfeather", `/checkout/${s.tok}/payment`, s.w, {}, stripeApp)).body).not.toContain(FAKE_JS);
    });

    it("keeps the fake mode's endpoints out of the payment page: nothing on it says fake (finding 15)", async () => {
      const { w, tok } = await atPayment("quillfeather", [HUILA], undefined, { shipping: "standard" }, undefined, stripeApp);
      const html = (await get("quillfeather", `/checkout/${tok}/payment`, w, {}, stripeApp)).body;
      expect(html).not.toMatch(/fake/i);
      const cfg = configOf(html);
      expect(Object.keys(cfg.urls).sort()).toEqual(["complete", "intent", "report", "returnUrl"]);
      expect(cfg.urls.report).toBe(`/w/${w}/quillfeather/checkout/${tok}/payment/report`);
      // Fake mode keeps its card form's endpoints, and has nothing to report.
      const f = await atPayment("quillfeather", [HUILA]);
      const fakeCfg = configOf((await get("quillfeather", `/checkout/${f.tok}/payment`, f.w)).body);
      expect(fakeCfg.urls).toMatchObject({ confirm: `/w/${f.w}/quillfeather/checkout/${f.tok}/payment/fake-confirm`, authenticate: `/w/${f.w}/quillfeather/checkout/${f.tok}/payment/authenticate` });
      expect(fakeCfg.urls).not.toHaveProperty("report");
    });

    it("logs the attempts the browser reports as Stripe has them, in fake mode's words, once each (finding 8)", async () => {
      const { w, tok } = await atPayment("quillfeather", [HUILA], undefined, { shipping: "standard" }, undefined, stripeApp);
      const i = await intentOf("quillfeather", w, tok, stripeApp);
      const report = (body: object, ws = w, t = tok) => postJson("quillfeather", `/checkout/${t}/payment/report`, body, ws, stripeApp);
      const attempts = async () => (await repos.events.list(w)).filter((e) => e.kind === "payment_attempt").map((e) => e.data);
      expect((await report({ payment_intent: i.id })).json()).toMatchObject({ recorded: false }); // nothing was tried yet
      stripeFake.settle(i.id, "decline");
      // The browser's word on the outcome is not taken: Stripe's is.
      const declined = await report({ payment_intent: i.id, status: "succeeded" });
      expect(declined.statusCode).toBe(200);
      expect(declined.json()).toMatchObject({ recorded: true, status: "requires_payment_method", error: "Your card was declined." });
      stripeFake.settle(i.id, "require_action");
      expect((await report({ payment_intent: i.id })).json()).toMatchObject({ recorded: true, status: "requires_action" });
      // Reported again: on record already, logged once.
      expect((await report({ payment_intent: i.id })).json()).toMatchObject({ recorded: true, status: "requires_action" });
      const [charge] = await stripeFake.charges(i.id);
      const waiting = (await stripeFake.getIntent(i.id)).attemptMethod;
      expect(await attempts()).toEqual([
        { token: tok, ref: i.id, result: "declined", attempt: charge?.id },
        { token: tok, ref: i.id, result: "requires_action", attempt: waiting },
      ]);
      // The shopper fails the bank's step (Stripe makes no charge for it): logged by its card. Without an id: the checkout's own intent.
      stripeFake.settle(i.id, "fail_authentication");
      expect((await report({})).json()).toMatchObject({ recorded: true, status: "requires_payment_method", error: AUTHENTICATION_FAILED });
      expect((await attempts()).at(-1)).toEqual({ token: tok, ref: i.id, result: "authentication_failed", attempt: waiting });
      // Another workspace's checkout cannot report this payment; an unknown one is not found.
      const other = await atPayment("quillfeather", [HUILA], undefined, { shipping: "standard" }, undefined, stripeApp);
      expect((await report({ payment_intent: i.id }, other.w, other.tok)).statusCode).toBe(400);
      expect((await report({ payment_intent: "pi_fake_000000000000000000000000" })).statusCode).toBe(404);
      expect(await attempts()).toHaveLength(3);
      // A payment that went through: logged as Stripe has it, and the shopper is sent on to its completion.
      stripeFake.settle(i.id, "succeed");
      expect((await report({ payment_intent: i.id })).json()).toMatchObject({ status: "succeeded", redirect: `/w/${w}/quillfeather/checkout/${tok}/complete?payment_intent=${i.id}` });
      expect((await attempts()).map((a) => (a as { result: string }).result)).toEqual(["declined", "requires_action", "authentication_failed", "succeeded"]);
      // Fake mode logs its own attempts: no report endpoint there.
      const f = await atPayment("quillfeather", [HUILA]);
      expect((await postJson("quillfeather", `/checkout/${f.tok}/payment/report`, {}, f.w)).statusCode).toBe(404);
    });
  });

  describe("Stripe mode: the attempts Stripe recorded, in fake mode's words", () => {
    const attemptsIn = async (w: string) => (await repos.events.list(w)).filter((e) => e.kind === "payment_attempt").map((e) => e.data);

    it("logs a decline and then the card that paid, once each, when the payment completes — before its order", async () => {
      const { w, tok } = await atPayment("quillfeather", [HUILA], undefined, { shipping: "standard" }, undefined, stripeApp);
      const i = await intentOf("quillfeather", w, tok, stripeApp);
      stripeFake.settle(i.id, "decline"); // the browser never reported it
      stripeFake.settle(i.id, "succeed");
      const [declined, paid] = await stripeFake.charges(i.id);
      const first = await complete("quillfeather", w, tok, `payment_intent=${i.id}`, stripeApp);
      orderNoOf(first, w, "quillfeather");
      expect((await complete("quillfeather", w, tok, `payment_intent=${i.id}`, stripeApp)).headers.location).toBe(first.headers.location);
      expect(await attemptsIn(w)).toEqual([
        { token: tok, ref: i.id, result: "declined", attempt: declined?.id },
        { token: tok, ref: i.id, result: "succeeded", attempt: paid?.id },
      ]);
      const kinds = (await repos.events.list(w)).map((e) => e.kind);
      expect(kinds.indexOf("order_placed")).toBeGreaterThan(kinds.lastIndexOf("payment_attempt"));
    });

    it("logs a 3-D Secure card as fake mode does — asked, then authenticated — and a declined completion too", async () => {
      const { w, tok } = await atPayment("wrenfield", [MEADOW], undefined, { shipping: "standard" }, undefined, stripeApp);
      const i = await intentOf("wrenfield", w, tok, stripeApp);
      stripeFake.settle(i.id, "decline");
      // A completion the bank declined (a redirect back from it): logged, no order.
      expect((await complete("wrenfield", w, tok, `payment_intent=${i.id}`, stripeApp)).headers.location).toMatch(/\/payment\?error=/);
      stripeFake.settle(i.id, "require_action");
      const waiting = (await stripeFake.getIntent(i.id)).attemptMethod;
      stripeFake.settle(i.id, "succeed"); // the shopper completed the bank's step
      orderNoOf(await complete("wrenfield", w, tok, `payment_intent=${i.id}`, stripeApp), w, "wrenfield");
      const charges = await stripeFake.charges(i.id);
      expect(await attemptsIn(w)).toEqual([
        { token: tok, ref: i.id, result: "declined", attempt: charges[0]?.id },
        { token: tok, ref: i.id, result: "requires_action", attempt: waiting },
        { token: tok, ref: i.id, result: "authenticated", attempt: charges[1]?.id },
      ]);
    });

    it("logs a hosted session's attempts under the session, as fake mode's hosted page does", async () => {
      const { w, tok } = await atPayment("halden", [SHOAL_LITE], undefined, { shipping: "standard" }, undefined, stripeApp);
      const cs = await sessionOf("halden", w, tok, stripeApp);
      stripeFake.settleSession(cs, "decline");
      stripeFake.settleSession(cs);
      orderNoOf(await complete("halden", w, tok, `session_id=${cs}`, stripeApp), w, "halden");
      const [declined, paid] = await stripeFake.charges((await stripeFake.getSession(cs)).paymentIntentId as string);
      expect(await attemptsIn(w)).toEqual([
        { token: tok, ref: cs, result: "declined", attempt: declined?.id },
        { token: tok, ref: cs, result: "succeeded", attempt: paid?.id },
      ]);
    });

    it("logs the attempts of payments the browser never came back from when the store reconciles them: one paid, one only declined", async () => {
      const a = await atPayment("halden", [SHOAL_LITE], undefined, { shipping: "standard" }, undefined, stripeApp);
      const cs = await sessionOf("halden", a.w, a.tok, stripeApp);
      stripeFake.settleSession(cs, "decline"); // declined on Stripe's page, then the shopper left it
      expect((await get("halden", "/cart", a.w, {}, stripeApp)).statusCode).toBe(200);
      const pi = (await stripeFake.getSession(cs)).paymentIntentId as string;
      const [declined] = await stripeFake.charges(pi);
      expect(await attemptsIn(a.w)).toEqual([{ token: a.tok, ref: cs, result: "declined", attempt: declined?.id }]);
      // Read again by the next page: nothing new, nothing logged twice.
      expect((await get("halden", "/cart", a.w, {}, stripeApp)).statusCode).toBe(200);
      expect(await attemptsIn(a.w)).toHaveLength(1);
      // Paid on the page after all, and the success redirect never followed: the order and the attempt, at the next page —
      // which shows the shopper that order.
      stripeFake.settleSession(cs);
      const no = recoveredNoOf(await get("halden", "/cart", a.w, {}, stripeApp), a.w, "halden");
      expect((await repos.orders.list(a.w)).map((o) => [o.orderNo, o.paymentRef])).toEqual([[no, pi]]);
      expect((await attemptsIn(a.w)).map((e) => (e as { result: string }).result)).toEqual(["declined", "succeeded"]);
    });

    it("logs nothing from the processor in fake mode: its card pages log their own attempts", async () => {
      const { w, tok } = await atPayment("quillfeather", [HUILA]);
      await intentOf("quillfeather", w, tok);
      await post("quillfeather", `/checkout/${tok}/payment/fake-confirm`, { number: "4000000000000002", expiry: "12/34", cvc: "123", zip: "94107" }, w);
      await post("quillfeather", `/checkout/${tok}/payment/fake-confirm`, { number: "4242424242424242", expiry: "12/34", cvc: "123", zip: "94107" }, w);
      const i = (await repos.payments.currentIntent(w, tok))?.ref as string;
      orderNoOf(await complete("quillfeather", w, tok, `payment_intent=${i}`), w, "quillfeather");
      const [, paid] = await fake.charges(i);
      expect(await attemptsIn(w)).toEqual([
        { token: tok, ref: i, result: "declined" },
        // The card that paid, logged when the store took the authorized payment — once, by its charge.
        { token: tok, ref: i, result: "succeeded", attempt: paid?.id },
      ]);
    });
  });
});
