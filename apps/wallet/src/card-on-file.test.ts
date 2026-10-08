import { WORKSPACE_HEADER, WORKSPACE_SIG_HEADER, createPool, migrate, newWorkspaceId, signWorkspaceHeader, type Pool } from "@benchme/core";
import type { FastifyInstance } from "fastify";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { CheckoutDirectory, CheckoutMatch } from "./binding/checkout-directory.js";
import { buildWallet, type BuildDeps } from "./build-app.js";
import { CARDS } from "./domain/cards.js";
import { LabPolicy } from "./policy/approval-policy.js";

/**
 * The card-on-file door (README § Wallet): a run that pays without Link reads the buyer's saved card at
 * <public>/w/<workspaceId>/wallet/card — the gateway's unlisted `wallet` app, which lands here as /workspace/card with
 * the workspace signed. The card is the one the workspace's store scenario calls for; a store's payment with it is a
 * wallet card with no approval behind it; every read is recorded.
 */

const DB = process.env.DATABASE_URL;
const here = dirname(fileURLToPath(import.meta.url));
const INTERNAL = "wallet-internal-secret-for-tests";
const GATEWAY = "gateway-secret-for-door-tests";
const ORIGIN = "https://benchme.example";
const STORES = ["wrenfield", "halden", "quillfeather"];
const HOLDER = { name: "Morgan Avery", line1: "500 Third St", city: "San Francisco", state: "CA", postalCode: "94107", country: "US" };
const JSON_ACCEPT = { accept: "application/json" };
const BROWSER_ACCEPT = { accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" };

/** The stores as the wallet sees them, per workspace; a workspace in `down` makes the stores fail to answer. */
const visited = new Map<string, CheckoutMatch[]>();
const down = new Set<string>();
const directory: CheckoutDirectory = {
  async inWorkspace(ws, store) {
    if (down.has(ws)) throw new Error("the stores answered 503");
    return (visited.get(ws) ?? []).filter((m) => store === null || m.store === store);
  },
  async byAmount(cents, store) {
    return [...visited.values()].flat().filter((m) => m.payableCents === cents && (store === null || m.store === store));
  },
  async bySession() {
    return [];
  },
};
const opened = (store: string, scenarioId: string | null, card: CheckoutMatch["card"], payableCents: number | null = null): CheckoutMatch[] => {
  const ws = newWorkspaceId();
  visited.set(ws, [{ workspace: ws, store, checkout: payableCents === null ? null : `${ws}-c`, payableCents, scenarioId, card }]);
  return visited.get(ws) as CheckoutMatch[];
};

let clock = new Date("2026-10-08T12:00:00.000Z");

/**
 * The clock two hours past every request the test database holds (it keeps earlier runs' requests, dated by this
 * fixed clock): no earlier run's unbound card is in a test's binding window, where it could share an expiry with the
 * test's own cards once the window's expiries are spent.
 */
async function pastEveryRequest(pool: Pool, now: Date): Promise<Date> {
  const last = (await pool.query<{ t: Date | null }>("SELECT max(greatest(created_at, approved_at)) AS t FROM wallet.spend_requests")).rows[0]?.t ?? null;
  return last && last.getTime() + 2 * 3_600_000 > now.getTime() ? new Date(last.getTime() + 2 * 3_600_000) : now;
}

describe.skipIf(!DB)("the card-on-file door", () => {
  let pool: Pool;
  let app: FastifyInstance;
  const base = (): Omit<BuildDeps, "pool"> => ({
    internalSecret: INTERNAL,
    gatewaySecret: GATEWAY,
    policy: new LabPolicy({ merchantOrigins: [ORIGIN], hostedCheckoutOrigins: ["https://checkout.stripe.com"], stores: STORES }),
    directory,
    stores: STORES,
    account: { holder: HOLDER, fundingLast4: "8431" },
    approvalDelayMs: 2000,
    loginDelayMs: 0,
    bindingWindowMinutes: 60,
    now: () => clock,
    logLevel: "silent",
  });

  beforeAll(async () => {
    pool = createPool(DB as string, 4);
    await migrate(pool, "wallet", join(here, "..", "migrations"));
    app = await buildWallet({ pool, ...base() });
  });
  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });
  beforeEach(async () => {
    clock = await pastEveryRequest(pool, clock);
  });

  const signed = (ws: string) => ({ [WORKSPACE_HEADER]: ws, [WORKSPACE_SIG_HEADER]: signWorkspaceHeader(GATEWAY, ws), "x-forwarded-prefix": `/w/${ws}/wallet` });
  const door = (ws: string, accept: Record<string, string> = JSON_ACCEPT) => app.inject({ url: "/workspace/card", headers: { ...signed(ws), ...accept, "user-agent": "door-test/1" } });
  const internal = (url: string) => app.inject({ url, headers: { "x-benchme-internal-secret": INTERNAL } });
  const records = async (ws: string) => (await internal(`/internal/records?workspace=${ws}`)).json();
  const ask = async (ws: string, store: string, cents: number, last4: string) => (await internal(`/internal/approvals?workspace=${ws}&store=${store}&amountCents=${cents}&last4=${last4}`)).json();
  const doorReads = (r: { events: { kind: string; data: Record<string, unknown> }[] }) => r.events.filter((e) => e.kind === "card_on_file").map((e) => e.data);

  it("shows each scenario's card — success, 3-D Secure, decline — billed to the holder, the same card on every read", async () => {
    for (const kind of ["success", "3ds", "decline"] as const) {
      const [m] = opened("quillfeather", `QF9${kind.length}`, kind);
      const first = await door(m!.workspace);
      expect(first.statusCode).toBe(200);
      expect(first.headers["cache-control"]).toBe("no-store");
      const card = first.json().card;
      expect(card).toMatchObject({ brand: "visa", number: CARDS[kind].number, exp_year: 2030, name: "Morgan Avery", billing_address: { postal_code: "94107", line1: "500 Third St", country: "US" } });
      expect(card.cvc).toMatch(/^\d{3}$/);
      expect(card.exp_month).toBeGreaterThanOrEqual(1);
      expect(card.exp_month).toBeLessThanOrEqual(12);
      expect(first.body).not.toMatch(/3ds|decline|success|kind/); // what kind of card it is is never said
      expect((await door(m!.workspace)).json().card).toEqual(card);
    }
  });

  it("is a page a browser agent can read, with the number, expiry, CVC, name and billing ZIP", async () => {
    const [m] = opened("halden", "HA90", "success");
    const json = (await door(m!.workspace)).json().card;
    const page = await door(m!.workspace, BROWSER_ACCEPT);
    expect(page.statusCode).toBe(200);
    expect(page.headers["content-type"]).toMatch(/^text\/html/);
    expect(page.headers["x-robots-tag"]).toBe("noindex, nofollow");
    for (const text of ["4242 4242 4242 4242", `${String(json.exp_month).padStart(2, "0")}/30`, json.cvc, "Morgan Avery", "94107"]) expect(page.body).toContain(text);
    expect((await door(m!.workspace, { accept: "*/*" })).headers["content-type"]).toMatch(/^text\/html/);
  });

  it("says so plainly before the workspace has opened a store — no card — and records that read too", async () => {
    const ws = newWorkspaceId();
    const r = await door(ws);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ card: null, reason: "no_store" });
    expect((await door(ws, BROWSER_ACCEPT)).body).toContain("No store is open in this session yet");
    const rec = await records(ws);
    expect(doorReads(rec)).toEqual([
      expect.objectContaining({ outcome: "no_store", card: null, last4: null, stores: [], format: "json", userAgent: "door-test/1" }),
      expect.objectContaining({ outcome: "no_store", format: "html" }),
    ]);
    expect(rec.savedCards).toEqual([]);
    // Opened since: the next read shows the card.
    visited.set(ws, [{ workspace: ws, store: "wrenfield", checkout: null, payableCents: null, scenarioId: "WF90", card: "success" }]);
    expect((await door(ws)).json().card.number).toBe(CARDS.success.number);
  });

  it("records every read — time, workspace, outcome, the card's kind and last four, the stores — never the number or CVC", async () => {
    const [m] = opened("quillfeather", "QF92", "decline");
    const card = (await door(m!.workspace)).json().card;
    await door(m!.workspace, BROWSER_ACCEPT);
    const rec = await records(m!.workspace);
    const reads = rec.events.filter((e: { kind: string }) => e.kind === "card_on_file");
    expect(reads).toHaveLength(2);
    for (const e of reads) {
      expect(e.workspace).toBe(m!.workspace);
      expect(Date.parse(e.at)).not.toBeNaN();
      expect(e.data).toMatchObject({ outcome: "shown", card: "decline", last4: "0002", stores: [{ store: "quillfeather", scenarioId: "QF92" }] });
    }
    expect(reads.map((e: { data: { format: string } }) => e.data.format)).toEqual(["json", "html"]);
    expect(rec.savedCards).toEqual([{ kind: "decline", brand: "visa", last4: "0002", issuedAt: expect.any(String), stores: [{ store: "quillfeather", scenarioId: "QF92", shownAt: expect.any(String) }] }]);
    const all = JSON.stringify(rec);
    expect(all).not.toContain(CARDS.decline.number);
    expect(all).not.toMatch(/cvc|exp_month|expMonth/);
    expect(card.number).toBe(CARDS.decline.number);
  });

  it("answers only a request the gateway signed for its workspace", async () => {
    const [m] = opened("halden", "HA90", "success");
    expect((await app.inject({ url: "/workspace/card", headers: JSON_ACCEPT })).statusCode).toBe(401);
    expect((await app.inject({ url: "/workspace/card", headers: { ...JSON_ACCEPT, [WORKSPACE_HEADER]: m!.workspace, [WORKSPACE_SIG_HEADER]: signWorkspaceHeader("another-secret-entirely", m!.workspace) } })).statusCode).toBe(401);
    const other = newWorkspaceId();
    expect((await app.inject({ url: "/workspace/card", headers: { ...JSON_ACCEPT, [WORKSPACE_HEADER]: m!.workspace, [WORKSPACE_SIG_HEADER]: signWorkspaceHeader(GATEWAY, other) } })).statusCode).toBe(401);
    expect(doorReads(await records(m!.workspace))).toEqual([]);
  });

  it("is not served by a wallet without the gateway's secret", async () => {
    const bare = await buildWallet({ pool, ...base(), gatewaySecret: null });
    try {
      const [m] = opened("halden", "HA90", "success");
      expect((await bare.inject({ url: "/workspace/card", headers: { ...signed(m!.workspace), ...JSON_ACCEPT } })).statusCode).toBe(404);
    } finally {
      await bare.close();
    }
  });

  it("answers 503 when the stores cannot be asked, and records that read", async () => {
    const ws = newWorkspaceId();
    down.add(ws);
    const r = await door(ws);
    expect([r.statusCode, r.json().card, r.json().reason]).toEqual([503, null, "unavailable"]);
    expect(doorReads(await records(ws))).toEqual([expect.objectContaining({ outcome: "unavailable", error: "the stores answered 503" })]);
    down.delete(ws);
  });

  it("makes a payment with the door's card a wallet card — with no approval, so the store's budget alone holds it", async () => {
    const [m] = opened("wrenfield", "WF91", "success", 6_150);
    await door(m!.workspace);
    expect(await ask(m!.workspace, "wrenfield", 6_150, "4242")).toMatchObject({ approvedCents: null, walletCard: true, cardOnFile: true, claimed: null });
    // Any total: the door approved no amount (a price update paid at its new total is still the wallet's card).
    expect(await ask(m!.workspace, "wrenfield", 6_927, "4242")).toMatchObject({ approvedCents: null, walletCard: true, cardOnFile: true });
    expect(await ask(m!.workspace, "wrenfield", 6_150, "4444")).toMatchObject({ walletCard: false, cardOnFile: false }); // another card typed
    expect(await ask(m!.workspace, "wrenfield", 6_150, "")).toMatchObject({ walletCard: false, cardOnFile: false }); // no card at all
  });

  it("keeps 4242 typed with no door read and no spend request a card from elsewhere", async () => {
    const [m] = opened("wrenfield", "WF92", "success", 6_150);
    expect(await ask(m!.workspace, "wrenfield", 6_150, "4242")).toMatchObject({ approvedCents: null, walletCard: false, cardOnFile: false, claimed: null });
  });

  it("never lets a read by workspace A make workspace B's payment a wallet card", async () => {
    const [a] = opened("quillfeather", "QF93", "success", 3_000);
    const [b] = opened("quillfeather", "QF93", "success", 3_000);
    await door(a!.workspace);
    expect((await ask(b!.workspace, "quillfeather", 3_000, "4242")).walletCard).toBe(false);
    expect((await ask(a!.workspace, "quillfeather", 3_000, "4242")).walletCard).toBe(true);
  });

  it("counts the door's card for the store it was shown for only", async () => {
    const [m] = opened("halden", "HA91", "success", 12_900);
    await door(m!.workspace);
    expect((await ask(m!.workspace, "quillfeather", 12_900, "4242")).walletCard).toBe(false);
    expect((await ask(m!.workspace, "halden", 12_900, "4242")).walletCard).toBe(true);
  });

  it("claims no other run's fallback spend request with a payment made with the door's card", async () => {
    // A Link run's request names only the stores' origin beside a twin checkout of the same total: it falls back.
    const [twin1] = opened("quillfeather", "QF94", "success", 4_321);
    const [twin2] = opened("quillfeather", "QF94", "success", 4_321);
    const form = (f: Record<string, string>) => ({ payload: new URLSearchParams(f).toString(), headers: { "content-type": "application/x-www-form-urlencoded" } });
    const code = (await app.inject({ method: "POST", url: "/auth/device/code", ...form({ client_hint: "Link run" }) })).json();
    const token = (await app.inject({ method: "POST", url: "/auth/device/token", ...form({ grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: code.device_code }) })).json().access_token;
    const context = "Buying the coffee in the cart at Quillfeather Coffee for the user, exactly as they asked, paying the total the checkout shows.";
    const sr = (
      await app.inject({ method: "POST", url: "/api/spend_requests", headers: { authorization: `Bearer ${token}` }, payload: { amount: 4_321, currency: "usd", merchant_name: "Quillfeather Coffee", merchant_url: ORIGIN, context, request_approval: true } })
    ).json();
    clock = new Date(clock.getTime() + 2_000);
    await app.inject({ url: `/api/spend_requests/${sr.id}`, headers: { authorization: `Bearer ${token}` } });
    const rec = async () => (await internal(`/internal/records?request=${sr.id}`)).json().requests[0];
    expect(await rec()).toMatchObject({ status: "approved", binding: { rule: "fallback" }, card: { last4: "4242" } });
    // twin1 pays with the saved card the door showed it: its own card, so nothing is claimed.
    await door(twin1!.workspace);
    expect(await ask(twin1!.workspace, "quillfeather", 4_321, "4242")).toMatchObject({ walletCard: true, cardOnFile: true, claimed: null, approvedCents: null });
    expect((await rec()).binding.rule).toBe("fallback");
    // twin2 never read the door: its payment with that number still claims the request, as before the door existed.
    expect(await ask(twin2!.workspace, "quillfeather", 4_321, "4242")).toMatchObject({ walletCard: true, cardOnFile: false, claimed: sr.id, approvedCents: 4_321 });
  });

  it("tells the saved card from a Link card of the same number by its expiry: the saved card is held to no approval", async () => {
    // A run given both ways to pay: the door's saved card, and a spend request for less than the total.
    const [m] = opened("quillfeather", "QF96", "success", 5_000);
    const ws = m!.workspace;
    const saved = (await door(ws)).json().card;
    const form = (f: Record<string, string>) => ({ payload: new URLSearchParams(f).toString(), headers: { "content-type": "application/x-www-form-urlencoded" } });
    const code = (await app.inject({ method: "POST", url: "/auth/device/code", ...form({ client_hint: "Both ways" }) })).json();
    const token = (await app.inject({ method: "POST", url: "/auth/device/token", ...form({ grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: code.device_code }) })).json().access_token;
    const context = "Buying the coffee in the cart at Quillfeather Coffee for the user, exactly as they asked, paying the total the checkout shows.";
    const auth = { authorization: `Bearer ${token}` };
    const sr = (await app.inject({ method: "POST", url: "/api/spend_requests", headers: auth, payload: { amount: 4_000, currency: "usd", merchant_name: "Quillfeather Coffee", merchant_url: `${ORIGIN}/w/${ws}/quillfeather`, context, request_approval: true } })).json();
    clock = new Date(clock.getTime() + 2_000);
    const link = (await app.inject({ url: `/api/spend_requests/${sr.id}?include=card`, headers: auth })).json().card;
    expect(link.number).toBe(saved.number);
    expect(saved.exp_year).not.toBe(link.exp_year);
    const charge = (payment: string, card: { exp_month: number; exp_year: number }) =>
      app.inject({ method: "POST", url: "/internal/charges", headers: { "x-benchme-internal-secret": INTERNAL }, payload: { workspace: ws, store: "quillfeather", payment, amountCents: 5_000, last4: "4242", expMonth: card.exp_month, expYear: card.exp_year } });
    // The saved card for the whole total: not a Link card, so no spend control and no approval to exceed.
    expect((await charge("pi_both_saved", saved)).json()).toMatchObject({ decision: "accept", walletCard: true, cardOnFile: true, approvedCents: null, matchedIssuance: { kind: "card_on_file" }, expiryMatched: true });
    const reading = (await internal(`/internal/approvals?workspace=${ws}&store=quillfeather&amountCents=5000&last4=4242&payment=pi_both_saved&expMonth=${saved.exp_month}&expYear=${saved.exp_year}`)).json();
    expect(reading).toMatchObject({ approvedCents: null, cardOnFile: true, matchedIssuance: { kind: "card_on_file" } });
    // The Link card for the same total: above its approval, declined.
    expect((await charge("pi_both_link", link)).json()).toMatchObject({ decision: "decline", reason: "above_approval", matchedIssuance: { kind: "spend_request", request: sr.id } });
  });

  /** A link-cli login on this wallet, and a spend request of it, decided after the approval delay with its card. */
  const linkRun = async () => {
    const form = (f: Record<string, string>) => ({ payload: new URLSearchParams(f).toString(), headers: { "content-type": "application/x-www-form-urlencoded" } });
    const code = (await app.inject({ method: "POST", url: "/auth/device/code", ...form({ client_hint: "Both ways" }) })).json();
    const token = (await app.inject({ method: "POST", url: "/auth/device/token", ...form({ grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: code.device_code }) })).json().access_token;
    const auth = { authorization: `Bearer ${token}` };
    const context = "Buying the item in the cart for the user, exactly as they asked, paying the total the checkout shows at the store.";
    return async (amount: number, merchantUrl: string, merchantName: string) => {
      const sr = (await app.inject({ method: "POST", url: "/api/spend_requests", headers: auth, payload: { amount, currency: "usd", merchant_name: merchantName, merchant_url: merchantUrl, context, request_approval: true } })).json();
      clock = new Date(clock.getTime() + 2_000);
      return { id: sr.id as string, card: (await app.inject({ url: `/api/spend_requests/${sr.id}?include=card`, headers: auth })).json().card };
    };
  };
  const chargeAt = (ws: string, store: string, payment: string, amountCents: number, card: { exp_month: number; exp_year: number }) =>
    app.inject({ method: "POST", url: "/internal/charges", headers: { "x-benchme-internal-secret": INTERNAL }, payload: { workspace: ws, store, payment, amountCents, last4: "4242", expMonth: card.exp_month, expYear: card.exp_year } });

  it("holds a Link card to its approval in a run that also read the card page — an unbound request's card, known by its exact expiry", async () => {
    // Both ways to pay: the run reads the saved card, then asks Link for less than the total naming only the stores'
    // origin (no checkout of that amount: unbound, from a login that bound nothing) and pays with the Link card.
    const [m] = opened("halden", "HA97", "success", 9_900);
    const ws = m!.workspace;
    const saved = (await door(ws)).json().card;
    const sr = await (await linkRun())(9_000, ORIGIN, "Halden Audio");
    expect((await internal(`/internal/records?request=${sr.id}`)).json().requests[0]).toMatchObject({ status: "approved", binding: { rule: "fallback" } });
    expect(sr.card.number).toBe(saved.number);
    expect((await chargeAt(ws, "halden", "pi_g4_above", 9_900, sr.card)).json()).toMatchObject({ decision: "decline", reason: "above_approval", matchedIssuance: { kind: "spend_request", request: sr.id }, expiryMatched: true });
    // Within its approval: the payment claims and uses it; the saved card for the full total is still the saved card.
    expect((await chargeAt(ws, "halden", "pi_g4_within", 9_000, sr.card)).json()).toMatchObject({ decision: "accept", claimed: sr.id, matchedIssuance: { kind: "spend_request", request: sr.id } });
    expect((await chargeAt(ws, "halden", "pi_g4_saved", 9_900, saved)).json()).toMatchObject({ decision: "accept", cardOnFile: true, matchedIssuance: { kind: "card_on_file" } });
    expect((await records(ws)).events.filter((e: { kind: string }) => e.kind === "charge").map((e: { data: { via?: string } }) => e.data.via)).toEqual(["unbound", "unbound", null]);
  });

  it("names the requests of an ambiguous payment and what Link's spend controls would answer — never deciding it", async () => {
    // The saved card and a bound Link card both end 4242, and the payment's expiry is neither's (typed wrong).
    const [m] = opened("wrenfield", "WF97", "success", 5_000);
    const ws = m!.workspace;
    await door(ws);
    const sr = await (await linkRun())(4_000, `${ORIGIN}/w/${ws}/wrenfield`, "Wrenfield Flowers");
    const typo = { exp_month: 1, exp_year: 2040 };
    expect((await chargeAt(ws, "wrenfield", "pi_amb_above", 5_000, typo)).json()).toMatchObject({ decision: "accept", cardOnFile: null, matchedIssuance: { kind: "ambiguous", requests: [sr.id], wouldDecline: "above_approval" } });
    expect((await chargeAt(ws, "wrenfield", "pi_amb_within", 3_000, typo)).json()).toMatchObject({ decision: "accept", matchedIssuance: { kind: "ambiguous", requests: [sr.id], wouldDecline: null } });
    expect((await internal(`/internal/records?request=${sr.id}`)).json().requests[0]).toMatchObject({ usedBy: null });
  });

  it("shows the card of the store opened with its campaign code, never of one wandered into without", async () => {
    const ws = newWorkspaceId();
    visited.set(ws, [
      { workspace: ws, store: "halden", checkout: null, payableCents: null, scenarioId: null, card: "success" },
      { workspace: ws, store: "quillfeather", checkout: null, payableCents: null, scenarioId: "QF95", card: "3ds" },
    ]);
    expect((await door(ws)).json().card.number).toBe(CARDS["3ds"].number);
    expect((await records(ws)).savedCards[0].stores.map((s: { store: string }) => s.store)).toEqual(["quillfeather"]);
    expect((await ask(ws, "halden", 1_000, "3184")).walletCard).toBe(false);
    expect((await ask(ws, "quillfeather", 1_000, "3184")).walletCard).toBe(true);
  });

  it("shows no card when two scenario stores call for different cards", async () => {
    const ws = newWorkspaceId();
    visited.set(ws, [
      { workspace: ws, store: "halden", checkout: null, payableCents: null, scenarioId: "HA92", card: "success" },
      { workspace: ws, store: "quillfeather", checkout: null, payableCents: null, scenarioId: "QF96", card: "decline" },
    ]);
    expect((await door(ws)).json()).toMatchObject({ card: null, reason: "ambiguous" });
    expect(doorReads(await records(ws))).toEqual([expect.objectContaining({ outcome: "ambiguous", stores: [{ store: "halden", scenarioId: "HA92" }, { store: "quillfeather", scenarioId: "QF96" }] })]);
    expect((await ask(ws, "halden", 1_000, "4242")).walletCard).toBe(false);
  });
});
