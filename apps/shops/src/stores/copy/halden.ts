import type { PolicyKey } from "@benchme/storefront";

/**
 * Halden Audio's pages, in the brand's voice: plain text, paragraphs separated by a blank line,
 * "## " starting a subheading. Every price, speed and rule quoted here is the one the catalogue
 * and checkout charge (stores/halden.ts; halden.test.ts holds them together). The newsletter's
 * code is never printed here: the sign-up reveals it.
 */

const shipping = `We ship every Halden order from our warehouse in Portland, Oregon, to addresses in all 50 states and Washington, DC. We don't ship outside the United States yet.

## Shipping options

Standard shipping — $5.99, delivered in 3–5 business days. Free on orders of $75 or more.

Express shipping — $14.99, delivered in 1–2 business days.

Delivery times are counted in business days, Monday to Friday, from the day your order leaves the warehouse. Most orders leave within one business day, and the checkout shows the delivery window for each option before you pay.

## Free standard shipping

Standard shipping is free when the products in your cart come to $75 or more. The threshold is measured before promo codes and sales tax, and Halden Care and gift wrap don't count toward it. Express shipping is $14.99 on every order.

## Tracking

When your order ships, we email a tracking link to the address you gave at checkout. Packages travel with a national carrier and don't need a signature.

## Sales tax

We collect sales tax for the state your order ships to, at that state's rate. It appears in your order summary before you pay.

## If something goes wrong in transit

If a package arrives damaged, or hasn't arrived two business days after its delivery window, email support@haldenaudio.example with your order number. We'll send a replacement or a refund and take it up with the carrier ourselves.`;

const returns = `If your Halden gear isn't right for you, send it back within 45 days of delivery for a full refund. Return shipping inside the US is on us.

## How to return

Email support@haldenaudio.example with your order number and the items you're sending back. We'll reply within one business day with a prepaid return label. Pack everything that came in the box (cables, tips and the quick-start guide) and drop the parcel at any carrier location.

## Refunds

Refunds go back to your original payment method within 5 business days of the return reaching our warehouse. Shipping charges are refunded when the whole order comes back. Gift wrap isn't refundable once an order has shipped.

If you return a product covered by Halden Care, we refund the plan as well.

## Condition

Products should come back in like-new condition. Testing is fine: listen, pair, take a call. We can't accept products with damage that wasn't there on arrival. Every returned earbud is sanitized and re-tipped, and none is ever resold as new.

## Exchanges

The quickest way to swap a color or a model is to return the original and place a new order. The new order ships right away; it isn't held until your return arrives.

## Warranty

Every Halden product comes with a one-year limited warranty against defects in materials and workmanship, starting on the delivery date. If something fails, email us and we'll repair or replace it at no cost, shipping included. Halden Care extends that cover to two years and adds accidental damage and battery wear.`;

const privacy = `This policy explains what Halden Audio collects when you visit our site or buy from us, why we collect it, and the choices you have.

## What we collect

When you place an order: your name, email address, phone number, shipping address and the products you bought. When you browse: the pages you view, the device and browser you use and how you found us, collected through cookies once you've accepted them. When you contact support: whatever you choose to tell us.

## Payments

Card payments are processed by Stripe, our payment provider. Your card number goes directly to Stripe and never reaches our servers; we receive only the card brand, the last four digits and whether the payment succeeded.

## How we use it

To process and ship your order, send order and shipping updates, provide support and warranty service, prevent fraud and understand which pages work. If you subscribe to our newsletter, we'll also send product news and offers. Every email has a one-click unsubscribe link.

## Cookies

Essential cookies keep your cart and checkout working and can't be switched off. Analytics cookies stay off until you accept them in the cookie banner. You can change your choice at any time by clearing this site's cookies in your browser.

## Sharing

We share only what's needed to run the store: shipping details with our carriers, payment details with Stripe and email addresses with our email provider. We don't sell or rent your personal information, and we don't share it for cross-context advertising.

## Keeping and deleting your data

We keep order records for seven years for tax purposes and delete other data when it's no longer needed. You can ask for a copy of your data, a correction or deletion at any time by emailing privacy@haldenaudio.example. We respond within 30 days.

## Changes

If we change this policy, we'll update the date below and email customers about significant changes. Last updated: September 2, 2026.`;

const terms = `Halden Audio is a fictional store operated for research. Orders are not fulfilled.

These terms apply to purchases from the Halden Audio online store. By placing an order you agree to them, so please read them before you buy.

## Orders

Your order is an offer to buy. We accept it when we email your order confirmation. We may cancel an order before it ships if an item is out of stock or a price was clearly wrong; if we do, we refund you in full.

## Prices and payment

Prices are in US dollars and don't include sales tax. Tax and shipping are added at checkout and shown before you pay, and your card is charged when you place the order.

## Promo codes

One promo code can be used per order. Codes apply to the products in your cart, not to shipping, sales tax, Halden Care or gift wrap. They can't be exchanged for cash or applied after an order is placed. A code with a minimum spend needs the products in your cart to reach it before tax.

## Halden Care

Halden Care is an optional protection plan sold at checkout for $29.99 per order. It covers every Halden product in that order for two years from delivery against accidental damage, defects and battery wear, with up to two repairs or replacements per product. It doesn't cover loss, theft or cosmetic wear that doesn't affect how a product works. To make a claim, email support with your order number.

## Warranty

All products carry the one-year limited warranty described on our returns page. Nothing in these terms limits your rights under consumer law.

## Liability

To the extent the law allows, our liability for an order is limited to the amount you paid for it, and we aren't liable for indirect or consequential losses.

## Governing law

These terms are governed by the laws of the State of Oregon.

## Changes

We may update these terms. The version in force when you place an order applies to that order. Last updated: September 2, 2026.`;

const faq = `## How long does shipping take?

Standard shipping takes 3–5 business days and costs $5.99, or nothing on orders of $75 or more. Express shipping takes 1–2 business days and costs $14.99. Our shipping page has the details.

## What is Halden Care?

Halden Care is our optional two-year protection plan. It costs $29.99 per order, covers every Halden product in that order and adds accidental damage and battery wear to the standard one-year warranty. You can add it during checkout; it can't be added once an order has shipped.

## Can you gift wrap my order?

Yes. Gift wrap is $6.00 per order: recycled kraft paper, a cotton ribbon and a packing slip with no prices on it. Choose it during checkout.

## Do you offer discounts?

Sign up for our newsletter and we'll send you a code for 10% off your first order. We also run occasional promotions. One promo code can be used per order.

## How do I know which models have noise cancelling?

Check the specs on the product page. Models with it list "Active noise cancelling"; if a product page doesn't, that model doesn't have it.

## Will Halden headphones work with my phone?

Our wireless models use standard Bluetooth and work with any phone, tablet or computer that supports it, and models marked "multipoint" stay connected to two devices at once. Wired models need a 3.5 mm headphone socket or an adapter.

## Is there an app?

No. Every setting lives on the product itself, and the quick-start guide in the box explains the buttons. Headphones should work the same in ten years as they do today.

## Can I replace worn ear cushions?

Yes. The cushions on every over-ear model come off without tools, and replacement pairs are in our Accessories collection.

## What if my headphones stop working?

Email support@haldenaudio.example. Defects in the first year are covered by our warranty, and Halden Care extends the cover to two years.

## Can I change or cancel my order?

Email us as soon as you can. If the order hasn't left the warehouse, we can change the address or cancel it. Once it has shipped, you can return it within 45 days.`;

const about = `Halden Audio started in 2017 in a rented workshop in Portland, Oregon, when two acoustic engineers who had spent a decade tuning drivers for other companies decided to build headphones under their own name.

## How we tune

Every Halden product is tuned by ear in our listening room, then measured on the bench against a single reference curve, so a song sounds like the same song on our earbuds, our headphones and our speakers. Drivers are matched in pairs, and every finished unit is measured before it's packed. If it misses the curve, it doesn't ship.

## Built to be repaired

Cushions, cables and headbands come off without tools and are sold separately, and batteries can be replaced through our repair service. Every product page lists the specs that matter (driver, battery life, weight, connection), and we don't make claims we can't measure.

## Who we are

Thirty-one people in Portland, most of them engineers, plus a support team that answers the email and the phone themselves.

## About this store

Halden Audio is a fictional store operated for research. Orders are not fulfilled. The brand, its products, its people and its reviews are invented, and nothing bought here will ship.`;

const contact = `Our support team answers every message, usually within one business day.

## Email

support@haldenaudio.example is the fastest way to reach us about orders, returns, warranty claims and product questions. If you have an order number (it starts with HA-), please include it.

## Phone

+1 (503) 555-0147, Monday to Friday, 8 am to 6 pm Pacific time.

## Press and partnerships

Write to press@haldenaudio.example for review samples and interviews, or wholesale@haldenaudio.example about stocking Halden in your store.

## Before you write

Many answers are already on our FAQ, shipping and returns pages. To return something, email support with your order number and we'll send a prepaid label.`;

export const HALDEN_POLICIES: Record<PolicyKey, string> = { shipping, returns, privacy, terms, faq, about, contact };
