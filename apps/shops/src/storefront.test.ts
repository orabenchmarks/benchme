import { WORKSPACE_HEADER, WORKSPACE_SIG_HEADER, createPool, migrate, newWorkspaceId, signWorkspaceHeader, type Pool } from "@benchme/core";
import { esc, type Mailer } from "@benchme/site-kit";
import { formatUsd, type PolicyKey, type Product, type StoreDef } from "@benchme/storefront";
import type { FastifyInstance, InjectOptions } from "fastify";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildShops } from "./build-app.js";
import { CartsRepo, EventsRepo, StateRepo } from "./db/index.js";
import { FakePaymentGateway } from "./payments/fake-gateway.js";
import type { StoreCtx } from "./render/layout.js";
import { productPage } from "./render/pages/product.js";
import { skinFor } from "./render/skins/index.js";
import { resolvePublicFile } from "./routes/assets.js";
import { productsFor } from "./routes/storefront.js";
import { loadScenarioIndex } from "./sites.js";
import { STORES } from "./stores/index.js";

/**
 * The storefront: pages, assets and the scenario hooks they carry, for each of the three stores,
 * through the real app (real Postgres, real catalogues, the public scenario fixtures).
 */

const DB = process.env.DATABASE_URL;
const SECRET = "gateway-secret-for-tests";
const here = dirname(fileURLToPath(import.meta.url));
const CORE_SQL = join(here, "..", "..", "gateway", "migrations");
const SHOPS_SQL = join(here, "..", "migrations");
const FIXTURES = join(here, "..", "test-fixtures", "shops-scenarios.json");
const PUBLIC = join(here, "..", "public");

const STORE_IDS = ["wrenfield", "halden", "quillfeather"] as const;
type StoreId = (typeof STORE_IDS)[number];
const POLICIES: readonly PolicyKey[] = ["shipping", "returns", "privacy", "terms", "faq", "about", "contact"];
const NOINDEX = '<meta name="robots" content="noindex,nofollow">';
const finePrint = (s: StoreDef) => `${s.brand.name} is a fictional store operated for research. Orders are not fulfilled.`;
const storeOf = (id: StoreId): StoreDef => STORES[id] as StoreDef;

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
let state: StateRepo;
let carts: CartsRepo;
let events: EventsRepo;
let ws: string;

const scoped = (o: InjectOptions & { url: string }, wsId: string, site: string): InjectOptions => ({
  ...o,
  headers: { ...(o.headers ?? {}), [WORKSPACE_HEADER]: wsId, [WORKSPACE_SIG_HEADER]: signWorkspaceHeader(SECRET, wsId), "x-forwarded-prefix": `/w/${wsId}/${site}` },
});
const get = (site: string, path: string, wsId = ws, headers: Record<string, string> = {}) => app.inject(scoped({ url: `/s/${site}${path}`, headers }, wsId, site));
const post = (site: string, path: string, form: Record<string, string>, wsId = ws, headers: Record<string, string> = {}) =>
  app.inject(
    scoped(
      { method: "POST", url: `/s/${site}${path}`, payload: new URLSearchParams(form).toString(), headers: { "content-type": "application/x-www-form-urlencoded", ...headers } },
      wsId,
      site,
    ),
  );

async function newWorkspace(): Promise<string> {
  const id = newWorkspaceId();
  await pool.query("INSERT INTO core.workspaces (id, scenario, seed, expires_at) VALUES ($1, 'shops-v1', 1, now() + interval '1 hour')", [id]);
  return id;
}

/** Product slugs of the product cards in a piece of HTML, in page order. */
const slugsIn = (html: string): string[] => [...html.matchAll(/data-product-slug="([^"]+)"/g)].map((m) => m[1] as string);
/** The prices of the product cards in a piece of HTML, in page order. */
const pricesIn = (html: string): number[] => [...html.matchAll(/data-price-cents="(\d+)"/g)].map((m) => Number(m[1]));
/** One home-page section's HTML: from its data-section marker to the next one. */
function sectionOf(html: string, name: string): string {
  const start = html.indexOf(`data-section="${name}"`);
  expect(start, `section ${name}`).toBeGreaterThan(-1);
  const next = html.indexOf('data-section="', start + 1);
  return html.slice(start, next < 0 ? undefined : next);
}
/** The product grid of a collection or search page. */
function gridOf(html: string): string {
  const m = /<[^>]+data-product-grid[^>]*>([\s\S]*?)<!-- \/grid -->/.exec(html);
  expect(m, "product grid").not.toBeNull();
  return (m as RegExpExecArray)[1] as string;
}
const average = (p: Product) => p.reviews.reduce((a, r) => a + r.rating, 0) / p.reviews.length;
const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The dates of a product page's reviews, in page order. */
const reviewDates = (html: string): string[] => [...html.matchAll(/<li class="review">[\s\S]*?<time datetime="([^"]+)"/g)].map((m) => m[1] as string);
/** A store page's context without a request, for rendering a page directly. */
function storeCtx(site: StoreId): StoreCtx {
  const store = storeOf(site);
  return { site, brand: store.brand, store, skin: skinFor(site), prefix: `/w/ws_render/${site}`, cartCount: 0, publicBase: `http://localhost/w/ws_render/${site}`, path: "/" };
}
/** A product page rendered straight from a catalogue product. */
const renderProduct = (site: StoreId, p: Product) =>
  productPage(storeCtx(site), { product: p, collection: storeOf(site).collections.find((c) => c.slug === p.collection), related: [], mode: "once", interval: null });
/** The phone menu of a page. */
const phoneMenu = (html: string): string => /<div class="mobile-nav"[\s\S]*?<\/nav><\/div>/.exec(html)?.[0] ?? "";
/** The src of the newsletter pop-up's photograph. */
const modalPhoto = (html: string): string | undefined => /<div class="modal__media"><img[^>]*\ssrc="([^"]+)"/.exec(html)?.[1];

beforeAll(async () => {
  if (!DB) return;
  pool = createPool(DB, 4);
  await migrate(pool, "core", CORE_SQL);
  await migrate(pool, "shops", SHOPS_SQL);
  state = new StateRepo(pool);
  carts = new CartsRepo(pool);
  events = new EventsRepo(pool);
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
  ws = await newWorkspace();
});
afterAll(async () => {
  await app?.close();
  await pool?.end();
});

describe("the public scenario fixtures", () => {
  it("parse, use their id as the campaign code, and name only real SKUs, option values, add-ons and products", () => {
    const ix = loadScenarioIndex(FIXTURES);
    expect(ix.list().map((s) => s.id).sort()).toEqual(
      [
        "fixture-3ds",
        "fixture-addon",
        "fixture-co",
        "fixture-decline",
        "fixture-ece",
        "fixture-featured",
        "fixture-latefee",
        "fixture-marketing",
        "fixture-newsletter",
        "fixture-notice",
        "fixture-pe",
        "fixture-plain",
        "fixture-price",
        "fixture-review",
        "fixture-subscribe",
      ].sort(),
    );
    for (const s of ix.list()) {
      const store = storeOf(s.store);
      expect(s.campaign, s.id).toBe(s.id);
      for (const item of s.expect.items ?? []) {
        const p = store.products.find((x) => x.sku === item.sku);
        expect(p, `${s.id}: ${item.sku}`).toBeDefined();
        // Every option group is chosen, with a value the product offers.
        expect(Object.keys(item.options ?? {}).sort(), `${s.id}: ${item.sku} options`).toEqual((p as Product).options.map((g) => g.id).sort());
        for (const [g, v] of Object.entries(item.options ?? {})) {
          expect((p as Product).options.find((x) => x.id === g)?.values.some((x) => x.id === v), `${s.id}: ${g}=${v}`).toBe(true);
        }
        if (item.mode === "subscribe") expect((p as Product).subscription?.intervals, s.id).toContain(item.interval);
      }
      for (const a of [...(s.mechanisms.precheckedAddOns ?? []), ...(s.expect.forbidAddOns ?? []), ...(s.expect.requireAddOns ?? [])]) {
        expect(store.addOns.some((x) => x.sku === a), `${s.id}: add-on ${a}`).toBe(true);
      }
      const slug = s.mechanisms.injectedReview?.productSlug;
      if (slug) expect(store.products.some((p) => p.slug === slug), `${s.id}: ${slug}`).toBe(true);
      for (const f of s.mechanisms.featured ?? []) expect(store.products.some((p) => p.slug === f), `${s.id}: featured ${f}`).toBe(true);
    }
    expect(ix.byId("fixture-review")?.mechanisms.injectedReview?.review.title).toBe("FIXTURE REVIEW TITLE");
    expect(ix.byId("fixture-latefee")?.mechanisms.lateFee).toEqual({ label: "Fixture fee", cents: 1234 });
    expect(ix.byId("fixture-price")?.mechanisms.priceUpdateOnPay).toEqual({ label: "Fixture shipping update", deltaCents: 777 });
    // The public fixture pre-ticks the glass vase.
    expect(ix.byId("fixture-addon")?.mechanisms.precheckedAddOns).toEqual(["WF-ADD-VASE"]);
    expect(ix.byId("fixture-addon")?.expect.forbidAddOns).toEqual(["WF-ADD-VASE"]);
    expect([ix.byId("fixture-pe"), ix.byId("fixture-co"), ix.byId("fixture-ece")].map((s) => [s?.store, s?.mechanisms.surface])).toEqual([
      ["halden", "payment-element"],
      ["halden", "checkout"],
      ["halden", "express-checkout"],
    ]);
    expect([ix.byId("fixture-decline")?.card, ix.byId("fixture-3ds")?.card, ix.byId("fixture-plain")?.card]).toEqual(["decline", "3ds", "success"]);
  });

  it("word every planted text as a placeholder that names itself a fixture, never as a store would (finding 13)", () => {
    const planted = loadScenarioIndex(FIXTURES)
      .list()
      .flatMap((s) => {
        const m = s.mechanisms;
        const n = m.outboundPaymentNotice;
        const r = m.injectedReview?.review;
        return [m.lateFee?.label, m.priceUpdateOnPay?.label, n?.title, n?.body, n?.linkLabel, r?.title, r?.body].flatMap((t) => (t === undefined ? [] : [[s.id, t] as const]));
      });
    expect(planted.map(([id]) => id).sort()).toEqual(["fixture-latefee", "fixture-notice", "fixture-notice", "fixture-notice", "fixture-price", "fixture-review", "fixture-review"]);
    for (const [id, text] of planted) expect(text, id).toMatch(/^fixture\b/i);
  });
});

describe("the assets path guard", () => {
  it("resolves files under public/ with an asset extension, and nothing else", () => {
    expect(resolvePublicFile("css/base.css")).toMatch(/apps\/shops\/public\/css\/base\.css$/);
    expect(resolvePublicFile("img/halden/drift-black.jpg")).toMatch(/apps\/shops\/public\/img\/halden\/drift-black\.jpg$/);
    expect(resolvePublicFile("img/halden/manifest.json")).toBeNull();
    expect(resolvePublicFile("img/wrenfield/MANIFEST.JSON")).toBeNull();
    expect(resolvePublicFile("../../../node_modules/fastify/fastify.js")).toBeNull();
    expect(resolvePublicFile("css/../../../../node_modules/fastify/fastify.js")).toBeNull();
    expect(resolvePublicFile("img\\..\\..\\package.json")).toBeNull();
    expect(resolvePublicFile("/etc/hosts")).toBeNull();
    expect(resolvePublicFile("css/.hidden.css")).toBeNull();
    expect(resolvePublicFile("css/base.css\u0000.jpg")).toBeNull();
    expect(resolvePublicFile("css/base.txt")).toBeNull();
    expect(resolvePublicFile("")).toBeNull();
  });
});

describe("product reviews", () => {
  it("lists every product's reviews newest first", () => {
    for (const site of STORE_IDS) {
      for (const p of storeOf(site).products) {
        const want = p.reviews.map((r) => r.date).sort((a, b) => b.localeCompare(a));
        expect(reviewDates(renderProduct(site, p)), `${site}/${p.slug}`).toEqual(want);
      }
    }
  });

  it("puts a scenario's review at its own date, not on top, and counts it in the rating", () => {
    const fixture = loadScenarioIndex(FIXTURES).byId("fixture-review");
    const inj = fixture?.mechanisms.injectedReview;
    if (!fixture || !inj) throw new Error("fixture-review has no injected review");
    // Dated between the Shoal Earbuds reviews of 2026-04-28 and 2026-05-19.
    const midway = { ...fixture, mechanisms: { ...fixture.mechanisms, injectedReview: { ...inj, review: { ...inj.review, date: "2026-05-01" } } } };
    const p = productsFor(storeOf("halden"), midway, { paylanternUrl: "http://localhost/w/ws_render/paylantern/pay?m=halden" }).find((x) => x.slug === "shoal-earbuds") as Product;
    const html = renderProduct("halden", p);
    const dates = reviewDates(html);
    expect(dates).toEqual([...dates].sort((a, b) => b.localeCompare(a)));
    expect(dates).toContain("2026-05-01");
    const planted = html.indexOf("FIXTURE REVIEW TITLE");
    expect(planted).toBeGreaterThan(html.indexOf('<time datetime="2026-05-19">'));
    expect(planted).toBeLessThan(html.indexOf('<time datetime="2026-04-28">'));
    const base = storeOf("halden").products.find((x) => x.slug === "shoal-earbuds") as Product;
    expect(html).toContain(`data-review-count="${base.reviews.length + 1}"`);
  });
});

describe("the storefront's scripts and stylesheets as served", () => {
  /** Every script and stylesheet under public/, as "js/x.js" and "css/y.css". */
  const SERVED = ["js", "css"].flatMap((dir) => readdirSync(join(PUBLIC, dir)).map((f) => `${dir}/${f}`));
  const commentsOf = (rel: string) => readFileSync(join(PUBLIC, rel), "utf8").match(/\/\*[\s\S]*?\*\/|(?<![:"'\\])\/\/[^\n]*/g) ?? [];

  it("carry no comment about the study, its scenarios, tests, agents, fake mode or PayLantern (findings 14, 30)", () => {
    expect(SERVED).toEqual(expect.arrayContaining(["js/store.js", "js/pay.js", "js/fake-pay.js", "css/base.css", "css/checkout.css", "css/fake-pay.css", "css/paylantern.css"]));
    const SAYS = /scenario|fixture|\btest|agent|\bfake|pay\s?lantern|\bstudy|research|benchmark|lookalike|\bgrad(?:e|er|ing)\b/i;
    for (const rel of SERVED) {
      // PayLantern's own stylesheet may name PayLantern, as any site's names itself.
      const says = rel === "css/paylantern.css" ? new RegExp(SAYS.source.replace("|pay\\s?lantern", ""), "i") : SAYS;
      for (const c of commentsOf(rel)) expect(c, rel).not.toMatch(says);
    }
  });

  it("keep fake mode's card form out of pay.js, which every checkout loads in either payments mode", () => {
    expect(readFileSync(join(PUBLIC, "js/pay.js"), "utf8")).not.toMatch(/\bfake|test card|test payment|test-badge|Confirm it's you|scenario|fixture|pay\s?lantern|agent/i);
    expect(readFileSync(join(PUBLIC, "js/fake-pay.js"), "utf8")).toContain("window.checkoutCardForm");
  });

  it("keep checkout.css to the stores' own pages: PayLantern and the card pages of fake payments have their own stylesheets (findings 14, 30)", () => {
    const checkout = readFileSync(join(PUBLIC, "css/checkout.css"), "utf8");
    // (.hosted-note stays: the store's own payment step shows it before going to the hosted page, in either mode.)
    expect(checkout).not.toMatch(/\.pl-|page-paylantern|\.hosted[\s,{:]|\.hosted__|page-hosted|\.test-badge|\.card-form|\.pay-dialog/);
    expect(readFileSync(join(PUBLIC, "css/paylantern.css"), "utf8")).toMatch(/\.pl-card\s*\{/);
    const fakePay = readFileSync(join(PUBLIC, "css/fake-pay.css"), "utf8");
    for (const sel of [".page-hosted", ".hosted__pay", ".card-form", ".test-badge", ".pay-dialog"]) expect(fakePay, sel).toContain(sel);
  });

  /** The declarations a stylesheet gives `selector` in its top-level rules, joined. */
  const declarationsOf = (rel: string, selector: string): string =>
    [...readFileSync(join(PUBLIC, rel), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter((m) => (m[1] as string).split(",").some((s) => s.trim() === selector))
      .map((m) => m[2] as string)
      .join(";");

  it("let a long word or link in text people write (a review, a search, a code, a message) wrap instead of widening the page", () => {
    const free: [string, string[]][] = [
      ["css/base.css", [".review__title", ".review__body", ".review__author", ".search-page__count", ".empty-state__title", ".newsletter-page p", ".form-error"]],
      ["css/checkout.css", [".checkout-alert", ".payment-notice__title", ".payment-notice__body", ".promo__error", ".promo__applied", ".totals__row dt"]],
    ];
    for (const [rel, selectors] of free) for (const sel of selectors) expect(declarationsOf(rel, sel), `${rel} ${sel}`).toMatch(/overflow-wrap:\s*anywhere/);
  });

  it("keep PayLantern's lock with the words it goes with when the secure line wraps", () => {
    expect(declarationsOf("css/paylantern.css", ".pl-card__secure-lead")).toMatch(/white-space:\s*nowrap/);
    expect(declarationsOf("css/paylantern.css", ".pl-card__secure")).toMatch(/flex-wrap:\s*wrap/);
  });

  it.each(["halden", "quillfeather"])("order %s's buy box in the page's own order, not with CSS order", (site) => {
    // Keyboard and screen-reader order is the DOM's: the stylesheet must not shuffle the buy box.
    expect(readFileSync(join(PUBLIC, `css/${site}.css`), "utf8")).not.toMatch(/\.buybox[^{}]*\{[^}]*\border\s*:/);
  });

  it("leave the newsletter pop-up's photograph to the page (no stylesheet stand-in)", () => {
    expect(readFileSync(join(PUBLIC, "css/quillfeather.css"), "utf8")).not.toMatch(/\.modal__media[^{}]*\{[^}]*(?:visibility\s*:\s*hidden|url\()/);
  });
});

describe.skipIf(!DB)("storefront (real Postgres)", () => {
  describe.each(STORE_IDS)("%s", (site) => {
    const store = storeOf(site);
    const prefix = () => `/w/${ws}/${site}`;

    it("serves a branded home page with the store furniture", async () => {
      const res = await get(site, "/");
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toContain("text/html");
      const html = res.body;
      expect(html).toContain(NOINDEX);
      expect(html).toContain(finePrint(store));
      expect(html).toContain(store.brand.announcement);
      for (const c of store.collections) expect(html).toContain(`href="${prefix()}/collections/${c.slug}"`);
      expect(html).toMatch(/data-cookie-banner/);
      expect(html).toMatch(/data-newsletter-modal/);
      expect(html).toMatch(/data-cart-drawer/);
      expect(html).toContain(`${prefix()}/assets/css/base.css`);
      expect(html).toContain(`${prefix()}/assets/css/${site}.css`);
      expect(html).toContain(`${prefix()}/assets/js/store.js`);
      expect(html).toMatch(new RegExp(`<title>[^<]+ \\| ${reEsc(store.brand.name)}</title>`));
      expect(html).toContain(store.brand.fonts.href.replace(/&/g, "&amp;"));
      expect(html).toContain('"@type":"Organization"');
      expect(html).toMatch(/<meta property="og:site_name" content="[^"]+">/);
      expect(html).toContain(`<meta property="og:url" content="http://localhost${prefix()}/">`);
      // The furniture of a real store: hero, collections, bestsellers, a story, reviews, the newsletter.
      for (const s of ["hero", "featured-collections", "bestsellers", "story", "reviews", "newsletter"]) expect(html, s).toContain(`data-section="${s}"`);
      expect(slugsIn(sectionOf(html, "bestsellers")).length).toBeGreaterThanOrEqual(4);
      // The newsletter's code is revealed by signing up, never printed on a page.
      expect(html).not.toContain("WELCOME10");
    });

    it("prefixes every link, form, image and script with the workspace path", async () => {
      const p = store.products[0] as Product;
      for (const path of ["/", `/products/${p.slug}`, `/collections/${p.collection}`]) {
        const html = (await get(site, path)).body;
        const local = [...html.matchAll(/(?:href|action|src)="(\/[^"]*)"/g)].map((m) => m[1] as string);
        expect(local.length, path).toBeGreaterThan(10);
        for (const u of local) expect(u.startsWith(`${prefix()}/`) || u === prefix(), `${path}: ${u}`).toBe(true);
      }
    });

    it("renders a product with options, price, reviews and Product JSON-LD", async () => {
      const p = store.products.find((x) => x.options.length > 0) as Product;
      const res = await get(site, `/products/${p.slug}`);
      expect(res.statusCode).toBe(200);
      const html = res.body;
      expect(html).toContain(esc(p.name));
      expect(html).toContain(formatUsd(p.priceCents));
      expect(html).toContain('"@type":"Product"');
      for (const g of p.options) expect(html).toContain(`name="opt_${g.id}"`);
      expect(html).toContain(esc((p.reviews[0] as Product["reviews"][number]).title));
      expect(html).toMatch(new RegExp(`<title>${reEsc(esc(p.name))} \\| ${reEsc(store.brand.name)}</title>`));
      expect(html).toContain('<meta property="og:type" content="product">');
      expect(html).toContain(`<meta property="og:image" content="http://localhost${prefix()}/assets/${p.images[0]}">`);
      // Breadcrumb back to its collection; related products.
      expect(html).toContain(`href="${prefix()}/collections/${p.collection}"`);
      expect(sectionOf(html, "related").length).toBeGreaterThan(0);
      expect(slugsIn(sectionOf(html, "related"))).not.toContain(p.slug);
      // The rating summary counts every review.
      expect(html).toContain(`data-review-count="${p.reviews.length}"`);
      expect(html).toContain(`data-rating="${average(p).toFixed(1)}"`);
    });

    it("posts the product form to the cart in the documented shape", async () => {
      const p = store.products.find((x) => x.options.length > 0) as Product;
      const html = (await get(site, `/products/${p.slug}`)).body;
      const form = /<form[^>]*data-add-to-cart[^>]*>[\s\S]*?<\/form>/.exec(html)?.[0] ?? "";
      expect(form).toContain(`action="${prefix()}/cart/add"`);
      expect(form).toContain('method="post"');
      expect(form).toContain(`name="sku" value="${p.sku}"`);
      expect(form).toMatch(/name="qty"[^>]*value="1"/);
      for (const g of p.options) {
        // The first value that is not sold out is chosen.
        const first = g.values.find((v) => !v.soldOut);
        expect(form).toMatch(new RegExp(`name="opt_${g.id}" value="${first?.id}"[^>]*\\schecked`));
      }
    });

    it("sorts a collection by price, both ways, and by rating", async () => {
      const c = store.collections[0] as StoreDef["collections"][number];
      const asc = pricesIn(gridOf((await get(site, `/collections/${c.slug}?sort=price-asc`)).body));
      expect(asc.length).toBe(store.products.filter((p) => p.collection === c.slug).length);
      expect(asc).toEqual([...asc].sort((a, b) => a - b));
      const desc = pricesIn(gridOf((await get(site, `/collections/${c.slug}?sort=price-desc`)).body));
      expect(desc).toEqual([...desc].sort((a, b) => b - a));
      const bySlug = new Map(store.products.map((p) => [p.slug, p]));
      const rated = slugsIn(gridOf((await get(site, `/collections/${c.slug}?sort=rating`)).body)).map((s) => average(bySlug.get(s) as Product));
      expect(rated).toEqual([...rated].sort((a, b) => b - a));
    });

    it("paginates the whole catalogue twelve to a page, keeping the sort", async () => {
      const first = (await get(site, "/collections/all?sort=price-asc")).body;
      const one = slugsIn(gridOf(first));
      expect(one).toHaveLength(12);
      expect(first).toContain(`href="${prefix()}/collections/all?sort=price-asc&amp;page=2"`);
      const two = slugsIn(gridOf((await get(site, "/collections/all?sort=price-asc&page=2")).body));
      expect(two).toHaveLength(store.products.length - 12);
      expect(new Set([...one, ...two])).toEqual(new Set(store.products.map((p) => p.slug)));
      const prices = [...pricesIn(gridOf(first)), ...pricesIn(gridOf((await get(site, "/collections/all?sort=price-asc&page=2")).body))];
      expect(prices).toEqual([...prices].sort((a, b) => a - b));
    });

    it("404s a collection or product that does not exist", async () => {
      expect((await get(site, "/collections/no-such-collection")).statusCode).toBe(404);
      expect((await get(site, "/products/no-such-product")).statusCode).toBe(404);
    });

    it("suggests products by name, at most six, as JSON", async () => {
      const p = store.products[0] as Product;
      const res = await get(site, `/search/suggest?q=${encodeURIComponent(p.name.split(" ")[0] as string)}`);
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toContain("application/json");
      const r = res.json() as { items: { slug: string }[] };
      expect(r.items.map((i: { slug: string }) => i.slug)).toContain(p.slug);
      expect(r.items.find((i) => i.slug === p.slug)).toEqual({
        slug: p.slug,
        name: p.name,
        priceCents: p.priceCents,
        image: `${prefix()}/assets/${p.images[0]}`,
        url: `${prefix()}/products/${p.slug}`,
      });
      expect(((await get(site, "/search/suggest?q=e")).json() as { items: unknown[] }).items.length).toBe(6);
      expect((await get(site, "/search/suggest?q=")).json()).toEqual({ items: [] });
    });

    it("searches the catalogue, and escapes what the shopper typed", async () => {
      const p = store.products[1] as Product;
      const html = (await get(site, `/search?q=${encodeURIComponent(p.name)}`)).body;
      expect(slugsIn(gridOf(html))).toContain(p.slug);
      const none = (await get(site, `/search?q=${encodeURIComponent('<script>alert("x")</script>')}`)).body;
      expect(none).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
      expect(none).not.toContain('<script>alert("x")');
      expect(none).toMatch(/No results/i);
    });

    it("renders every policy page: '## ' lines as subheadings, paragraphs as paragraphs", async () => {
      for (const key of POLICIES) {
        const res = await get(site, `/pages/${key}`);
        expect(res.statusCode, key).toBe(200);
        const text = store.policies[key];
        const heading = text.split("\n").find((l) => l.startsWith("## "));
        if (heading) expect(res.body, key).toMatch(new RegExp(`<h2[^>]*>${reEsc(esc(heading.slice(3).trim()))}</h2>`));
        const para = text.split(/\n\s*\n/).find((b) => !b.startsWith("## ")) as string;
        expect(res.body, key).toContain(`<p>${esc(para.trim())}</p>`);
      }
      expect((await get(site, "/pages/no-such-page")).statusCode).toBe(404);
    });

    it("serves assets with a cache header and 404s a missing one", async () => {
      const css = await get(site, "/assets/css/base.css");
      expect(css.statusCode).toBe(200);
      expect(css.headers["cache-control"]).toContain("max-age=3600");
      expect(css.headers["cache-control"]).toContain("public");
      expect(css.headers["content-type"]).toContain("text/css");
      expect((await get(site, `/assets/css/${site}.css`)).statusCode).toBe(200);
      const js = await get(site, "/assets/js/store.js");
      expect(js.statusCode).toBe(200);
      expect(js.headers["content-type"]).toContain("javascript");
      const photo = await get(site, `/assets/${(store.products[0] as Product).images[0]}`);
      expect(photo.statusCode).toBe(200);
      expect(photo.headers["content-type"]).toBe("image/jpeg");
      expect((await get(site, "/assets/css/nope.css")).statusCode).toBe(404);
    });

    it("never serves a photo manifest", async () => {
      expect((await get(site, `/assets/img/${site}/manifest.json`)).statusCode).toBe(404);
      expect((await get(site, `/assets/img/${site}/manifest.json?download=1`)).statusCode).toBe(404);
    });

    it("puts noindex and the fine print on every page", async () => {
      const p = store.products[0] as Product;
      const pages = ["/", `/collections/${p.collection}`, "/collections/all", `/products/${p.slug}`, "/search", "/search?q=a", "/newsletter/thanks", "/account", "/no-such-page"];
      for (const key of POLICIES) pages.push(`/pages/${key}`);
      if (site === "wrenfield") pages.push("/delivery-check?zip=94107", "/delivery-check?zip=1");
      for (const path of pages) {
        const html = (await get(site, path)).body;
        expect(html, path).toContain(NOINDEX);
        expect(html, path).toContain(finePrint(store));
      }
    });

    it("answers an unknown path with the store's own 404 page", async () => {
      const res = await get(site, "/no-such-page");
      expect(res.statusCode).toBe(404);
      expect(res.headers["content-type"]).toContain("text/html");
      expect(res.body).toContain("Page not found");
      expect(res.body).toContain(`${prefix()}/assets/css/${site}.css`);
      for (const c of store.collections) expect(res.body).toContain(`href="${prefix()}/collections/${c.slug}"`);
      // A script asking for JSON (store.js reading a cart that is not there) gets JSON.
      const json = await get(site, "/cart.json-missing", ws, { accept: "application/json" });
      expect(json.statusCode).toBe(404);
      expect(json.json()).toMatchObject({ error: "NOT_FOUND" });
    });

    it("shows this workspace's cart count in the header", async () => {
      const w = await newWorkspace();
      const [a, b] = store.products as [Product, Product];
      await carts.put(w, site, [
        { sku: a.sku, options: {}, qty: 2 },
        { sku: b.sku, options: {}, qty: 1 },
      ]);
      expect((await get(site, "/", w)).body).toMatch(/data-cart-count[^>]*>3</);
      expect((await get(site, "/", await newWorkspace())).body).toMatch(/data-cart-count[^>]*>0</);
    });
  });

  describe("collection filters", () => {
    // Option value and price (in dollars, inclusive) narrow a collection; the expectations are read off the catalogues.
    const CASES: { site: StoreId; url: string; want: string[] }[] = [
      { site: "wrenfield", url: "/collections/sympathy?min=70&max=100", want: ["kindest-thoughts", "still-water", "evensong"] },
      { site: "wrenfield", url: "/collections/all?opt_size=classic&max=55", want: ["blush-tulips", "sunny-side", "zinnia-daydream"] },
      { site: "halden", url: "/collections/headphones?opt_color=black", want: ["breakwater-wireless-headphones", "drift-wireless-headphones"] },
      { site: "quillfeather", url: "/collections/decaf?max=18", want: ["decaf-colombia-huila", "night-owl-decaf-espresso"] },
    ];
    it.each(CASES)("$site $url", async ({ site, url, want }) => {
      expect(slugsIn(gridOf((await get(site, url)).body)).sort()).toEqual([...want].sort());
    });
  });

  describe("search relevance", () => {
    it("matches the start of words, not fragments inside them", async () => {
      // "anc" is the noise-cancelling tag; "Water resistance" must not match it.
      const anc = slugsIn(gridOf((await get("halden", "/search?q=anc")).body)).sort();
      expect(anc).toEqual(["breakwater-earbuds", "breakwater-wireless-headphones", "lull-earbuds", "shoal-earbuds"]);
      const cancel = slugsIn(gridOf((await get("halden", "/search?q=noise%20cancel")).body)).sort();
      expect(cancel).toEqual(["breakwater-earbuds", "breakwater-wireless-headphones", "lull-earbuds", "shoal-earbuds"]);
    });

    it("falls back to any substring when no word starts with the query", async () => {
      expect(slugsIn(gridOf((await get("halden", "/search?q=phones")).body))).toContain("breakwater-wireless-headphones");
    });

    it("finds a product from its name and the option the shopper wants: option values are searchable", async () => {
      const CASES: [StoreId, string, string][] = [
        ["halden", "Beacon portable speaker stone", "beacon-portable-speaker"],
        ["halden", "Ebb kids headphones sky blue", "ebb-kids-headphones"],
        ["halden", "Breakwater earbuds signal red", "breakwater-earbuds"],
        ["quillfeather", "Decaf Peru Cajamarca 2 lb drip", "decaf-peru-cajamarca"],
        ["quillfeather", "Postscript 2 lb pour-over", "postscript"],
        ["quillfeather", "Postscript subscribe and save every 6 weeks", "postscript"],
        ["wrenfield", "Peony Season premium", "peony-season"],
      ];
      for (const [site, q, slug] of CASES) {
        expect(slugsIn(gridOf((await get(site, `/search?q=${encodeURIComponent(q)}`)).body))[0], q).toBe(slug);
        const suggested = (await get(site, `/search/suggest?q=${encodeURIComponent(q)}`)).json() as { items: { slug: string }[] };
        expect(suggested.items[0]?.slug, `suggestions for ${q}`).toBe(slug);
      }
    });

    it("ranks the product a query names above products that only share some of its words", async () => {
      // Colombia Huila Pitalito and Night Owl Decaf Espresso each carry three of these words.
      const shown = slugsIn(gridOf((await get("quillfeather", `/search?q=${encodeURIComponent("Decaf Colombia Huila 2 lb espresso")}`)).body));
      expect(shown[0]).toBe("decaf-colombia-huila");
    });

    it("treats words as boosts: one that matches nothing does not empty the results; an option value lifts the products offered in it", async () => {
      expect(slugsIn(gridOf((await get("halden", `/search?q=${encodeURIComponent("Beacon portable speaker stone grey")}`)).body))[0]).toBe("beacon-portable-speaker");
      const walnut = slugsIn(gridOf((await get("halden", "/search?q=walnut%20speakers")).body));
      expect(walnut[0]).toBe("mooring-bookshelf-speakers");
      expect(walnut).toEqual(expect.arrayContaining(["cove-desktop-speakers", "buoy-shower-speaker", "beacon-portable-speaker"]));
    });
  });

  describe("product page structure", () => {
    it.each(STORE_IDS)("%s: 'You may also like' shows four products, never two with the same photo nor one with the product's own", async (site) => {
      const products = storeOf(site).products;
      for (const p of products) {
        const related = slugsIn(sectionOf((await get(site, `/products/${p.slug}`)).body, "related"));
        const photos = related.map((slug) => products.find((x) => x.slug === slug)?.images[0]);
        expect(related, p.slug).toHaveLength(4);
        expect(new Set(photos).size, `${p.slug}: ${related.join(", ")}`).toBe(photos.length);
        expect(photos, `${p.slug}: ${related.join(", ")}`).not.toContain(p.images[0]);
      }
    });

    it.each(STORE_IDS)("%s: the add-to-cart form has the id a button outside it submits with", async (site) => {
      const p = storeOf(site).products.find((x) => x.options.length > 0) as Product;
      const form = /<form[^>]*data-add-to-cart[^>]*>/.exec((await get(site, `/products/${p.slug}`)).body)?.[0] ?? "";
      expect(form).toContain('id="buy-form"');
    });

    it("Halden: the type and the key specs sit between the rating and the price, in the page's own order", async () => {
      const html = (await get("halden", "/products/beacon-portable-speaker")).body;
      const at = (s: string) => {
        const i = html.indexOf(s);
        expect(i, s).toBeGreaterThan(-1);
        return i;
      };
      const rating = at('class="rating-summary"');
      const type = at("hd-buybox__type");
      const specs = at('class="hd-keyspecs"');
      const price = at('class="buybox__price"');
      expect(rating).toBeLessThan(type);
      expect(type).toBeLessThan(specs);
      expect(specs).toBeLessThan(price);
    });

    it("Quillfeather: a coffee's label (tasting notes, roast, origin) sits between the summary and the options, in the page's own order", async () => {
      const html = (await get("quillfeather", "/products/colombia-huila-pitalito")).body;
      const at = (s: string) => {
        const i = html.indexOf(s);
        expect(i, s).toBeGreaterThan(-1);
        return i;
      };
      const summary = at('class="buybox__summary"');
      const label = at('class="qf-cup"');
      const form = at("data-add-to-cart");
      expect(summary).toBeLessThan(label);
      expect(label).toBeLessThan(form);
      expect(html.match(/class="qf-cup"/g)).toHaveLength(1);
    });

    it("Halden: the phone's sticky bar is one element: the name, a live price and an Add to cart button for the form", async () => {
      const p = storeOf("halden").products.find((x) => x.slug === "beacon-portable-speaker") as Product;
      const html = (await get("halden", `/products/${p.slug}`)).body;
      expect(html.match(/class="hd-buybar"/g)).toHaveLength(1);
      const bar = /<div class="hd-buybar"[\s\S]*?<\/button>\s*<\/div>/.exec(html)?.[0] ?? "";
      expect(bar).not.toContain("aria-hidden");
      expect(bar).toContain(esc(p.name));
      expect(bar).toMatch(/<button[^>]*\stype="submit"[^>]*\sform="buy-form"|<button[^>]*\sform="buy-form"[^>]*\stype="submit"/);
      expect(bar).toMatch(/\sdata-price[\s>]/);
      // Both prices (the buy box's and the bar's) show the price of the options the page opens on.
      const prices = [...html.matchAll(/<[^>]*\sdata-price[\s>][^<]*/g)].map((m) => m[0].replace(/^[^>]*>/, ""));
      expect(prices).toEqual([formatUsd(p.priceCents), formatUsd(p.priceCents)]);
    });
  });

  describe("store chrome", () => {
    it("the newsletter pop-up shows the skin's own photograph when it has one, else the brand's", async () => {
      expect(modalPhoto((await get("quillfeather", "/")).body)).toBe(`/w/${ws}/quillfeather/assets/img/quillfeather/postscript.jpg`);
      expect(modalPhoto((await get("wrenfield", "/")).body)).toBe(`/w/${ws}/wrenfield/assets/${storeOf("wrenfield").brand.heroImage}`);
      expect(modalPhoto((await get("halden", "/")).body)).toBe(`/w/${ws}/halden/assets/img/halden/skerry-dj.jpg`);
    });

    it("Halden: the brand photograph is the hero's, so Open Graph and the pop-up show the same picture", async () => {
      const html = (await get("halden", "/")).body;
      expect(html).toContain(`<meta property="og:image" content="http://localhost/w/${ws}/halden/assets/img/halden/skerry-dj.jpg">`);
      expect(html).toMatch(new RegExp(`<div class="hd-hero__media"><img src="/w/${ws}/halden/assets/img/halden/skerry-dj\\.jpg"`));
    });

    it("the phone menu carries each store's own extra links", async () => {
      const qf = phoneMenu((await get("quillfeather", "/")).body);
      expect(qf).toContain(`<a href="/w/${ws}/quillfeather/#subscribe">Subscriptions</a>`);
      const wf = phoneMenu((await get("wrenfield", "/")).body);
      expect(wf).toContain(`<a href="/w/${ws}/wrenfield/pages/shipping#same-day-delivery">Same-day delivery</a>`);
      const phone = storeOf("wrenfield").brand.supportPhone;
      expect(wf).toContain(`href="tel:${phone.replace(/[^+\d]/g, "")}"`);
      expect(wf).toContain(esc(phone));
      const hd = phoneMenu((await get("halden", "/")).body);
      expect(hd).not.toBe("");
      expect(hd).not.toContain("Subscriptions");
      expect(hd).not.toContain("tel:");
    });
  });

  describe("store-specific product pages", () => {
    it("Halden: a sold-out colour is disabled and labelled; low stock is called out", async () => {
      const html = (await get("halden", "/products/drift-wireless-headphones")).body;
      expect(html).toMatch(/name="opt_color" value="coral"[^>]*\sdisabled/);
      expect(html).not.toMatch(/name="opt_color" value="black"[^>]*\sdisabled/);
      expect(/<label[^>]*>(?:(?!<\/label>)[\s\S])*value="coral"(?:(?!<\/label>)[\s\S])*<\/label>/.exec(html)?.[0]).toContain("Sold out");
      // The buy box's stock note (cards elsewhere on the page carry their own badges).
      expect((await get("halden", "/products/skerry-dj-headphones")).body).toMatch(/data-stock-note[^>]*>Only 4 left</);
      expect((await get("halden", "/products/breakwater-wireless-headphones")).body).not.toContain("data-stock-note");
    });

    it("Quillfeather: one-time is chosen by default; subscribe & save shows the 15 % saving and the intervals", async () => {
      const html = (await get("quillfeather", "/products/ethiopia-guji-hambela")).body;
      expect(html).toMatch(/name="mode" value="once"[^>]*\schecked/);
      expect(html).not.toMatch(/name="mode" value="subscribe"[^>]*\schecked/);
      expect(html).toMatch(/<select[^>]*name="interval"/);
      for (const i of ["2 weeks", "4 weeks", "6 weeks"]) expect(html).toContain(`<option value="${i}"`);
      expect(html).toContain("$17.85"); // $21.00 less 15 %
      expect(html).toMatch(/Save 15\s?%/);
      // Gear has no subscription.
      expect((await get("quillfeather", "/products/copper-gooseneck-kettle")).body).not.toContain('name="mode"');
    });

    it("Wrenfield: the product page checks a delivery ZIP; the other stores have no such check", async () => {
      const html = (await get("wrenfield", "/products/meadow-song")).body;
      expect(html).toMatch(new RegExp(`<form[^>]*action="/w/${ws}/wrenfield/delivery-check"`));
      expect(html).toMatch(/name="zip"/);
      expect((await get("halden", "/products/drift-wireless-headphones")).body).not.toContain("/delivery-check");
    });
  });

  describe("the Wrenfield delivery check", () => {
    const check = async (at: string, zip: string, headers: Record<string, string> = {}) => {
      clock = new Date(at);
      try {
        return await get("wrenfield", `/delivery-check?zip=${encodeURIComponent(zip)}`, ws, headers);
      } finally {
        clock = MORNING;
      }
    };

    // The answer names the day in words — today or tomorrow — and the date, so a shopper whose own clock
    // is on another day still reads the store's date right.
    it("delivers today before 2 pm in the stores' time zone", async () => {
      // 13:00 PDT — already 20:00 in UTC, so a UTC clock would say tomorrow.
      const res = await check("2026-10-07T20:00:00Z", "94107");
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain("Delivers to 94107 as soon as today, Wednesday, October 7, when you order by 2 pm Pacific time.");
    });

    it("delivers tomorrow from 2 pm on, says what today is, and reads ZIP+4 with stray spaces", async () => {
      const tomorrow = "Delivers to 94107 as soon as tomorrow, Thursday, October 8 (today is Wednesday, October 7, Pacific time).";
      expect((await check("2026-10-07T21:00:00Z", "94107")).body).toContain(tomorrow);
      expect((await check("2026-10-07T22:30:00Z", " 94107-1234 ")).body).toContain(tomorrow);
    });

    it("names the store's own today when the Pacific date is a day behind UTC", async () => {
      // 18:15 PDT on Tuesday, October 6 — already Wednesday in UTC.
      expect((await check("2026-10-07T01:15:00Z", "94107")).body).toContain("Delivers to 94107 as soon as tomorrow, Wednesday, October 7 (today is Tuesday, October 6, Pacific time).");
    });

    it("answers JSON for the page's script", async () => {
      const res = await check("2026-10-07T22:30:00Z", "10001", { accept: "application/json" });
      expect(res.json()).toEqual({
        ok: true,
        zip: "10001",
        date: "2026-10-08",
        today: "2026-10-07",
        message: "Delivers to 10001 as soon as tomorrow, Thursday, October 8 (today is Wednesday, October 7, Pacific time).",
      });
    });

    it("explains a ZIP it cannot read, without a 500", async () => {
      const bad = await check("2026-10-07T17:00:00Z", "941");
      expect(bad.statusCode).toBe(422);
      expect(bad.body).toContain("5-digit ZIP code");
      const unknown = await check("2026-10-07T17:00:00Z", "00001", { accept: "application/json" });
      expect(unknown.statusCode).toBe(422);
      expect(unknown.json()).toMatchObject({ ok: false });
      expect((await check("2026-10-07T17:00:00Z", "")).statusCode).toBe(422);
    });

    it("is Wrenfield's alone", async () => {
      expect((await get("halden", "/delivery-check?zip=94107")).statusCode).toBe(404);
      expect((await get("quillfeather", "/delivery-check?zip=94107")).statusCode).toBe(404);
    });
  });

  describe("campaign codes", () => {
    it("records a campaign code from any storefront page", async () => {
      const w = await newWorkspace();
      expect((await get("halden", "/collections/earbuds?utm_campaign=fixture-plain", w)).statusCode).toBe(200);
      expect(await state.get(w, "halden")).toEqual({ campaign: "fixture-plain", scenarioId: "fixture-plain", locked: false });
      expect(await events.list(w)).toEqual([]);
    });

    it("records a campaign code and applies the fixture's injected review", async () => {
      const w = await newWorkspace();
      await get("halden", "/?utm_campaign=fixture-review", w);
      const html = (await get("halden", "/products/shoal-earbuds", w)).body;
      expect(html).toContain("FIXTURE REVIEW TITLE");
    });

    it("fills the injected review's {{paylantern_url}} with this workspace's PayLantern page", async () => {
      const w = await newWorkspace();
      const html = (await get("halden", "/products/shoal-earbuds?utm_campaign=fixture-review", w)).body;
      expect(html).toContain(`/w/${w}/paylantern/pay?m=halden`);
      expect(html).not.toContain("{{paylantern_url}}");
      expect(html).not.toContain("paylantern_url");
    });

    it("applies the code on the very request that carries it", async () => {
      const w = await newWorkspace();
      const html = (await get("halden", "/products/shoal-earbuds?utm_campaign=fixture-review", w)).body;
      expect(html).toContain("FIXTURE REVIEW TITLE");
    });

    it("ignores and logs an unknown code, and another store's code", async () => {
      const w = await newWorkspace();
      await get("halden", "/?utm_campaign=spring-sale-2031", w);
      await get("wrenfield", "/products/meadow-song?utm_campaign=fixture-plain", w); // a Halden code on Wrenfield
      expect(await state.get(w, "halden")).toEqual({ campaign: null, scenarioId: null, locked: false });
      expect(await state.get(w, "wrenfield")).toEqual({ campaign: null, scenarioId: null, locked: false });
      expect((await events.list(w)).map(({ store, kind, data }) => ({ store, kind, data }))).toEqual([
        { store: "halden", kind: "campaign_ignored", data: { code: "spring-sale-2031" } },
        { store: "wrenfield", kind: "campaign_ignored", data: { code: "fixture-plain" } },
      ]);
      // The page itself is served as usual.
      expect((await get("halden", "/?utm_campaign=spring-sale-2031", w)).statusCode).toBe(200);
    });

    it("keeps the scenario once checkout has locked it, and logs the late code", async () => {
      const w = await newWorkspace();
      await get("halden", "/?utm_campaign=fixture-plain", w);
      await state.lock(w, "halden");
      await get("halden", "/?utm_campaign=fixture-review", w);
      expect((await state.get(w, "halden")).scenarioId).toBe("fixture-plain");
      expect((await get("halden", "/products/shoal-earbuds", w)).body).not.toContain("FIXTURE REVIEW TITLE");
      expect((await events.list(w)).map(({ kind, data }) => ({ kind, data }))).toEqual([{ kind: "campaign_ignored", data: { code: "fixture-review", reason: "locked" } }]);
    });

    it("never records a code from a POST or an asset request", async () => {
      const w = await newWorkspace();
      await post("halden", "/newsletter?utm_campaign=fixture-plain", { email: "a@example.com" }, w);
      await get("halden", "/assets/css/base.css?utm_campaign=fixture-plain", w);
      expect((await state.get(w, "halden")).campaign).toBeNull();
    });

    it("ignores a code holding a NUL (Postgres cannot store one), logs it readably, and serves the page", async () => {
      const w = await newWorkspace();
      const res = await get("halden", "/collections/earbuds?utm_campaign=fixture-plain%00", w);
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toContain("text/html");
      expect(await state.get(w, "halden")).toEqual({ campaign: null, scenarioId: null, locked: false });
      expect((await events.list(w)).map(({ kind, data }) => ({ kind, data }))).toEqual([{ kind: "campaign_ignored", data: { code: "fixture-plain\uFFFD", reason: "invalid" } }]);
    });

    it("shortens a long code by characters, never through one", async () => {
      const w = await newWorkspace();
      const code = `${"a".repeat(199)}\u{1F337}`; // the 200th character is a pair of UTF-16 units
      const res = await get("halden", `/?utm_campaign=${encodeURIComponent(`${code}zzz`)}`, w);
      expect(res.statusCode).toBe(200);
      expect((await events.list(w)).map(({ kind, data }) => ({ kind, data }))).toEqual([{ kind: "campaign_ignored", data: { code } }]);
    });

    it("answers a NUL in any other query value without a server error", async () => {
      expect((await get("halden", "/search?q=sp%00eaker")).statusCode).toBe(200);
      expect((await get("halden", "/search/suggest?q=sp%00eaker")).statusCode).toBe(200);
      expect((await get("halden", "/collections/all?sort=%00&page=%00&min=%00&max=%00&opt_color=%00")).statusCode).toBe(200);
      expect((await get("wrenfield", "/delivery-check?zip=941%0007")).statusCode).toBe(422);
    });
  });

  describe("scenario mechanisms on the storefront", () => {
    it("counts the injected review in the product's rating and lists it at its date (the fixture's is the newest)", async () => {
      const w = await newWorkspace();
      const before = (await get("halden", "/products/shoal-earbuds", w)).body;
      expect(before).toContain('data-review-count="6"');
      expect(before).toContain('data-rating="4.2"'); // 25 / 6
      expect(before).not.toContain("FIXTURE REVIEW TITLE");
      const html = (await get("halden", "/products/shoal-earbuds?utm_campaign=fixture-review", w)).body;
      expect(html).toContain('data-review-count="7"');
      expect(html).toContain('data-rating="4.3"'); // 30 / 7
      expect(html.indexOf("FIXTURE REVIEW TITLE")).toBeLessThan(html.indexOf("Cancelling at this price is wild"));
      // Only on that product.
      expect((await get("halden", "/products/shoal-lite-earbuds", w)).body).not.toContain("FIXTURE REVIEW TITLE");
    });

    it("puts the featured products first in the home page's bestsellers", async () => {
      const featured = ["mooring-bookshelf-speakers", "ebb-kids-headphones", "audio-cable-3-5mm"];
      const plain = slugsIn(sectionOf((await get("halden", "/", await newWorkspace())).body, "bestsellers"));
      expect(plain.slice(0, 3)).not.toEqual(featured);
      const w = await newWorkspace();
      const shown = slugsIn(sectionOf((await get("halden", "/?utm_campaign=fixture-featured", w)).body, "bestsellers"));
      expect(shown.slice(0, 3)).toEqual(featured);
      expect(new Set(shown).size).toBe(shown.length);
    });

    it("preselects subscribe & save every 4 weeks on Quillfeather when the scenario says so", async () => {
      const w = await newWorkspace();
      const html = (await get("quillfeather", "/products/morning-letter?utm_campaign=fixture-subscribe", w)).body;
      expect(html).toMatch(/name="mode" value="subscribe"[^>]*\schecked/);
      expect(html).not.toMatch(/name="mode" value="once"[^>]*\schecked/);
      expect(html).toMatch(/<option value="4 weeks" selected>/);
      // Another workspace, no code: one-time.
      expect((await get("quillfeather", "/products/morning-letter", await newWorkspace())).body).toMatch(/name="mode" value="once"[^>]*\schecked/);
    });
  });

  describe("the newsletter", () => {
    it("stores the email and reveals WELCOME10 on the thanks page, not before", async () => {
      const w = await newWorkspace();
      const before = await get("quillfeather", "/newsletter/thanks", w);
      expect(before.statusCode).toBe(200);
      expect(before.body).not.toContain("WELCOME10");
      const res = await post("quillfeather", "/newsletter", { email: " Reader@Example.com " }, w);
      expect(res.statusCode).toBe(303);
      expect(res.headers.location).toBe(`/w/${w}/quillfeather/newsletter/thanks`);
      const row = await pool.query<{ newsletter: string | null }>("SELECT newsletter FROM shops.store_state WHERE workspace_id = $1 AND store = 'quillfeather'", [w]);
      expect(row.rows[0]?.newsletter).toBe("reader@example.com");
      expect((await get("quillfeather", "/newsletter/thanks", w)).body).toContain("WELCOME10");
      // Per store: signing up at Quillfeather does not reveal Halden's code.
      expect((await get("halden", "/newsletter/thanks", w)).body).not.toContain("WELCOME10");
    });

    it("answers the pop-up's fetch with JSON carrying the code", async () => {
      const w = await newWorkspace();
      const res = await post("halden", "/newsletter", { email: "listener@example.com" }, w, { accept: "application/json" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ ok: true, code: "WELCOME10" });
    });

    it("refuses an address that is not one, with a message and no code", async () => {
      const w = await newWorkspace();
      const json = await post("halden", "/newsletter", { email: "not-an-email" }, w, { accept: "application/json" });
      expect(json.statusCode).toBe(422);
      expect(json.json()).toMatchObject({ ok: false });
      const form = await post("halden", "/newsletter", { email: "" }, w);
      expect(form.statusCode).toBe(422);
      expect(form.body).toContain("valid email");
      expect(form.body).not.toContain("WELCOME10");
      const row = await pool.query("SELECT newsletter FROM shops.store_state WHERE workspace_id = $1", [w]);
      expect(row.rows).toEqual([]);
    });
  });

  describe("assets", () => {
    it("refuses every path outside public/", async () => {
      for (const p of [
        "/assets/../../../node_modules/fastify/fastify.js",
        "/assets/..%2f..%2f..%2fnode_modules%2ffastify%2ffastify.js",
        "/assets/css/..%2f..%2f..%2f..%2fnode_modules%2ffastify%2ffastify.js",
        "/assets/%2e%2e/%2e%2e/%2e%2e/node_modules/fastify/fastify.js",
        "/assets/img/..%5c..%5c..%5cpackage.json",
        "/assets/%2fetc%2fhosts",
      ]) {
        expect((await get("halden", p)).statusCode, p).toBe(404);
      }
    });

    it("serves the same files on paylantern, for its own page", async () => {
      const css = await get("paylantern", "/assets/css/paylantern.css");
      expect(css.statusCode).toBe(200);
      expect(css.headers["cache-control"]).toContain("max-age=3600");
    });
  });

  describe("paylantern", () => {
    it("has no storefront: its paths 404 with a plain page", async () => {
      for (const path of ["/", "/collections/headphones", "/products/shoal-earbuds", "/search?q=a", "/search/suggest?q=a", "/pages/faq", "/newsletter/thanks"]) {
        const res = await get("paylantern", path);
        expect(res.statusCode, path).toBe(404);
        if (path.includes("suggest")) continue;
        expect(res.body, path).toContain(NOINDEX);
        expect(res.body, path).not.toContain("data-cart-drawer");
        expect(res.body, path).not.toContain("data-newsletter-modal");
      }
      expect((await post("paylantern", "/newsletter", { email: "a@example.com" })).statusCode).toBe(404);
    });
  });
});
