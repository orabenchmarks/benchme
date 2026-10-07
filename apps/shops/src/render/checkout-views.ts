import { addDays, type Totals } from "@benchme/storefront";
import { assetHref, esc, formatUsd, href, icon, plural } from "./components.js";
import { layout, type PageCtx, type StoreCtx } from "./layout.js";

/**
 * The pieces every checkout page is built from: the two-column checkout (steps and form on the
 * left, the order summary on the right, collapsed behind "Show order summary" on a phone), the
 * Cart › Information › Shipping › Payment trail, the totals list, form fields with their errors,
 * and the review box. Styles: public/css/checkout.css (linked by checkoutShell and the cart page;
 * fake payments' card pages add public/css/fake-pay.css), coloured by the store's own tokens, so each
 * checkout reads as its store's.
 *
 * Every interpolated value goes through esc() and every URL through href()/assetHref().
 */

/** The stylesheet of the cart page and the checkout. */
export const CHECKOUT_CSS = "css/checkout.css";

/**
 * The stylesheet of fake payments' card pages: the card form on the payment step (and the verification dialog
 * its script opens over it), the payment step's verification step without JavaScript, and the hosted card page
 * with its verification step. Only the pages that show one link it, so a store's pages in Stripe mode name
 * nothing of fake payments.
 */
export const FAKE_PAY_CSS = "css/fake-pay.css";

/** The fake card form's mark (render/pages/payment.ts): a checkout step that holds it links FAKE_PAY_CSS. */
const FAKE_CARD_FORM = /<form\b[^>]*\sdata-fake-card[\s>]/;

export type CheckoutStep = "information" | "shipping" | "payment";

/** "$12.00" and "−$12.00" (a true minus sign, as receipts print it). */
export const money = (cents: number) => formatUsd(cents);
export const minus = (cents: number) => `−${formatUsd(cents)}`;

/** "Thursday, October 8" from an ISO date. */
export function longDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" });
}

/**
 * A date as a shopper says it, against the store's today: "Today, Wednesday, October 7", "Tomorrow, Thursday,
 * October 8", "Saturday, October 10"; "" for anything that is not a date.
 */
export function dayInWords(iso: string, today: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || Number.isNaN(new Date(`${iso}T12:00:00Z`).getTime())) return "";
  const long = longDate(iso);
  return iso === today ? `Today, ${long}` : iso === addDays(today, 1) ? `Tomorrow, ${long}` : long;
}

/** "Thu, Oct 8" from an ISO date. */
export function shortDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
}

/* ------------------------------------------------------------------ the order summary */

export type SummaryItem = { name: string; optionsLabel: string; qty: number; totalCents: number; image: string; url: string };

export type SummaryView = {
  items: SummaryItem[];
  totals: Totals;
  /** The applied code (it shows on the discount line), and what it still needs when its minimum is not met. */
  promo: string | null;
  promoNote: string | null;
  /** The chosen method's label; null before the shipping step ("Calculated at next step"). */
  shippingLabel: string | null;
  /** False until the address names a state: tax is "Calculated at next step". */
  taxKnown: boolean;
  /** "Delivery" at a florist, "Shipping" elsewhere. */
  shippingWord: string;
  /** Add-ons that renew, by SKU ("year"): the line says so. */
  recurring: Record<string, string>;
};

/** Subtotal, discount, add-ons, shipping, fees, taxes and the total, as a receipt lists them. */
export function totalsList(s: Pick<SummaryView, "totals" | "promo" | "shippingLabel" | "taxKnown" | "shippingWord" | "recurring">, opts: { cls?: string } = {}): string {
  const t = s.totals;
  const row = (label: string, value: string, attrs = "", cls = "") => `<div class="totals__row${cls ? ` ${cls}` : ""}"${attrs}><dt>${label}</dt><dd>${value}</dd></div>`;
  const rows = [row("Subtotal", esc(money(t.subtotalCents)), ' data-summary-subtotal')];
  if (t.discountCents > 0) rows.push(row(`Discount${s.promo ? ` <span class="totals__code">${esc(s.promo)}</span>` : ""}`, esc(minus(t.discountCents)), " data-summary-discount", "totals__row--discount"));
  for (const a of t.addOns) rows.push(row(esc(a.name), `${esc(money(a.cents))}${s.recurring[a.sku] ? `<span class="totals__per">/${esc(s.recurring[a.sku] as string)}</span>` : ""}`, ` data-summary-addon="${esc(a.sku)}"`));
  const shipping =
    s.shippingLabel === null ? '<span class="totals__pending">Calculated at next step</span>' : t.shippingCents === 0 ? "Free" : esc(money(t.shippingCents));
  rows.push(row(`${esc(s.shippingWord)}${s.shippingLabel ? ` <span class="totals__method">${esc(s.shippingLabel)}</span>` : ""}`, shipping, " data-summary-shipping"));
  for (const f of t.fees) rows.push(row(esc(f.label), esc(money(f.cents)), ` data-summary-fee="${esc(f.label)}"`));
  rows.push(row("Taxes", s.taxKnown ? esc(money(t.taxCents)) : '<span class="totals__pending">Calculated at next step</span>', " data-summary-tax"));
  rows.push(
    `<div class="totals__row totals__row--total"><dt>Total</dt><dd><span class="totals__currency">USD</span> <strong data-summary-total>${esc(money(t.totalCents))}</strong></dd></div>`,
  );
  return `<dl class="totals${opts.cls ? ` ${esc(opts.cls)}` : ""}">${rows.join("")}</dl>`;
}

function summaryItems(ctx: Pick<PageCtx, "prefix">, items: SummaryItem[]): string {
  return `<ul class="summary-items">${items
    .map(
      (i) => `<li class="summary-item">
<span class="summary-item__media">${i.image ? `<img src="${esc(i.image)}" alt="">` : ""}<span class="summary-item__qty" aria-label="Quantity ${i.qty}">${i.qty}</span></span>
<span class="summary-item__info"><a class="summary-item__name" href="${esc(i.url)}">${esc(i.name)}</a>${i.optionsLabel ? `<span class="summary-item__opts">${esc(i.optionsLabel)}</span>` : ""}</span>
<span class="summary-item__price">${esc(money(i.totalCents))}</span>
</li>`,
    )
    .join("")}</ul>`;
}

/**
 * The order summary sidebar: the items, the totals and the applied code. A <details> that is open
 * as rendered (the desktop sidebar has no toggle); on a phone the inline script right after it
 * closes it before the first paint, so it starts as "Show order summary $X".
 */
export function orderSummary(ctx: Pick<PageCtx, "prefix">, s: SummaryView): string {
  const count = s.items.reduce((a, i) => a + i.qty, 0);
  return `<aside class="checkout__summary" aria-label="Order summary">
<details class="order-summary" data-order-summary open>
<summary class="order-summary__toggle"><span class="order-summary__toggle-label">${icon("bag")}<span class="order-summary__show">Show order summary</span><span class="order-summary__hide">Hide order summary</span>${icon("chevron-down", "icon order-summary__chevron")}</span><strong class="order-summary__toggle-total" data-summary-total-toggle>${esc(money(s.totals.totalCents))}</strong></summary>
<div class="order-summary__body">
<h2 class="order-summary__title">Order summary <span class="order-summary__count">${esc(plural(count, "item"))}</span></h2>
${summaryItems(ctx, s.items)}
${s.promo ? `<p class="summary-code">${icon("check")}<span><strong>${esc(s.promo)}</strong> ${s.promoNote ? esc(s.promoNote) : "applied"}</span></p>` : ""}
${totalsList(s)}
</div>
</details>
<script>(function(d){if(d&&window.matchMedia&&window.matchMedia("(max-width: 999px)").matches)d.removeAttribute("open")})(document.currentScript&&document.currentScript.previousElementSibling)</script>
</aside>`;
}

/* ------------------------------------------------------------------ steps */

const STEPS: { step: CheckoutStep; label: string }[] = [
  { step: "information", label: "Information" },
  { step: "shipping", label: "Shipping" },
  { step: "payment", label: "Payment" },
];

/** Cart › Information › Shipping › Payment: the steps already done link back, the current one is marked. */
export function checkoutSteps(ctx: Pick<PageCtx, "prefix">, token: string, current: CheckoutStep): string {
  const at = STEPS.findIndex((s) => s.step === current);
  const items = [
    `<li><a href="${esc(href(ctx, "/cart"))}">Cart</a></li>`,
    ...STEPS.map((s, i) =>
      i < at
        ? `<li><a href="${esc(href(ctx, `/checkout/${token}/${s.step}`))}">${esc(s.label)}</a></li>`
        : i === at
          ? `<li><span aria-current="step">${esc(s.label)}</span></li>`
          : `<li><span class="checkout-steps__todo">${esc(s.label)}</span></li>`,
    ),
  ];
  return `<nav class="checkout-steps" aria-label="Checkout steps"><ol>${items.join("")}</ol></nav>`;
}

/* ------------------------------------------------------------------ the page */

export type ShellOpts = {
  /** The step's name, before " · Checkout | <Brand>". */
  title: string;
  step: CheckoutStep;
  token: string;
  /** The main column under the steps. */
  main: string;
  summary: SummaryView;
  /** Scripts that pay.js needs loaded before it (Stripe.js; in fake mode, the card form's own script). */
  scripts?: string[];
  head?: string;
};

/** A checkout step: the checkout chrome, the steps, the main column and the order summary. */
export function checkoutShell(ctx: StoreCtx, o: ShellOpts): string {
  const body = `<div class="checkout container">
<div class="checkout__main">
${checkoutSteps(ctx, o.token, o.step)}
${o.main}
</div>
${orderSummary(ctx, o.summary)}
</div>`;
  return layout(ctx, `${o.title} · Checkout`, body, {
    chrome: "checkout",
    styles: FAKE_CARD_FORM.test(o.main) ? [CHECKOUT_CSS, FAKE_PAY_CSS] : [CHECKOUT_CSS],
    scripts: [...(o.scripts ?? []), assetHref(ctx, "js/pay.js")],
    bodyClass: `page-checkout page-checkout--${o.step}`,
    ...(o.head ? { head: o.head } : {}),
  });
}

/* ------------------------------------------------------------------ forms */

export type FieldErrors = Record<string, string>;

type FieldOpts = {
  name: string;
  label: string;
  value: string;
  errors?: FieldErrors;
  type?: string;
  autocomplete?: string;
  inputmode?: string;
  maxlength?: number;
  placeholder?: string;
  hint?: string;
  required?: boolean;
  cls?: string;
  min?: string;
  max?: string;
  id?: string;
  /** data-* attributes of the input (names and values escaped here), for a script. */
  data?: Record<string, string>;
  /**
   * What the value means, said under the input ("Tomorrow, Thursday, October 8"): read with the field
   * (aria-describedby) and kept current by a script (aria-live).
   */
  status?: string;
};

const fieldId = (name: string) => `f-${name.replace(/[^A-Za-z0-9_-]/g, "-")}`;
const dataAttrs = (d: FieldOpts["data"]) =>
  Object.entries(d ?? {})
    .filter(([k]) => /^[a-z][a-z0-9-]*$/.test(k))
    .map(([k, v]) => `data-${k}="${esc(v)}"`);

/** A labelled input with its status line, its hint and its error (aria-invalid, aria-describedby). */
export function textField(o: FieldOpts): string {
  const id = o.id ?? fieldId(o.name);
  const err = o.errors?.[o.name];
  const describedBy = [o.status !== undefined ? `${id}-status` : "", o.hint ? `${id}-hint` : "", err ? `${id}-error` : ""].filter(Boolean).join(" ");
  const attrs = [
    `id="${esc(id)}"`,
    `name="${esc(o.name)}"`,
    `type="${esc(o.type ?? "text")}"`,
    `value="${esc(o.value)}"`,
    o.autocomplete ? `autocomplete="${esc(o.autocomplete)}"` : "",
    o.inputmode ? `inputmode="${esc(o.inputmode)}"` : "",
    o.maxlength ? `maxlength="${o.maxlength}"` : "",
    o.placeholder ? `placeholder="${esc(o.placeholder)}"` : "",
    o.min ? `min="${esc(o.min)}"` : "",
    o.max ? `max="${esc(o.max)}"` : "",
    o.required ? "required" : "",
    err ? 'aria-invalid="true"' : "",
    describedBy ? `aria-describedby="${esc(describedBy)}"` : "",
    ...dataAttrs(o.data),
  ]
    .filter(Boolean)
    .join(" ");
  const status = o.status !== undefined ? `<p class="cfield__status" id="${esc(id)}-status" aria-live="polite">${esc(o.status)}</p>` : "";
  return `<div class="cfield${o.cls ? ` ${esc(o.cls)}` : ""}${err ? " cfield--error" : ""}">
<label class="cfield__label" for="${esc(id)}">${esc(o.label)}</label>
<input class="cfield__input" ${attrs}>
${status}${o.hint ? `<p class="cfield__hint" id="${esc(id)}-hint">${esc(o.hint)}</p>` : ""}${err ? `<p class="cfield__error" id="${esc(id)}-error">${esc(err)}</p>` : ""}
</div>`;
}

/** A labelled <textarea> with a character limit. */
export function textArea(o: FieldOpts & { rows?: number }): string {
  const id = o.id ?? fieldId(o.name);
  const err = o.errors?.[o.name];
  const describedBy = [o.hint ? `${id}-hint` : "", err ? `${id}-error` : ""].filter(Boolean).join(" ");
  return `<div class="cfield${o.cls ? ` ${esc(o.cls)}` : ""}${err ? " cfield--error" : ""}">
<label class="cfield__label" for="${esc(id)}">${esc(o.label)}</label>
<textarea class="cfield__input cfield__input--area" id="${esc(id)}" name="${esc(o.name)}" rows="${o.rows ?? 3}"${o.maxlength ? ` maxlength="${o.maxlength}"` : ""}${
    o.placeholder ? ` placeholder="${esc(o.placeholder)}"` : ""
  }${err ? ' aria-invalid="true"' : ""}${describedBy ? ` aria-describedby="${esc(describedBy)}"` : ""}>${esc(o.value)}</textarea>
${o.hint ? `<p class="cfield__hint" id="${esc(id)}-hint">${esc(o.hint)}</p>` : ""}${err ? `<p class="cfield__error" id="${esc(id)}-error">${esc(err)}</p>` : ""}
</div>`;
}

/** A labelled <select>; `placeholder` is a first, empty choice. */
export function selectField(o: FieldOpts & { options: { value: string; label: string }[] }): string {
  const id = o.id ?? fieldId(o.name);
  const err = o.errors?.[o.name];
  const opts = [
    o.placeholder ? `<option value=""${o.value ? "" : " selected"}>${esc(o.placeholder)}</option>` : "",
    ...o.options.map((x) => `<option value="${esc(x.value)}"${x.value === o.value ? " selected" : ""}>${esc(x.label)}</option>`),
  ].join("");
  return `<div class="cfield${o.cls ? ` ${esc(o.cls)}` : ""}${err ? " cfield--error" : ""}">
<label class="cfield__label" for="${esc(id)}">${esc(o.label)}</label>
<select class="cfield__input cfield__input--select" id="${esc(id)}" name="${esc(o.name)}"${o.autocomplete ? ` autocomplete="${esc(o.autocomplete)}"` : ""}${o.required ? " required" : ""}${
    err ? ` aria-invalid="true" aria-describedby="${esc(id)}-error"` : ""
  }>${opts}</select>
${err ? `<p class="cfield__error" id="${esc(id)}-error">${esc(err)}</p>` : ""}
</div>`;
}

/** "Please correct …" above a form that came back with errors. */
export function errorSummary(errors: FieldErrors): string {
  const n = Object.keys(errors).length;
  if (!n) return "";
  return `<div class="checkout-alert checkout-alert--error" role="alert"><p><strong>${n === 1 ? "Please correct the field below." : `Please correct the ${n} fields below.`}</strong></p></div>`;
}

/** A banner in the main column. */
export function alertBox(kind: "error" | "info" | "success", html: string, attrs = ""): string {
  return `<div class="checkout-alert checkout-alert--${kind}" role="${kind === "error" ? "alert" : "status"}"${attrs ? ` ${attrs}` : ""}>${html}</div>`;
}

/* ------------------------------------------------------------------ the review box */

export type ReviewRow = { label: string; value: string; change?: string; /** data-* attributes for the value (names and values escaped here), so a script can update it. */ data?: Record<string, string> };

/** Contact / Ship to / Method …, each with a Change link back to its step: what the later steps confirm before going on. */
export function reviewBox(rows: ReviewRow[]): string {
  const data = (d: ReviewRow["data"]) => dataAttrs(d).map((a) => ` ${a}`).join("");
  return `<div class="review-box">${rows
    .map(
      (r) =>
        `<div class="review-box__row"><p class="review-box__label">${esc(r.label)}</p><p class="review-box__value"${data(r.data)}>${esc(r.value)}</p>${
          r.change ? `<a class="review-box__change" href="${esc(r.change)}">Change<span class="visually-hidden"> ${esc(r.label.toLowerCase())}</span></a>` : ""
        }</div>`,
    )
    .join("")}</div>`;
}

/** JSON for a page's script, in a <script type="application/json">: "<" escaped so nothing in it can close the element. */
export function jsonScript(id: string, data: object): string {
  return `<script type="application/json" id="${esc(id)}">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;
}
