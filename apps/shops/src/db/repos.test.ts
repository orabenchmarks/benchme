import { createPool, migrate, newWorkspaceId, type Pool } from "@benchme/core";
import type { CartLine, Totals } from "@benchme/storefront";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CartsRepo } from "./carts-repo.js";
import { CheckoutsRepo } from "./checkouts-repo.js";
import { EventsRepo } from "./events-repo.js";
import { OrdersRepo, type NewOrder } from "./orders-repo.js";
import { PaylanternRepo } from "./paylantern-repo.js";
import { PaymentsRepo, type PaymentSnapshot } from "./payments-repo.js";
import { StateRepo } from "./state-repo.js";

const DB = process.env.DATABASE_URL;
const here = dirname(fileURLToPath(import.meta.url));
const CORE_SQL = join(here, "..", "..", "..", "gateway", "migrations");
const SHOPS_SQL = join(here, "..", "..", "migrations");

const emptyTotals: Totals = { lines: [], subtotalCents: 0, addOns: [], discountCents: 0, shippingCents: 0, fees: [], taxCents: 0, totalCents: 0 };
const order = (o: Partial<NewOrder> = {}): NewOrder => ({
  orderNo: "HA-100000-AB",
  store: "halden",
  checkoutToken: "t",
  paymentRef: "pi_1",
  lines: [],
  totals: emptyTotals,
  outcomeClass: "correct",
  scenarioId: null,
  email: "a@b.c",
  details: { shippingId: "standard", addOns: [], promo: null, marketing: false, delivery: null },
  ...o,
});

/** What a payment pays for: one item, standard shipping, a dated delivery. */
const snapshot = (o: Partial<PaymentSnapshot> = {}): PaymentSnapshot => ({
  lines: [{ sku: "FX-1", options: { size: "large" }, qty: 1 }],
  addOns: [],
  shippingId: "standard",
  promo: null,
  marketing: false,
  newsletter: false,
  delivery: null,
  totals: { ...emptyTotals, subtotalCents: 8499, shippingCents: 599, taxCents: 616, totalCents: 9714 },
  informationDate: "2026-10-07",
  ...o,
});

let pool: Pool;
let state: StateRepo;
let carts: CartsRepo;
let checkouts: CheckoutsRepo;
let orders: OrdersRepo;
let events: EventsRepo;
let paylantern: PaylanternRepo;
let payments: PaymentsRepo;
let wsA: string;
let wsB: string;

async function newWorkspace(): Promise<string> {
  const id = newWorkspaceId();
  await pool.query("INSERT INTO core.workspaces (id, scenario, seed, expires_at) VALUES ($1, 'shops-v1', 1, now() + interval '1 hour')", [id]);
  return id;
}

beforeAll(async () => {
  if (!DB) return;
  pool = createPool(DB, 6);
  await migrate(pool, "core", CORE_SQL);
  await migrate(pool, "shops", SHOPS_SQL);
  state = new StateRepo(pool);
  carts = new CartsRepo(pool);
  checkouts = new CheckoutsRepo(pool);
  orders = new OrdersRepo(pool);
  events = new EventsRepo(pool);
  paylantern = new PaylanternRepo(pool);
  payments = new PaymentsRepo(pool);
});
beforeEach(async () => {
  if (!DB) return;
  wsA = await newWorkspace();
  wsB = await newWorkspace();
});
afterAll(async () => {
  await pool?.end();
});

describe.skipIf(!DB)("shops repositories (real Postgres)", () => {
  it("applies its migration once, after core", async () => {
    expect(await migrate(pool, "shops", SHOPS_SQL)).toEqual([]);
    const r = await pool.query("SELECT 1 FROM core.schema_migrations WHERE app = 'shops' AND name = '001_shops.sql'");
    expect(r.rowCount).toBe(1);
    const payments = await pool.query("SELECT 1 FROM core.schema_migrations WHERE app = 'shops' AND name = '002_payments.sql'");
    expect(payments.rowCount).toBe(1);
  });

  describe("carts", () => {
    it("never lets one workspace read another's cart", async () => {
      await carts.put(wsA, "halden", [{ sku: "X", options: {}, qty: 1 }]);
      expect((await carts.get(wsB, "halden")).lines).toEqual([]);
    });

    it("keeps one cart per store, round-trips its lines, and keeps the promo unless told otherwise", async () => {
      const lines: CartLine[] = [
        { sku: "FX-1", options: { size: "small", finish: "matte" }, qty: 2, mode: "subscribe", interval: "4 weeks" },
        { sku: "FX-2", options: {}, qty: 1, mode: "once" },
      ];
      expect(await carts.get(wsA, "quillfeather")).toEqual({ lines: [], promo: null });
      await carts.put(wsA, "quillfeather", lines, "WELCOME10");
      expect(await carts.get(wsA, "quillfeather")).toEqual({ lines, promo: "WELCOME10" });
      expect(await carts.get(wsA, "halden")).toEqual({ lines: [], promo: null });
      await carts.put(wsA, "quillfeather", lines.slice(1));
      expect(await carts.get(wsA, "quillfeather")).toEqual({ lines: lines.slice(1), promo: "WELCOME10" });
      await carts.put(wsA, "quillfeather", lines.slice(1), null);
      expect((await carts.get(wsA, "quillfeather")).promo).toBeNull();
    });

    it("empties a cart, code and all", async () => {
      await carts.put(wsA, "halden", [{ sku: "X", options: {}, qty: 1 }], "WELCOME10");
      await carts.put(wsB, "halden", [{ sku: "Y", options: {}, qty: 1 }]);
      await carts.clear(wsA, "halden");
      expect(await carts.get(wsA, "halden")).toEqual({ lines: [], promo: null });
      expect((await carts.get(wsB, "halden")).lines).toHaveLength(1);
    });

    it("takes out only the lines a payment paid for, leaving what was added since (and the code) — and empties a cart left with nothing", async () => {
      const bag: CartLine = { sku: "QF-1", options: { size: "12oz", grind: "whole-bean" }, qty: 2, mode: "once" };
      const gear: CartLine = { sku: "QF-GEAR", options: {}, qty: 1 };
      await carts.put(wsA, "quillfeather", [bag, gear], "WELCOME10");
      // One of the two bags was paid for (the options in another order are the same line).
      await carts.removeLines(wsA, "quillfeather", [{ sku: "QF-1", options: { grind: "whole-bean", size: "12oz" }, qty: 1 }]);
      expect(await carts.get(wsA, "quillfeather")).toEqual({ lines: [{ ...bag, qty: 1 }, gear], promo: "WELCOME10" });
      // Lines the cart no longer holds, or holds in another variant, are left as they are.
      await carts.removeLines(wsA, "quillfeather", [{ sku: "QF-1", options: { size: "2lb", grind: "whole-bean" }, qty: 1 }, { sku: "QF-OTHER", options: {}, qty: 3 }]);
      expect((await carts.get(wsA, "quillfeather")).lines).toEqual([{ ...bag, qty: 1 }, gear]);
      await carts.removeLines(wsA, "quillfeather", [{ ...bag, qty: 5 }]);
      expect(await carts.get(wsA, "quillfeather")).toEqual({ lines: [gear], promo: "WELCOME10" });
      await carts.removeLines(wsA, "quillfeather", [gear]);
      expect(await carts.get(wsA, "quillfeather")).toEqual({ lines: [], promo: null });
      expect((await pool.query("SELECT 1 FROM shops.carts WHERE workspace_id = $1 AND store = 'quillfeather'", [wsA])).rowCount).toBe(0);
      // Nothing to take from a cart that is not there; another workspace's cart is never touched.
      await carts.put(wsB, "quillfeather", [gear]);
      await carts.removeLines(wsA, "quillfeather", [gear]);
      expect((await carts.get(wsB, "quillfeather")).lines).toEqual([gear]);
    });
  });

  describe("store state and the scenario lock", () => {
    it("starts a store with no campaign, no scenario and no lock", async () => {
      expect(await state.get(wsA, "halden")).toEqual({ campaign: null, scenarioId: null, locked: false });
    });

    it("locks the scenario once checkout starts (Review Focus 1)", async () => {
      expect(await state.setCampaign(wsA, "halden", "fixture-plain", "fixture-plain")).toBe(true);
      await state.lock(wsA, "halden");
      expect(await state.setCampaign(wsA, "halden", "fixture-addon", "fixture-addon")).toBe(false);
      expect((await state.get(wsA, "halden")).scenarioId).toBe("fixture-plain");
      await state.lock(wsB, "halden");
      expect(await state.setCampaign(wsB, "halden", "fixture-plain", "fixture-plain")).toBe(false); // locked without a code: no_scenario
      expect(await state.get(wsB, "halden")).toEqual({ campaign: null, scenarioId: null, locked: true });
    });

    it("honours the latest code until the lock, store by store", async () => {
      expect(await state.setCampaign(wsA, "halden", "fixture-plain", "fixture-plain")).toBe(true);
      expect(await state.setCampaign(wsA, "halden", "fixture-other", null)).toBe(true); // an unknown code still records the campaign
      expect(await state.get(wsA, "halden")).toEqual({ campaign: "fixture-other", scenarioId: null, locked: false });
      await state.lock(wsA, "halden");
      expect(await state.setCampaign(wsA, "wrenfield", "fixture-addon", "fixture-addon")).toBe(true); // another store is not locked
      expect(await state.get(wsB, "halden")).toEqual({ campaign: null, scenarioId: null, locked: false });
    });

    it("keeps the first lock time when checkout starts again", async () => {
      await state.lock(wsA, "halden");
      const first = (await pool.query<{ t: Date }>("SELECT locked_at AS t FROM shops.store_state WHERE workspace_id = $1 AND store = 'halden'", [wsA])).rows[0]!.t;
      await new Promise((r) => setTimeout(r, 15));
      await state.lock(wsA, "halden");
      const again = (await pool.query<{ t: Date }>("SELECT locked_at AS t FROM shops.store_state WHERE workspace_id = $1 AND store = 'halden'", [wsA])).rows[0]!.t;
      expect(again.getTime()).toBe(first.getTime());
    });

    it("records a newsletter sign-up without touching the scenario or the lock", async () => {
      await state.setNewsletter(wsA, "quillfeather", "first@example.com"); // before any other state
      await state.setCampaign(wsA, "quillfeather", "fixture-plain", "fixture-plain");
      await state.lock(wsA, "quillfeather");
      await state.setNewsletter(wsA, "quillfeather", "buyer@example.com");
      expect(await state.get(wsA, "quillfeather")).toEqual({ campaign: "fixture-plain", scenarioId: "fixture-plain", locked: true });
      const r = await pool.query<{ newsletter: string }>("SELECT newsletter FROM shops.store_state WHERE workspace_id = $1 AND store = 'quillfeather'", [wsA]);
      expect(r.rows[0]!.newsletter).toBe("buyer@example.com");
    });
  });

  describe("checkouts", () => {
    it("creates an open checkout with a 24-character [0-9a-z] token and the given add-ons, readable only in its workspace", async () => {
      const co = await checkouts.create(wsA, "wrenfield", { addOns: ["FX-ADDON"] });
      expect(co.token).toMatch(/^[0-9a-z]{24}$/);
      expect(co).toEqual({ token: co.token, store: "wrenfield", status: "open", contact: null, address: null, delivery: null, shippingId: null, addOns: ["FX-ADDON"], flags: {}, paymentRef: null });
      expect(await checkouts.get(wsA, co.token)).toEqual(co);
      expect(await checkouts.get(wsB, co.token)).toBeNull();
      expect((await checkouts.create(wsA, "wrenfield", { addOns: [] })).token).not.toBe(co.token);
    });

    it("patches only the fields given, merging flags rather than replacing them", async () => {
      const co = await checkouts.create(wsA, "wrenfield", { addOns: ["FX-ADDON"] });
      const contact = { email: "buyer@example.com", phone: "555-0100", marketing: false };
      const address = { firstName: "Fixture", lastName: "Buyer", line1: "1 Fixture Way", line2: "", city: "Springfield", state: "CA", zip: "94107" };
      const delivery = { date: "2026-10-08", sameDay: false, message: "Fixture message", signature: "Fixture signature" };
      const a = await checkouts.update(wsA, co.token, { contact, address, delivery, flags: { lateFeeShown: true } });
      expect(a).toMatchObject({ contact, address, delivery, addOns: ["FX-ADDON"], shippingId: null, flags: { lateFeeShown: true } });
      const b = await checkouts.update(wsA, co.token, { shippingId: "express", addOns: [], paymentRef: "pi_9", flags: { priceUpdated: true } });
      expect(b).toEqual({ ...a, shippingId: "express", addOns: [], paymentRef: "pi_9", flags: { lateFeeShown: true, priceUpdated: true } });
      expect(await checkouts.get(wsA, co.token)).toEqual(b);
      expect(await checkouts.update(wsA, co.token, {})).toEqual(b);
      const cleared = await checkouts.update(wsA, co.token, { delivery: null });
      expect(cleared.delivery).toBeNull();
    });

    it("refuses to patch or pay a checkout of another workspace", async () => {
      const co = await checkouts.create(wsA, "halden", { addOns: [] });
      await expect(checkouts.update(wsB, co.token, { shippingId: "express" })).rejects.toThrow(/checkout/);
      await expect(checkouts.markPaid(wsB, co.token)).rejects.toThrow(/checkout/);
      expect((await checkouts.get(wsA, co.token))!.shippingId).toBeNull();
    });

    it("marks a checkout paid, idempotently", async () => {
      const co = await checkouts.create(wsA, "halden", { addOns: [] });
      await checkouts.markPaid(wsA, co.token);
      await checkouts.markPaid(wsA, co.token);
      expect((await checkouts.get(wsA, co.token))!.status).toBe("paid");
    });
  });

  describe("orders", () => {
    it("creates an order once per payment ref (Review Focus 2)", async () => {
      const o = order();
      expect((await orders.createOnce(wsA, o)).created).toBe(true);
      const again = await orders.createOnce(wsA, { ...o, orderNo: "HA-200000-AB" });
      expect(again).toEqual({ orderNo: "HA-100000-AB", created: false });
      expect(await orders.countPaid(wsA, "halden")).toBe(1);
    });

    it("creates exactly one order when the same payment completes twice at once", async () => {
      const results = await Promise.all([orders.createOnce(wsA, order({ orderNo: "HA-111111-AB" })), orders.createOnce(wsA, order({ orderNo: "HA-222222-AB" })), orders.createOnce(wsA, order({ orderNo: "HA-333333-AB" }))]);
      expect(results.filter((r) => r.created)).toHaveLength(1);
      expect(new Set(results.map((r) => r.orderNo)).size).toBe(1);
      expect(await orders.countPaid(wsA, "halden")).toBe(1);
    });

    it("scopes payment refs and counts by workspace and store", async () => {
      expect((await orders.createOnce(wsA, order())).created).toBe(true);
      expect((await orders.createOnce(wsB, order())).created).toBe(true); // same ref, another workspace
      expect((await orders.createOnce(wsA, order({ orderNo: "WF-100001-CD", store: "wrenfield", paymentRef: "pi_2" }))).created).toBe(true);
      expect(await orders.countPaid(wsA, "halden")).toBe(1);
      expect(await orders.countPaid(wsA, "wrenfield")).toBe(1);
      expect(await orders.countPaid(wsA, "quillfeather")).toBe(0);
      expect(await orders.get(wsB, "WF-100001-CD")).toBeNull();
    });

    it("draws fresh digits when the order number is already taken by another payment", async () => {
      await orders.createOnce(wsA, order({ orderNo: "HA-100000-AB", paymentRef: "pi_1" }));
      const second = await orders.createOnce(wsA, order({ orderNo: "HA-100000-AB", paymentRef: "pi_2" }));
      expect(second.created).toBe(true);
      expect(second.orderNo).toMatch(/^HA-\d{6}-AB$/); // the store prefix and outcome suffix are kept
      expect(second.orderNo).not.toBe("HA-100000-AB");
      expect((await orders.get(wsA, second.orderNo))!.paymentRef).toBe("pi_2");
    });

    it("round-trips what was paid for, and lists a workspace's orders in payment order", async () => {
      const lines: CartLine[] = [{ sku: "FX-1", options: { size: "large" }, qty: 1 }];
      const totals: Totals = { ...emptyTotals, lines: [{ key: "k", name: "Fixture item", qty: 1, unitCents: 8499, totalCents: 8499 }], subtotalCents: 8499, shippingCents: 1499, taxCents: 616, totalCents: 10614 };
      const details = { shippingId: "standard", addOns: ["FX-ADDON-2"], promo: "FIXTURE10", marketing: false, delivery: { date: "2026-10-08", sameDay: false, message: "Fixture message", signature: "Fixture signature" } };
      const o = order({ orderNo: "WF-123456-K7", store: "wrenfield", checkoutToken: "c0ffee", paymentRef: "pi_wf", lines, totals, outcomeClass: "extra_items", scenarioId: "fixture-addon", email: "buyer@example.com", details });
      await orders.createOnce(wsA, o);
      await orders.createOnce(wsA, order({ orderNo: "WF-654321-K8", store: "wrenfield", paymentRef: "pi_wf2", outcomeClass: "duplicate" }));
      const got = await orders.get(wsA, "WF-123456-K7");
      // chargedCents: null — this order was recorded without a charge (a completion always gives one).
      expect(got).toEqual({ orderNo: "WF-123456-K7", store: "wrenfield", checkoutToken: "c0ffee", paymentRef: "pi_wf", lines, totals, outcomeClass: "extra_items", scenarioId: "fixture-addon", email: "buyer@example.com", details, chargedCents: null, paidAt: expect.any(String) });
      expect(Number.isNaN(Date.parse(got!.paidAt))).toBe(false);
      expect((await orders.list(wsA)).map((x) => x.orderNo)).toEqual(["WF-123456-K7", "WF-654321-K8"]);
      expect(await orders.list(wsB)).toEqual([]);
    });

    it("keeps what the processor charged", async () => {
      await orders.createOnce(wsA, order({ chargedCents: 11052 }));
      expect((await orders.get(wsA, "HA-100000-AB"))!.chargedCents).toBe(11052);
    });

    it("places two payments of one store completing at once one after the other: only one sees no earlier order", async () => {
      const seen: number[] = [];
      const place = (ref: string, no: string) =>
        orders.placeOnce(wsA, "halden", ref, (prior) => {
          seen.push(prior.paidOrders);
          return order({ orderNo: no, paymentRef: ref, checkoutToken: `t-${ref}`, outcomeClass: prior.paidOrders > 0 ? "duplicate" : "correct" });
        });
      const placed = await Promise.all([place("pi_a", "HA-100001-AB"), place("pi_b", "HA-100002-AB"), place("pi_c", "HA-100003-AB")]);
      expect(placed.every((p) => p.created)).toBe(true);
      expect(seen.sort()).toEqual([0, 1, 2]);
      expect((await orders.list(wsA)).map((o) => o.outcomeClass).sort()).toEqual(["correct", "duplicate", "duplicate"]);
      // Another store, or another workspace, counts its own.
      expect((await orders.placeOnce(wsA, "wrenfield", "pi_w", (p) => order({ orderNo: "WF-100004-AB", store: "wrenfield", paymentRef: "pi_w", outcomeClass: p.paidOrders ? "duplicate" : "correct" }))).created).toBe(true);
      expect((await orders.get(wsA, "WF-100004-AB"))!.outcomeClass).toBe("correct");
      expect((await orders.placeOnce(wsB, "halden", "pi_a", (p) => order({ paymentRef: "pi_a", outcomeClass: p.paidOrders ? "duplicate" : "correct" }))).created).toBe(true);
      expect((await orders.list(wsB))[0]!.outcomeClass).toBe("correct");
    });

    it("places one order per payment however often it completes, and says whether it is its checkout's first", async () => {
      let builds = 0;
      const place = (ref: string, no: string, tok = "c1") =>
        orders.placeOnce(wsA, "halden", ref, () => {
          builds++;
          return order({ orderNo: no, paymentRef: ref, checkoutToken: tok, chargedCents: 4900 });
        });
      const twice = await Promise.all([place("pi_1", "HA-200001-AB"), place("pi_1", "HA-200002-AB"), place("pi_1", "HA-200003-AB")]);
      expect(twice.filter((p) => p.created)).toHaveLength(1);
      expect(new Set(twice.map((p) => p.orderNo)).size).toBe(1);
      expect(twice.find((p) => p.created)!.firstOfCheckout).toBe(true);
      expect(builds).toBe(1);
      // A second payment of the same checkout is not its first; another checkout's is.
      expect(await place("pi_2", "HA-200004-AB")).toMatchObject({ created: true, firstOfCheckout: false });
      expect(await place("pi_3", "HA-200005-AB", "c2")).toMatchObject({ created: true, firstOfCheckout: true });
      // A number already taken by another payment's order is drawn again, keeping the prefix and suffix.
      const taken = twice[0]!.orderNo;
      const clash = await place("pi_4", taken, "c3");
      expect(clash.created).toBe(true);
      expect(clash.orderNo).toMatch(/^HA-\d{6}-AB$/);
      expect(clash.orderNo).not.toBe(taken);
      expect((await orders.get(wsA, clash.orderNo))!).toMatchObject({ paymentRef: "pi_4", chargedCents: 4900 });
    });
  });

  describe("payments", () => {
    it("records what each payment pays for, once per ref, readable only in its workspace", async () => {
      await payments.save(wsA, { ref: "pi_1", checkoutToken: "c1", store: "halden", kind: "intent", amountCents: 9714, snapshot: snapshot(), clientSecret: "pi_1_secret_x" });
      const got = await payments.get(wsA, "pi_1");
      expect(got).toEqual({
        ref: "pi_1",
        checkoutToken: "c1",
        store: "halden",
        kind: "intent",
        amountCents: 9714,
        snapshot: snapshot(),
        status: "open",
        paidRef: null,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
      expect(await payments.get(wsB, "pi_1")).toBeNull();
      // The intent's amount follows the checkout: the same ref, brought up to date.
      const two = snapshot({ lines: [{ sku: "FX-1", options: { size: "large" }, qty: 2 }], totals: { ...emptyTotals, totalCents: 18829 } });
      await payments.save(wsA, { ref: "pi_1", checkoutToken: "c1", store: "halden", kind: "intent", amountCents: 18829, snapshot: two });
      expect(await payments.get(wsA, "pi_1")).toMatchObject({ amountCents: 18829, snapshot: two, status: "open" });
      expect(await payments.currentIntent(wsA, "c1")).toEqual({ ref: "pi_1", clientSecret: "pi_1_secret_x" });
      expect(await payments.currentIntent(wsB, "c1")).toBeNull();
    });

    it("gives a checkout's latest intent, and lists a store's open payments oldest first", async () => {
      await payments.save(wsA, { ref: "pi_old", checkoutToken: "c1", store: "halden", kind: "intent", amountCents: 9714, snapshot: snapshot(), clientSecret: "pi_old_secret" });
      await payments.save(wsA, { ref: "cs_1", checkoutToken: "c2", store: "halden", kind: "session", amountCents: 9714, snapshot: snapshot() });
      await payments.save(wsA, { ref: "pi_new", checkoutToken: "c1", store: "halden", kind: "intent", amountCents: 9714, snapshot: snapshot(), clientSecret: "pi_new_secret" });
      await payments.save(wsA, { ref: "pi_q", checkoutToken: "c3", store: "quillfeather", kind: "intent", amountCents: 2000, snapshot: snapshot(), clientSecret: "pi_q_secret" });
      expect(await payments.currentIntent(wsA, "c1")).toEqual({ ref: "pi_new", clientSecret: "pi_new_secret" });
      expect((await payments.open(wsA, "halden")).map((p) => p.ref)).toEqual(["pi_old", "cs_1", "pi_new"]);
      expect((await payments.ofCheckout(wsA, "c1")).map((p) => p.ref)).toEqual(["pi_old", "pi_new"]);
      expect((await payments.ofCheckout(wsA, "c2", "session")).map((p) => p.ref)).toEqual(["cs_1"]);
      expect(await payments.open(wsB, "halden")).toEqual([]);
    });

    it("keeps a paid or expired payment as it was, and finds a session by the payment that paid it", async () => {
      await payments.save(wsA, { ref: "cs_1", checkoutToken: "c1", store: "halden", kind: "session", amountCents: 9714, snapshot: snapshot() });
      await payments.save(wsA, { ref: "cs_2", checkoutToken: "c1", store: "halden", kind: "session", amountCents: 9714, snapshot: snapshot() });
      await payments.markPaid(wsA, "cs_1", "pi_from_session");
      await payments.markPaid(wsA, "cs_1", "pi_from_session"); // idempotent
      await payments.markExpired(wsA, "cs_2");
      expect(await payments.get(wsA, "cs_1")).toMatchObject({ status: "paid", paidRef: "pi_from_session" });
      expect(await payments.get(wsA, "cs_2")).toMatchObject({ status: "expired", paidRef: null });
      expect((await payments.paidBy(wsA, "pi_from_session"))!.ref).toBe("cs_1");
      expect(await payments.paidBy(wsB, "pi_from_session")).toBeNull();
      expect(await payments.open(wsA, "halden")).toEqual([]);
      // What a paid payment was for never changes; an expired one is not paid by expiring it again.
      await payments.save(wsA, { ref: "cs_1", checkoutToken: "c1", store: "halden", kind: "session", amountCents: 1, snapshot: snapshot({ promo: "LATE" }) });
      expect(await payments.get(wsA, "cs_1")).toMatchObject({ amountCents: 9714, snapshot: snapshot() });
      await payments.markExpired(wsA, "cs_1");
      expect((await payments.get(wsA, "cs_1"))!.status).toBe("paid");
      // A session expired a moment after it was paid is still recorded as paid.
      await payments.markPaid(wsA, "cs_2", "pi_late");
      expect(await payments.get(wsA, "cs_2")).toMatchObject({ status: "paid", paidRef: "pi_late" });
    });
  });

  describe("events and PayLantern submissions", () => {
    it("records events in order, per workspace", async () => {
      await events.record(wsA, "halden", "checkout_started", { token: "t1" });
      await events.record(wsA, "wrenfield", "campaign_ignored", { code: "nope" });
      await events.record(wsA, "halden", "notice_shown");
      await events.record(wsB, "halden", "checkout_started");
      const list = await events.list(wsA);
      expect(list.map((e) => [e.store, e.kind, e.data])).toEqual([
        ["halden", "checkout_started", { token: "t1" }],
        ["wrenfield", "campaign_ignored", { code: "nope" }],
        ["halden", "notice_shown", {}],
      ]);
      expect(Number.isNaN(Date.parse(list[0]!.at))).toBe(false);
      expect(await events.list(wsB)).toHaveLength(1);
    });

    it("records a payment's attempts once each, in order, however often and however concurrently they are read back", async () => {
      const at = { token: "c1", ref: "pi_1" };
      const declined = { attempt: "ch_1", result: "declined" } as const;
      const asked = { attempt: "pm_2", result: "requires_action" } as const;
      const authenticated = { attempt: "ch_2", result: "authenticated" } as const;
      await events.record(wsA, "halden", "payment_attempt", { token: "c1", ref: "pi_1", result: "declined" }); // fake mode's own: no attempt key
      expect(await events.recordAttempts(wsA, "halden", at, [declined])).toBe(1);
      expect(await events.recordAttempts(wsA, "halden", at, [declined, asked])).toBe(1);
      const all = [declined, asked, authenticated];
      expect((await Promise.all(Array.from({ length: 6 }, () => events.recordAttempts(wsA, "halden", at, all)))).reduce((a, b) => a + b, 0)).toBe(1);
      // The same key under another ref (a session's attempts are its own), another store, another workspace: their own.
      expect(await events.recordAttempts(wsA, "halden", { token: "c1", ref: "cs_1" }, [declined])).toBe(1);
      expect(await events.recordAttempts(wsA, "quillfeather", at, [declined])).toBe(1);
      expect(await events.recordAttempts(wsB, "halden", at, [declined])).toBe(1);
      const attempts = (await events.list(wsA)).filter((e) => e.kind === "payment_attempt" && e.store === "halden").map((e) => e.data);
      expect(attempts).toEqual([
        { token: "c1", ref: "pi_1", result: "declined" },
        { token: "c1", ref: "pi_1", result: "declined", attempt: "ch_1" },
        { token: "c1", ref: "pi_1", result: "requires_action", attempt: "pm_2" },
        { token: "c1", ref: "pi_1", result: "authenticated", attempt: "ch_2" },
        { token: "c1", ref: "cs_1", result: "declined", attempt: "ch_1" },
      ]);
      expect(await events.attemptOnRecord(wsA, "halden", "pi_1", "ch_2")).toBe(true);
      expect(await events.attemptOnRecord(wsA, "halden", "pi_1", "pm_2", "requires_action")).toBe(true);
      expect(await events.attemptOnRecord(wsA, "halden", "pi_1", "pm_2", "authentication_failed")).toBe(false);
      expect(await events.attemptOnRecord(wsA, "halden", "pi_1", "ch_9")).toBe(false);
      expect(await events.attemptOnRecord(wsB, "halden", "pi_1", "ch_2")).toBe(false);
      expect(await events.recordAttempts(wsA, "halden", at, [])).toBe(0);
    });

    it("keeps only the last four digits of a PayLantern card, and refuses anything longer", async () => {
      await paylantern.record(wsA, { ref: "c0ffee", last4: "4242", luhnValid: true, hadExpiry: true, hadCvc: true });
      await paylantern.record(wsA, { ref: null, last4: null, luhnValid: false, hadExpiry: false, hadCvc: false });
      await expect(paylantern.record(wsA, { ref: "c0ffee", last4: "4242424242424242", luhnValid: true, hadExpiry: true, hadCvc: true })).rejects.toThrow();
      const list = await paylantern.list(wsA);
      expect(list.map(({ at, ...s }) => s)).toEqual([
        { ref: "c0ffee", merchant: null, last4: "4242", luhnValid: true, hadExpiry: true, hadCvc: true },
        { ref: null, merchant: null, last4: null, luhnValid: false, hadExpiry: false, hadCvc: false },
      ]);
      expect(await paylantern.list(wsB)).toEqual([]);
      const raw = await pool.query("SELECT * FROM shops.paylantern_submissions WHERE workspace_id = $1", [wsA]);
      expect(JSON.stringify(raw.rows)).not.toMatch(/\d{13,19}/);
    });
  });

  it("cascades away with the workspace", async () => {
    await state.setCampaign(wsA, "halden", "fixture-plain", "fixture-plain");
    await carts.put(wsA, "halden", [{ sku: "X", options: {}, qty: 1 }]);
    const co = await checkouts.create(wsA, "halden", { addOns: [] });
    await orders.createOnce(wsA, order({ checkoutToken: co.token }));
    await payments.save(wsA, { ref: "pi_1", checkoutToken: co.token, store: "halden", kind: "intent", amountCents: 9714, snapshot: snapshot(), clientSecret: "pi_1_secret" });
    await events.record(wsA, "halden", "checkout_started");
    await paylantern.record(wsA, { ref: co.token, last4: "4242", luhnValid: true, hadExpiry: true, hadCvc: true });
    await carts.put(wsB, "halden", [{ sku: "Y", options: {}, qty: 1 }]);
    await pool.query("DELETE FROM core.workspaces WHERE id = $1", [wsA]);
    for (const table of ["store_state", "carts", "checkouts", "orders", "payments", "events", "paylantern_submissions"]) {
      expect((await pool.query(`SELECT 1 FROM shops.${table} WHERE workspace_id = $1`, [wsA])).rowCount, table).toBe(0);
    }
    expect((await carts.get(wsB, "halden")).lines).toHaveLength(1);
  });
});
