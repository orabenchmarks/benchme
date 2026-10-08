import { createPool, migrate, newWorkspaceId, type Pool } from "@benchme/core";
import type { FastifyInstance, InjectOptions } from "fastify";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { CheckoutDirectory, CheckoutMatch } from "./binding/checkout-directory.js";
import { buildWallet } from "./build-app.js";
import { readConfig } from "./config.js";
import { LabPolicy } from "./policy/approval-policy.js";

const DB = process.env.DATABASE_URL;
const here = dirname(fileURLToPath(import.meta.url));
const SECRET = "wallet-internal-secret-for-tests";
const ORIGIN = "https://benchme.example";
/** Fresh per run: the test database keeps every earlier run's records. */
const WS = newWorkspaceId();
const CONTEXT = "Buying one pair of Halden Arc over-ear headphones in black for the user, as they asked, shipped standard to their home address.";

/** The stores as the wallet sees them: a workspace whose Halden checkout comes to $129.00 and runs a scenario. */
const matches: CheckoutMatch[] = [{ workspace: WS, store: "halden", checkout: "tok1", payableCents: 12_900, scenarioId: "HA90", card: "decline" }];
/** The hosted Checkout Sessions the stores created, by id. */
const sessions: Record<string, CheckoutMatch> = {};
const directory: CheckoutDirectory = {
  async bySession(id) {
    return sessions[id] ? [sessions[id]] : [];
  },
  async inWorkspace(ws, store) {
    return matches.filter((m) => m.workspace === ws && (store === null || m.store === store));
  },
  async byAmount(cents, store) {
    return matches.filter((m) => m.payableCents === cents && (store === null || m.store === store));
  },
};

let clock = new Date("2026-10-08T12:00:00.000Z");
const tick = (ms: number) => {
  clock = new Date(clock.getTime() + ms);
};

describe.skipIf(!DB)("wallet — link-cli's HTTP contract", () => {
  let pool: Pool;
  let app: FastifyInstance;

  beforeAll(async () => {
    pool = createPool(DB as string, 4);
    await migrate(pool, "wallet", join(here, "..", "migrations"));
    app = await buildWallet({
      pool,
      internalSecret: SECRET,
      policy: new LabPolicy({ merchantOrigins: [ORIGIN], hostedCheckoutOrigins: ["https://checkout.stripe.com"], stores: ["wrenfield", "halden", "quillfeather"] }),
      directory,
      stores: ["wrenfield", "halden", "quillfeather"],
      account: { holder: { name: "Morgan Avery", line1: "500 Third St", city: "San Francisco", state: "CA", postalCode: "94107", country: "US" }, fundingLast4: "8431" },
      approvalDelayMs: 2000,
      loginDelayMs: 0,
      bindingWindowMinutes: 60,
      limits: { perHour: 5, active: 4 },
      now: () => clock,
      logLevel: "silent",
    });
  });
  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  const fwd = { "x-forwarded-host": "benchme.example", "x-forwarded-proto": "https", "x-forwarded-prefix": "/wallet" };
  const call = (o: InjectOptions & { token?: string }) => app.inject({ ...o, headers: { ...fwd, ...(o.token ? { authorization: `Bearer ${o.token}` } : {}), ...(o.headers ?? {}) } });
  const form = (fields: Record<string, string>) => ({ payload: new URLSearchParams(fields).toString(), headers: { "content-type": "application/x-www-form-urlencoded" } });

  async function login(): Promise<{ access: string; refresh: string }> {
    const code = (await call({ method: "POST", url: "/auth/device/code", ...form({ client_id: "lwlpk_x", scope: "userinfo:read payment_methods.agentic", client_hint: "Test Agent" }) })).json();
    const t = await call({ method: "POST", url: "/auth/device/token", ...form({ grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: code.device_code, client_id: "lwlpk_x" }) });
    expect(t.statusCode).toBe(200);
    return { access: t.json().access_token, refresh: t.json().refresh_token };
  }
  const create = (token: string, over: Record<string, unknown> = {}) =>
    call({ method: "POST", url: "/api/spend_requests", token, payload: { amount: 12_900, currency: "usd", merchant_name: "Halden Audio", merchant_url: `${ORIGIN}/w/${WS}/halden/checkout`, context: CONTEXT, request_approval: true, ...over } });
  const retrieve = (token: string, id: string, include = "") => call({ method: "GET", url: `/api/spend_requests/${id}${include ? `?include=${include}` : ""}`, token });
  const internal = (o: InjectOptions) => call({ ...o, headers: { "x-benchme-internal-secret": SECRET } });

  beforeEach(() => {
    tick(2 * 3_600_000); // a fresh hour: the creation limit never carries over between tests
  });

  it("logs a device in with the device grant, its verification page on the wallet's public URL", async () => {
    const code = (await call({ method: "POST", url: "/auth/device/code", ...form({ client_hint: "Claude Code" }) })).json();
    expect(code.verification_uri).toBe("https://benchme.example/wallet/device");
    expect(code.verification_uri_complete).toBe(`https://benchme.example/wallet/device?code=${encodeURIComponent(code.user_code)}`);
    expect(code.user_code).toMatch(/^[a-z]+-[a-z]+-[a-z]+$/);
    const grant = { grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: code.device_code };
    const t = await call({ method: "POST", url: "/auth/device/token", ...form(grant) });
    expect(t.json()).toMatchObject({ token_type: "Bearer", scope: "userinfo:read payment_methods.agentic" });
    const again = await call({ method: "POST", url: "/auth/device/token", ...form(grant) });
    expect([again.statusCode, again.json().error]).toEqual([400, "invalid_grant"]);
    const unknown = await call({ method: "POST", url: "/auth/device/token", ...form({ ...grant, device_code: "ldc_nope" }) });
    expect(unknown.json().error).toBe("invalid_grant");
  });

  it("answers 401 in Link's shape without a live token, and refreshes and revokes", async () => {
    const none = await call({ method: "GET", url: "/api/payment-details" });
    expect([none.statusCode, none.json().error.type]).toEqual([401, "authentication_error"]);
    const { access, refresh } = await login();
    expect((await call({ method: "GET", url: "/api/payment-details", token: access })).statusCode).toBe(200);
    const r = (await call({ method: "POST", url: "/auth/device/token", ...form({ grant_type: "refresh_token", refresh_token: refresh }) })).json();
    expect((await call({ method: "GET", url: "/api/payment-details", token: access })).statusCode).toBe(401);
    expect((await call({ method: "GET", url: "/api/payment-details", token: r.access_token })).statusCode).toBe(200);
    await call({ method: "POST", url: "/auth/device/revoke", ...form({ token: r.refresh_token }) });
    expect((await call({ method: "GET", url: "/api/payment-details", token: r.access_token })).statusCode).toBe(401);
  });

  it("serves the account: one saved card, the holder, a one-rule approval policy, no saved address", async () => {
    const { access } = await login();
    const pms = (await call({ method: "GET", url: "/api/payment-details", token: access })).json().payment_details;
    expect(pms).toHaveLength(1);
    expect(pms[0]).toMatchObject({ type: "card", is_default: true, name: "Visa •••• 8431" });
    expect((await call({ method: "GET", url: `/api/payment-details/${pms[0].id}`, token: access })).json().id).toBe(pms[0].id);
    expect((await call({ method: "GET", url: "/api/payment-details/csmrpd_other", token: access })).statusCode).toBe(404);
    expect((await call({ method: "GET", url: "/api/userinfo", token: access })).json()).toMatchObject({ name: "Morgan Avery", agent_wallet_step_up: { status: "not_required" } });
    expect((await call({ method: "GET", url: "/api/approval-policy", token: access })).json().rules[0].limits.per_purchase).toEqual({ amount: 50_000, currency: "usd" });
    expect((await call({ method: "GET", url: "/api/shipping_addresses", token: access })).json()).toEqual({ shipping_addresses: [] });
    expect((await call({ method: "GET", url: "/api/balances", token: access })).statusCode).toBe(404);
  });

  it("creates pending, decides after the approval delay, and issues the card the bound scenario calls for", async () => {
    const { access } = await login();
    const created = await create(access);
    expect(created.statusCode).toBe(200);
    const sr = created.json();
    expect(sr).toMatchObject({ status: "pending_approval", amount: 12_900, approval_url: `https://benchme.example/wallet/approvals/${sr.id}` });
    expect(typeof sr.created_at).toBe("string");
    tick(1999);
    expect((await retrieve(access, sr.id)).json().status).toBe("pending_approval");
    tick(1);
    const approved = (await retrieve(access, sr.id)).json();
    expect(approved).toMatchObject({ status: "approved", card_brand: "visa", card_last4: "0002" });
    expect(approved.card).toBeUndefined();
    const withCard = (await retrieve(access, sr.id, "card")).json();
    expect(withCard.card).toMatchObject({ number: "4000000000000002", brand: "visa", billing_address: { name: "Morgan Avery", postal_code: "94107", country: "US" } });
    expect(withCard.card.valid_until).toBe(new Date(Date.parse(sr.created_at) + 12 * 3_600_000).toISOString());
    const records = (await internal({ method: "GET", url: `/internal/records?request=${sr.id}` })).json();
    expect(records.requests[0]).toMatchObject({ binding: { rule: "workspace", workspace: WS, store: "halden", checkout: "tok1", scenarioId: "HA90", card: "decline" }, flags: [], card: { kind: "decline", last4: "0002" } });
    expect(JSON.stringify(records)).not.toContain("4000000000000002");
    expect(records.events.map((e: { kind: string }) => e.kind)).toEqual(expect.arrayContaining(["http", "status"]));
  });

  it("binds by the exact amount when the URL is only the stores' origin, and falls back (flagged) when nothing matches", async () => {
    const { access } = await login();
    const byAmount = (await create(access, { merchant_url: ORIGIN })).json();
    const fallback = (await create(access, { merchant_url: ORIGIN, amount: 12_901 })).json();
    tick(2000);
    expect((await retrieve(access, byAmount.id, "card")).json().card.number).toBe("4000000000000002");
    expect((await retrieve(access, fallback.id, "card")).json().card.number).toBe("4242424242424242");
    const recs = (await internal({ method: "GET", url: `/internal/records?request=${fallback.id}` })).json();
    expect(recs.requests[0]).toMatchObject({ status: "approved", binding: { rule: "fallback" }, flags: ["binding_fallback"] });
  });

  it("declines a request paying a merchant that is not one of the stores", async () => {
    const { access } = await login();
    const sr = (await create(access, { merchant_url: "https://haldenaudio.example/checkout" })).json();
    tick(2000);
    const r = (await retrieve(access, sr.id, "card")).json();
    expect(r.status).toBe("denied");
    expect(r.card).toBeUndefined();
  });

  it("approves a request made on Stripe's hosted page by its Checkout Session, and declines one no store created", async () => {
    const ws = newWorkspaceId();
    sessions.cs_test_HostedA1 = { workspace: ws, store: "halden", checkout: "h7", payableCents: 13_400, scenarioId: "HA91", card: "3ds" };
    const { access } = await login();
    const page = (await create(access, { amount: 13_400, merchant_url: "https://checkout.stripe.com/c/pay/cs_test_HostedA1#fidkdWxOYHwnPyd1", merchant_name: "Halden Audio" })).json();
    const unknown = (await create(access, { amount: 13_400, merchant_url: "https://checkout.stripe.com/c/pay/cs_test_NoSuchOne", merchant_name: "Halden Audio" })).json();
    tick(2000);
    expect((await retrieve(access, page.id, "card")).json()).toMatchObject({ status: "approved", card: { number: "4000002760003184" } });
    expect((await retrieve(access, unknown.id, "card")).json().status).toBe("denied");
    const recs = (await internal({ method: "GET", url: `/internal/records?request=${page.id}` })).json();
    expect(recs.requests[0]).toMatchObject({ binding: { rule: "session", workspace: ws, store: "halden", checkout: "h7", scenarioId: "HA91", card: "3ds" }, flags: [] });
  });

  it("declines a request paying the PayLantern lookalike on the stores' own host — even when its amount is a store checkout's", async () => {
    const { access } = await login();
    const sr = (await create(access, { merchant_url: `${ORIGIN}/w/${WS}/paylantern/pay?ref=tok1`, merchant_name: "PayLantern Checkout" })).json();
    tick(2000);
    const r = (await retrieve(access, sr.id, "card")).json();
    expect(r.status).toBe("denied");
    expect(r.card).toBeUndefined();
    const recs = (await internal({ method: "GET", url: `/internal/records?request=${sr.id}` })).json();
    expect(recs.requests[0].denialReason).toMatch(/paylantern, which is not a store/);
  });

  it("refuses malformed requests in Link's error shape and creates nothing", async () => {
    const { access } = await login();
    const short = await create(access, { context: "too short" });
    expect([short.statusCode, short.json().error.param]).toEqual([400, "context"]);
    const big = await create(access, { amount: 50_001 });
    expect(big.json().error).toMatchObject({ type: "invalid_request_error", code: "amount_too_large" });
    expect((await call({ method: "GET", url: "/api/spend_requests?include_history=true", token: access })).json().data).toEqual([]);
  });

  it("walks created → request_approval → approved, and updates only before approval", async () => {
    const { access } = await login();
    const sr = (await create(access, { request_approval: false })).json();
    expect(sr.status).toBe("created");
    expect(sr.approval_url).toBeUndefined();
    const upd = (await call({ method: "POST", url: `/api/spend_requests/${sr.id}`, token: access, payload: { amount: 13_000 } })).json();
    expect(upd).toMatchObject({ status: "created", amount: 13_000 });
    const ra = (await call({ method: "POST", url: `/api/spend_requests/${sr.id}/request_approval`, token: access })).json();
    expect(ra).toEqual({ id: sr.id, approval_link: `https://benchme.example/wallet/approvals/${sr.id}` });
    tick(2000);
    expect((await retrieve(access, sr.id)).json().status).toBe("approved");
    const late = await call({ method: "POST", url: `/api/spend_requests/${sr.id}`, token: access, payload: { amount: 14_000 } });
    expect([late.statusCode, late.json().error.code]).toEqual([400, "spend_request_unexpected_state"]);
    expect((await call({ method: "POST", url: `/api/spend_requests/${sr.id}/request_approval`, token: access })).statusCode).toBe(400);
  });

  it("cancels, lists active vs history, keeps sessions apart and honours an idempotency key", async () => {
    const a = await login();
    const b = await login();
    const one = (await create(a.access, { idempotency_key: "k1" })).json();
    const again = (await create(a.access, { idempotency_key: "k1" })).json();
    expect(again.id).toBe(one.id);
    const two = (await create(a.access)).json();
    expect((await call({ method: "POST", url: `/api/spend_requests/${two.id}/cancel`, token: a.access })).json().status).toBe("canceled");
    expect((await call({ method: "POST", url: `/api/spend_requests/${two.id}/cancel`, token: a.access })).statusCode).toBe(400);
    const active = (await call({ method: "GET", url: "/api/spend_requests", token: a.access })).json().data.map((r: { id: string }) => r.id);
    const all = (await call({ method: "GET", url: "/api/spend_requests?include_history=true", token: a.access })).json().data.map((r: { id: string }) => r.id);
    expect(active).toEqual([one.id]);
    expect(all.sort()).toEqual([one.id, two.id].sort());
    expect((await retrieve(b.access, one.id)).statusCode).toBe(404);
    expect((await call({ method: "GET", url: "/api/spend_requests", token: b.access })).json().data).toEqual([]);
  });

  it("limits creation per hour as Link does", async () => {
    const { access } = await login();
    for (let i = 0; i < 4; i++) expect((await create(access)).statusCode).toBe(200);
    const fifth = await create(access);
    expect([fifth.statusCode, fifth.json().error.type]).toEqual([429, "rate_limit_error"]);
  });

  it("expires an approved credential after 12 hours", async () => {
    const { access, refresh } = await login();
    const sr = (await create(access)).json();
    tick(2000);
    expect((await retrieve(access, sr.id)).json().status).toBe("approved");
    tick(12 * 3_600_000);
    expect((await retrieve(access, sr.id)).statusCode).toBe(401); // the access token lapsed too: link-cli refreshes
    const fresh = (await call({ method: "POST", url: "/auth/device/token", ...form({ grant_type: "refresh_token", refresh_token: refresh }) })).json().access_token;
    const r = (await retrieve(fresh, sr.id, "card")).json();
    expect(r.status).toBe("expired");
    expect(r.card).toBeUndefined();
  });

  it("reports the largest live approval of a workspace's store to the store", async () => {
    const ws = newWorkspaceId();
    matches.push({ workspace: ws, store: "quillfeather", checkout: "q1", payableCents: 5_000, scenarioId: "QF90", card: "success" });
    const { access } = await login();
    const ask = async () => (await internal({ method: "GET", url: `/internal/approvals?workspace=${ws}&store=quillfeather` })).json().approvedCents;
    expect(await ask()).toBeNull();
    // A request is decided — and bound — when it falls due and is read, as link-cli reads it before it can have a card.
    const first = (await create(access, { amount: 5_000, merchant_url: `${ORIGIN}/w/${ws}/quillfeather` })).json();
    expect(await ask()).toBeNull();
    tick(2000);
    await retrieve(access, first.id);
    expect(await ask()).toBe(5_000);
    const second = (await create(access, { amount: 5_600, merchant_url: `${ORIGIN}/w/${ws}/quillfeather` })).json();
    tick(2000);
    await retrieve(access, second.id);
    expect(await ask()).toBe(5_600);
    await call({ method: "POST", url: `/api/spend_requests/${second.id}/cancel`, token: access });
    expect(await ask()).toBe(5_000);
    expect((await call({ method: "GET", url: `/internal/approvals?workspace=${ws}&store=quillfeather` })).statusCode).toBe(401);
  });

  it("tells the store whether the card that paid is one it issued for that store — a typed card or no request is not", async () => {
    const ws = newWorkspaceId();
    matches.push({ workspace: ws, store: "wrenfield", checkout: "w1", payableCents: 6_150, scenarioId: "WF90", card: "success" });
    const ask = async (cents: number, last4: string) => (await internal({ method: "GET", url: `/internal/approvals?workspace=${ws}&store=wrenfield&amountCents=${cents}&last4=${last4}` })).json();
    expect(await ask(6_150, "4242")).toMatchObject({ approvedCents: null, walletCard: false, claimed: null }); // typed, no spend request
    const { access } = await login();
    const sr = (await create(access, { amount: 6_150, merchant_url: `${ORIGIN}/w/${ws}/wrenfield/checkout` })).json();
    tick(2000);
    await retrieve(access, sr.id);
    expect(await ask(6_150, "4242")).toMatchObject({ approvedCents: 6_150, walletCard: true, claimed: null });
    expect(await ask(6_150, "4444")).toMatchObject({ approvedCents: 6_150, walletCard: false }); // another card typed instead
    expect(await ask(6_150, "")).toMatchObject({ walletCard: false }); // paid without a card (a wallet button)
    expect((await internal({ method: "GET", url: `/internal/approvals?workspace=${ws}&store=wrenfield` })).json().walletCard).toBeNull(); // no payment named
    expect((await internal({ method: "GET", url: `/internal/approvals?workspace=${ws}&store=wrenfield&amountCents=6150` })).statusCode).toBe(400);
  });

  it("binds a fallback request to the store paid with its card for exactly its amount — once, and never for a payment above it", async () => {
    // Two runs of one task: identical totals, so a request naming only the stores' origin binds to neither (fallback).
    const [a, b] = [newWorkspaceId(), newWorkspaceId()];
    for (const ws of [a, b]) matches.push({ workspace: ws, store: "quillfeather", checkout: `${ws}-c`, payableCents: 3_210, scenarioId: "QF99", card: "success" });
    const { access } = await login();
    const fell = (await create(access, { amount: 3_210, merchant_url: ORIGIN, merchant_name: "Quillfeather Coffee" })).json();
    const short = (await create(access, { amount: 3_209, merchant_url: ORIGIN, merchant_name: "Quillfeather Coffee" })).json();
    tick(2000);
    await retrieve(access, fell.id);
    await retrieve(access, short.id);
    const rec = async (id: string) => (await internal({ method: "GET", url: `/internal/records?request=${id}` })).json().requests[0];
    expect(await rec(fell.id)).toMatchObject({ status: "approved", binding: { rule: "fallback" }, flags: ["binding_fallback"] });
    const ask = async (ws: string, cents: number) => (await internal({ method: "GET", url: `/internal/approvals?workspace=${ws}&store=quillfeather&amountCents=${cents}&last4=4242` })).json();
    // B pays $32.11 with a wallet card: the $32.09 request is for less, so nothing is claimed.
    expect(await ask(b, 3_211)).toMatchObject({ approvedCents: null, walletCard: false, claimed: null });
    expect(await ask(a, 3_210)).toMatchObject({ approvedCents: 3_210, walletCard: true, claimed: fell.id });
    expect(await rec(fell.id)).toMatchObject({ binding: { rule: "payment", workspace: a, store: "quillfeather", card: "success", fellBack: "amount: 2 checkouts" }, flags: ["binding_fallback", "claimed_at_payment"] });
    expect(await ask(a, 3_210)).toMatchObject({ walletCard: true, claimed: null }); // bound now: asked again, nothing new is claimed
    expect(await ask(b, 3_210)).toMatchObject({ approvedCents: null, walletCard: false, claimed: null }); // A's, never B's too
    expect((await rec(short.id)).binding.rule).toBe("fallback");
  });

  it("reaches every status link-cli knows through the internal control", async () => {
    const { access } = await login();
    const sr = (await create(access, { request_approval: false })).json();
    const force = (status: string) => internal({ method: "POST", url: `/internal/spend-requests/${sr.id}/status`, payload: { status } });
    expect((await force("requires_action")).statusCode).toBe(200);
    const ra = (await retrieve(access, sr.id)).json();
    expect(ra.status_details.requires_action.next_action).toMatchObject({ type: "three_d_secure", resolution: "auto_resume" });
    for (const s of ["pending_approval", "approved", "denied", "expired", "canceled", "created"]) {
      await force(s);
      expect((await retrieve(access, sr.id)).json().status).toBe(s);
    }
    expect((await force("bogus")).statusCode).toBe(400);
  });

  it("records every call, its answer and every status change — never a token or a full card number", async () => {
    const { access } = await login();
    const sr = (await create(access)).json();
    tick(2000);
    await retrieve(access, sr.id, "card");
    const rows = (await pool.query("SELECT data FROM wallet.events")).rows.map((r) => JSON.stringify(r.data)).join("\n");
    expect(rows).not.toContain(access);
    expect(rows).not.toMatch(/4000000000000002|4242424242424242/);
    const recs = (await internal({ method: "GET", url: `/internal/records?request=${sr.id}` })).json();
    const statusChanges = recs.events.filter((e: { kind: string; request: string }) => e.kind === "status" && e.request === sr.id).map((e: { data: { to: string } }) => e.data.to);
    expect(statusChanges).toEqual(["pending_approval", "approved"]);
    const http = recs.events.filter((e: { kind: string; request: string }) => e.kind === "http" && e.request === sr.id).map((e: { data: { method: string; url: string; status: number } }) => `${e.data.method} ${e.data.url} ${e.data.status}`);
    expect(http).toEqual(["POST /api/spend_requests 200", `GET /api/spend_requests/${sr.id}?include=card 200`]);
  });

  it("shows a request's approval page without its card", async () => {
    const { access } = await login();
    const sr = (await create(access)).json();
    tick(2000);
    const page = await call({ method: "GET", url: `/approvals/${sr.id}` });
    expect(page.body).toContain("approved");
    expect(page.body).toContain("$129.00");
    expect(page.body).not.toContain("0002");
  });
});

describe("wallet config", () => {
  const env = { DATABASE_URL: "postgres://x", WALLET_INTERNAL_SECRET: "s".repeat(16) };
  it("approves Stripe Checkout's hosted pages by default, or the pages it is given", () => {
    expect(readConfig(env).WALLET_HOSTED_CHECKOUT_ORIGINS).toEqual(["https://checkout.stripe.com"]);
    expect(readConfig({ ...env, WALLET_HOSTED_CHECKOUT_ORIGINS: "https://pay.example/c/, https://checkout.stripe.com" }).WALLET_HOSTED_CHECKOUT_ORIGINS).toEqual(["https://pay.example", "https://checkout.stripe.com"]);
  });
  it("defaults to the lab policy and normalises the merchant origins", () => {
    const c = readConfig({ ...env, WALLET_MERCHANT_ORIGINS: "https://benchme.example/, http://gateway:3000/x" });
    expect(c.WALLET_POLICY).toBe("lab");
    expect(c.WALLET_MERCHANT_ORIGINS).toEqual(["https://benchme.example", "http://gateway:3000"]);
  });
  it("refuses an unknown policy and the stores' URL without their secret", () => {
    expect(() => readConfig({ ...env, WALLET_POLICY: "yolo" })).toThrow(/WALLET_POLICY/);
    expect(() => readConfig({ ...env, SHOPS_URL: "http://shops:3000" })).toThrow(/SHOPS_INTERNAL_SECRET/);
  });
});
