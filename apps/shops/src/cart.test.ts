import { WORKSPACE_HEADER, WORKSPACE_SIG_HEADER, createPool, migrate, newWorkspaceId, signWorkspaceHeader, type Pool } from "@benchme/core";
import { esc, type Mailer } from "@benchme/site-kit";
import { formatUsd, lineKey, type Product, type StoreDef } from "@benchme/storefront";
import type { FastifyInstance, InjectOptions } from "fastify";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildShops } from "./build-app.js";
import { CartsRepo } from "./db/index.js";
import { FakePaymentGateway } from "./payments/fake-gateway.js";
import { loadScenarioIndex } from "./sites.js";
import { STORES } from "./stores/index.js";

/**
 * The cart: the routes the product page and store.js rely on (the contract at the top of
 * routes/storefront.ts), the cart page and its promo code — through the real app, real Postgres,
 * the real catalogues and the public scenario fixtures.
 */

const DB = process.env.DATABASE_URL;
const SECRET = "gateway-secret-for-tests";
const here = dirname(fileURLToPath(import.meta.url));
const CORE_SQL = join(here, "..", "..", "gateway", "migrations");
const SHOPS_SQL = join(here, "..", "migrations");
const FIXTURES = join(here, "..", "test-fixtures", "shops-scenarios.json");
const NOINDEX = '<meta name="robots" content="noindex,nofollow">';
const JSON_ACCEPT = { accept: "application/json" };

const storeOf = (id: "wrenfield" | "halden" | "quillfeather"): StoreDef => STORES[id] as StoreDef;
const productOf = (store: StoreDef, sku: string): Product => store.products.find((p) => p.sku === sku) as Product;
const HALDEN = storeOf("halden");
const QUILLFEATHER = storeOf("quillfeather");
const WRENFIELD = storeOf("wrenfield");
const DRIFT = productOf(HALDEN, "HA-HP-DRIFT");

class CapturingMailer implements Mailer {
  sent: { ws: string; to: string; subject: string; body: string }[] = [];
  async deliver(ws: string, msg: { to: string; subject: string; body: string }) {
    this.sent.push({ ws, ...msg });
  }
}

let pool: Pool;
let app: FastifyInstance;
let carts: CartsRepo;

const scoped = (o: InjectOptions & { url: string }, wsId: string, site: string): InjectOptions => ({
  ...o,
  headers: { ...(o.headers ?? {}), [WORKSPACE_HEADER]: wsId, [WORKSPACE_SIG_HEADER]: signWorkspaceHeader(SECRET, wsId), "x-forwarded-prefix": `/w/${wsId}/${site}` },
});
const get = (site: string, path: string, wsId: string, headers: Record<string, string> = {}) => app.inject(scoped({ url: `/s/${site}${path}`, headers }, wsId, site));
type Form = Record<string, string | string[]>;
const encode = (form: Form) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(form)) for (const x of Array.isArray(v) ? v : [v]) p.append(k, x);
  return p.toString();
};
const post = (site: string, path: string, form: Form, wsId: string, headers: Record<string, string> = {}) =>
  app.inject(scoped({ method: "POST", url: `/s/${site}${path}`, payload: encode(form), headers: { "content-type": "application/x-www-form-urlencoded", ...headers } }, wsId, site));
const postJson = (site: string, path: string, body: object, wsId: string) =>
  app.inject(scoped({ method: "POST", url: `/s/${site}${path}`, payload: JSON.stringify(body), headers: { "content-type": "application/json", ...JSON_ACCEPT } }, wsId, site));
const cartJson = async (site: string, wsId: string) => (await get(site, "/cart.json", wsId, JSON_ACCEPT)).json() as CartJson;

type CartJson = {
  lines: { key: string; name: string; image: string; optionsLabel: string; qty: number; unitCents: number; totalCents: number; url: string }[];
  subtotalCents: number;
  count: number;
};

async function newWorkspace(): Promise<string> {
  const id = newWorkspaceId();
  await pool.query("INSERT INTO core.workspaces (id, scenario, seed, expires_at) VALUES ($1, 'shops-v1', 1, now() + interval '1 hour')", [id]);
  return id;
}

beforeAll(async () => {
  if (!DB) return;
  pool = createPool(DB, 4);
  await migrate(pool, "core", CORE_SQL);
  await migrate(pool, "shops", SHOPS_SQL);
  carts = new CartsRepo(pool);
  app = await buildShops({
    pool,
    gatewaySecret: SECRET,
    internalSecret: "internal-secret-for-tests",
    suffixKey: "k".repeat(32),
    scenarios: loadScenarioIndex(FIXTURES),
    payments: new FakePaymentGateway(),
    mailer: new CapturingMailer(),
    logLevel: "silent",
    now: () => new Date("2026-10-07T17:00:00Z"),
  });
});
afterAll(async () => {
  await app?.close();
  await pool?.end();
});

describe.skipIf(!DB)("the cart (real Postgres)", () => {
  it("adds from the product form, merging the same options into one line, and lists it as documented", async () => {
    const w = await newWorkspace();
    const first = await post("halden", "/cart/add", { sku: DRIFT.sku, opt_color: "black", qty: "1" }, w);
    expect(first.statusCode).toBe(303);
    expect(first.headers.location).toBe(`/w/${w}/halden/cart`);
    await post("halden", "/cart/add", { sku: DRIFT.sku, opt_color: "black", qty: "1" }, w);
    const cart = await cartJson("halden", w);
    expect(cart).toEqual({
      lines: [
        {
          key: lineKey({ sku: DRIFT.sku, options: { color: "black" } }),
          name: DRIFT.name,
          image: `/w/${w}/halden/assets/${DRIFT.images[0]}`,
          optionsLabel: "Black",
          qty: 2,
          unitCents: DRIFT.priceCents,
          totalCents: 2 * DRIFT.priceCents,
          url: `/w/${w}/halden/products/${DRIFT.slug}`,
        },
      ],
      subtotalCents: 2 * DRIFT.priceCents,
      count: 2,
    });
    // The header's count follows the cart on every page.
    expect((await get("halden", "/", w)).body).toMatch(/data-cart-count[^>]*>2</);
  });

  it("answers store.js with the cart as JSON, keeping different options on their own lines", async () => {
    const w = await newWorkspace();
    const a = await postJson("halden", "/cart/add", { sku: DRIFT.sku, opt_color: "black", qty: "1" }, w);
    expect(a.statusCode).toBe(200);
    expect(a.headers["content-type"]).toContain("application/json");
    const b = await post("halden", "/cart/add", { sku: DRIFT.sku, opt_color: "white", qty: "2" }, w, JSON_ACCEPT);
    expect(b.statusCode).toBe(200);
    const cart = b.json() as CartJson;
    const label = (id: string) => DRIFT.options[0]?.values.find((v) => v.id === id)?.label;
    expect(cart.lines.map((l) => [l.optionsLabel, l.qty])).toEqual([
      [label("black"), 1],
      [label("white"), 2],
    ]);
    expect(cart.count).toBe(3);
    expect(cart.subtotalCents).toBe(3 * DRIFT.priceCents);
  });

  it("updates and removes lines by key, from a form or from store.js", async () => {
    const w = await newWorkspace();
    await post("halden", "/cart/add", { sku: DRIFT.sku, opt_color: "black", qty: "1" }, w);
    await post("halden", "/cart/add", { sku: "HA-AC-CASE", qty: "1" }, w);
    const key = lineKey({ sku: DRIFT.sku, options: { color: "black" } });
    const up = await post("halden", "/cart/update", { key, qty: "3" }, w, JSON_ACCEPT);
    expect(up.statusCode).toBe(200);
    expect((up.json() as CartJson).lines.find((l) => l.key === key)?.qty).toBe(3);
    const form = await post("halden", "/cart/update", { key, qty: "0" }, w);
    expect(form.statusCode).toBe(303);
    expect(form.headers.location).toBe(`/w/${w}/halden/cart`);
    expect((await cartJson("halden", w)).lines.map((l) => l.name)).toEqual([productOf(HALDEN, "HA-AC-CASE").name]);
    const caseKey = lineKey({ sku: "HA-AC-CASE", options: {} });
    const rm = await post("halden", "/cart/remove", { key: caseKey }, w, JSON_ACCEPT);
    expect(rm.json()).toEqual({ lines: [], subtotalCents: 0, count: 0 });
    // A key that is not in the cart, or a quantity that is not a number, changes nothing.
    await post("halden", "/cart/add", { sku: "HA-AC-CASE", qty: "2" }, w);
    await post("halden", "/cart/update", { key: "nope", qty: "5" }, w);
    await post("halden", "/cart/update", { key: caseKey, qty: "lots" }, w);
    expect((await cartJson("halden", w)).count).toBe(2);
  });

  it("refuses a sold-out option with a message, not a 500", async () => {
    const w = await newWorkspace();
    const json = await postJson("halden", "/cart/add", { sku: DRIFT.sku, opt_color: "coral", qty: "1" }, w);
    expect(json.statusCode).toBe(422);
    expect(json.json()).toMatchObject({ error: "SOLD_OUT" });
    expect((json.json() as { message: string }).message).toMatch(/sold out/i);
    const page = await post("halden", "/cart/add", { sku: DRIFT.sku, opt_color: "coral", qty: "1" }, w);
    expect(page.statusCode).toBe(422);
    expect(page.headers["content-type"]).toContain("text/html");
    expect(page.body).toMatch(/sold out/i);
    expect(page.body).toContain(NOINDEX);
    expect(page.body).toContain(`href="/w/${w}/halden/products/${DRIFT.slug}"`);
    expect((await cartJson("halden", w)).lines).toEqual([]);
  });

  it("refuses an unknown product, an unknown or missing option, and a subscription it does not sell", async () => {
    const w = await newWorkspace();
    const err = async (site: string, body: object) => {
      const r = await postJson(site, "/cart/add", body, w);
      return [r.statusCode, (r.json() as { error: string }).error];
    };
    expect(await err("halden", { sku: "HA-NOPE", qty: "1" })).toEqual([422, "UNKNOWN_SKU"]);
    expect(await err("halden", { sku: DRIFT.sku, opt_color: "plaid", qty: "1" })).toEqual([422, "INVALID"]);
    expect(await err("halden", { sku: DRIFT.sku, qty: "1" })).toEqual([422, "INVALID"]);
    expect(await err("halden", { sku: "HA-AC-CASE", mode: "subscribe", interval: "4 weeks", qty: "1" })).toEqual([422, "INVALID"]);
    expect(await err("quillfeather", { sku: "QF-ETH-GUJI", opt_size: "12oz", opt_grind: "drip", mode: "subscribe", interval: "3 days", qty: "1" })).toEqual([422, "INVALID"]);
    // Another store's SKU is unknown here.
    expect(await err("wrenfield", { sku: DRIFT.sku, opt_color: "black", qty: "1" })).toEqual([422, "UNKNOWN_SKU"]);
    expect((await cartJson("halden", w)).lines).toEqual([]);
  });

  it("keeps a subscription apart from a one-time bag and prices it 15 % lower", async () => {
    const w = await newWorkspace();
    const guji = productOf(QUILLFEATHER, "QF-ETH-GUJI");
    const opts = { sku: guji.sku, opt_size: "12oz", opt_grind: "drip", qty: "1" };
    await post("quillfeather", "/cart/add", { ...opts, mode: "once", interval: "4 weeks" }, w); // the form always sends an interval
    await post("quillfeather", "/cart/add", { ...opts, mode: "subscribe", interval: "4 weeks" }, w);
    const cart = await cartJson("quillfeather", w);
    expect(cart.lines.map((l) => [l.optionsLabel, l.unitCents])).toEqual([
      ["12 oz / Drip", guji.priceCents],
      ["12 oz / Drip / Every 4 weeks", Math.round((guji.priceCents * 85) / 100)],
    ]);
    const rows = await carts.get(w, "quillfeather");
    expect(rows.lines[0]).not.toHaveProperty("interval");
    expect(rows.lines[1]).toMatchObject({ mode: "subscribe", interval: "4 weeks" });
  });

  it("refuses a quantity no one can buy with a sentence that says which: not a whole number, under one, over ten (finding 22)", async () => {
    const w = await newWorkspace();
    for (const qty of ["0", "-5", "abc", "1.5", "1e3", "12", "999999", "1000000000"]) {
      const r = await postJson("halden", "/cart/add", { sku: "HA-AC-CASE", qty }, w);
      expect(r.statusCode, qty).toBe(422);
      expect(r.json(), qty).toEqual({ error: "INVALID", message: "Choose a quantity from 1 to 10." });
    }
    // Four left: the range says so.
    expect((await postJson("halden", "/cart/add", { sku: "HA-HP-SKERRY", qty: "0" }, w)).json()).toMatchObject({ message: "Choose a quantity from 1 to 4." });
    const form = await post("halden", "/cart/add", { sku: "HA-AC-CASE", qty: "-5" }, w);
    expect(form.statusCode).toBe(422);
    expect(form.body).toContain("Choose a quantity from 1 to 10.");
    expect((await cartJson("halden", w)).lines).toEqual([]);
    // Nothing typed: one, as a product page's stepper starts.
    expect((await postJson("halden", "/cart/add", { sku: "HA-AC-CASE" }, w)).json()).toMatchObject({ count: 1 });
  });

  it("caps a line at the stock left, and says so in the drawer's answer and on the cart page (finding 22)", async () => {
    const w = await newWorkspace();
    const skerry = productOf(HALDEN, "HA-HP-SKERRY");
    const said = `We have only 4 of ${skerry.name} in stock, so your cart has 4.`;
    const first = await postJson("halden", "/cart/add", { sku: skerry.sku, qty: "9" }, w);
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ count: 4, notice: said });
    // At the cap already: nothing is added, and the answer says why.
    expect((await postJson("halden", "/cart/add", { sku: skerry.sku, qty: "1" }, w)).json()).toMatchObject({ count: 4, notice: said });
    // Without JavaScript: the cart page says it.
    const form = await post("halden", "/cart/add", { sku: skerry.sku, qty: "2" }, w);
    expect(form.statusCode).toBe(303);
    const page = (await get("halden", (form.headers.location as string).replace(`/w/${w}/halden`, ""), w)).body;
    expect(page).toContain(esc(said));
    // An add that fits says nothing of the kind.
    expect((await postJson("halden", "/cart/add", { sku: "HA-AC-CASE", qty: "2" }, w)).json()).not.toHaveProperty("notice");
  });

  it("caps a line at ten across adds and updates, and says so; an impossible update is refused (finding 22)", async () => {
    const w = await newWorkspace();
    const box = productOf(HALDEN, "HA-AC-CASE");
    const said = `You can buy up to 10 of ${box.name} in one order, so your cart has 10.`;
    await postJson("halden", "/cart/add", { sku: box.sku, qty: "8" }, w);
    expect((await postJson("halden", "/cart/add", { sku: box.sku, qty: "5" }, w)).json()).toMatchObject({ count: 10, notice: said });
    const key = lineKey({ sku: box.sku, options: {} });
    await postJson("halden", "/cart/update", { key, qty: "3" }, w);
    // The drawer's "+" past the cap, or a script asking for more.
    expect((await postJson("halden", "/cart/update", { key, qty: "50" }, w)).json()).toMatchObject({ count: 10, notice: said });
    const form = await post("halden", "/cart/update", { key, qty: "11" }, w);
    expect((await get("halden", (form.headers.location as string).replace(`/w/${w}/halden`, ""), w)).body).toContain(esc(said));
    for (const qty of ["-1", "lots", "2.5"]) {
      const r = await postJson("halden", "/cart/update", { key, qty }, w);
      expect(r.statusCode, qty).toBe(422);
      expect(r.json(), qty).toEqual({ error: "INVALID", message: "Choose a quantity from 0 to 10." });
    }
    expect((await cartJson("halden", w)).count).toBe(10);
  });

  it("renders the cart page: lines, subtotal, the code field and the way to checkout, all under the prefix", async () => {
    const w = await newWorkspace();
    await post("halden", "/cart/add", { sku: DRIFT.sku, opt_color: "black", qty: "2" }, w);
    const res = await get("halden", "/cart", w);
    expect(res.statusCode).toBe(200);
    const html = res.body;
    expect(html).toContain(NOINDEX);
    expect(html).toContain(`${HALDEN.brand.name} is a fictional store operated for research. Orders are not fulfilled.`);
    expect(html).toContain(esc(DRIFT.name));
    expect(html).toContain(formatUsd(2 * DRIFT.priceCents));
    expect(html).toMatch(new RegExp(`<form[^>]*action="/w/${w}/halden/checkout"`));
    expect(html).toContain(`formaction="/w/${w}/halden/cart/promo"`);
    expect(html).toMatch(/name="code"/);
    const local = [...html.matchAll(/(?:href|action|src|formaction)="(\/[^"]*)"/g)].map((m) => m[1] as string);
    for (const u of local) expect(u.startsWith(`/w/${w}/halden/`), u).toBe(true);
    // Empty: says so, and offers the shop.
    const empty = (await get("halden", "/cart", await newWorkspace())).body;
    expect(empty).toContain("Your cart is empty");
  });

  it("applies a promo code to the cart, case-insensitively, and shows the discount", async () => {
    const w = await newWorkspace();
    await post("halden", "/cart/add", { sku: DRIFT.sku, opt_color: "black", qty: "1" }, w);
    const res = await post("halden", "/cart/promo", { code: " welcome10 " }, w);
    expect(res.statusCode).toBe(303);
    expect((await carts.get(w, "halden")).promo).toBe("WELCOME10");
    const html = (await get("halden", "/cart", w)).body;
    expect(html).toContain("WELCOME10");
    expect(html).toContain(`−${formatUsd(Math.floor((DRIFT.priceCents * 1000 + 5000) / 10000))}`);
  });

  it("refuses a code it does not know with a friendly message and keeps the code applied before", async () => {
    const w = await newWorkspace();
    await post("halden", "/cart/add", { sku: DRIFT.sku, opt_color: "black", qty: "1" }, w);
    await post("halden", "/cart/promo", { code: "WELCOME10" }, w);
    const res = await post("halden", "/cart/promo", { code: "FREESTUFF" }, w);
    expect(res.statusCode).toBe(303);
    const html = (await get("halden", (res.headers.location as string).replace(`/w/${w}/halden`, ""), w)).body;
    expect(html).toContain("This code isn&#39;t valid");
    expect(html).toContain("FREESTUFF");
    expect((await carts.get(w, "halden")).promo).toBe("WELCOME10");
    const json = await postJson("halden", "/cart/promo", { code: "<b>nope</b>" }, w);
    expect(json.statusCode).toBe(422);
    expect(json.json()).toMatchObject({ error: "INVALID_CODE" });
    // Removing it.
    await post("halden", "/cart/promo", { remove: "1" }, w);
    expect((await carts.get(w, "halden")).promo).toBeNull();
  });

  it("keeps a known code that needs a bigger order, and says what it needs", async () => {
    const w = await newWorkspace();
    await post("wrenfield", "/cart/add", { sku: "WF-PL-LACE-ALOE", qty: "1" }, w); // under SPRING15's minimum
    await post("wrenfield", "/cart/promo", { code: "spring15" }, w);
    expect((await carts.get(w, "wrenfield")).promo).toBe("SPRING15");
    const html = (await get("wrenfield", "/cart", w)).body;
    const min = WRENFIELD.promoCodes.SPRING15?.minSubtotalCents as number;
    expect(html).toContain(`SPRING15 applies to orders of $${min / 100} or more`);
  });

  it("keeps carts apart by workspace and by store", async () => {
    const a = await newWorkspace();
    const b = await newWorkspace();
    await post("halden", "/cart/add", { sku: DRIFT.sku, opt_color: "black", qty: "1" }, a);
    expect((await cartJson("halden", b)).lines).toEqual([]);
    expect((await cartJson("quillfeather", a)).lines).toEqual([]);
  });

  it("is a store's: paylantern has no cart", async () => {
    const w = await newWorkspace();
    expect((await get("paylantern", "/cart", w)).statusCode).toBe(404);
    expect((await get("paylantern", "/cart.json", w, JSON_ACCEPT)).statusCode).toBe(404);
    expect((await post("paylantern", "/cart/add", { sku: DRIFT.sku }, w)).statusCode).toBe(404);
  });
});
