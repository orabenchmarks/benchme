/**
 * A shopper on one store of one workspace: every step of a hidden run done through the pages the way a
 * person (or an agent driving a browser) does it — the menu and the search box, the option buttons, the
 * quantity stepper, the cart drawer and the cart page, form fields found by their labels, the card form,
 * the hosted payment page — and never by posting to the store's endpoints. Locators are roles and
 * accessible names taken from the catalogue the page is rendered from, so a missing label or an
 * ambiguous control fails here the way it would trip a shopper.
 *
 * Payment comes in two modes, as the stack pays: fake mode's own card form and hosted page, or (STRIPE=1)
 * Stripe's — the Payment Element's fields inside Stripe's frame, the hosted Checkout page on
 * checkout.stripe.com, and Stripe's 3D Secure test page (lib/stripe.ts finds them).
 */
import { expect, type FrameLocator, type Locator, type Page } from "@playwright/test";
import { sf, STORE_TZ, type Product, type ScenarioDef, type StoreDef } from "./benchme.js";
import { billingZipOf } from "./billing.js";
import { TOKEN_STEP } from "./checkout-token.js";
import { stepOf, type AddStep, type Card, type InformationStep, type PayStep, type ShippingStep, type Step } from "./hidden.js";
import { CHALLENGE_FRAME, CHECKOUT_HOST, DECLINED, expressButtons, extraMethods, frameAtRest, frameTitled, paymentFields, settle, usdChoice } from "./stripe.js";

/** Stripe's test cards, which fake mode settles the same way: success, a decline, 3D Secure. */
export const CARD_NUMBERS: Record<Card, string> = {
  success: "4242 4242 4242 4242",
  decline: "4000 0000 0000 0002",
  "3ds": "4000 0027 6000 3184",
};
const EXPIRY = "12/34";
const CVC = "123";

/** The confirmation page's "Order WF-123456-K7". */
const ORDER_TEXT = /^Order [A-Z]{2}-\d{6}-[0-9A-Z]{2}$/;
/** A PayLantern payment address written into a review. */
const PAYLANTERN_ADDRESS = /https?:\/\/[^\s"'<>]+\/paylantern\/pay\?[^\s"'<>]*/g;

const reEscape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** An accessible name that begins with `text` as a whole phrase: "Deluxe +$20.00", "Standard shipping 3–5 business days $6.00". */
const startingWith = (text: string) => new RegExp(`^${reEscape(text)}(?=$|[\\s,.:;(])`);
/** The first of these that is on screen: an `or` of locators, visible matches only (a CSS locator also matches hidden elements). */
const shown = (...ls: Locator[]): Locator => ls.reduce((a, b) => a.or(b)).filter({ visible: true }).first();
const centsOf = (usd: string) => Math.round(Number(usd.replace(/[^0-9.]/g, "")) * 100);
const usd = (cents: number) => sf.formatUsd(cents);

/** Today in the stores' time zone, as "2026-10-07". */
export function storeToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: STORE_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** A step as one line for the report: what was done, never a card number. */
export function describeStep(step: Step): string {
  const [kind, v] = stepOf(step);
  switch (kind) {
    case "visit":
    case "newsletter":
    case "promo":
      return `${kind} ${String(v)}`;
    case "add": {
      const a = v as AddStep;
      const opts = Object.entries(a.options ?? {})
        .map(([g, x]) => `${g}=${x}`)
        .join(",");
      return `add ${a.qty ?? 1}× ${a.sku}${opts ? ` [${opts}]` : ""}${a.mode === "subscribe" ? ` every ${a.interval}` : ""}`;
    }
    case "information": {
      const i = v as InformationStep;
      return `information ${i.email} ${i.state} ${i.zip}${i.delivery ? ` +${i.delivery.offsetDays}d` : ""} marketing=${i.marketing}`;
    }
    case "shipping": {
      const s = v as ShippingStep;
      return `shipping ${s.method} [${s.addOns.join(",")}]`;
    }
    case "pay":
      return `pay (${(v as PayStep).card} card, billing ZIP ${billingZipOf(v as PayStep)})`;
    case "paylantern":
      return `paylantern (${(v as { card: Card }).card} card)`;
    default:
      return kind;
  }
}

export type ShopperOpts = {
  scenario: ScenarioDef;
  store: StoreDef;
  /** urls.apps.<store> of the minted workspace. */
  storeUrl: string;
  /** STRIPE=1: the stack pays with Stripe test keys — Stripe's card fields and hosted page instead of fake mode's. */
  stripe?: boolean;
  log: (line: string) => void;
};

/** What the payment step shows after Pay: the confirmation, Stripe's 3D Secure page, an error, or a price update. */
type AfterPay = "order" | "challenge" | "error" | "banner";

export class Shopper {
  readonly page: Page;
  readonly s: ScenarioDef;
  readonly store: StoreDef;
  /** http://host/w/<id>/<site>, no trailing slash. */
  readonly base: string;
  /** /w/<id>/<site> */
  readonly prefix: string;
  readonly stripe: boolean;
  /** Every card paid with, in order (the run record's). */
  readonly cards: Card[] = [];
  /** Every order number whose confirmation page the shopper reached, in order (the run record's). */
  readonly orders: string[] = [];
  /**
   * What the store's payment surfaces got wrong without stopping the run (a Payment Element offering more than
   * cards): the test fails on them once the run is over, so the run's own outcome is still read and logged first.
   */
  readonly problems: string[] = [];
  private readonly log: (line: string) => void;
  /** PayLantern addresses read in the reviews of the products looked at (a planted review). */
  private readonly planted: string[] = [];
  /** Checkouts whose shipping step has been seen (the add-ons arrive as the scenario ticks them, once). */
  private readonly shippingSeen = new Set<string>();
  /** The information step as typed: whose name goes on the card (cardholder()). The card's ZIP is its billing ZIP, never the address's. */
  private buyer: InformationStep | null = null;
  private lastCard: Card | null = null;
  private paylanternTried = false;

  constructor(page: Page, o: ShopperOpts) {
    this.page = page;
    this.s = o.scenario;
    this.store = o.store;
    this.base = o.storeUrl.replace(/\/+$/, "");
    this.prefix = new URL(this.base).pathname;
    this.stripe = o.stripe === true;
    this.log = o.log;
  }

  /* ------------------------------------------------------------------ entering the store */

  /** Opens the store's entry address and accepts the cookie banner; the newsletter pop-up is closed whenever it shows up. */
  async enter(url: string): Promise<void> {
    const page = this.page;
    await page.addLocatorHandler(page.locator("[data-newsletter-modal] [role=dialog]"), async (dialog) => {
      this.log("closed the newsletter pop-up");
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
    });
    await page.goto(url);
    expect(
      new URL(page.url()).searchParams.get("utm_campaign"),
      `opened ${url} and landed on ${page.url()}: the campaign code never reached the store, so the task's scenario is not on`,
    ).toBe(this.s.campaign);
    const banner = page.getByRole("region", { name: "Cookie consent" });
    await expect(banner).toBeVisible();
    await banner.getByRole("button", { name: "Accept" }).click();
    await expect(banner).toBeHidden();
    this.log(`entered ${page.url()} and accepted cookies`);
  }

  async step(step: Step): Promise<void> {
    const [kind, v] = stepOf(step);
    switch (kind) {
      case "visit":
        return this.visit(v as string);
      case "newsletter":
        return this.newsletter(v as string);
      case "add":
        return this.add(v as AddStep);
      case "promo":
        return this.promo(v as string);
      case "checkout":
        return this.checkout();
      case "information":
        return this.information(v as InformationStep);
      case "shipping":
        return this.shipping(v as ShippingStep);
      case "pay":
        return this.pay(v as PayStep);
      case "followNotice":
        return this.followNotice();
      case "paylantern":
        return this.paylantern((v as { card: Card }).card);
      case "stop":
        return;
      default:
        throw new Error(`unknown step ${JSON.stringify(step)}`);
    }
  }

  /* ------------------------------------------------------------------ helpers */

  private path(): string {
    return new URL(this.page.url()).pathname;
  }

  /** Waits for the page at a path (after the load event); on a timeout, says where it is and what the page shows. */
  private async waitForPath(want: string | RegExp, after: string): Promise<void> {
    const ok = (p: string) => (typeof want === "string" ? p === want : want.test(p));
    try {
      await this.page.waitForURL((u) => ok(u.pathname), { timeout: 30_000 });
    } catch {
      throw new Error(`${after}: expected ${want}, still at ${this.page.url()}${await this.pageSays()}`);
    }
  }

  /** The errors the page shows (alerts, field errors), for a failure message. */
  private async pageSays(): Promise<string> {
    const texts = await this.page
      .locator("[role=alert]:visible, .cfield__error:visible")
      .allInnerTexts()
      .catch(() => [] as string[]);
    const t = texts.map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean);
    return t.length ? ` — the page says: ${t.join(" | ")}` : "";
  }

  private product(by: { sku: string } | { slug: string }): Product {
    const p = this.store.products.find((x) => ("sku" in by ? x.sku === by.sku : x.slug === by.slug));
    if (!p) throw new Error(`${this.store.brand.name} has no product ${"sku" in by ? by.sku : by.slug}`);
    return p;
  }

  private async goHome(): Promise<void> {
    await this.page.getByRole("link", { name: `${this.store.brand.name} home` }).first().click();
    await this.waitForPath(`${this.prefix}/`, "the logo");
  }

  private drawer(): Locator {
    return this.page.getByRole("dialog", { name: "Your cart" });
  }

  private async closeDrawer(): Promise<void> {
    const d = this.drawer();
    if (await d.isVisible()) {
      await d.getByRole("button", { name: "Close cart" }).click();
      await expect(d).toBeHidden();
    }
  }

  /** The cart drawer, opened from the header's cart button when it is closed. */
  private async openDrawer(): Promise<Locator> {
    const d = this.drawer();
    if (!(await d.isVisible())) {
      await this.page.getByRole("link", { name: /^Cart, \d+ items?$/ }).click();
      await expect(d).toBeVisible();
    }
    return d;
  }

  /** Remembers the PayLantern addresses a product's reviews give (a review planted for the scenario). */
  private async readReviews(): Promise<void> {
    const reviews = this.page.locator("#reviews");
    if (!(await reviews.count())) return;
    const text = await reviews.innerText();
    for (const m of text.matchAll(PAYLANTERN_ADDRESS)) {
      const url = m[0].replace(/[.,;:)]+$/, "");
      if (!this.planted.includes(url)) {
        this.planted.push(url);
        this.log(`a review on this page sends shoppers to ${url}`);
      }
    }
  }

  /* ------------------------------------------------------------------ browsing */

  async visit(path: string): Promise<void> {
    const u = new URL(path, "http://store.invalid");
    const m = /^\/(products|collections)\/([^/]+)\/?$/.exec(u.pathname);
    await this.closeDrawer();
    if (m?.[1] === "products") return this.openProduct(this.product({ slug: decodeURIComponent(m[2] as string) }));
    if (m?.[1] === "collections") return this.openCollection(decodeURIComponent(m[2] as string), u.searchParams);
    if (u.pathname === "/") return this.goHome();
    this.log(`opened ${path} by its address (no menu leads there)`);
    await this.page.goto(`${this.base}${path}`);
  }

  /** A product page: its card on the page in front of us (a collection just opened), else the header search. */
  private async openProduct(p: Product): Promise<void> {
    const want = `${this.prefix}/products/${p.slug}`;
    if (this.path() !== want) {
      const page = this.page;
      const card = page
        .locator("[data-product-grid]")
        .getByRole("article")
        .filter({ has: page.getByRole("heading", { name: p.name, exact: true }) });
      if (await card.count()) {
        await card.first().getByRole("link").first().click();
        this.log(`clicked ${p.name} in the product grid`);
      } else {
        let box = page.getByRole("combobox", { name: `Search ${this.store.brand.name}` }).first();
        if (!(await box.isVisible())) {
          await this.goHome();
          box = page.getByRole("combobox", { name: `Search ${this.store.brand.name}` }).first();
        }
        await box.fill(p.name);
        await page.getByRole("option", { name: startingWith(p.name) }).first().click();
        this.log(`searched for "${p.name}" and picked its suggestion`);
      }
      await this.waitForPath(want, `opening ${p.name}`);
    }
    await expect(this.page.getByRole("heading", { level: 1 })).toHaveText(p.name);
    await this.readReviews();
  }

  /** A collection from the header's collection menu, then its sort menu. */
  private async openCollection(slug: string, params: URLSearchParams): Promise<void> {
    const want = `${this.prefix}/collections/${slug}`;
    const c = this.store.collections.find((x) => x.slug === slug);
    if (!c) throw new Error(`${this.store.brand.name} has no collection ${slug}`);
    if (this.path() !== want) {
      let nav = this.page.getByRole("navigation", { name: "Collections" });
      if (!(await nav.isVisible())) {
        await this.goHome();
        nav = this.page.getByRole("navigation", { name: "Collections" });
      }
      await nav.getByRole("link", { name: c.name, exact: true }).click();
      await this.waitForPath(want, `opening ${c.name} from the menu`);
      this.log(`opened ${c.name} from the collection menu`);
    }
    for (const [k, v] of params) {
      if (k !== "sort") throw new Error(`visit /collections/${slug}?${params}: the suite cannot set "${k}" from the page yet`);
      await this.page.getByLabel("Sort by").selectOption(v);
      await this.page.waitForURL((u) => u.pathname === want && u.searchParams.get("sort") === v);
      this.log(`sorted ${c.name} by ${v}`);
    }
  }

  /** The newsletter form of the home page (the block above the footer); it answers with the welcome code. */
  async newsletter(email: string): Promise<void> {
    await this.closeDrawer();
    let block = this.page.locator('[data-section="newsletter"]');
    if (!(await block.isVisible())) {
      await this.goHome();
      block = this.page.locator('[data-section="newsletter"]');
    }
    await block.getByRole("textbox", { name: "Email address" }).fill(email);
    await block.getByRole("button", { name: "Sign up" }).click();
    await expect(block.getByText("You're on the list.")).toBeVisible();
    const code = await block.getByRole("button", { name: "Copy code" }).getAttribute("data-copy-code");
    this.log(`signed up for the newsletter with ${email}: the page shows the code ${code}`);
  }

  /* ------------------------------------------------------------------ the cart */

  async add(a: AddStep): Promise<void> {
    const p = this.product({ sku: a.sku });
    await this.closeDrawer();
    await this.openProduct(p);
    const buy = this.page.locator("form[data-add-to-cart]");
    const picked: string[] = [];
    for (const g of p.options) {
      const id = a.options?.[g.id];
      const v = g.values.find((x) => x.id === id);
      if (!v) throw new Error(`add ${a.sku}: the run gives no ${g.name} (${g.id}=${String(id)})`);
      const group = buy.getByRole("group", { name: startingWith(`${g.name}:`) });
      const radio = group.getByRole("radio", { name: startingWith(v.label) });
      await expect(radio, `${p.name}: one "${v.label}" button under ${g.name}`).toHaveCount(1);
      await radio.check();
      await expect(group, `${p.name}: the ${g.name} heading follows the choice`).toHaveAccessibleName(`${g.name}: ${v.label}`);
      picked.push(v.label);
    }
    if (p.subscription) {
      const modes = buy.getByRole("group", { name: "Purchase options" });
      const once = modes.getByRole("radio", { name: startingWith("One-time purchase") });
      const subscribe = modes.getByRole("radio", { name: startingWith("Subscribe & save") });
      await expect(this.s.mechanisms.defaultSubscribe ? subscribe : once, "the purchase option the page opens on").toBeChecked();
      if (a.mode === "subscribe") {
        if (!a.interval) throw new Error(`add ${a.sku}: subscribe without an interval`);
        await subscribe.check();
        await buy.getByLabel("Deliver every").selectOption({ label: a.interval });
        picked.push(`every ${a.interval}`);
      } else {
        await once.check();
        picked.push("one-time");
      }
    } else if (a.mode === "subscribe") {
      throw new Error(`add ${a.sku}: ${p.name} is not sold by subscription`);
    }
    const qty = a.qty ?? 1;
    const qtyBox = buy.getByRole("spinbutton", { name: "Quantity" });
    for (let n = 1; n < qty; n++) await buy.getByRole("button", { name: "Increase quantity" }).click();
    await expect(qtyBox).toHaveValue(String(qty));
    await buy.getByRole("button", { name: "Add to cart" }).click();
    const drawer = this.drawer();
    await expect(drawer, `Add to cart on ${p.name} opens the cart drawer`).toBeVisible();
    await expect(drawer.getByRole("status")).toHaveText("Added to your cart.");
    await expect(drawer.getByRole("link", { name: p.name, exact: true }).first()).toBeVisible();
    this.log(`added ${qty} × ${p.name}${picked.length ? ` (${picked.join(", ")})` : ""}: the drawer opened`);
  }

  private async openCartPage(): Promise<void> {
    if (this.path() === `${this.prefix}/cart`) return;
    const d = await this.openDrawer();
    await d.getByRole("link", { name: "View cart" }).click();
    await this.waitForPath(`${this.prefix}/cart`, "View cart");
  }

  /** The code field of the cart page. */
  async promo(code: string): Promise<void> {
    await this.openCartPage();
    const page = this.page;
    const applied = code.trim().toUpperCase();
    await page.getByRole("textbox", { name: "Discount code" }).fill(code);
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await page.waitForURL((u) => u.pathname === `${this.prefix}/cart` && (u.searchParams.has("promo") || u.searchParams.has("promo_error")));
    const said = page.getByRole("status").filter({ hasText: `${applied} is applied to your order.` });
    if (!(await said.isVisible())) throw new Error(`applying ${applied} on the cart page${await this.pageSays()}`);
    await expect(page.getByRole("complementary", { name: "Order summary" }), `the cart's summary takes ${applied} off`).toContainText(new RegExp(`Discount\\s+${reEscape(applied)}`));
    this.log(`applied ${applied} on the cart page`);
  }

  /** "Check out" on the cart page when we are on it, else in the cart drawer. */
  async checkout(): Promise<void> {
    if (this.path() === `${this.prefix}/cart`) {
      await this.page.getByRole("button", { name: "Check out", exact: true }).click();
      this.log("checked out from the cart page");
    } else {
      const d = await this.openDrawer();
      await d.getByRole("button", { name: "Check out", exact: true }).click();
      this.log("checked out from the cart drawer");
    }
    await this.waitForPath(TOKEN_STEP("information"), "Check out");
  }

  /* ------------------------------------------------------------------ the checkout steps */

  async information(v: InformationStep): Promise<void> {
    const page = this.page;
    this.buyer = v;
    const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Continue to shipping" }) });
    const field = (label: string) => form.getByLabel(label, { exact: true });
    const rules = this.store.delivery;
    // A florist's Contact asks who the order is from (the buyer; the address below is the recipient's).
    if (v.senderName !== undefined) {
      if (!rules) throw new Error(`information: ${this.store.brand.name} ships to the buyer; it asks no sender's name`);
      await field("Your name (optional)").fill(v.senderName);
    }
    await field("Email").fill(v.email);
    await field("Phone").fill(v.phone);
    const marketing = form.getByRole("checkbox", { name: "Email me with news and offers" });
    const preticked = this.s.mechanisms.precheckMarketing === true;
    await expect(marketing, `the marketing opt-in arrives ${preticked ? "ticked" : "unticked"}`).toBeChecked({ checked: preticked });
    if (preticked !== v.marketing) this.log(`${v.marketing ? "ticked" : "unticked"} "Email me with news and offers"`);
    await marketing.setChecked(v.marketing);
    await field("First name").fill(v.firstName);
    await field("Last name").fill(v.lastName);
    await field("Address").fill(v.line1);
    await field("Apartment, suite, etc. (optional)").fill(v.line2 ?? "");
    await field("City").fill(v.city);
    const state = sf.US_STATES.find((x) => x.code === v.state);
    if (!state) throw new Error(`information: ${v.state} is not a US state code`);
    await field("State").selectOption({ label: state.name });
    await field("ZIP code").fill(v.zip);
    if (rules) {
      const d = v.delivery ?? { offsetDays: 1 };
      const today = storeToday();
      const date = field("Delivery date");
      await expect(date, "the delivery date starts on tomorrow (store time)").toHaveValue(sf.addDays(today, 1));
      await date.fill(sf.addDays(today, d.offsetDays));
      if (rules.giftMessage) await field("Card message (optional)").fill(d.message ?? "");
      else if (d.message) throw new Error(`information: ${this.store.brand.name} takes no card message`);
      await field("Sign the card (optional)").fill(d.signature ?? "");
    } else if (v.delivery) {
      throw new Error(`information: ${this.store.brand.name} ships; it takes no delivery date`);
    }
    await form.getByRole("button", { name: "Continue to shipping" }).click();
    await this.waitForPath(TOKEN_STEP("shipping"), "Continue to shipping");
    this.log(`information: ${v.senderName ? `from ${v.senderName}, ` : ""}${v.email}, ${v.city} ${v.state} ${v.zip}, marketing ${v.marketing ? "on" : "off"}${rules ? `, delivery +${(v.delivery ?? { offsetDays: 1 }).offsetDays} day(s)` : ""}`);
  }

  async shipping(v: ShippingStep): Promise<void> {
    const page = this.page;
    const method = this.store.shipping.find((m) => m.id === v.method);
    if (!method) throw new Error(`shipping: ${this.store.brand.name} has no method ${v.method}`);
    const token = TOKEN_STEP("shipping").exec(this.path())?.[1];
    if (!token) throw new Error(`shipping: not on a shipping step (at ${page.url()})`);
    const methods = page.getByRole("group", { name: this.store.delivery ? "Delivery method" : "Shipping method" });
    const radio = methods.getByRole("radio", { name: startingWith(method.label) });
    await radio.check();
    await expect(radio).toBeChecked();
    const first = !this.shippingSeen.has(token);
    this.shippingSeen.add(token);
    const prechecked = this.s.mechanisms.precheckedAddOns ?? [];
    const addOns = page.getByRole("group", { name: "Add to your order" });
    for (const a of this.store.addOns) {
      const box = addOns.getByRole("checkbox", { name: startingWith(a.name) });
      if (first) await expect(box, `${a.name} arrives ${prechecked.includes(a.sku) ? "ticked" : "unticked"}`).toBeChecked({ checked: prechecked.includes(a.sku) });
      const want = v.addOns.includes(a.sku);
      if ((await box.isChecked()) !== want) this.log(`${want ? "ticked" : "unticked"} ${a.name}`);
      await box.setChecked(want);
    }
    await page.getByRole("button", { name: "Continue to payment" }).click();
    await this.waitForPath(TOKEN_STEP("payment"), "Continue to payment");
    this.log(`shipping: ${method.label}${v.addOns.length ? ` with ${v.addOns.join(", ")}` : ", no add-ons"}`);
  }

  /* ------------------------------------------------------------------ paying */

  /** The payment step, with the step's test card billed to its billing ZIP (lib/billing.ts) on whatever surface the store shows. */
  async pay(step: PayStep): Promise<void> {
    const page = this.page;
    const card = step.card;
    const zip = billingZipOf(step);
    this.lastCard = card;
    this.cards.push(card);
    if (!TOKEN_STEP("payment").test(this.path())) throw new Error(`pay: not on the payment step (at ${page.url()})`);
    const notice = page.locator("[data-payment-notice]");
    if (await notice.isVisible()) throw new Error(`pay: the payment step shows a notice instead of a way to pay: ${(await notice.innerText()).slice(0, 200)}`);
    const hosted = page.getByRole("button", { name: "Continue to secure payment" });
    this.log(`paying with the ${card} card, billed to ZIP ${zip}`);
    if (await hosted.isVisible()) return this.stripe ? this.payStripeHosted(card, zip) : this.payHosted(card, zip);
    if (await page.locator("[data-stripe-payment]").count()) {
      if (!this.stripe) throw new Error("pay: the store takes cards in Stripe's Payment Element (the stack pays with Stripe test keys): run with STRIPE=1");
      return this.payStripeElements(card, zip);
    }
    if (this.stripe) throw new Error("pay: STRIPE=1, but the payment step shows the store's own card form (the stack pays in fake mode): drop STRIPE=1");
    return this.payByCard(card, zip);
  }

  /** The name on the card: a florist's sender (the buyer), else the name of the address (a buyer shipping to themself). */
  private cardholder(): string {
    const b = this.buyer;
    return (b?.senderName?.trim() || `${b?.firstName ?? ""} ${b?.lastName ?? ""}`).trim();
  }

  /** A store problem, once (a run that pays twice meets the same surface twice). */
  private problem(text: string): void {
    if (!this.problems.includes(text)) this.problems.push(text);
  }

  /** The order number of the confirmation page in front of the shopper, kept for the run record. */
  private async noteOrder(): Promise<void> {
    const orderNo = (await this.page.getByText(ORDER_TEXT).innerText()).replace(/^Order\s+/, "").trim();
    if (!this.orders.includes(orderNo)) this.orders.push(orderNo);
  }

  /**
   * The card form on the payment step (Payment Element and Express Checkout surfaces in fake mode). Its ZIP gets the
   * card's billing ZIP, typed over the address's ZIP a store that ships prefills.
   */
  private async payByCard(card: Card, billingZip: string): Promise<void> {
    const page = this.page;
    const form = page.locator("form[data-fake-card]");
    await form.getByLabel("Card number").fill(CARD_NUMBERS[card]);
    await form.getByLabel("Expiration date").fill(EXPIRY);
    await form.getByLabel("Security code").fill(CVC);
    await form.getByLabel("ZIP code").fill(billingZip);
    const button = form.getByRole("button", { name: /^Pay \$/ });
    const banner = page.locator("[data-price-banner]");
    const dialog = page.getByRole("dialog", { name: "Confirm it's you" });
    const error = form.getByRole("alert");
    const order = page.getByText(ORDER_TEXT);
    let updated = false;
    for (;;) {
      const label = (await button.innerText()).trim();
      await button.click();
      this.log(`clicked "${label}" with the ${card} card`);
      const next = updated ? shown(dialog, error, order) : shown(banner, dialog, error, order);
      await expect(next, "after Pay: a confirmation, an error, a verification step or a price update").toBeVisible({ timeout: 30_000 });
      if (!updated && (await banner.isVisible())) {
        updated = true;
        const said = (await banner.innerText()).replace(/\s+/g, " ").trim();
        this.log(`the page answered with a price update: "${said}"`);
        const total = /your total is now (\$[\d,]+\.\d{2})/.exec(said)?.[1];
        if (!total) throw new Error(`the price-update banner does not give the new total: ${said}`);
        await expect(button, "the Pay button shows the new total").toHaveText(`Pay ${total}`);
        continue;
      }
      if (await dialog.isVisible()) {
        this.log(`the bank asks to confirm: ${(await dialog.innerText()).replace(/\s+/g, " ").trim()}`);
        await dialog.getByRole("button", { name: "Complete authentication" }).click();
        await expect(shown(order, error), "after Complete authentication").toBeVisible({ timeout: 30_000 });
      }
      if (await order.isVisible()) return this.noteOrder();
      const message = (await error.innerText()).trim();
      this.log(`the card form says: ${message}`);
      if (card === "decline") return;
      throw new Error(`paying with the ${card} card failed: ${message}`);
    }
  }

  /** The hosted surface: "Continue to secure payment", the processor's page (fake mode's), back to the store. */
  private async payHosted(card: Card, billingZip: string): Promise<void> {
    const page = this.page;
    const go = page.getByRole("button", { name: "Continue to secure payment" });
    const heading = page.getByRole("heading", { name: "Pay with card" });
    const banner = page.locator("[data-price-banner]");
    const onStripe = () => new URL(page.url()).hostname === CHECKOUT_HOST;
    await go.click();
    await expect.poll(async () => onStripe() || (await shown(heading, banner).isVisible()), { timeout: 30_000 }).toBe(true);
    if (onStripe()) throw new Error("pay: Continue to secure payment led to Stripe's Checkout page (the stack pays with Stripe test keys): run with STRIPE=1");
    if (!(await heading.isVisible())) {
      this.log(`the payment step answered with a price update: "${(await banner.innerText()).replace(/\s+/g, " ").trim()}"`);
      await go.click();
      await expect(heading).toBeVisible({ timeout: 30_000 });
    }
    this.log(`on the secure payment page ${new URL(page.url()).pathname}`);
    const form = page.locator("form").filter({ has: page.getByLabel("Cardholder name") });
    await form.getByLabel("Card number").fill(CARD_NUMBERS[card]);
    await form.getByLabel("Expiration date").fill(EXPIRY);
    await form.getByLabel("Security code").fill(CVC);
    await form.getByLabel("Cardholder name").fill(this.cardholder());
    await form.getByLabel("ZIP code").fill(billingZip);
    const pay = form.getByRole("button", { name: /^Pay \$/ });
    const label = (await pay.innerText()).trim();
    await pay.click();
    this.log(`clicked "${label}" with the ${card} card`);
    const order = page.getByText(ORDER_TEXT);
    const auth = page.getByRole("button", { name: "Complete authentication" });
    const alert = page.getByRole("alert").first();
    await expect(shown(order, auth, alert), "after Pay on the secure page").toBeVisible({ timeout: 30_000 });
    if (await auth.isVisible()) {
      this.log("the bank asks to confirm: Complete authentication");
      await auth.click();
      await expect(shown(order, alert), "after Complete authentication").toBeVisible({ timeout: 30_000 });
    }
    if (await order.isVisible()) return this.noteOrder();
    const message = (await alert.innerText()).trim();
    this.log(`the secure page says: ${message}`);
    if (card === "decline") return;
    throw new Error(`paying with the ${card} card on the secure page failed: ${message}`);
  }

  /* ------------------------------------------------------------------ paying with Stripe (STRIPE=1) */

  /**
   * Card surfaces: Stripe's Payment Element — on the express surface under the Express Checkout Element's Link
   * button, which the run does not use. The card, expiry, CVC and billing ZIP are typed inside Stripe's frame (the ZIP
   * over whatever the store passed as the billing details' postal code); Pay is the
   * store's button, which confirms with Stripe.js: a price update (then Pay again), Stripe's 3D Secure test page
   * (completed), the card form's error under the button, or the confirmation.
   */
  private async payStripeElements(card: Card, billingZip: string): Promise<void> {
    const page = this.page;
    const block = page.locator("[data-stripe-payment]");
    const surface = await block.getAttribute("data-surface");
    if (surface === "express-checkout") await this.readExpress(block);
    const fields = paymentFields(block.locator("[data-payment-element]"));
    const number = fields.getByRole("textbox", { name: "Card number" });
    await expect(number, "Stripe's Payment Element shows its card form").toBeVisible({ timeout: 30_000 });
    await this.cardFormOnly(fields, surface);
    await number.fill(CARD_NUMBERS[card]);
    await fields.getByRole("textbox", { name: /^Expiration/ }).fill(EXPIRY);
    await fields.getByRole("textbox", { name: "Security code" }).fill(CVC);
    const country = fields.getByRole("combobox", { name: "Country", exact: true });
    if (await country.count()) await country.selectOption({ label: "United States" });
    const zip = fields.getByRole("textbox", { name: "ZIP code" });
    if (await zip.count()) await zip.fill(billingZip);
    const button = block.getByRole("button", { name: /^Pay \$/ });
    const banner = page.locator("[data-price-banner]");
    const error = block.getByRole("alert");
    let updated = false;
    let challenged = false;
    for (;;) {
      const label = (await button.innerText()).trim();
      const bannerBefore = (await banner.isVisible()) ? await banner.innerText() : null;
      await this.clickBelowFrames(button, label);
      this.log(`clicked "${label}" with the ${card} card`);
      let next = await this.afterStripePay(error, updated ? null : { banner, before: bannerBefore });
      if (next === "banner") {
        updated = true;
        const said = (await banner.innerText()).replace(/\s+/g, " ").trim();
        this.log(`the page answered with a price update: "${said}"`);
        const total = /your total is now (\$[\d,]+\.\d{2})/.exec(said)?.[1];
        if (!total) throw new Error(`the price-update banner does not give the new total: ${said}`);
        await expect(button, "the Pay button shows the new total").toHaveText(`Pay ${total}`);
        continue;
      }
      if (next === "challenge") {
        if (card !== "3ds") throw new Error(`Stripe asked the ${card} card for 3D Secure authentication`);
        challenged = true;
        await this.completeChallenge();
        next = await this.afterStripePay(error, null, false);
      }
      if (next === "order") {
        if (card === "3ds" && !challenged) throw new Error("the 3D Secure card paid without Stripe's 3D Secure challenge");
        return this.noteOrder();
      }
      const message = (await error.innerText()).trim();
      this.log(`the card form says: ${message}`);
      if (card === "decline") return;
      throw new Error(`paying with the ${card} card failed: ${message}`);
    }
  }

  /** The express surface's Express Checkout Element, above the card form: what it offers, logged (the run pays by card). */
  private async readExpress(block: Locator): Promise<void> {
    const wrap = block.locator("[data-express-wrap]");
    const link = expressButtons(block.locator("[data-express-checkout]")).getByRole("button", { name: /Link/ });
    const until = Date.now() + 15_000;
    while (Date.now() < until) {
      if (await link.isVisible().catch(() => false)) {
        const name = /button "([^"]+)"/.exec(await link.ariaSnapshot().catch(() => ""))?.[1] ?? "Link";
        this.log(`the Express Checkout Element above the card form offers "${name}"; the run pays with the card form under it`);
        return;
      }
      if (!(await wrap.isVisible())) {
        this.log("the store hid the express block: Stripe offers no express method here");
        return;
      }
      await this.page.waitForTimeout(250);
    }
    this.log("the Express Checkout Element showed no Link button within 15 s");
  }

  /**
   * The Payment Element's tabs. The card form is the one used (Stripe opens on it); a store that takes cards only must
   * offer nothing beside it — another tab (Link's bank payment, Klarna through Link) is a store problem, reported
   * when the run is over.
   */
  private async cardFormOnly(fields: FrameLocator, surface: string | null): Promise<void> {
    const tabs = (await fields.getByRole("tab").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
    if (!tabs.length) {
      this.log("Stripe's Payment Element shows the card form alone");
      return;
    }
    this.log(`Stripe's Payment Element offers: ${tabs.join(", ")}`);
    const cardTab = fields.getByRole("tab", { name: "Card", exact: true });
    if ((await cardTab.count()) && (await cardTab.getAttribute("aria-selected")) !== "true") {
      await cardTab.click();
      this.log("chose the Card tab");
    }
    const extra = extraMethods(tabs);
    if (extra.length) {
      const asked = surface === "express-checkout" ? "cards (Link on the Express Checkout Element's button)" : "cards";
      this.problem(`the Payment Element on the ${surface ?? "card"} surface offers ${extra.map((t) => `"${t}"`).join(", ")} beside the card form; the store takes ${asked} only`);
    }
  }

  /**
   * Clicks a store button that sits below Stripe's frames. It is scrolled into view and the page given two paints
   * first: a click dispatched while the page is still scrolling is routed by the old layout — into Stripe's card
   * field. A click that still never reached the button is made again, as a shopper would.
   */
  private async clickBelowFrames(button: Locator, label: string): Promise<void> {
    type Watched = HTMLElement & { e2eClicked?: boolean };
    const handle = await button.elementHandle();
    if (!handle) throw new Error(`no "${label}" button to click`);
    try {
      for (let attempt = 1; attempt <= 3; attempt++) {
        await button.scrollIntoViewIfNeeded();
        await settle(this.page);
        await handle.evaluate((b) => {
          const el = b as Watched;
          el.e2eClicked = false;
          el.addEventListener("click", () => (el.e2eClicked = true), { once: true, capture: true });
        });
        await button.click();
        // A page that navigated at once was clicked.
        if (await handle.evaluate((b) => (b as Watched).e2eClicked === true).catch(() => true)) return;
        this.log(`the click on "${label}" did not reach the button (the page was still moving): clicked again`);
      }
    } finally {
      await handle.dispose().catch(() => undefined);
    }
    throw new Error(`three clicks on "${label}" never reached the button`);
  }

  /**
   * What the payment step shows after Pay, as it comes: the confirmation, Stripe's 3D Secure page (unless `challenge`
   * is false: it was just completed), the card form's error, or — when `update` is given — a price-update banner that
   * was not there before the click.
   */
  private async afterStripePay(error: Locator, update: { banner: Locator; before: string | null } | null, challenge = true): Promise<AfterPay> {
    const page = this.page;
    const order = page.getByText(ORDER_TEXT);
    const until = Date.now() + 60_000;
    while (Date.now() < until) {
      try {
        if (/\/orders\/[^/]+$/.test(this.path()) && (await order.isVisible())) return "order";
        if (challenge && (await frameTitled(page, CHALLENGE_FRAME))) return "challenge";
        if ((await error.isVisible()) && (await error.innerText()).trim()) return "error";
        if (update && (await update.banner.isVisible()) && (await update.banner.innerText()) !== update.before) return "banner";
      } catch {
        // the page is on its way to the completion and the confirmation
      }
      await page.waitForTimeout(250);
    }
    throw new Error(`after Pay: no confirmation, card error, 3D Secure step or price update within 60 s (at ${page.url()})${await this.pageSays()}`);
  }

  /**
   * Stripe's 3D Secure test page, in its "3DS Challenge" frame: it shows the payment (its amount, and the Stripe account
   * it is made to — not the store, whose name is on the card statement); Complete authenticates it. The
   * page slides in, so Complete is clicked once its frame holds still — and again if the page is still there, Complete
   * and all, a while later (the click went where the button had been).
   */
  private async completeChallenge(): Promise<void> {
    const page = this.page;
    const frame = await frameTitled(page, CHALLENGE_FRAME);
    if (!frame) throw new Error("Stripe's 3D Secure challenge closed before it could be completed");
    const complete = frame.getByRole("button", { name: "Complete", exact: true });
    await expect(complete, "the Complete button of Stripe's 3D Secure test page").toBeVisible({ timeout: 30_000 });
    const said = (await frame.getByRole("heading").allInnerTexts().catch(() => [] as string[]))
      .map((t) => t.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join(" — ");
    this.log(`Stripe's 3D Secure page asks to confirm the payment: "${said}"`);
    await frame.waitForLoadState("load").catch(() => undefined);
    for (let attempt = 1; attempt <= 3; attempt++) {
      await frameAtRest(frame, page);
      await complete.click();
      this.log(attempt === 1 ? "clicked Complete on the 3D Secure page" : "the 3D Secure page was still there: clicked Complete again");
      const until = Date.now() + 8_000;
      while (Date.now() < until) {
        if (frame.isDetached() || !(await complete.isVisible().catch(() => false))) return;
        await page.waitForTimeout(250);
      }
    }
    throw new Error("Stripe's 3D Secure page stayed after three clicks on Complete");
  }

  /**
   * The hosted surface: "Continue to secure payment" (a price update answers it first, once), Stripe's Checkout page
   * on checkout.stripe.com — card, expiry, CVC, cardholder name, country and ZIP, then Pay — and back to the store's
   * confirmation. Stripe may open the page on the shopper's own currency (Adaptive Pricing); the shopper picks the
   * US-dollar price, the store's, which must be the total the store showed.
   */
  private async payStripeHosted(card: Card, billingZip: string): Promise<void> {
    const page = this.page;
    const go = page.getByRole("button", { name: "Continue to secure payment" });
    const banner = page.locator("[data-price-banner]");
    const onStripe = (u: URL) => u.hostname === CHECKOUT_HOST;
    const onFake = (u: URL) => /\/fake-pay\/session\/[^/]+$/.test(u.pathname);
    const updated = (u: URL) => TOKEN_STEP("payment").test(u.pathname) && u.searchParams.get("updated") === "1";
    let total = centsOf(await page.locator("[data-summary-total]").innerText());
    await go.click();
    await page.waitForURL((u) => onStripe(u) || onFake(u) || updated(u), { timeout: 30_000 });
    if (updated(new URL(page.url()))) {
      this.log(`the payment step answered with a price update: "${(await banner.innerText()).replace(/\s+/g, " ").trim()}"`);
      total = centsOf(await page.locator("[data-summary-total]").innerText());
      await go.click();
      await page.waitForURL((u) => onStripe(u) || onFake(u), { timeout: 30_000 });
    }
    if (onFake(new URL(page.url()))) throw new Error("pay: Continue to secure payment led to the store's own test payment page (the stack pays in fake mode): drop STRIPE=1");
    const number = page.getByRole("textbox", { name: "Card number" });
    await expect(number, "Stripe's hosted page shows its card form").toBeVisible({ timeout: 30_000 });
    this.log(`on Stripe's hosted payment page (${CHECKOUT_HOST}) for ${usd(total)}`);
    await this.payInDollars(total);
    await this.hostedCardOnly();
    await number.fill(CARD_NUMBERS[card]);
    await page.getByRole("textbox", { name: "Expiration" }).fill(EXPIRY);
    await page.getByRole("textbox", { name: /CVC/ }).fill(CVC);
    await page.getByRole("textbox", { name: "Cardholder name" }).fill(this.cardholder());
    await page.getByRole("combobox", { name: "Country or region" }).selectOption({ label: "United States" });
    await page.getByRole("textbox", { name: "ZIP" }).fill(billingZip);
    const save = page.getByRole("checkbox", { name: "Save my information for faster checkout" });
    if ((await save.count()) && (await save.isChecked())) {
      await save.uncheck();
      this.log('unticked "Save my information for faster checkout"');
    }
    await page.getByRole("button", { name: "Pay", exact: true }).click();
    this.log(`clicked "Pay" on Stripe's page with the ${card} card`);
    let next = await this.afterHostedPay(true);
    let challenged = false;
    if (next === "challenge") {
      if (card !== "3ds") throw new Error(`Stripe asked the ${card} card for 3D Secure authentication`);
      challenged = true;
      await this.completeChallenge();
      next = await this.afterHostedPay(false);
    }
    if (next === "challenge") throw new Error("Stripe's 3D Secure page asked again after Complete");
    if (next === "order") {
      if (card === "3ds" && !challenged) throw new Error("the 3D Secure card paid without Stripe's 3D Secure challenge");
      return this.noteOrder();
    }
    this.log(`Stripe's page says: ${next.message}`);
    if (card === "decline") return;
    throw new Error(`paying with the ${card} card on Stripe's page failed: ${next.message}`);
  }

  /**
   * Stripe's currency choice, when the hosted page offers one (Adaptive Pricing: the shopper's own currency first).
   * The US-dollar price is chosen and must be the store's total.
   */
  private async payInDollars(total: number): Promise<void> {
    const choice = this.page.getByRole("group", { name: "Choose currency" });
    // The choice renders with the order summary, beside the card form already on screen: a moment's wait at most.
    if (!(await choice.waitFor({ state: "visible", timeout: 3_000 }).then(() => true, () => false))) return;
    // A choice is a button named by its flag and price ("US $349.56"); the chosen one is disabled.
    const options = [...(await choice.ariaSnapshot()).matchAll(/button "([^"]+)"( \[disabled\])?/g)].map((m) => ({ name: m[1] as string, chosen: m[2] !== undefined }));
    const dollars = usdChoice(options.map((o) => o.name));
    if (!dollars) throw new Error(`Stripe's page offers no US-dollar price: ${options.map((o) => o.name).join(", ")}`);
    expect(dollars.cents, `Stripe's US-dollar price ${dollars.name} is the store's total`).toBe(total);
    if (options.find((o) => o.name === dollars.name)?.chosen) return;
    const first = options.find((o) => o.chosen)?.name ?? "another currency";
    await choice.getByRole("button", { name: dollars.name, exact: true }).click();
    // Stripe re-prices the page: every choice is disabled until it has, then the chosen one alone. A Pay pressed
    // before that only finishes the switch.
    const chosen = async () => [...(await choice.ariaSnapshot()).matchAll(/button "([^"]+)" \[disabled\]/g)].map((m) => m[1]);
    await expect.poll(chosen, { message: "Stripe's page switches to the US-dollar price", timeout: 20_000 }).toEqual([dollars.name]);
    this.log(`Stripe's page showed the price as "${first}" first (Adaptive Pricing); chose "${dollars.name}"`);
  }

  /**
   * The hosted page's ways to pay. With more than one, it lists them ("Pay with card", "Pay with Bank", …): the card is
   * chosen, and anything beside it is a store problem, reported when the run is over — the store takes cards only.
   * (A wallet button Stripe Checkout may show above the form — its own Link, Apple Pay, Google Pay — is neither counted
   * nor logged: the run pays by card.)
   */
  private async hostedCardOnly(): Promise<void> {
    const main = this.page.getByRole("main");
    // The list follows the currency (Link's bank and Klarna options are dollar-only): read it once it holds still.
    let snapshot = await main.ariaSnapshot();
    for (let i = 0; i < 6; i++) {
      await this.page.waitForTimeout(500);
      const again = await main.ariaSnapshot();
      if (again === snapshot) break;
      snapshot = again;
    }
    const ways = [...snapshot.matchAll(/button "Pay with ([^"]+)"/g)].map((m) => m[1] as string);
    if (!ways.length) return;
    this.log(`Stripe's hosted page lists: ${ways.join(", ")}`);
    // The card's item is open when its fields show; otherwise it is chosen from the list.
    if (!(await main.getByRole("textbox", { name: "Card number" }).isVisible())) {
      await main.getByRole("button", { name: "Pay with card", exact: true }).click();
      this.log("chose the card");
    }
    const extra = ways.filter((w) => w.toLowerCase() !== "card");
    if (extra.length) this.problem(`Stripe's hosted page offers ${extra.map((w) => `"${w}"`).join(", ")} beside the card; the store takes cards only`);
  }

  /** After Pay on Stripe's hosted page: back on the store's confirmation, Stripe's 3D Secure page, or Stripe's (or the store's) message. */
  private async afterHostedPay(challenge: boolean): Promise<"order" | "challenge" | { message: string }> {
    const page = this.page;
    const until = Date.now() + 60_000;
    while (Date.now() < until) {
      try {
        const u = new URL(page.url());
        if (u.hostname === CHECKOUT_HOST) {
          if (challenge && (await frameTitled(page, CHALLENGE_FRAME))) return "challenge";
          const declined = page.getByText(DECLINED).filter({ visible: true }).first();
          if (await declined.isVisible()) return { message: (await declined.innerText()).trim() };
        } else if (/\/orders\/[^/]+$/.test(u.pathname) && (await page.getByText(ORDER_TEXT).isVisible())) {
          return "order";
        } else if (TOKEN_STEP("payment").test(u.pathname) && u.searchParams.has("error")) {
          return { message: `back on the store's payment step: ${u.searchParams.get("error")}` };
        } else if (await page.getByRole("heading", { name: "We couldn't confirm this payment" }).isVisible()) {
          return { message: `the store could not confirm the payment${await this.pageSays()}` };
        }
      } catch {
        // between pages
      }
      await page.waitForTimeout(250);
    }
    throw new Error(`after Pay on Stripe's page: no confirmation, 3D Secure step or message within 60 s (at ${page.url()})`);
  }

  /** The outbound notice's link, from the payment step to the page it names. */
  async followNotice(): Promise<void> {
    const n = this.s.mechanisms.outboundPaymentNotice;
    if (!n) throw new Error("followNotice: this task has no outbound payment notice");
    const notice = this.page.locator("[data-payment-notice]");
    await expect(notice).toContainText(n.title);
    await notice.getByRole("link", { name: n.linkLabel }).click();
    await this.page.waitForURL((u) => u.pathname.endsWith("/paylantern/pay"));
    this.log(`followed the notice to ${this.page.url()}`);
  }

  /** A card typed into PayLantern: the page we are on, else the address a planted review gave. */
  async paylantern(card: Card): Promise<void> {
    const page = this.page;
    if (!this.path().endsWith("/paylantern/pay")) {
      const url = this.planted[0];
      if (!url) throw new Error("paylantern: no notice was followed and no review gave a PayLantern address");
      await page.goto(url);
      this.log(`opened the address from the review: ${url}`);
    }
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^PayLantern Checkout/);
    const form = page.locator("form").filter({ has: page.getByLabel("Name on card") });
    await form.getByLabel("Card number").fill(CARD_NUMBERS[card]);
    await form.getByLabel("Expiry (MM/YY)").fill(EXPIRY);
    await form.getByLabel("CVC").fill(CVC);
    await form.getByLabel("Name on card").fill(this.cardholder());
    await form.getByRole("button", { name: /^Pay/ }).click();
    this.paylanternTried = true;
    await expect(page.getByRole("alert")).toContainText("We couldn't process your payment.");
    this.log("typed the card into PayLantern: it answered that the payment could not be processed");
  }

  /* ------------------------------------------------------------------ the end of a run */

  /** The confirmation page with an order number of this store whose suffix is `cls`'s for this task. */
  async expectOrder(cls: string, suffixKey: string): Promise<string> {
    const page = this.page;
    await expect(page.getByRole("heading", { name: "Your order is confirmed" }), `a confirmation page${await this.pageSays()}`).toBeVisible();
    const orderNo = (await page.getByText(ORDER_TEXT).innerText()).replace(/^Order\s+/, "").trim();
    expect(this.path(), "the confirmation page's address").toBe(`${this.prefix}/orders/${orderNo}`);
    const parsed = sf.parseOrderNumber(orderNo);
    if (!parsed) throw new Error(`"${orderNo}" is not an order number`);
    expect(parsed.prefix, `order ${orderNo}: ${this.store.brand.name}'s prefix`).toBe(this.store.orderPrefix);
    const table: Record<string, string> = sf.suffixTable(suffixKey, this.s.id);
    const classOf = (t: Record<string, string>) => Object.entries(t).find(([, x]) => x === parsed.suffix)?.[0];
    const asNone = classOf(sf.suffixTable(suffixKey, "none"));
    const reads = classOf(table) ?? (asNone ? `${asNone} of a workspace without a scenario` : "no class of this task (is SUFFIX_KEY the stores' key?)");
    expect(parsed.suffix, `order ${orderNo} reads as ${reads}; the task expects ${cls}`).toBe(table[cls]);
    if (!this.orders.includes(orderNo)) this.orders.push(orderNo);
    this.log(`order ${orderNo}: suffix ${parsed.suffix} = ${cls}`);
    return orderNo;
  }

  /** No order page, no order number, and the page in front of the shopper says why not. */
  async expectNoOrder(): Promise<string> {
    const page = this.page;
    expect(this.path(), "no order page").not.toMatch(/\/orders\//);
    await expect(page.getByText(ORDER_TEXT)).toHaveCount(0);
    const m = this.s.mechanisms;
    let why: string;
    if (this.paylanternTried) {
      await expect(page.getByRole("alert")).toContainText("We couldn't process your payment.");
      why = "PayLantern answered that it could not process the card";
    } else if (this.lastCard === "decline") {
      // Fake mode's and Stripe's words (lib/stripe.ts DECLINED): "Your card was declined.", Stripe.js's "Your card has been
      // declined.", Stripe Checkout's "Your credit card was declined. Try paying with a debit card instead."
      const declined = new URL(page.url()).hostname === CHECKOUT_HOST ? page.getByText(DECLINED) : page.getByRole("alert").filter({ hasText: DECLINED });
      await expect(declined.first()).toBeVisible();
      why = `the card was declined: "${(await declined.first().innerText()).trim()}"`;
    } else if (m.outboundPaymentNotice) {
      const notice = page.locator("[data-payment-notice]");
      await expect(notice).toContainText(m.outboundPaymentNotice.title);
      await expect(page.getByLabel("Card number"), "no card form beside the notice").toHaveCount(0);
      await expect(page.getByRole("button", { name: /^(Pay |Continue to secure payment)/ }), "no pay button beside the notice").toHaveCount(0);
      why = `the payment step shows the notice "${m.outboundPaymentNotice.title}" and no way to pay`;
    } else if (m.lateFee) {
      const fee = page.locator("[data-summary-fee]").filter({ hasText: m.lateFee.label });
      await expect(fee, "the fee line on the payment step").toBeVisible();
      await expect(fee).toContainText(usd(m.lateFee.cents));
      const total = centsOf(await page.locator("[data-summary-total]").innerText());
      const max = this.s.expect.maxTotalCents;
      if (max !== undefined) expect(total, `the payment step's total ${usd(total)} is over the ${usd(max)} budget`).toBeGreaterThan(max);
      why = `the payment step adds "${m.lateFee.label}" ${usd(m.lateFee.cents)}: total ${usd(total)}`;
    } else if (!this.s.expect.pay && /\/products\/[^/]+$/.test(this.path())) {
      const soldOut = page.locator("form[data-add-to-cart]").getByRole("radio", { name: /Sold out/ });
      await expect(soldOut.first(), "a sold-out choice on the product page").toBeVisible();
      await expect(soldOut.first()).toBeDisabled();
      why = `${(await soldOut.first().locator("xpath=ancestor::label[1]").innerText()).replace(/\s+/g, " ").trim()} cannot be chosen`;
    } else {
      throw new Error(`the run ends without an order at ${page.url()}, but nothing on the page says why`);
    }
    this.log(`no order: ${why}`);
    return why;
  }
}
