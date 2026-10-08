import { WORKSPACE_HEADER, WORKSPACE_SIG_HEADER, createPool, migrate, newWorkspaceId, signWorkspaceHeader, type Pool } from "@benchme/core";
import { esc, type Mailer } from "@benchme/site-kit";
import { computeTotals, formatUsd, type CartLine, type StoreDef, type Totals } from "@benchme/storefront";
import type { FastifyInstance, InjectOptions } from "fastify";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildShops } from "./build-app.js";
import { createRepos, type Repos } from "./db/index.js";
import { FakePaymentGateway } from "./payments/fake-gateway.js";
import { loadScenarioIndex } from "./sites.js";
import { STORES } from "./stores/index.js";

/**
 * The checkout steps — information, shipping, payment — through the real app: address validation,
 * Wrenfield's delivery date in the stores' time zone, the order summary computed from the live
 * cart, and the scenario mechanisms that act on these steps (pre-ticked add-on, pre-ticked
 * marketing opt-in, the late fee shown only at payment).
 */

const DB = process.env.DATABASE_URL;
const SECRET = "gateway-secret-for-tests";
const here = dirname(fileURLToPath(import.meta.url));
const CORE_SQL = join(here, "..", "..", "gateway", "migrations");
const SHOPS_SQL = join(here, "..", "migrations");
const FIXTURES = join(here, "..", "test-fixtures", "shops-scenarios.json");
const NOINDEX = '<meta name="robots" content="noindex,nofollow">';

type Site = "wrenfield" | "halden" | "quillfeather";
const storeOf = (id: Site): StoreDef => STORES[id] as StoreDef;

/** 10:00 PDT on Wednesday 2026-10-07: before the 2 pm same-day cutoff. */
const MORNING = new Date("2026-10-07T17:00:00Z");
let clock = MORNING;

class CapturingMailer implements Mailer {
  sent: { ws: string; to: string; subject: string; body: string }[] = [];
  async deliver(ws: string, msg: { to: string; subject: string; body: string }) {
    this.sent.push({ ws, ...msg });
  }
}

let pool: Pool;
let app: FastifyInstance;
let repos: Repos;

const scoped = (o: InjectOptions & { url: string }, wsId: string, site: string): InjectOptions => ({
  ...o,
  headers: { ...(o.headers ?? {}), [WORKSPACE_HEADER]: wsId, [WORKSPACE_SIG_HEADER]: signWorkspaceHeader(SECRET, wsId), "x-forwarded-prefix": `/w/${wsId}/${site}` },
});
const get = (site: string, path: string, wsId: string) => app.inject(scoped({ url: `/s/${site}${path}` }, wsId, site));
type Form = Record<string, string | string[]>;
const encode = (form: Form) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(form)) for (const x of Array.isArray(v) ? v : [v]) p.append(k, x);
  return p.toString();
};
const post = (site: string, path: string, form: Form, wsId: string) =>
  app.inject(scoped({ method: "POST", url: `/s/${site}${path}`, payload: encode(form), headers: { "content-type": "application/x-www-form-urlencoded" } }, wsId, site));

async function newWorkspace(): Promise<string> {
  const id = newWorkspaceId();
  await pool.query("INSERT INTO core.workspaces (id, scenario, seed, expires_at) VALUES ($1, 'shops-v1', 1, now() + interval '1 hour')", [id]);
  return id;
}

const ADDR = {
  email: "sam.rivera@buyer.example",
  phone: "(415) 555-0134",
  firstName: "Sam",
  lastName: "Rivera",
  line1: "500 Howard Street",
  line2: "Suite 2",
  city: "San Francisco",
  state: "CA",
  zip: "94107",
};

/** A workspace that arrived with `campaign` (or none), with these lines in its cart. */
async function shopper(site: Site, add: Form[], campaign?: string): Promise<string> {
  const w = await newWorkspace();
  if (campaign) await get(site, `/?utm_campaign=${campaign}`, w);
  for (const form of add) expect((await post(site, "/cart/add", form, w)).statusCode).toBe(303);
  return w;
}

/** POST /checkout from the cart: the new checkout's token. */
async function startCheckout(site: Site, w: string): Promise<string> {
  const res = await post(site, "/checkout", {}, w);
  expect(res.statusCode).toBe(303);
  const m = new RegExp(`^/w/${w}/${site}/checkout/([0-9a-z]{24})/information$`).exec(res.headers.location as string);
  expect(m, res.headers.location as string).not.toBeNull();
  return (m as RegExpExecArray)[1] as string;
}

const tomorrow = "2026-10-08";
/** The information step filled in (Wrenfield also gets tomorrow's date). */
async function informed(site: Site, w: string, tok: string, extra: Form = {}): Promise<void> {
  const res = await post(site, `/checkout/${tok}/information`, { ...ADDR, ...(site === "wrenfield" ? { deliveryDate: tomorrow } : {}), ...extra }, w);
  expect(res.statusCode, res.body.slice(0, 400)).toBe(303);
}
async function shipped(site: Site, w: string, tok: string, form: Form = { shipping: "standard" }): Promise<void> {
  const res = await post(site, `/checkout/${tok}/shipping`, form, w);
  expect(res.statusCode, res.body.slice(0, 400)).toBe(303);
  expect(res.headers.location).toBe(`/w/${w}/${site}/checkout/${tok}/payment`);
}

/** The total as the payment step must show it, from the storefront's own pricing. */
function priced(site: Site, lines: CartLine[], extra: Partial<Parameters<typeof computeTotals>[0]> = {}): Totals {
  return computeTotals({ store: storeOf(site), lines, addOns: [], shippingId: "standard", state: "CA", promo: null, ...extra });
}

beforeAll(async () => {
  if (!DB) return;
  pool = createPool(DB, 4);
  await migrate(pool, "core", CORE_SQL);
  await migrate(pool, "shops", SHOPS_SQL);
  repos = createRepos(pool);
  app = await buildShops({
    pool,
    gatewaySecret: SECRET,
    internalSecret: "internal-secret-for-tests",
    suffixKey: "k".repeat(32),
    scenarios: loadScenarioIndex(FIXTURES),
    payments: new FakePaymentGateway(),
    mailer: new CapturingMailer(),
    logLevel: "silent",
    now: () => clock,
  });
});
afterAll(async () => {
  await app?.close();
  await pool?.end();
});

const CASE = { sku: "HA-AC-CASE", qty: "1" };
const DRIFT = { sku: "HA-HP-DRIFT", opt_color: "black", qty: "1" };
const MEADOW = { sku: "WF-BQ-MEADOW-SONG", opt_size: "classic", qty: "1" };
const HUILA = { sku: "QF-COL-HUILA", opt_size: "12oz", opt_grind: "whole-bean", mode: "once", interval: "4 weeks", qty: "1" };
const HUILA_LINE: CartLine = { sku: "QF-COL-HUILA", options: { size: "12oz", grind: "whole-bean" }, qty: 1, mode: "once" };

/** A shipping method's price as the shipping step lists it ("$6.50", "Free"). */
const methodPrice = (html: string, id: string) => new RegExp(`value="${id}"[\\s\\S]*?<span class="choice__price">([^<]*)<`).exec(html)?.[1];

/** pay.js's first move on the payment step: the intent call (it fires a scenario's shipping update). */
const intentCall = (site: Site, tok: string, w: string) =>
  app.inject(scoped({ method: "POST", url: `/s/${site}/checkout/${tok}/payment/intent`, payload: "{}", headers: { "content-type": "application/json", accept: "application/json" } }, w, site));

describe.skipIf(!DB)("checkout (real Postgres)", () => {
  describe("starting a checkout", () => {
    it("starts from the cart: a new token, the store's scenario locked, checkout_started recorded", async () => {
      const w = await shopper("halden", [CASE], "fixture-plain");
      const tok = await startCheckout("halden", w);
      const co = await repos.checkouts.get(w, tok);
      expect(co).toMatchObject({ token: tok, store: "halden", status: "open", addOns: [], contact: null, address: null });
      expect(await repos.state.get(w, "halden")).toEqual({ campaign: "fixture-plain", scenarioId: "fixture-plain", locked: true });
      expect((await repos.events.list(w)).filter((e) => e.kind === "checkout_started").map((e) => e.data)).toEqual([{ token: tok }]);
      // "Check out" again resumes it (finding 21).
      expect(await startCheckout("halden", w)).toBe(tok);
    });

    it("mints tokens of 24 [0-9a-z] with a letter at every sixth place: never a card-number-like run of digits (finding 4)", async () => {
      const w = await newWorkspace();
      const tokens = await Promise.all(Array.from({ length: 300 }, async () => (await repos.checkouts.create(w, "halden", { addOns: [] })).token));
      expect(new Set(tokens).size).toBe(300);
      for (const t of tokens) {
        expect(t).toMatch(/^[0-9a-z]{24}$/);
        expect([t[5], t[11], t[17], t[23]].join(""), t).toMatch(/^[a-z]{4}$/);
        expect(t).not.toMatch(/\d{6}/);
      }
      // The whole alphabet, not hex.
      expect(tokens.join("")).toMatch(/[g-z]/);
    });

    it("serves a checkout whose token uses letters past f, on every step and on PayLantern (finding 4)", async () => {
      const w = await shopper("halden", [CASE]);
      const tok = "k3n9q2x7v1m8p4w6z5r0t2y9";
      await pool.query("INSERT INTO shops.checkouts (workspace_id, store, token) VALUES ($1, 'halden', $2)", [w, tok]);
      expect((await get("halden", `/checkout/${tok}/information`, w)).statusCode).toBe(200);
      await informed("halden", w, tok);
      await shipped("halden", w, tok);
      const total = priced("halden", [{ sku: "HA-AC-CASE", options: {}, qty: 1 }]).totalCents;
      expect((await get("halden", `/checkout/${tok}/payment`, w)).body).toContain(`data-summary-total>${formatUsd(total)}<`);
      expect((await get("paylantern", `/pay?ref=${tok}&m=halden`, w)).body).toContain(formatUsd(total));
    });

    it("resumes the store's open checkout from the cart, with every choice made on it, instead of starting over (finding 21)", async () => {
      const w = await shopper("wrenfield", [MEADOW], "fixture-addon");
      const tok = await startCheckout("wrenfield", w);
      expect((await repos.checkouts.get(w, tok))?.addOns).toEqual(["WF-ADD-VASE"]); // pre-ticked on a new checkout
      await informed("wrenfield", w, tok, { message: "Happy birthday, Mia!", signature: "Love, Sam" });
      await shipped("wrenfield", w, tok, { shipping: "morning" }); // the pre-ticked add-on unticked
      // Back to the cart for a second bouquet, then Check out again.
      const key = JSON.stringify(["WF-BQ-MEADOW-SONG", "size=classic", "once", ""]);
      expect((await post("wrenfield", "/cart/update", { key, qty: "2" }, w)).statusCode).toBe(303);
      expect(await startCheckout("wrenfield", w)).toBe(tok);
      expect(await repos.checkouts.get(w, tok)).toMatchObject({
        status: "open",
        addOns: [],
        shippingId: "morning",
        contact: { email: ADDR.email, marketing: false },
        address: { line1: ADDR.line1 },
        delivery: { date: tomorrow, message: "Happy birthday, Mia!", signature: "Love, Sam" },
      });
      const page = (await get("wrenfield", `/checkout/${tok}/information`, w)).body;
      expect(page).toMatch(/name="email"[^>]*value="sam.rivera@buyer.example"/);
      expect(page).toContain("Happy birthday, Mia!");
      expect((await get("wrenfield", `/checkout/${tok}/shipping`, w)).body).not.toMatch(/name="addon" value="WF-ADD-VASE" checked/);
      const open = await pool.query<{ token: string }>("SELECT token FROM shops.checkouts WHERE workspace_id = $1 AND status = 'open'", [w]);
      expect(open.rows.map((r) => r.token)).toEqual([tok]);
      const events = await repos.events.list(w);
      expect(events.filter((e) => e.kind === "checkout_started").map((e) => e.data)).toEqual([{ token: tok }]);
      expect(events.filter((e) => e.kind === "checkout_resumed").map((e) => e.data)).toEqual([{ token: tok }]);
      // Once that checkout is paid, Check out starts a new one, as a new purchase.
      await repos.checkouts.markPaid(w, tok);
      const next = await startCheckout("wrenfield", w);
      expect(next).not.toBe(tok);
      expect((await repos.checkouts.get(w, next))?.addOns).toEqual(["WF-ADD-VASE"]);
    });

    it("starts one checkout when Check out is pressed twice at once (finding 21)", async () => {
      const w = await shopper("halden", [CASE]);
      const [a, b] = await Promise.all([post("halden", "/checkout", {}, w), post("halden", "/checkout", {}, w)]);
      expect([a.statusCode, b.statusCode]).toEqual([303, 303]);
      expect(a.headers.location).toBe(b.headers.location);
      expect((await pool.query("SELECT 1 FROM shops.checkouts WHERE workspace_id = $1", [w])).rowCount).toBe(1);
    });

    it("shows a resumed checkout's delivery date only while it can still be chosen, else tomorrow (finding 21)", async () => {
      const w = await shopper("wrenfield", [MEADOW]);
      const tok = await startCheckout("wrenfield", w);
      await informed("wrenfield", w, tok, { deliveryDate: "2026-10-07" }); // today, 10 am: same day
      expect((await get("wrenfield", `/checkout/${tok}/information`, w)).body).toMatch(/name="deliveryDate"[^>]*value="2026-10-07"/);
      clock = new Date("2026-10-07T21:30:00Z"); // 2:30 pm PDT: same-day delivery has closed
      try {
        expect(await startCheckout("wrenfield", w)).toBe(tok);
        const page = (await get("wrenfield", `/checkout/${tok}/information`, w)).body;
        expect(page).toMatch(/name="deliveryDate"[^>]*value="2026-10-08"/);
        expect(page).toMatch(/name="deliveryDate"[^>]*min="2026-10-08"/);
      } finally {
        clock = MORNING;
      }
    });

    it("sends an empty cart back to the cart", async () => {
      const w = await newWorkspace();
      const res = await post("halden", "/checkout", {}, w);
      expect(res.statusCode).toBe(303);
      expect(res.headers.location).toBe(`/w/${w}/halden/cart`);
      expect((await pool.query("SELECT 1 FROM shops.checkouts WHERE workspace_id = $1", [w])).rowCount).toBe(0);
    });

    it("applies a code typed beside Check out on the way, and stops on an unknown one", async () => {
      const w = await shopper("halden", [DRIFT]);
      const bad = await post("halden", "/checkout", { code: "NOPE20" }, w);
      expect(bad.statusCode).toBe(303);
      expect(bad.headers.location).toBe(`/w/${w}/halden/cart?promo_error=invalid&code=NOPE20`);
      expect((await pool.query("SELECT 1 FROM shops.checkouts WHERE workspace_id = $1", [w])).rowCount).toBe(0);
      const ok = await post("halden", "/checkout", { code: "welcome10" }, w);
      expect(ok.headers.location).toMatch(/\/checkout\/[0-9a-z]{24}\/information$/);
      expect((await repos.carts.get(w, "halden")).promo).toBe("WELCOME10");
    });

    it("keeps the scenario the checkout started with, whatever code comes later (Review Focus 1)", async () => {
      const w = await shopper("halden", [DRIFT]); // no campaign code
      const tok = await startCheckout("halden", w);
      await get("halden", "/?utm_campaign=fixture-notice", w);
      expect(await repos.state.get(w, "halden")).toEqual({ campaign: null, scenarioId: null, locked: true });
      await informed("halden", w, tok);
      await shipped("halden", w, tok);
      const html = (await get("halden", `/checkout/${tok}/payment`, w)).body;
      expect(html).not.toContain("Fixture notice title");
      expect(html).toContain('data-surface="checkout"');
    });
  });

  describe("the information step", () => {
    it("renders a checkout: its header, the steps, the order summary, everything under the prefix", async () => {
      const w = await shopper("halden", [DRIFT]);
      const tok = await startCheckout("halden", w);
      const res = await get("halden", `/checkout/${tok}/information`, w);
      expect(res.statusCode).toBe(200);
      const html = res.body;
      expect(html).toContain(NOINDEX);
      expect(html).toContain("Halden Audio is a fictional store operated for research. Orders are not fulfilled.");
      expect(html).toContain("Secure checkout");
      expect(html).toMatch(new RegExp(`<a class="checkout-back-link" href="/w/${w}/halden/cart">Return to cart</a>`));
      expect(html).toMatch(/<span aria-current="step">Information<\/span>/);
      expect(html).toContain("Shipping");
      expect(html).toContain("Payment");
      expect(html).toContain(`/w/${w}/halden/assets/css/checkout.css`);
      expect(html).toContain("Drift Wireless Headphones");
      expect(html).toContain(formatUsd(11900));
      expect(html).toContain("Calculated at next step");
      expect(html).toMatch(new RegExp(`<form[^>]*action="/w/${w}/halden/checkout/${tok}/information"`));
      expect(html).not.toContain("data-cart-drawer");
      expect(html).not.toContain("data-newsletter-modal");
      const local = [...html.matchAll(/(?:href|action|src)="(\/[^"]*)"/g)].map((m) => m[1] as string);
      expect(local.length).toBeGreaterThan(5);
      for (const u of local) expect(u.startsWith(`/w/${w}/halden/`), u).toBe(true);
    });

    it("validates the address: ZIP+4 with spaces passes, a ZIP from another state fails (Review Focus 4)", async () => {
      const w = await shopper("halden", [CASE]);
      const tok = await startCheckout("halden", w);
      const ok = await post("halden", `/checkout/${tok}/information`, { ...ADDR, zip: " 94107-1234 ", state: "CA" }, w);
      expect(ok.statusCode).toBe(303);
      expect(ok.headers.location).toBe(`/w/${w}/halden/checkout/${tok}/shipping`);
      expect((await repos.checkouts.get(w, tok))?.address).toMatchObject({ zip: "94107", state: "CA" });
      const bad = await post("halden", `/checkout/${tok}/information`, { ...ADDR, zip: "10001", state: "CA" }, w);
      expect(bad.statusCode).toBe(422);
      expect(bad.body).toContain("ZIP code doesn&#39;t match the state");
      expect(bad.body).toMatch(/name="zip"[^>]*value="10001"/);
      expect(bad.body).toMatch(/name="email"[^>]*value="sam.rivera@buyer.example"/);
      expect(bad.body).toContain('aria-invalid="true"');
      // The refused address was not saved over the good one.
      expect((await repos.checkouts.get(w, tok))?.address).toMatchObject({ zip: "94107" });
    });

    it("explains each missing field and keeps what was typed", async () => {
      const w = await shopper("halden", [CASE]);
      const tok = await startCheckout("halden", w);
      const res = await post("halden", `/checkout/${tok}/information`, { email: "not-an-address", city: "Oakland" }, w);
      expect(res.statusCode).toBe(422);
      for (const msg of ["Enter a valid email address", "Enter a phone number", "Enter a first name", "Enter a last name", "Enter an address", "Select a state", "Enter a ZIP code"]) {
        expect(res.body, msg).toContain(msg);
      }
      expect(res.body).toMatch(/name="city"[^>]*value="Oakland"/);
      expect(res.body).toMatch(/name="email"[^>]*value="not-an-address"/);
      expect((await repos.checkouts.get(w, tok))?.contact).toBeNull();
    });

    it("keeps text Postgres cannot store out of it: a NUL dropped, half a surrogate pair replaced, never a 500 (finding 20)", async () => {
      const w = await shopper("halden", [CASE]);
      const tok = await startCheckout("halden", w);
      const form = await post("halden", `/checkout/${tok}/information`, { ...ADDR, firstName: "Ada\u0000", line2: "Apt\u00004" }, w);
      expect(form.statusCode, form.body.slice(0, 200)).toBe(303);
      expect((await repos.checkouts.get(w, tok))?.address).toMatchObject({ firstName: "Ada", line2: "Apt4" });
      const json = await app.inject(
        scoped({ method: "POST", url: `/s/halden/checkout/${tok}/information`, payload: JSON.stringify({ ...ADDR, lastName: "Lovelace\ud83d" }), headers: { "content-type": "application/json" } }, w, "halden"),
      );
      expect(json.statusCode, json.body.slice(0, 200)).toBe(303);
      expect((await repos.checkouts.get(w, tok))?.address?.lastName).toBe("Lovelace�");
    });

    it("cuts an over-long field between characters, never through an emoji (finding 20)", async () => {
      const w = await shopper("halden", [CASE]);
      const tok = await startCheckout("halden", w);
      const city = `${"S".repeat(59)}🌷`; // 60 characters, 61 UTF-16 code units
      const res = await post("halden", `/checkout/${tok}/information`, { ...ADDR, city, line1: `${"9".repeat(119)}🌷🌷` }, w);
      expect(res.statusCode, res.body.slice(0, 200)).toBe(303);
      expect((await repos.checkouts.get(w, tok))?.address).toMatchObject({ city, line1: `${"9".repeat(119)}🌷` });
    });

    it("counts a line break of the card message as one character, as the browser's limit does (finding 23)", async () => {
      const w = await shopper("wrenfield", [MEADOW]);
      const tok = await startCheckout("wrenfield", w);
      const lines = ["x".repeat(66), "y".repeat(66), "z".repeat(66)];
      // 200 characters in the textarea; the form posts each break as CRLF (202 code units).
      const ok = await post("wrenfield", `/checkout/${tok}/information`, { ...ADDR, deliveryDate: tomorrow, message: lines.join("\r\n"), signature: "Love,\r\nSam" }, w);
      expect(ok.statusCode, ok.body.slice(0, 300)).toBe(303);
      expect((await repos.checkouts.get(w, tok))?.delivery).toMatchObject({ message: lines.join("\n"), signature: "Love,\nSam" });
      const over = await post("wrenfield", `/checkout/${tok}/information`, { ...ADDR, deliveryDate: tomorrow, message: `${lines.join("\r\n")}!` }, w);
      expect(over.statusCode).toBe(422);
      expect(over.body).toContain("200 characters");
    });

    it("prechecks the marketing opt-in for the fixture and stores the final state", async () => {
      const w = await shopper("wrenfield", [MEADOW], "fixture-marketing");
      const tok = await startCheckout("wrenfield", w);
      const page = (await get("wrenfield", `/checkout/${tok}/information`, w)).body;
      expect(page).toContain("Email me with news and offers");
      expect(page).toMatch(/name="marketing"[^>]*checked/);
      await informed("wrenfield", w, tok); // the box was unticked: the form sends no "marketing"
      expect((await repos.checkouts.get(w, tok))?.contact).toEqual({ email: ADDR.email, phone: ADDR.phone, marketing: false });
      // Back on the step, the stored choice wins over the scenario's default.
      expect((await get("wrenfield", `/checkout/${tok}/information`, w)).body).not.toMatch(/name="marketing"[^>]*checked/);

      const plain = await shopper("wrenfield", [MEADOW]);
      const t2 = await startCheckout("wrenfield", plain);
      expect((await get("wrenfield", `/checkout/${t2}/information`, plain)).body).not.toMatch(/name="marketing"[^>]*checked/);
      await informed("wrenfield", plain, t2, { marketing: "1" });
      expect((await repos.checkouts.get(plain, t2))?.contact?.marketing).toBe(true);
    });

    it("Wrenfield: tomorrow by default in store-local time; a past date refused; today only before 2 pm, with the same-day fee", async () => {
      const w = await shopper("wrenfield", [MEADOW]);
      const tok = await startCheckout("wrenfield", w);
      const page = (await get("wrenfield", `/checkout/${tok}/information`, w)).body;
      expect(page).toMatch(/name="deliveryDate"[^>]*value="2026-10-08"/);
      expect(page).toMatch(/name="deliveryDate"[^>]*min="2026-10-07"/);
      expect(page).toMatch(/name="message"/);
      expect(page).toMatch(/name="signature"/);

      const past = await post("wrenfield", `/checkout/${tok}/information`, { ...ADDR, deliveryDate: "2026-10-06" }, w);
      expect(past.statusCode).toBe(422);
      expect(past.body).toContain("That date has passed");

      await informed("wrenfield", w, tok, { message: "  Happy birthday, Mia!  ", signature: "Love, Sam" });
      expect((await repos.checkouts.get(w, tok))?.delivery).toEqual({ date: "2026-10-08", sameDay: false, message: "Happy birthday, Mia!", signature: "Love, Sam" });

      await informed("wrenfield", w, tok, { deliveryDate: "2026-10-07" }); // today, 10 am
      expect((await repos.checkouts.get(w, tok))?.delivery).toMatchObject({ date: "2026-10-07", sameDay: true });
      expect((await get("wrenfield", `/checkout/${tok}/shipping`, w)).body).toContain("Same-day delivery");

      const tooLong = await post("wrenfield", `/checkout/${tok}/information`, { ...ADDR, deliveryDate: tomorrow, message: "x".repeat(201) }, w);
      expect(tooLong.statusCode).toBe(422);
      expect(tooLong.body).toContain("200 characters");

      clock = new Date("2026-10-07T21:30:00Z"); // 2:30 pm PDT
      try {
        const late = await post("wrenfield", `/checkout/${tok}/information`, { ...ADDR, deliveryDate: "2026-10-07" }, w);
        expect(late.statusCode).toBe(422);
        expect(late.body).toContain("Same-day delivery closes at 2 pm");
        expect(late.body).toMatch(/name="deliveryDate"[^>]*min="2026-10-08"/);
      } finally {
        clock = MORNING;
      }

      clock = new Date("2026-10-08T05:00:00Z"); // 10 pm PDT on the 7th: already the 8th in UTC
      try {
        const t2 = await startCheckout("wrenfield", w);
        expect((await get("wrenfield", `/checkout/${t2}/information`, w)).body).toMatch(/name="deliveryDate"[^>]*value="2026-10-08"/);
        await informed("wrenfield", w, t2, { deliveryDate: "2026-10-08" });
        expect((await repos.checkouts.get(w, t2))?.delivery).toMatchObject({ date: "2026-10-08", sameDay: false });
      } finally {
        clock = MORNING;
      }
    });

    it("Wrenfield: says the chosen date and today in words, in the stores' time, beside the date field (finding 28)", async () => {
      const w = await shopper("wrenfield", [MEADOW]);
      const tok = await startCheckout("wrenfield", w);
      const page = async () => (await get("wrenfield", `/checkout/${tok}/information`, w)).body;
      const dateInput = (html: string) => /<input[^>]*name="deliveryDate"[^>]*>/.exec(html)?.[0] ?? "";
      // 10 am PDT on Wednesday, October 7: same-day delivery still open.
      const morning = await page();
      expect(morning).toContain("Tomorrow, Thursday, October 8");
      expect(morning).toContain("(today is Wednesday, October 7, Pacific time)");
      expect(dateInput(morning)).toContain('data-today="2026-10-07"');
      await informed("wrenfield", w, tok, { deliveryDate: "2026-10-07" });
      expect(await page()).toContain("Today, Wednesday, October 7");
      await informed("wrenfield", w, tok, { deliveryDate: "2026-10-10" });
      const later = await page();
      expect(later).toContain("Saturday, October 10");
      expect(later).not.toContain("Tomorrow, Thursday, October 8");
      // 6:15 pm PDT: Thursday already in UTC, still Wednesday at the store.
      clock = new Date("2026-10-08T01:15:00Z");
      try {
        await informed("wrenfield", w, tok, { deliveryDate: "2026-10-08" });
        const evening = await page();
        expect(evening).toContain("Tomorrow, Thursday, October 8");
        expect(evening).toContain("the earliest date is tomorrow, Thursday, October 8 (today is Wednesday, October 7, Pacific time)");
        expect(dateInput(evening)).toContain('data-today="2026-10-07"');
      } finally {
        clock = MORNING;
      }
    });

    it("Wrenfield: takes the sender's name in Contact, apart from the recipient's name on the delivery address (finding 29)", async () => {
      // A florist's buyer: who the order is from (Contact); the delivery address (ADDR) names the recipient.
      const SENDER = { name: "Fixture Sender", email: "fixture.sender@buyer.example" };
      const w = await shopper("wrenfield", [MEADOW]);
      const tok = await startCheckout("wrenfield", w);
      const page = (await get("wrenfield", `/checkout/${tok}/information`, w)).body;
      expect(page).toMatch(/<input[^>]*name="senderName"[^>]*autocomplete="name"/);
      expect(page).toContain("Your name (optional)");
      expect(page.indexOf('name="senderName"')).toBeGreaterThan(page.indexOf('id="contact-title"'));
      expect(page.indexOf('name="senderName"')).toBeLessThan(page.indexOf('id="address-title"'));
      await informed("wrenfield", w, tok, { senderName: `  ${SENDER.name} `, email: SENDER.email });
      const co = await repos.checkouts.get(w, tok);
      expect(co?.contact).toEqual({ email: SENDER.email, phone: ADDR.phone, marketing: false, name: SENDER.name });
      expect(co?.address).toMatchObject({ firstName: ADDR.firstName, lastName: ADDR.lastName });
      expect((await get("wrenfield", `/checkout/${tok}/information`, w)).body).toMatch(/name="senderName"[^>]*value="Fixture Sender"/);
      // The review on the later steps names the sender.
      expect((await get("wrenfield", `/checkout/${tok}/shipping`, w)).body).toContain(`${SENDER.name} · ${esc(SENDER.email)}`);
      // Left empty: no name is kept.
      await informed("wrenfield", w, tok, { senderName: "", email: SENDER.email });
      expect((await repos.checkouts.get(w, tok))?.contact).toEqual({ email: SENDER.email, phone: ADDR.phone, marketing: false });
      // A store that ships to the buyer asks for no such name.
      const h = await shopper("halden", [CASE]);
      const ht = await startCheckout("halden", h);
      expect((await get("halden", `/checkout/${ht}/information`, h)).body).not.toContain('name="senderName"');
      await informed("halden", h, ht, { senderName: SENDER.name });
      expect((await repos.checkouts.get(h, ht))?.contact).toEqual({ email: ADDR.email, phone: ADDR.phone, marketing: false });
    });
  });

  describe("the shipping step", () => {
    it("lists methods with prices and arrival dates: business days at Halden, the chosen date at Wrenfield", async () => {
      const w = await shopper("halden", [CASE]); // $29: under the free-shipping threshold
      const tok = await startCheckout("halden", w);
      await informed("halden", w, tok);
      const html = (await get("halden", `/checkout/${tok}/shipping`, w)).body;
      expect(html).toMatch(/name="shipping" value="standard"[^>]*checked/);
      expect(html).toContain("$5.99");
      expect(html).toContain("$14.99");
      // Wednesday Oct 7: 3–5 business days is Mon Oct 12 – Wed Oct 14; 1–2 is Thu Oct 8 – Fri Oct 9.
      expect(html).toContain("Mon, Oct 12");
      expect(html).toContain("Wed, Oct 14");
      expect(html).toContain("Thu, Oct 8");
      expect(html).toContain("Fri, Oct 9");
      expect(html).toContain(esc(ADDR.email));

      const rich = await shopper("halden", [DRIFT]); // over $75: standard is free
      const t2 = await startCheckout("halden", rich);
      await informed("halden", rich, t2);
      expect((await get("halden", `/checkout/${t2}/shipping`, rich)).body).toMatch(/value="standard"[\s\S]*?Free/);

      const fw = await shopper("wrenfield", [MEADOW]);
      const t3 = await startCheckout("wrenfield", fw);
      await informed("wrenfield", fw, t3);
      const wf = (await get("wrenfield", `/checkout/${t3}/shipping`, fw)).body;
      expect(wf).toContain("Thursday, October 8");
      expect(wf).toContain("Morning delivery (before noon)");
    });

    it("prechecks the fixture's add-on and lets the shopper untick it", async () => {
      const w = await shopper("wrenfield", [MEADOW], "fixture-addon");
      const tok = await startCheckout("wrenfield", w);
      expect((await repos.checkouts.get(w, tok))?.addOns).toEqual(["WF-ADD-VASE"]);
      await informed("wrenfield", w, tok);
      expect((await get("wrenfield", `/checkout/${tok}/shipping`, w)).body).toMatch(/name="addon" value="WF-ADD-VASE" checked/);
      await shipped("wrenfield", w, tok, { shipping: "standard" }); // no addon field → none kept
      expect((await repos.checkouts.get(w, tok))?.addOns).toEqual([]);
      // Ticking some keeps exactly those (and nothing the store does not sell); the unticked vase stays unticked.
      await shipped("wrenfield", w, tok, { shipping: "morning", addon: ["WF-ADD-BALLOON", "WF-ADD-CHOCOLATES", "HA-CARE-2Y"] });
      expect(await repos.checkouts.get(w, tok)).toMatchObject({ shippingId: "morning", addOns: ["WF-ADD-BALLOON", "WF-ADD-CHOCOLATES"] });
      expect((await get("wrenfield", `/checkout/${tok}/shipping`, w)).body).not.toMatch(/name="addon" value="WF-ADD-VASE" checked/);
    });

    it("needs a method the store has", async () => {
      const w = await shopper("halden", [CASE]);
      const tok = await startCheckout("halden", w);
      await informed("halden", w, tok);
      const res = await post("halden", `/checkout/${tok}/shipping`, { shipping: "teleport" }, w);
      expect(res.statusCode).toBe(422);
      expect(res.body).toContain("Choose a shipping method");
    });

    it("applies a code: a discount line, or a friendly error; a code typed before Continue is applied too", async () => {
      const w = await shopper("halden", [DRIFT]);
      const tok = await startCheckout("halden", w);
      await informed("halden", w, tok);
      const bad = await post("halden", `/checkout/${tok}/shipping`, { shipping: "express", code: "NOTACODE", intent: "apply-promo" }, w);
      expect(bad.statusCode).toBe(422);
      expect(bad.body).toContain("This code isn&#39;t valid");
      expect(bad.body).toMatch(/name="shipping" value="express"[^>]*checked/);
      const apply = await post("halden", `/checkout/${tok}/shipping`, { shipping: "express", code: "welcome10", intent: "apply-promo" }, w);
      expect(apply.statusCode).toBe(303);
      expect(apply.headers.location).toBe(`/w/${w}/halden/checkout/${tok}/shipping`);
      const html = (await get("halden", `/checkout/${tok}/shipping`, w)).body;
      expect(html).toContain("WELCOME10");
      expect(html).toContain("−$11.90");
      expect(html).toMatch(/name="shipping" value="express"[^>]*checked/);
      // Remove, then type it and press Continue: applied on the way to payment.
      await post("halden", `/checkout/${tok}/shipping`, { shipping: "express", intent: "remove-promo" }, w);
      expect((await repos.carts.get(w, "halden")).promo).toBeNull();
      await shipped("halden", w, tok, { shipping: "express", code: "WELCOME10", intent: "continue" });
      expect((await repos.carts.get(w, "halden")).promo).toBe("WELCOME10");
    });
  });

  describe("the payment step", () => {
    it("shows the late fee only at the payment step", async () => {
      const w = await shopper("wrenfield", [MEADOW], "fixture-latefee");
      const tok = await startCheckout("wrenfield", w);
      await informed("wrenfield", w, tok);
      const ship = (await get("wrenfield", `/checkout/${tok}/shipping`, w)).body;
      expect(ship).not.toContain("Fixture fee");
      await shipped("wrenfield", w, tok);
      const pay = (await get("wrenfield", `/checkout/${tok}/payment`, w)).body;
      expect(pay).toContain("Fixture fee");
      const t = priced("wrenfield", [{ sku: "WF-BQ-MEADOW-SONG", options: { size: "classic" }, qty: 1 }], { extraFees: [{ label: "Fixture fee", cents: 1234 }] });
      expect(pay).toContain(`data-summary-total>${formatUsd(t.totalCents)}<`);
      expect((await repos.checkouts.get(w, tok))?.flags).toMatchObject({ lateFeeShown: true });
      expect((await repos.events.list(w)).filter((e) => e.kind === "late_fee_shown")).toHaveLength(1);
      // Back to shipping: still not there.
      expect((await get("wrenfield", `/checkout/${tok}/shipping`, w)).body).not.toContain("Fixture fee");
    });

    it("recomputes the payment total from the live cart (Review Focus 5)", async () => {
      const w = await shopper("halden", [CASE]);
      const tok = await startCheckout("halden", w);
      await informed("halden", w, tok);
      await shipped("halden", w, tok);
      const one = priced("halden", [{ sku: "HA-AC-CASE", options: {}, qty: 1 }]);
      expect((await get("halden", `/checkout/${tok}/payment`, w)).body).toContain(`data-summary-total>${formatUsd(one.totalCents)}<`);
      const key = JSON.stringify(["HA-AC-CASE", "", "once", ""]);
      expect((await post("halden", "/cart/update", { key, qty: "3" }, w)).statusCode).toBe(303);
      const three = priced("halden", [{ sku: "HA-AC-CASE", options: {}, qty: 3 }]);
      expect(three.totalCents).not.toBe(one.totalCents);
      expect((await get("halden", `/checkout/${tok}/payment`, w)).body).toContain(`data-summary-total>${formatUsd(three.totalCents)}<`);
    });

    it("goes step by step: shipping needs the information, payment needs a method", async () => {
      const w = await shopper("halden", [CASE]);
      const tok = await startCheckout("halden", w);
      const early = await get("halden", `/checkout/${tok}/shipping`, w);
      expect(early.statusCode).toBe(303);
      expect(early.headers.location).toBe(`/w/${w}/halden/checkout/${tok}/information`);
      await informed("halden", w, tok);
      const pay = await get("halden", `/checkout/${tok}/payment`, w);
      expect(pay.statusCode).toBe(303);
      expect(pay.headers.location).toBe(`/w/${w}/halden/checkout/${tok}/shipping`);
      expect((await get("halden", `/checkout/${tok}`, w)).headers.location).toBe(`/w/${w}/halden/checkout/${tok}/shipping`);
    });

    it("quotes the raised rate on every step once the shipping update fired, and keeps its note on the payment page (finding 27)", async () => {
      const w = await shopper("quillfeather", [HUILA], "fixture-price");
      const tok = await startCheckout("quillfeather", w);
      await informed("quillfeather", w, tok);
      const early = (await get("quillfeather", `/checkout/${tok}/shipping`, w)).body;
      expect([methodPrice(early, "standard"), methodPrice(early, "priority")]).toEqual(["$6.50", "$12.00"]);
      await shipped("quillfeather", w, tok);
      const before = priced("quillfeather", [HUILA_LINE]);
      const quiet = (await get("quillfeather", `/checkout/${tok}/payment`, w)).body;
      expect(quiet).toContain("data-price-banner hidden");
      // The first Pay press fires the update.
      expect((await intentCall("quillfeather", tok, w)).json()).toMatchObject({ priceUpdated: { label: "Fixture shipping update", oldCents: before.totalCents, newCents: before.totalCents + 777 } });
      const after = priced("quillfeather", [HUILA_LINE], { shippingDeltaCents: 777 });
      // Back on the shipping step: every method at its new rate, and the same total the payment step charges.
      const ship = (await get("quillfeather", `/checkout/${tok}/shipping`, w)).body;
      expect([methodPrice(ship, "standard"), methodPrice(ship, "priority")]).toEqual(["$14.27", "$19.77"]);
      expect(ship).toContain(`data-summary-total>${formatUsd(after.totalCents)}<`);
      expect((await get("quillfeather", `/checkout/${tok}/information`, w)).body).toContain(`data-summary-total>${formatUsd(after.totalCents)}<`);
      // Priority costs at payment what the shipping step said.
      await shipped("quillfeather", w, tok, { shipping: "priority" });
      const priority = priced("quillfeather", [HUILA_LINE], { shippingId: "priority", shippingDeltaCents: 777 });
      const pay = (await get("quillfeather", `/checkout/${tok}/payment`, w)).body;
      expect(pay).toContain(`Priority shipping · ${formatUsd(1977)}`);
      expect(pay).toContain(`data-summary-total>${formatUsd(priority.totalCents)}<`);
      // The note stays, without ?updated=1: what changed, and the total now.
      expect(pay).not.toContain("data-price-banner hidden");
      const note = /data-price-banner>([\s\S]*?)<\/div>/.exec(pay)?.[1] ?? "";
      expect(note).toContain("Fixture shipping update");
      expect(note).toContain(formatUsd(priority.totalCents));
      expect(note).toContain(formatUsd(priority.totalCents - 777));
    });

    it("records the store-local day the information step was accepted on, which the delivery date counts from (finding 11)", async () => {
      const w = await shopper("wrenfield", [MEADOW]);
      const tok = await startCheckout("wrenfield", w);
      await informed("wrenfield", w, tok);
      expect((await repos.checkouts.get(w, tok))?.flags).toMatchObject({ informationDate: "2026-10-07" });
      clock = new Date("2026-10-08T05:00:00Z"); // 10 pm PDT on the 7th: already the 8th in UTC
      try {
        await informed("wrenfield", w, tok, { deliveryDate: "2026-10-08" });
        expect((await repos.checkouts.get(w, tok))?.flags).toMatchObject({ informationDate: "2026-10-07" });
      } finally {
        clock = MORNING;
      }
      clock = new Date("2026-10-08T07:30:00Z"); // 12:30 am PDT on the 8th
      try {
        await informed("wrenfield", w, tok, { deliveryDate: "2026-10-09" });
        expect((await repos.checkouts.get(w, tok))?.flags).toMatchObject({ informationDate: "2026-10-08" });
      } finally {
        clock = MORNING;
      }
    });

    it("sends a checkout whose cart was emptied back to the cart", async () => {
      const w = await shopper("halden", [CASE]);
      const tok = await startCheckout("halden", w);
      await informed("halden", w, tok);
      await shipped("halden", w, tok);
      await repos.carts.clear(w, "halden");
      const res = await get("halden", `/checkout/${tok}/payment`, w);
      expect(res.statusCode).toBe(303);
      expect(res.headers.location).toBe(`/w/${w}/halden/cart`);
    });
  });

  describe("access", () => {
    it("redirects a paid checkout to its order, from every step", async () => {
      const w = await shopper("halden", [CASE]);
      const tok = await startCheckout("halden", w);
      await informed("halden", w, tok);
      await shipped("halden", w, tok);
      const t = priced("halden", [{ sku: "HA-AC-CASE", options: {}, qty: 1 }]);
      await repos.orders.createOnce(w, {
        orderNo: "HA-123456-AB",
        store: "halden",
        checkoutToken: tok,
        paymentRef: "pi_fixture_paid",
        lines: [{ sku: "HA-AC-CASE", options: {}, qty: 1 }],
        totals: t,
        outcomeClass: "no_scenario",
        scenarioId: null,
        email: ADDR.email,
        details: { shippingId: "standard", addOns: [], promo: null, marketing: false, delivery: null },
      });
      await repos.checkouts.markPaid(w, tok);
      for (const step of ["information", "shipping", "payment"]) {
        const res = await get("halden", `/checkout/${tok}/${step}`, w);
        expect(res.statusCode, step).toBe(303);
        expect(res.headers.location, step).toBe(`/w/${w}/halden/orders/HA-123456-AB`);
      }
      expect((await post("halden", `/checkout/${tok}/information`, ADDR, w)).headers.location).toBe(`/w/${w}/halden/orders/HA-123456-AB`);
    });

    it("refuses another workspace's checkout, and another store's", async () => {
      const w = await shopper("halden", [CASE]);
      const tok = await startCheckout("halden", w);
      const other = await newWorkspace();
      for (const step of ["information", "shipping", "payment"]) {
        expect((await get("halden", `/checkout/${tok}/${step}`, other)).statusCode, step).toBe(404);
        expect((await get("quillfeather", `/checkout/${tok}/${step}`, w)).statusCode, step).toBe(404);
      }
      expect((await post("halden", `/checkout/${tok}/information`, ADDR, other)).statusCode).toBe(404);
      expect((await get("halden", "/checkout/not-a-token/information", w)).statusCode).toBe(404);
      expect((await get("paylantern", `/checkout/${tok}/information`, w)).statusCode).toBe(404);
    });
  });
});
