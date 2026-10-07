import { US_STATES, type AddOn, type StoreDef } from "@benchme/storefront";
import type { Checkout } from "../../db/index.js";
import { dollars, esc, href, icon } from "../components.js";
import {
  alertBox,
  checkoutShell,
  dayInWords,
  errorSummary,
  longDate,
  money,
  reviewBox,
  selectField,
  textArea,
  textField,
  type FieldErrors,
  type ReviewRow,
  type SummaryView,
} from "../checkout-views.js";
import type { StoreCtx } from "../layout.js";

/** What the information form shows: the stored step, its defaults, or what was just typed. */
export type InfoValues = {
  /** The sender's name (a florist's form only; "" elsewhere). */
  senderName: string;
  email: string;
  phone: string;
  marketing: boolean;
  firstName: string;
  lastName: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  zip: string;
  deliveryDate: string;
  message: string;
  signature: string;
};

/** Wrenfield's delivery window in store-local dates: `today` is the store's, which the shopper's own clock may not share. */
export type DeliveryWindow = { today: string; min: string; max: string; sameDayOpen: boolean; cutoffLabel: string; sameDayFeeCents: number; giftMessage: boolean };

export type InformationView = { token: string; values: InfoValues; errors: FieldErrors; delivery: DeliveryWindow | null; summary: SummaryView };

/** One line of an address, as the review box and the emails print it. */
export function addressLine(a: NonNullable<Checkout["address"]>): string {
  return [`${a.firstName} ${a.lastName}`.trim(), a.line1, a.line2, `${a.city}, ${a.state} ${a.zip}`].filter((x) => x.trim()).join(", ");
}

const stepPath = (token: string, step: string) => `/checkout/${token}/${step}`;

/** /checkout/:token/information — contact, the opt-in, the address; Wrenfield adds the date and the card. */
export function informationPage(ctx: StoreCtx, v: InformationView): string {
  const e = v.errors;
  const x = v.values;
  const florist = !!ctx.store.delivery;
  const d = v.delivery;
  // The store's dates in words, with its today: a shopper whose own clock is already on another day reads them right.
  const today = d ? `(today is ${longDate(d.today)}, Pacific time)` : "";
  const deliverySection = d
    ? `<section class="checkout-section" aria-labelledby="delivery-title">
<h2 class="checkout-section__title" id="delivery-title">Delivery date and card</h2>
${textField({
  name: "deliveryDate",
  label: "Delivery date",
  type: "date",
  value: x.deliveryDate,
  min: d.min,
  max: d.max,
  errors: e,
  data: { today: d.today },
  status: dayInWords(x.deliveryDate, d.today),
  hint: d.sameDayOpen
    ? `Order by ${d.cutoffLabel} Pacific for delivery today (${dollars(d.sameDayFeeCents)} same-day fee); tomorrow and later dates have no extra fee ${today}.`
    : `Same-day delivery has closed for today: the earliest date is tomorrow, ${longDate(d.min)} ${today}.`,
})}
${
  d.giftMessage
    ? textArea({ name: "message", label: "Card message (optional)", value: x.message, maxlength: 200, rows: 3, errors: e, hint: "Up to 200 characters, printed on a card tucked in with the flowers." })
    : ""
}
${textField({ name: "signature", label: "Sign the card (optional)", value: x.signature, maxlength: 60, errors: e, hint: "How the card is signed, as you want it to read." })}
</section>`
    : "";
  const main = `${errorSummary(e)}
<form class="checkout-form" method="post" action="${esc(href(ctx, stepPath(v.token, "information")))}" novalidate>
<section class="checkout-section" aria-labelledby="contact-title">
<h2 class="checkout-section__title" id="contact-title">Contact</h2>
${
  florist
    ? textField({ name: "senderName", label: "Your name (optional)", value: x.senderName, autocomplete: "name", maxlength: 80, errors: e, hint: "Who the order is from, for your confirmation. The recipient's name goes with the delivery address." })
    : ""
}
${textField({ name: "email", label: "Email", type: "email", value: x.email, autocomplete: "email", required: true, errors: e })}
${textField({ name: "phone", label: "Phone", type: "tel", value: x.phone, autocomplete: "tel", required: true, errors: e, hint: florist ? "In case our florist needs to reach you about the delivery." : "For delivery updates." })}
<label class="check"><input type="checkbox" name="marketing" value="1"${x.marketing ? " checked" : ""}><span>Email me with news and offers</span></label>
</section>
<section class="checkout-section" aria-labelledby="address-title">
<h2 class="checkout-section__title" id="address-title">${florist ? "Delivery address" : "Shipping address"}</h2>
${florist ? '<p class="checkout-section__intro">Where the flowers go: the recipient\'s name and address.</p>' : ""}
<div class="cfield-row cfield-row--2">
${textField({ name: "firstName", label: "First name", value: x.firstName, autocomplete: "given-name", required: true, errors: e })}
${textField({ name: "lastName", label: "Last name", value: x.lastName, autocomplete: "family-name", required: true, errors: e })}
</div>
${textField({ name: "line1", label: "Address", value: x.line1, autocomplete: "address-line1", required: true, errors: e })}
${textField({ name: "line2", label: "Apartment, suite, etc. (optional)", value: x.line2, autocomplete: "address-line2", errors: e })}
<div class="cfield-row cfield-row--3">
${textField({ name: "city", label: "City", value: x.city, autocomplete: "address-level2", required: true, errors: e })}
${selectField({ name: "state", label: "State", value: x.state, autocomplete: "address-level1", required: true, errors: e, placeholder: "Select", options: US_STATES.map((s) => ({ value: s.code, label: s.name })) })}
${textField({ name: "zip", label: "ZIP code", value: x.zip, autocomplete: "postal-code", inputmode: "numeric", maxlength: 10, required: true, errors: e })}
</div>
<p class="checkout-section__note">${icon("pin")}<span>We ship within the United States.</span></p>
</section>
${deliverySection}
<div class="checkout-actions">
<a class="checkout-actions__back" href="${esc(href(ctx, "/cart"))}">${icon("chevron-left")}<span>Return to cart</span></a>
<button class="btn btn--primary btn--lg checkout-actions__next" type="submit">Continue to shipping</button>
</div>
</form>`;
  return checkoutShell(ctx, { title: "Information", step: "information", token: v.token, main, summary: v.summary });
}

export type ShippingMethodView = { id: string; label: string; cents: number; when: string; checked: boolean };

export type ShippingView = {
  token: string;
  checkout: Checkout;
  store: StoreDef;
  methods: ShippingMethodView[];
  addOns: (AddOn & { checked: boolean })[];
  promo: string | null;
  promoNote: string | null;
  promoError: { message: string; code: string } | null;
  errors: FieldErrors;
  summary: SummaryView;
};

/**
 * Contact, where it goes and (Wrenfield) when: what the shipping and payment steps confirm before going on.
 * At a florist the contact names the sender (when given): the delivery address is the recipient's.
 */
export function reviewRows(ctx: StoreCtx, token: string, c: Checkout, extra: ReviewRow[] = []): ReviewRow[] {
  const info = href(ctx, stepPath(token, "information"));
  const rows: ReviewRow[] = [];
  if (c.contact && ctx.store.delivery) {
    const name = c.contact.name ?? "";
    rows.push({ label: "Contact", value: name ? `${name} · ${c.contact.email}` : c.contact.email, change: info });
  } else if (c.contact) rows.push({ label: "Contact", value: c.contact.email, change: info });
  if (c.address) rows.push({ label: ctx.store.delivery ? "Deliver to" : "Ship to", value: addressLine(c.address), change: info });
  if (c.delivery) rows.push({ label: "Delivery date", value: `${longDate(c.delivery.date)}${c.delivery.sameDay ? " (same day)" : ""}`, change: info });
  return [...rows, ...extra];
}

/** /checkout/:token/shipping — the methods with their dates, the add-ons, the code. */
export function shippingPage(ctx: StoreCtx, v: ShippingView): string {
  const florist = !!ctx.store.delivery;
  const methods = v.methods
    .map(
      (m) => `<label class="choice"><input type="radio" name="shipping" value="${esc(m.id)}"${m.checked ? " checked" : ""}><span class="choice__body"><span class="choice__title">${esc(m.label)}</span><span class="choice__meta">${esc(
        m.when,
      )}</span></span><span class="choice__price">${m.cents === 0 ? "Free" : esc(money(m.cents))}</span></label>`,
    )
    .join("");
  const addOns = v.addOns
    .map(
      (a) => `<label class="choice choice--addon"><input type="checkbox" name="addon" value="${esc(a.sku)}"${a.checked ? " checked" : ""}><span class="choice__body"><span class="choice__title">${esc(a.name)}</span><span class="choice__meta">${esc(
        a.description,
      )}</span></span><span class="choice__price">${esc(money(a.priceCents))}${a.recurring ? `<span class="choice__per">/${esc(a.recurring)}</span>` : ""}</span></label>`,
    )
    .join("");
  const typed = v.promoError?.code ?? "";
  const promo = `<section class="checkout-section" aria-labelledby="code-title">
<h2 class="checkout-section__title" id="code-title">Discount code</h2>
<div class="promo__row"><label class="visually-hidden" for="ship-code">Discount code</label><input class="promo__input" id="ship-code" name="code" value="${esc(typed)}" placeholder="Discount code" autocomplete="off" autocapitalize="characters" spellcheck="false"${
    v.promoError ? ' aria-invalid="true" aria-describedby="ship-code-error"' : ""
  }><button class="btn btn--secondary" type="submit" name="intent" value="apply-promo">Apply</button></div>
${v.promoError ? `<p class="promo__error" id="ship-code-error" role="alert">${esc(v.promoError.message)}${v.promoError.code ? ` (${esc(v.promoError.code)})` : ""}</p>` : ""}
${
  v.promo
    ? `<p class="promo__applied">${icon("check")}<span><strong>${esc(v.promo)}</strong> ${v.promoNote ? esc(v.promoNote) : "applied to your order"}</span><button class="link-btn" type="submit" name="intent" value="remove-promo">Remove<span class="visually-hidden"> code ${esc(v.promo)}</span></button></p>`
    : ""
}
</section>`;
  const shipErr = v.errors.shipping;
  const main = `${reviewBox(reviewRows(ctx, v.token, v.checkout))}
${shipErr ? alertBox("error", `<p>${esc(shipErr)}</p>`) : ""}
<form class="checkout-form" method="post" action="${esc(href(ctx, stepPath(v.token, "shipping")))}" novalidate>
<section class="checkout-section" aria-labelledby="method-title">
<h2 class="checkout-section__title" id="method-title">${florist ? "Delivery method" : "Shipping method"}</h2>
<fieldset class="choice-list"><legend class="visually-hidden">${florist ? "Delivery method" : "Shipping method"}</legend>${methods}</fieldset>
</section>
${
  v.addOns.length
    ? `<section class="checkout-section" aria-labelledby="addons-title">
<h2 class="checkout-section__title" id="addons-title">Add to your order</h2>
<fieldset class="choice-list"><legend class="visually-hidden">Add to your order</legend>${addOns}</fieldset>
</section>`
    : ""
}
${promo}
<div class="checkout-actions">
<a class="checkout-actions__back" href="${esc(href(ctx, stepPath(v.token, "information")))}">${icon("chevron-left")}<span>Return to information</span></a>
<button class="btn btn--primary btn--lg checkout-actions__next" type="submit" name="intent" value="continue">Continue to payment</button>
</div>
</form>`;
  return checkoutShell(ctx, { title: "Shipping", step: "shipping", token: v.token, main, summary: v.summary });
}
