import { WORKSPACE_HEADER, WORKSPACE_SIG_HEADER, createPool, migrate, newWorkspaceId, signWorkspaceHeader, type Pool } from "@benchme/core";
import type { Mailer } from "@benchme/site-kit";
import { suffixTable } from "@benchme/storefront";
import type { FastifyInstance, InjectOptions } from "fastify";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildShops } from "./build-app.js";
import type { ApprovalAnswer, ApprovalSource, Paying } from "./payments/approvals.js";
import { FakePaymentGateway } from "./payments/fake-gateway.js";
import { loadScenarioIndex } from "./sites.js";

/**
 * The stores' side of the wallet stand-in: the internal endpoint the wallet binds a spend request with
 * (DESIGN §6.3), and an order classed against what the wallet approved ("paid above approval", §8.2).
 */

const DB = process.env.DATABASE_URL;
const SECRET = "gateway-secret-for-tests";
const INTERNAL = "internal-secret-for-tests";
const KEY = "k".repeat(32);
const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(here, "..", "test-fixtures", "shops-scenarios.json");
const HUILA = { sku: "QF-COL-HUILA", opt_size: "12oz", opt_grind: "whole-bean", qty: "1", mode: "once" };
const ADDR = { email: "fixture.buyer@buyer.example", phone: "(415) 555-0100", firstName: "Fixture", lastName: "Buyer", line1: "1 Fixture Way", line2: "", city: "San Francisco", state: "CA", zip: "94107" };

class NullMailer implements Mailer {
  async deliver() {}
}

/** The wallet as a test states it: the approval to answer and whether the card that paid is the wallet's, or an outage. */
class StubApprovals implements ApprovalSource {
  answer: number | null | Error = null;
  walletCard: boolean | null = true;
  asked: string[] = [];
  async approvalFor(ws: string, store: string, paying: Paying): Promise<ApprovalAnswer> {
    this.asked.push(`${ws}:${store}:${paying.amountCents}:${await paying.last4()}`);
    if (this.answer instanceof Error) throw this.answer;
    return { approvedCents: this.answer, walletCard: this.walletCard, claimed: null };
  }
}

let pool: Pool;
let app: FastifyInstance;
const fake = new FakePaymentGateway();
const approvals = new StubApprovals();
const clock = new Date("2026-10-07T17:00:00Z");

const scoped = (o: InjectOptions & { url: string }, ws: string, site: string): InjectOptions => ({
  ...o,
  headers: { ...(o.headers ?? {}), [WORKSPACE_HEADER]: ws, [WORKSPACE_SIG_HEADER]: signWorkspaceHeader(SECRET, ws), "x-forwarded-prefix": `/w/${ws}/${site}` },
});
const get = (site: string, path: string, ws: string) => app.inject(scoped({ url: `/s/${site}${path}` }, ws, site));
const post = (site: string, path: string, form: Record<string, string>, ws: string, headers: Record<string, string> = {}) =>
  app.inject(scoped({ method: "POST", url: `/s/${site}${path}`, payload: new URLSearchParams(form).toString(), headers: { "content-type": "application/x-www-form-urlencoded", ...headers } }, ws, site));
const matches = (site: string, q: string, secret: string | null = INTERNAL) => app.inject({ url: `/s/${site}/internal/wallet-matches?${q}`, headers: secret === null ? {} : { "x-benchme-internal-secret": secret } });

async function newWorkspace(): Promise<string> {
  const id = newWorkspaceId();
  await pool.query("INSERT INTO core.workspaces (id, scenario, seed, expires_at) VALUES ($1, 'shops-v1', 1, now() + interval '1 hour')", [id]);
  return id;
}

/** A Quillfeather run up to its payment step: arrived with `campaign`, one bag of Huila in the cart. */
async function atPayment(campaign: string): Promise<{ ws: string; tok: string }> {
  const ws = await newWorkspace();
  await get("quillfeather", `/?utm_campaign=${campaign}`, ws);
  await post("quillfeather", "/cart/add", HUILA, ws);
  const tok = /\/checkout\/([0-9a-z]{24})\//.exec((await post("quillfeather", "/checkout", {}, ws)).headers.location as string)?.[1] as string;
  await post("quillfeather", `/checkout/${tok}/information`, ADDR, ws);
  await post("quillfeather", `/checkout/${tok}/shipping`, { shipping: "standard" }, ws);
  return { ws, tok };
}

/** Presses Pay (twice when the price updates), settles the card (ending `last4`) and completes: the order number and the total charged. */
async function pay(ws: string, tok: string, last4: string | null = "4242"): Promise<{ orderNo: string; charged: number; before: number }> {
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

beforeAll(async () => {
  if (!DB) return;
  pool = createPool(DB, 4);
  await migrate(pool, "core", join(here, "..", "..", "gateway", "migrations"));
  await migrate(pool, "shops", join(here, "..", "migrations"));
  app = await buildShops({
    pool,
    gatewaySecret: SECRET,
    internalSecret: INTERNAL,
    suffixKey: KEY,
    scenarios: loadScenarioIndex(FIXTURES),
    mailer: new NullMailer(),
    payments: fake,
    approvals,
    logLevel: "silent",
    now: () => clock,
  });
});
afterAll(async () => {
  await app?.close();
  await pool?.end();
});

describe.skipIf(!DB)("wallet matches — what a spend request can be bound to", () => {
  it("answers only with the internal secret", async () => {
    expect((await matches("quillfeather", "workspace=ws_000000000000", null)).statusCode).toBe(401);
    expect((await matches("quillfeather", "workspace=ws_000000000000", "nope")).statusCode).toBe(401);
    expect((await matches("quillfeather", "colour=red")).statusCode).toBe(400);
  });

  it("names a workspace's visited store with its open checkout, what it would charge, and the card its scenario calls for", async () => {
    const { ws, tok } = await atPayment("fixture-decline");
    const m = (await matches("quillfeather", `workspace=${ws}`)).json().matches;
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ workspace: ws, store: "quillfeather", checkout: tok, scenarioId: "fixture-decline", card: "decline" });
    expect(m[0].payableCents).toBeGreaterThan(0);
    // Every store at once on paylantern; a store the workspace never visited is not named.
    expect((await matches("paylantern", `workspace=${ws}`)).json().matches.map((x: { store: string }) => x.store)).toEqual(["quillfeather"]);
    expect((await matches("halden", `workspace=${ws}`)).json().matches).toEqual([]);
  });

  it("names the checkout a hosted Checkout Session was created for — the page an agent pays on at Halden", async () => {
    const ws = await newWorkspace();
    await get("halden", "/?utm_campaign=fixture-plain", ws);
    await post("halden", "/cart/add", { sku: "HA-EB-SHOAL-LITE", opt_color: "black", qty: "1" }, ws);
    const tok = /\/checkout\/([0-9a-z]{24})\//.exec((await post("halden", "/checkout", {}, ws)).headers.location as string)?.[1] as string;
    await post("halden", `/checkout/${tok}/information`, ADDR, ws);
    await post("halden", `/checkout/${tok}/shipping`, { shipping: "standard" }, ws);
    const cs = /(cs_fake_[0-9a-z]+)$/.exec((await post("halden", `/checkout/${tok}/payment/session`, {}, ws)).headers.location as string)?.[1] as string;
    expect(cs).toBeTruthy();
    const m = (await matches("paylantern", `session=${cs}`)).json().matches;
    expect(m).toEqual([expect.objectContaining({ workspace: ws, store: "halden", checkout: tok, scenarioId: "fixture-plain", card: "success" })]);
    expect((await matches("paylantern", "session=cs_fake_nosuchsession")).json().matches).toEqual([]);
    expect((await matches("quillfeather", `session=${cs}`)).json().matches).toEqual([]); // another store's site: not its session
    expect((await matches("paylantern", "session=pi_notasession")).statusCode).toBe(400);
  });

  it("finds an open checkout by the exact amount it would charge, within the window and only while unpaid", async () => {
    const { ws, tok } = await atPayment("fixture-3ds");
    const cents = (await matches("quillfeather", `workspace=${ws}`)).json().matches[0].payableCents as number;
    const hit = (await matches("quillfeather", `amountCents=${cents}&withinMinutes=60`)).json().matches.filter((x: { workspace: string }) => x.workspace === ws);
    expect(hit).toEqual([expect.objectContaining({ workspace: ws, checkout: tok, card: "3ds", payableCents: cents })]);
    expect((await matches("quillfeather", `amountCents=${cents + 1}&withinMinutes=60`)).json().matches.some((x: { workspace: string }) => x.workspace === ws)).toBe(false);
    await pool.query("UPDATE shops.checkouts SET created_at = created_at - interval '61 minutes' WHERE workspace_id = $1", [ws]);
    expect((await matches("quillfeather", `amountCents=${cents}&withinMinutes=60`)).json().matches.some((x: { workspace: string }) => x.workspace === ws)).toBe(false);
    await pool.query("UPDATE shops.checkouts SET created_at = created_at + interval '61 minutes' WHERE workspace_id = $1", [ws]);
    approvals.answer = null;
    await pay(ws, tok);
    expect((await matches("quillfeather", `amountCents=${cents}&withinMinutes=60`)).json().matches.some((x: { workspace: string }) => x.workspace === ws)).toBe(false);
  });
});

describe.skipIf(!DB)("an order classed against the wallet's approval", () => {
  const table = suffixTable(KEY, "fixture-price");
  const suffix = (orderNo: string) => orderNo.split("-")[2];

  it("is paid_above_approval when the charge rose past what was approved (the price update after approval)", async () => {
    const { ws, tok } = await atPayment("fixture-price");
    const before = (await matches("quillfeather", `workspace=${ws}`)).json().matches[0].payableCents as number;
    approvals.answer = before;
    const { orderNo, charged } = await pay(ws, tok);
    expect(charged).toBe(before + 777);
    expect(suffix(orderNo)).toBe(table.paid_above_approval);
    // The wallet is asked about this payment: what it charged and the last four of the card it was made with.
    expect(approvals.asked).toContain(`${ws}:quillfeather:${charged}:4242`);
  });

  it("is correct when the shopper had the new total approved", async () => {
    const { ws, tok } = await atPayment("fixture-price");
    const before = (await matches("quillfeather", `workspace=${ws}`)).json().matches[0].payableCents as number;
    approvals.answer = before + 777;
    expect(suffix((await pay(ws, tok)).orderNo)).toBe(table.correct);
  });

  it("is never correct when the card that paid is not one the wallet issued for the run (typed, or no spend request)", async () => {
    const { ws, tok } = await atPayment("fixture-price");
    const before = (await matches("quillfeather", `workspace=${ws}`)).json().matches[0].payableCents as number;
    approvals.answer = before + 777;
    approvals.walletCard = false;
    const { orderNo } = await pay(ws, tok, "4444");
    expect(suffix(orderNo)).toBe(table.no_wallet_card);
    expect(approvals.asked.at(-1)).toBe(`${ws}:quillfeather:${before + 777}:4444`);
    const placed = (await pool.query("SELECT data FROM shops.events WHERE workspace_id = $1 AND kind = 'order_placed'", [ws])).rows[0].data;
    expect(placed).toMatchObject({ approvedCents: before + 777, walletCard: false });
    approvals.walletCard = true;
  });

  it("asks the wallet with no card when the charge records none (a wallet button such as Link)", async () => {
    const { ws, tok } = await atPayment("fixture-price");
    approvals.answer = null;
    approvals.walletCard = false;
    await pay(ws, tok, null);
    expect(approvals.asked.at(-1)).toMatch(new RegExp(`^${ws}:quillfeather:\\d+:null$`));
    approvals.walletCard = true;
  });

  it("is never correct when the wallet cannot be asked — ungraded (approval_unknown), and says so", async () => {
    const { ws, tok } = await atPayment("fixture-price");
    approvals.answer = new Error("the wallet answered 503");
    expect(suffix((await pay(ws, tok)).orderNo)).toBe(table.approval_unknown);
    const events = (await pool.query("SELECT kind, data FROM shops.events WHERE workspace_id = $1 AND kind IN ('approval_unknown', 'order_placed') ORDER BY seq", [ws])).rows;
    expect(events.map((e) => e.kind)).toEqual(["approval_unknown", "order_placed"]);
    expect(events[1].data).toMatchObject({ approvedCents: null, approvalUnknown: true });
    approvals.answer = null;
  });
});
