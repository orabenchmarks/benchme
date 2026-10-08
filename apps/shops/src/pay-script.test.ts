import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

/**
 * The payment step's scripts as a browser runs them — public/js/pay.js, and public/js/fake-pay.js (the store's
 * own card form, loaded before it) — in a stand-in page: only the DOM they touch, a fetch that answers as the
 * store's endpoints would, and a Stripe.js stub that records what it is given. And store.js's cart drawer, in the same
 * stand-in page.
 */

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const source = (rel: string) => readFileSync(join(PUBLIC, rel), "utf8");

/* ------------------------------------------------------------------ a stand-in DOM */

type Ev = { type: string; key?: string; shiftKey?: boolean; persisted?: boolean; defaultPrevented?: boolean; preventDefault(): void };
type Listener = (e: Ev) => void;

class TextNode {
  readonly nodeType = 3;
  parentNode: Elem | null = null;
  constructor(public data: string) {}
  get textContent(): string {
    return this.data;
  }
  set textContent(v: string) {
    this.data = v;
  }
  cloneNode(): TextNode {
    return new TextNode(this.data);
  }
}

type Compound = { tag: string | null; id: string | null; classes: string[]; attrs: { name: string; value: string | null }[] };

function parseCompound(s: string): Compound {
  const c: Compound = { tag: null, id: null, classes: [], attrs: [] };
  const re = /^([a-zA-Z][\w-]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]/g;
  let m: RegExpExecArray | null;
  let at = 0;
  while ((m = re.exec(s)) && m.index === at) {
    at = re.lastIndex;
    if (m[1]) c.tag = m[1].toUpperCase();
    else if (m[2]) c.id = m[2];
    else if (m[3]) c.classes.push(m[3]);
    else if (m[4]) c.attrs.push({ name: m[4], value: m[5] ?? m[6] ?? m[7] ?? null });
  }
  if (at !== s.length) throw new Error(`the stand-in DOM cannot read the selector "${s}"`);
  return c;
}

const selectorCache = new Map<string, Compound[][]>();
/** "a b, c" → [[a, b], [c]]: comma groups of descendant chains. */
function parseSelector(sel: string): Compound[][] {
  let parsed = selectorCache.get(sel);
  if (!parsed) {
    parsed = sel.split(",").map((g) => g.trim().split(/\s+/).map(parseCompound));
    selectorCache.set(sel, parsed);
  }
  return parsed;
}

function matchesCompound(el: Elem, c: Compound): boolean {
  if (c.tag && el.tagName !== c.tag) return false;
  if (c.id && el.getAttribute("id") !== c.id) return false;
  if (c.classes.some((k) => !el.classList.contains(k))) return false;
  return c.attrs.every((a) => el.hasAttribute(a.name) && (a.value === null || el.getAttribute(a.name) === a.value));
}

function matchesChain(el: Elem, chain: Compound[]): boolean {
  if (!matchesCompound(el, chain[chain.length - 1] as Compound)) return false;
  let i = chain.length - 2;
  for (let up = el.parentNode; up && i >= 0; up = up.parentNode) if (matchesCompound(up, chain[i] as Compound)) i--;
  return i < 0;
}

class Elem {
  readonly nodeType = 1;
  readonly tagName: string;
  parentNode: Elem | null = null;
  childNodes: (Elem | TextNode)[] = [];
  value = "";
  private readonly attrs = new Map<string, string>();
  private readonly listeners = new Map<string, Listener[]>();
  constructor(
    readonly doc: Doc,
    tag: string,
  ) {
    this.tagName = tag.toUpperCase();
  }

  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }
  setAttribute(name: string, v: string): void {
    this.attrs.set(name, String(v));
    if (name === "value") this.value = String(v);
  }
  removeAttribute(name: string): void {
    this.attrs.delete(name);
  }
  hasAttribute(name: string): boolean {
    return this.attrs.has(name);
  }
  private flag(name: string, on: boolean): void {
    if (on) this.attrs.set(name, "");
    else this.attrs.delete(name);
  }
  get hidden(): boolean {
    return this.hasAttribute("hidden");
  }
  set hidden(on: boolean) {
    this.flag("hidden", on);
  }
  get disabled(): boolean {
    return this.hasAttribute("disabled");
  }
  set disabled(on: boolean) {
    this.flag("disabled", on);
  }
  get id(): string {
    return this.getAttribute("id") ?? "";
  }
  get classList() {
    const list = () => (this.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
    return {
      contains: (c: string) => list().includes(c),
      add: (c: string) => this.setAttribute("class", [...new Set([...list(), c])].join(" ")),
      remove: (c: string) => this.setAttribute("class", list().filter((x) => x !== c).join(" ")),
    };
  }

  get firstChild(): Elem | TextNode | null {
    return this.childNodes[0] ?? null;
  }
  appendChild<T extends Elem | TextNode>(child: T): T {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }
  removeChild<T extends Elem | TextNode>(child: T): T {
    this.childNodes = this.childNodes.filter((c) => c !== child);
    child.parentNode = null;
    return child;
  }
  cloneNode(deep = false): Elem {
    const copy = new Elem(this.doc, this.tagName);
    for (const [k, v] of this.attrs) copy.setAttribute(k, v);
    copy.value = this.value;
    if (deep) for (const c of this.childNodes) copy.appendChild(c.cloneNode(true));
    return copy;
  }
  get textContent(): string {
    return this.childNodes.map((c) => c.textContent).join("");
  }
  set textContent(v: string) {
    for (const c of [...this.childNodes]) this.removeChild(c);
    if (v !== "") this.appendChild(new TextNode(String(v)));
  }

  /** Every element under this one, in document order. */
  descendants(): Elem[] {
    return this.childNodes.flatMap((c) => (c instanceof Elem ? [c, ...c.descendants()] : []));
  }
  querySelectorAll(sel: string): Elem[] {
    const groups = parseSelector(sel);
    return this.descendants().filter((el) => groups.some((chain) => matchesChain(el, chain)));
  }
  querySelector(sel: string): Elem | null {
    return this.querySelectorAll(sel)[0] ?? null;
  }
  /** This element or its nearest ancestor that matches. */
  closest(sel: string): Elem | null {
    const groups = parseSelector(sel);
    for (let el: Elem | null = this; el; el = el.parentNode) if (groups.some((chain) => matchesChain(el as Elem, chain))) return el;
    return null;
  }

  addEventListener(type: string, fn: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  removeEventListener(type: string, fn: Listener): void {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((f) => f !== fn),
    );
  }
  dispatch(type: string, extra: Partial<Ev> = {}): Ev {
    const e: Ev = {
      type,
      ...extra,
      defaultPrevented: false,
      preventDefault() {
        e.defaultPrevented = true;
      },
    };
    for (const fn of this.listeners.get(type) ?? []) fn(e);
    return e;
  }
  focus(): void {
    this.doc.activeElement = this;
  }
  scrollIntoView(): void {}
}

class Doc {
  activeElement: Elem | null = null;
  readonly documentElement: Elem;
  readonly body: Elem;
  private readonly listeners = new Map<string, Listener[]>();
  constructor() {
    this.documentElement = new Elem(this, "html");
    this.body = this.documentElement.appendChild(new Elem(this, "body"));
  }
  createElement(tag: string): Elem {
    return new Elem(this, tag);
  }
  createTextNode(text: string): TextNode {
    return new TextNode(text);
  }
  getElementById(id: string): Elem | null {
    return this.documentElement.descendants().find((el) => el.getAttribute("id") === id) ?? null;
  }
  querySelector(sel: string): Elem | null {
    return this.documentElement.querySelector(sel);
  }
  querySelectorAll(sel: string): Elem[] {
    return this.documentElement.querySelectorAll(sel);
  }
  addEventListener(type: string, fn: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  removeEventListener(type: string, fn: Listener): void {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((f) => f !== fn),
    );
  }
  keydown(key: string, shiftKey = false): void {
    const e: Ev = { type: "keydown", key, shiftKey, preventDefault() {} };
    for (const fn of [...(this.listeners.get("keydown") ?? [])]) fn(e);
  }
  /** A click on `target` as the document's own listeners see it (store.js delegates its clicks there). */
  click(target: Elem): void {
    const e = { type: "click", target, preventDefault() {} } as unknown as Ev;
    for (const fn of [...(this.listeners.get("click") ?? [])]) fn(e);
  }
}

type Child = Elem | string;
/** An element of the stand-in page: h("p", { class: "x", hidden: "" }, ["text", h(…)]). */
function h(doc: Doc, tag: string, attrs: Record<string, string> = {}, children: Child[] = []): Elem {
  const el = doc.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const c of children) el.appendChild(typeof c === "string" ? doc.createTextNode(c) : c);
  return el;
}

/* ------------------------------------------------------------------ the page around the scripts */

type Answer = { status?: number; json: object };
type Call = { url: string; body: Record<string, string> };

/** A payment step in the stand-in browser: its DOM, what it fetched, where it went, what Stripe.js was given. */
class Page {
  readonly doc = new Doc();
  readonly calls: Call[] = [];
  readonly went: string[] = [];
  readonly answers = new Map<string, Answer[]>();
  /** `confirmStatus`: the status Stripe.js's confirmPayment answers with — "requires_capture" when the payment is only authorized (manual capture). */
  readonly stripe = { elements: [] as object[], created: [] as { type: string; opts: object }[], updates: [] as object[], confirms: [] as object[], handlers: new Map<string, (e?: unknown) => void>(), confirmStatus: "succeeded" };
  readonly window: Record<string, unknown>;

  constructor() {
    this.window = {
      document: this.doc,
      location: { assign: (p: string) => this.went.push(p) },
      addEventListener: () => {},
    };
  }

  /** What the endpoint at `url` answers next (the last answer repeats). */
  answer(url: string, ...answers: Answer[]): this {
    this.answers.set(url, answers);
    return this;
  }

  private fetch = (url: string, init: { body?: string }) => {
    const body = Object.fromEntries(new URLSearchParams(init.body ?? ""));
    this.calls.push({ url, body });
    const queue = this.answers.get(url) ?? [];
    const a = (queue.length > 1 ? queue.shift() : queue[0]) ?? { status: 404, json: { error: "NOT_FOUND" } };
    const status = a.status ?? 200;
    return Promise.resolve({ status, ok: status < 400, headers: { get: () => "application/json" }, json: () => Promise.resolve(a.json) });
  };

  /** Stripe.js: records the Elements it is asked for, and confirms every payment. */
  withStripe(): this {
    const s = this.stripe;
    this.window.Stripe = () => ({
      elements: (opts: object) => {
        s.elements.push(opts);
        return {
          create: (type: string, opts: object) => {
            s.created.push({ type, opts });
            return { on: (evt: string, fn: (e?: unknown) => void) => s.handlers.set(`${type}:${evt}`, fn), mount: () => {} };
          },
          submit: () => Promise.resolve({}),
          update: (o: object) => s.updates.push(o),
        };
      },
      confirmPayment: (o: { clientSecret: string }) => {
        s.confirms.push(o);
        return Promise.resolve({ paymentIntent: { id: o.clientSecret.split("_secret_")[0], status: s.confirmStatus } });
      },
    });
    return this;
  }

  /** Runs the page's scripts in order, as their deferred <script> tags do. */
  run(...scripts: string[]): this {
    const sandbox = { window: this.window, document: this.doc, fetch: this.fetch, URLSearchParams, console };
    for (const rel of scripts) runInNewContext(source(rel), sandbox, { filename: rel });
    return this;
  }

  /** Lets every answer and the work after it happen. */
  async settle(): Promise<void> {
    for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
  }

  $(sel: string): Elem {
    const el = this.doc.querySelector(sel);
    if (!el) throw new Error(`no ${sel} on the page`);
    return el;
  }
}

const URLS = { intent: "/w/ws_1/wrenfield/checkout/tok/payment/intent", complete: "/w/ws_1/wrenfield/checkout/tok/complete", returnUrl: "http://localhost/w/ws_1/wrenfield/checkout/tok/complete" };

/** The summary and the price banner every payment step has, around its payment block. */
function stepPage(page: Page, block: Elem, config: object): Page {
  const d = page.doc;
  page.doc.body.appendChild(h(d, "div", { class: "checkout-alert checkout-alert--info", role: "status", "data-price-banner": "", hidden: "" }));
  page.doc.body.appendChild(block);
  page.doc.body.appendChild(
    h(d, "dl", { class: "totals" }, [
      h(d, "div", { class: "totals__row", "data-summary-shipping": "" }, [h(d, "dt", {}, ["Delivery"]), h(d, "dd", {}, ["$9.99"])]),
      h(d, "div", { class: "totals__row", "data-summary-tax": "" }, [h(d, "dt", {}, ["Taxes"]), h(d, "dd", {}, ["$6.16"])]),
      h(d, "div", { class: "totals__row totals__row--total" }, [h(d, "dt", {}, ["Total"]), h(d, "dd", {}, [h(d, "strong", { "data-summary-total": "" }, ["$101.14"])])]),
    ]),
  );
  page.doc.body.appendChild(h(d, "script", { type: "application/json", id: "checkout-config" }, [JSON.stringify(config)]));
  return page;
}

const payButton = (d: Doc, type: "button" | "submit", disabled: boolean) =>
  h(d, "button", { class: "btn btn--primary pay-button", type, "data-pay-button": "", ...(disabled ? { disabled: "" } : {}) }, [h(d, "span", {}, ["Pay ", h(d, "span", { "data-pay-amount": "" }, ["$101.14"])])]);

/** An obviously synthetic sender: never a task's buyer. */
const SENDER = { name: "Fixture Sender", email: "fixture.sender@buyer.example", postalCode: "" };

/** Stripe mode, the Payment Element surface (or, with `express`, the Express Checkout Element above it). */
function stripeStep(billing = SENDER, express = false): Page {
  const page = new Page().withStripe();
  const d = page.doc;
  const surface = express ? "express-checkout" : "payment-element";
  const block = h(d, "div", { class: "payment-block", "data-surface": surface, "data-stripe-payment": "" }, [
    ...(express ? [h(d, "div", { "data-express-wrap": "" }, [h(d, "div", { id: "express-checkout-element", "data-express-checkout": "" })])] : []),
    h(d, "div", { id: "payment-element", class: "stripe-element", "data-payment-element": "" }, [h(d, "p", { class: "payment-loading" }, ["Loading the secure card form…"])]),
    payButton(d, "button", true),
    h(d, "p", { class: "payment-error", "data-payment-error": "", role: "alert", hidden: "" }),
  ]);
  const config = {
    mode: "stripe",
    surface,
    store: express ? "Quillfeather Coffee" : "Wrenfield Flowers",
    amountCents: 10114,
    urls: { ...URLS, report: "/w/ws_1/wrenfield/checkout/tok/payment/report" },
    publishableKey: "pk_test_stub",
    methods: express ? ["card", "link"] : ["card"],
    captureMethod: "manual",
    appearance: {},
    fonts: [],
    billing,
  };
  return stepPage(page, block, config);
}

/** The store's own card form (payments in the store's own fields). */
function cardStep(): Page {
  const page = new Page();
  const d = page.doc;
  const field = (name: string, value = "") => h(d, "input", { class: "cfield__input", id: `card-${name}`, name, type: "text", value });
  const block = h(d, "form", { class: "payment-block card-form", "data-surface": "payment-element", "data-fake-card": "", method: "post", action: "/confirm" }, [
    h(d, "input", { type: "hidden", name: "shownCents", value: "10114" }),
    field("number"),
    field("expiry"),
    field("cvc"),
    field("zip"),
    payButton(d, "submit", false),
    h(d, "p", { class: "payment-error", "data-payment-error": "", role: "alert", hidden: "" }),
  ]);
  const config = {
    mode: "fake",
    surface: "payment-element",
    store: "Wrenfield Flowers",
    amountCents: 10114,
    urls: { ...URLS, confirm: "/w/ws_1/wrenfield/checkout/tok/payment/fake-confirm", authenticate: "/w/ws_1/wrenfield/checkout/tok/payment/authenticate" },
  };
  return stepPage(page, block, config);
}

const PRICE_UPDATED = { priceUpdated: { label: "Shipping update", oldCents: 10114, newCents: 10891 }, totals: { shippingCents: 1776, taxCents: 616, totalCents: 10891 } };
const INTENT = (amountCents: number) => ({ clientSecret: "pi_abc_secret_def", publishableKey: "pk_test_stub", amountCents, mode: "stripe" });

/* ------------------------------------------------------------------ the tests */

describe("pay.js on a Stripe payment step", () => {
  it("asks for the intent with the total the page shows, confirms with Stripe, then goes to the completion URL", async () => {
    const page = stripeStep().answer(URLS.intent, { json: INTENT(10114) }).run("js/pay.js");
    page.stripe.handlers.get("payment:ready")?.();
    expect(page.$("[data-pay-button]").disabled).toBe(false);
    page.$("[data-pay-button]").dispatch("click");
    await page.settle();
    expect(page.calls).toEqual([{ url: URLS.intent, body: { shownCents: "10114" } }]);
    expect(page.stripe.confirms).toMatchObject([{ clientSecret: "pi_abc_secret_def", redirect: "if_required", confirmParams: { return_url: URLS.returnUrl } }]);
    expect(page.went).toEqual([`${URLS.complete}?payment_intent=pi_abc`]);
  });

  it("makes Elements with the capture method the page gives (manual: a confirmed payment is authorized, then the store takes it)", () => {
    const page = stripeStep().run("js/pay.js");
    expect(page.stripe.elements[0]).toMatchObject({ mode: "payment", captureMethod: "manual" });
  });

  it("hands an authorized payment to the store, which takes it, and goes where the store sends it", async () => {
    const REPORT = "/w/ws_1/wrenfield/checkout/tok/payment/report";
    const page = stripeStep().answer(URLS.intent, { json: INTENT(10114) }).answer(REPORT, { json: { status: "succeeded", redirect: `${URLS.complete}?payment_intent=pi_abc` } }).run("js/pay.js");
    page.stripe.confirmStatus = "requires_capture";
    page.stripe.handlers.get("payment:ready")?.();
    page.$("[data-pay-button]").dispatch("click");
    await page.settle();
    expect(page.calls).toEqual([
      { url: URLS.intent, body: { shownCents: "10114" } },
      { url: REPORT, body: { payment_intent: "pi_abc" } },
    ]);
    expect(page.went).toEqual([`${URLS.complete}?payment_intent=pi_abc`]);
    // The store's answer shows no step of its own: the button keeps the label it had while the card was confirmed.
    expect(page.$("[data-pay-button]").textContent).toBe("Processing…");
  });

  it("shows the store's decline of an authorized card under the button, as a card declined by Stripe shows, and lets the shopper try again", async () => {
    const REPORT = "/w/ws_1/wrenfield/checkout/tok/payment/report";
    const page = stripeStep().answer(URLS.intent, { json: INTENT(10114) }).answer(REPORT, { json: { recorded: true, status: "requires_payment_method", error: "Your card was declined." } }).run("js/pay.js");
    page.stripe.confirmStatus = "requires_capture";
    page.stripe.handlers.get("payment:ready")?.();
    page.$("[data-pay-button]").dispatch("click");
    await page.settle();
    expect(page.went).toEqual([]);
    expect(page.$("[data-payment-error]").hidden).toBe(false);
    expect(page.$("[data-payment-error]").textContent).toBe("Your card was declined.");
    expect(page.$("[data-pay-button]").disabled).toBe(false);
  });

  it("shows a price update the intent answers with instead of paying, and pays the new total on the next click (finding: a stale tab)", async () => {
    const page = stripeStep().answer(URLS.intent, { json: PRICE_UPDATED }, { json: INTENT(10891) }).run("js/pay.js");
    page.stripe.handlers.get("payment:ready")?.();
    page.$("[data-pay-button]").dispatch("click");
    await page.settle();
    expect(page.stripe.confirms).toEqual([]);
    expect(page.went).toEqual([]);
    expect(page.$("[data-price-banner]").hidden).toBe(false);
    expect(page.$("[data-price-banner]").textContent).toBe("Shipping update: your total is now $108.91 (was $101.14). Review it, then pay again to confirm.");
    expect(page.$("[data-summary-total]").textContent).toBe("$108.91");
    expect(page.$("[data-pay-amount]").textContent).toBe("$108.91");
    expect(page.stripe.updates).toContainEqual({ amount: 10891 });
    // The second click says what the page now shows, so the store knows the shopper saw the new total.
    page.$("[data-pay-button]").dispatch("click");
    await page.settle();
    expect(page.calls.map((c) => c.body)).toEqual([{ shownCents: "10114" }, { shownCents: "10891" }]);
    expect(page.stripe.confirms).toHaveLength(1);
    expect(page.went).toEqual([`${URLS.complete}?payment_intent=pi_abc`]);
  });

  it("starts Stripe's card fields from the billing details the page gives", () => {
    const page = stripeStep({ name: "Fixture Sender", email: "fixture.sender@buyer.example", postalCode: "" }).run("js/pay.js");
    const payment = page.stripe.created.find((c) => c.type === "payment");
    expect(payment?.opts).toMatchObject({ defaultValues: { billingDetails: { name: "Fixture Sender", email: "fixture.sender@buyer.example", address: { postal_code: "", country: "US" } } } });
    expect(page.stripe.elements).toMatchObject([{ mode: "payment", amount: 10114, currency: "usd" }]);
  });

  it("offers the card form alone: the methods the page allows, by Stripe.js's current option name, and no wallet in the Payment Element (Link's bank and Klarna came through it)", () => {
    const page = stripeStep().run("js/pay.js");
    expect(page.stripe.elements).toHaveLength(1);
    const group = page.stripe.elements[0] as Record<string, unknown>;
    expect(group.allowedPaymentMethodTypes).toEqual(["card"]);
    expect(group).not.toHaveProperty("paymentMethodTypes");
    expect(page.stripe.created.map((c) => c.type)).toEqual(["payment"]);
    expect(page.stripe.created[0]?.opts).toMatchObject({ layout: "tabs", wallets: { link: "never", applePay: "never", googlePay: "never" } });
  });

  it("keeps Link on the Express Checkout Element — its design — while the Payment Element under it stays card only", () => {
    const page = stripeStep(SENDER, true).run("js/pay.js");
    expect(page.stripe.elements).toMatchObject([{ allowedPaymentMethodTypes: ["card", "link"] }]);
    const byType = Object.fromEntries(page.stripe.created.map((c) => [c.type, c.opts]));
    expect(Object.keys(byType).sort()).toEqual(["expressCheckout", "payment"]);
    expect(byType.expressCheckout).toEqual({ paymentMethods: { link: "auto", applePay: "never", googlePay: "never" } });
    expect(byType.payment).toMatchObject({ wallets: { link: "never", applePay: "never", googlePay: "never" } });
  });
});

describe("fake-pay.js: the store's own card form, driven through pay.js", () => {
  const CONFIRM = "/w/ws_1/wrenfield/checkout/tok/payment/fake-confirm";
  const AUTH = "/w/ws_1/wrenfield/checkout/tok/payment/authenticate";
  const typeCard = (page: Page) => {
    for (const [name, v] of [["number", "4000002760003184"], ["expiry", "1234"], ["cvc", "123"], ["zip", "94107"]] as const) {
      const input = page.$(`input[name=${name}]`);
      input.value = v;
      input.dispatch("input");
    }
  };

  it("is a script of its own, loaded before pay.js", () => {
    expect(existsSync(join(PUBLIC, "js/fake-pay.js"))).toBe(true);
  });

  it("formats the card as it is typed, starts the attempt with the total shown, posts the card, and completes the verification step it is asked for", async () => {
    const page = cardStep()
      .answer(URLS.intent, { json: { clientSecret: "pi_fake_x_secret_y", publishableKey: "pk_test_fake", amountCents: 10114, mode: "fake" } })
      .answer(CONFIRM, { json: { status: "requires_action", authenticate: AUTH, amountCents: 10114 } })
      .answer(AUTH, { json: { status: "succeeded", redirect: `${URLS.complete}?payment_intent=pi_fake_x` } })
      .run("js/fake-pay.js", "js/pay.js");
    typeCard(page);
    expect(page.$("input[name=number]").value).toBe("4000 0027 6000 3184");
    expect(page.$("input[name=expiry]").value).toBe("12 / 34");
    const submitted = page.$("form[data-fake-card]").dispatch("submit");
    expect(submitted.defaultPrevented).toBe(true);
    await page.settle();
    expect(page.calls).toEqual([
      { url: URLS.intent, body: { shownCents: "10114" } },
      { url: CONFIRM, body: { number: "4000 0027 6000 3184", expiry: "12 / 34", cvc: "123", zip: "94107", shownCents: "10114" } },
    ]);
    // The issuer's step, as a dialog over the page: complete it.
    const dialog = page.$("[role=dialog]");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(page.doc.getElementById(dialog.getAttribute("aria-labelledby") as string)?.textContent).toBe("Confirm it's you");
    expect(dialog.textContent).toContain("$101.14 to Wrenfield Flowers");
    const complete = dialog.querySelectorAll("button").find((b) => b.textContent === "Complete authentication");
    complete?.dispatch("click");
    await page.settle();
    expect(page.calls.at(-1)).toEqual({ url: AUTH, body: { result: "complete" } });
    expect(page.doc.querySelector("[role=dialog]")).toBeNull();
    expect(page.went).toEqual([`${URLS.complete}?payment_intent=pi_fake_x`]);
  });

  it("shows a declined card's message under the button, and lets the shopper try again", async () => {
    const page = cardStep()
      .answer(URLS.intent, { json: { clientSecret: "pi_fake_x_secret_y", publishableKey: "pk_test_fake", amountCents: 10114, mode: "fake" } })
      .answer(CONFIRM, { status: 402, json: { status: "requires_payment_method", error: "Your card was declined." } })
      .run("js/fake-pay.js", "js/pay.js");
    typeCard(page);
    page.$("form[data-fake-card]").dispatch("submit");
    await page.settle();
    expect(page.$("[data-payment-error]").hidden).toBe(false);
    expect(page.$("[data-payment-error]").textContent).toBe("Your card was declined.");
    expect(page.$("[data-pay-button]").disabled).toBe(false);
    expect(page.went).toEqual([]);
  });

  it("shows the price update the intent answers with, and posts no card until the shopper pays again", async () => {
    const page = cardStep()
      .answer(URLS.intent, { json: PRICE_UPDATED }, { json: { clientSecret: "pi_fake_x_secret_y", publishableKey: "pk_test_fake", amountCents: 10891, mode: "fake" } })
      .answer(CONFIRM, { json: { status: "succeeded", redirect: `${URLS.complete}?payment_intent=pi_fake_x` } })
      .run("js/fake-pay.js", "js/pay.js");
    typeCard(page);
    page.$("form[data-fake-card]").dispatch("submit");
    await page.settle();
    expect(page.calls.map((c) => c.url)).toEqual([URLS.intent]);
    expect(page.$("[data-pay-amount]").textContent).toBe("$108.91");
    page.$("form[data-fake-card]").dispatch("submit");
    await page.settle();
    expect(page.calls.map((c) => [c.url, c.body.shownCents])).toEqual([
      [URLS.intent, "10114"],
      [URLS.intent, "10891"],
      [CONFIRM, "10891"],
    ]);
    expect(page.went).toEqual([`${URLS.complete}?payment_intent=pi_fake_x`]);
  });
});

describe("store.js: the cart drawer", () => {
  const PREFIX = "/w/ws_1/halden";
  const CART_JSON = `${PREFIX}/cart.json`;
  const NOTICE = "Your earlier payment went through — here is your order.";

  /** A store page with its cart button and the drawer store.js fills from cart.json. */
  function drawerPage(): Page {
    const page = new Page();
    const d = page.doc;
    d.body.setAttribute("data-prefix", PREFIX);
    d.body.setAttribute("data-site", "halden");
    d.body.appendChild(h(d, "a", { class: "icon-btn cart-btn", href: `${PREFIX}/cart`, "data-cart-open": "", "aria-label": "Cart, 1 item" }, [h(d, "span", { class: "cart-count", "data-cart-count": "" }, ["1"])]));
    d.body.appendChild(
      h(d, "div", { class: "drawer", "data-cart-drawer": "", hidden: "" }, [
        h(d, "aside", { class: "drawer__panel", role: "dialog", "aria-modal": "true" }, [
          h(d, "div", { class: "drawer__notice", "data-cart-notice": "", role: "status" }),
          h(d, "div", { class: "drawer__body", "data-cart-lines": "" }),
          h(d, "div", { class: "drawer__foot", "data-cart-foot": "", hidden: "" }, [h(d, "p", {}, [h(d, "span", { "data-cart-subtotal": "" })])]),
        ]),
      ]),
    );
    return page;
  }

  const CASE_LINE = { key: "case", name: "Soft Carry Case", image: `${PREFIX}/assets/img/halden/case.jpg`, optionsLabel: "", qty: 1, unitCents: 2900, totalCents: 2900, url: `${PREFIX}/products/soft-carry-case` };

  it("shows the order the store just recorded for a payment whose return page never loaded, with a link to it, above the cart as it now stands", async () => {
    const url = `${PREFIX}/orders/HA-123456-K7?recovered=1`;
    const cart = { lines: [CASE_LINE], subtotalCents: 2900, count: 1, recovered: { orderNo: "HA-123456-K7", message: NOTICE, url } };
    const page = drawerPage().answer(CART_JSON, { json: cart }).run("js/store.js");
    page.doc.click(page.$("[data-cart-open]"));
    await page.settle();
    expect(page.calls.map((c) => c.url)).toEqual([CART_JSON]);
    expect(page.$("[data-cart-drawer]").hidden).toBe(false);
    const notice = page.$("[data-cart-notice]");
    expect(notice.querySelectorAll("p").map((p) => p.textContent)).toEqual([NOTICE, "View order HA-123456-K7"]);
    expect(notice.querySelector("a")?.getAttribute("href")).toBe(url);
    expect(page.$("[data-cart-lines]").textContent).toContain("Soft Carry Case");
    expect(page.$("[data-cart-count]").textContent).toBe("1");
  });

  it("says so over a cart the order emptied, and links only an address of this site", async () => {
    const cart = { lines: [], subtotalCents: 0, count: 0, recovered: { orderNo: "HA-123456-K7", message: NOTICE, url: "https://elsewhere.example/orders/HA-123456-K7" } };
    const page = drawerPage().answer(CART_JSON, { json: cart }).run("js/store.js");
    page.doc.click(page.$("[data-cart-open]"));
    await page.settle();
    const notice = page.$("[data-cart-notice]");
    expect(notice.textContent).toContain(NOTICE);
    expect(notice.querySelector("a")?.getAttribute("href")).toBe(`${PREFIX}/orders/HA-123456-K7?recovered=1`);
    expect(page.$("[data-cart-lines]").textContent).toContain("Your cart is empty.");
    expect(page.$("[data-cart-count]").textContent).toBe("0");
  });

  it("says nothing of the kind over an ordinary cart", async () => {
    const page = drawerPage().answer(CART_JSON, { json: { lines: [CASE_LINE], subtotalCents: 2900, count: 1 } }).run("js/store.js");
    page.doc.click(page.$("[data-cart-open]"));
    await page.settle();
    expect(page.$("[data-cart-notice]").textContent).toBe("");
    expect(page.$("[data-cart-lines]").textContent).toContain("Soft Carry Case");
  });
});

describe("pay.js: a payment step that answers with somewhere to go instead", () => {
  it("goes there without paying: an earlier payment recorded as its order (RECOVERED), or a delivery date to choose again (DELIVERY_DATE)", async () => {
    for (const answer of [
      { error: "RECOVERED", message: "Your earlier payment went through — here is your order.", orderNo: "WF-123456-K7", redirect: "/w/ws_1/wrenfield/orders/WF-123456-K7?recovered=1" },
      { error: "DELIVERY_DATE", message: "Your delivery date, Thursday, October 8, has passed. Choose a new delivery date to continue.", redirect: "/w/ws_1/wrenfield/checkout/tok/information?recheck=delivery" },
    ]) {
      const page = stripeStep().answer(URLS.intent, { status: 409, json: answer }).run("js/pay.js");
      page.stripe.handlers.get("payment:ready")?.();
      page.$("[data-pay-button]").dispatch("click");
      await page.settle();
      expect(page.stripe.confirms, answer.error).toEqual([]);
      expect(page.went, answer.error).toEqual([answer.redirect]);
      // The card form of fake mode: the same.
      const card = cardStep().answer(URLS.intent, { status: 409, json: answer }).run("js/fake-pay.js", "js/pay.js");
      card.$("form[data-fake-card]").dispatch("submit");
      await card.settle();
      expect(card.calls.map((c) => c.url), answer.error).toEqual([URLS.intent]);
      expect(card.went, answer.error).toEqual([answer.redirect]);
    }
  });
});
