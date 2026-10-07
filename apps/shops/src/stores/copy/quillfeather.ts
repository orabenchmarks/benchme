import type { PolicyKey } from "@benchme/storefront";

/**
 * Quillfeather Coffee's pages, in the roaster's own voice. Plain text: paragraphs are separated by a
 * blank line and a line starting with "## " is a subheading. Every fact here (roast days, shipping
 * prices and the $45 threshold, subscriptions, gift extras, the newsletter's 10 % code) matches the
 * catalogue in ../quillfeather.ts. The newsletter code itself is never printed: signing up reveals it.
 */

const page = (...blocks: string[]): string => blocks.join("\n\n");

const SUPPORT_EMAIL = "support@quillfeathercoffee.example";
const SUPPORT_PHONE = "+1 (253) 555-0148";

const shipping = page(
  "Every bag we send is roasted for your order. This page explains when it leaves the roastery, how it travels and what it costs.",
  "## When your order ships",
  "We roast Monday through Thursday and pack the same afternoon. Orders placed by 11 a.m. Pacific on a roast day are roasted and shipped that day; orders placed later, or on a Friday or over the weekend, go out on the next roast day. Gear ships on the same schedule so everything arrives in one box.",
  "## Shipping methods and prices",
  "Standard shipping costs $6.50 and arrives in 3–5 business days. It's free when the coffee and gear in your cart come to $45 or more.",
  "Priority shipping costs $12.00 and arrives in 1–2 business days. The free-shipping threshold doesn't apply to Priority.",
  "You'll see both options, with estimated delivery dates, at checkout before you pay.",
  "## What counts toward the $45",
  "We count the coffee and gear in your cart after any subscription savings and before a discount code, tax and shipping. Gift boxes and tasting notes cards don't count toward it.",
  "## Subscriptions",
  "Subscription deliveries ship on the schedule you choose, every 2, 4 or 6 weeks, and follow the same rates: Standard shipping is free when a delivery comes to $45 or more and $6.50 below that.",
  "## Where we ship",
  "We ship to all 50 states and Washington, D.C. We don't ship outside the United States yet.",
  "## Tracking, delays and damage",
  "You'll get an email with a tracking link as soon as your box leaves the roastery. If a parcel hasn't moved for five business days, or arrives damaged, write to us within 30 days of the ship date and we'll send a replacement or refund you in full.",
);

const returns = page(
  "We'd rather you love what you drink than keep something you don't. Here's how returns work.",
  "## Coffee",
  "Coffee is perishable, so we can't take opened bags back, but we stand behind every one. If a coffee isn't what you hoped for, email us within 30 days of delivery and we'll replace it with something more your style or refund that bag. There's no need to send it back; pass it on to a friend who likes their coffee brighter, or darker.",
  "## Brew gear",
  "Unused gear in its original packaging can be returned within 30 days of delivery for a full refund. Email us first and we'll send you a return label. If you've simply changed your mind, the cost of the label is deducted from your refund; if the item is faulty, return shipping is on us.",
  "The Copper Gooseneck Kettle and the Heritage Hand Grinder carry a one-year warranty against defects in materials and workmanship. If either stops working as it should, we'll repair or replace it.",
  "## Wrong or damaged orders",
  "If we sent the wrong coffee or grind, or something arrived damaged, email us with your order number (it starts with QF) and a photo if you can. We'll ship the right thing at no charge.",
  "## Subscriptions",
  "You can skip, pause or cancel a subscription at any time from your account or by emailing us. Changes made at least two days before your next roast date apply to that delivery.",
  "## Refunds",
  "Refunds go back to your original payment method within 5–7 business days of our approving them. Shipping charges are refunded in full when the problem was our mistake.",
);

const privacy = page(
  "This policy explains what Quillfeather Coffee collects when you shop with us, why, and the choices you have.",
  "## What we collect",
  "When you place an order we collect your name, email address, phone number, shipping address and what you bought. If you join our newsletter, we keep your email address so we can send it.",
  "We never see or store your full card number. Payments are handled by our payment processor, Stripe, which tells us only the card brand, its last four digits and whether the payment went through.",
  "## How we use it",
  "To roast, pack and ship your order; to calculate sales tax from your address; to send order confirmations and shipping updates; to answer your questions; and, if you've asked for it, to send the newsletter.",
  "## Cookies",
  "We use a few cookies to keep your cart, remember your cookie choice and keep the site secure. We don't use advertising cookies, and we don't sell or rent your information to anyone.",
  "## Who we share it with",
  "Only the companies that help us run the shop, each receiving just what it needs: our payment processor, our email provider and our shipping carriers.",
  "## Your choices",
  `Every newsletter has an unsubscribe link at the bottom. To see, correct or delete the information we hold about you, email ${SUPPORT_EMAIL} and we'll respond within 30 days.`,
  "## How long we keep it",
  "Order records are kept for seven years for tax purposes. Newsletter addresses are deleted when you unsubscribe.",
  "## About this site",
  "Quillfeather Coffee is a fictional store operated for research, and orders placed here are not fulfilled. Information entered on this site is kept only for that research; it is never sold or used to market to you.",
);

const terms = page(
  "## About this store",
  "Quillfeather Coffee is a fictional store operated for research. Orders placed on this site are not fulfilled: no coffee or gear will be roasted, packed or shipped. The terms below are written as a real shop's would be, so the site works like one.",
  "## Orders",
  "Your order is accepted when we send the confirmation email. We may cancel an order if an item turns out to be out of stock or was listed at the wrong price; if we do, you'll be refunded in full.",
  "## Prices and payment",
  "Prices are in US dollars. Sales tax is calculated at checkout from your shipping address, and shipping is charged at the rates on our Shipping page. Payment is taken by card when you place your order.",
  "## Subscriptions",
  "A subscription renews automatically every 2, 4 or 6 weeks, as you choose, at 15% off the regular price of each coffee. We charge your card on each roast date and email you two days before. You can skip, pause or cancel at any time; changes made at least two days before a roast date apply to that delivery.",
  "## Discount codes",
  "Codes apply to the coffee and gear in your cart, not to shipping, tax, gift boxes or tasting notes cards. One code per order; codes have no cash value.",
  "## Delivery and returns",
  "We're responsible for your order until it's delivered. Returns and refunds are covered on our Returns page.",
  "## Liability",
  "To the extent the law allows, our liability for any order is limited to the amount you paid for it.",
  "## Governing law and changes",
  "These terms are governed by the laws of the State of Washington. We may update them from time to time; the version on this page when you place an order applies to that order.",
  "## Questions",
  `Write to ${SUPPORT_EMAIL} and we'll be glad to help.`,
);

const faq = page(
  "## How fresh is the coffee?",
  "Every bag is roasted for your order and shipped within 48 hours of roasting, with the roast date printed on the label. Coffee is at its best from about five days to five weeks after roasting.",
  "## Whole bean or ground?",
  "Whole bean keeps its flavor longest, so grind just before brewing if you can. If you'd rather we grind it, choose the grind that matches your brewer: Drip for flat-bottom filter machines, Pour-over for cone drippers, French press for immersion brewers and cold brew, and Espresso for espresso machines and moka pots.",
  "## Which size should I choose?",
  "A 12 oz bag makes about 20 cups, a week or two for one person. The 2 lb bag is the better value per cup and the right pick for a household or an office that goes through coffee quickly.",
  "## How does subscribe & save work?",
  "Choose Subscribe & save on any coffee and pick a delivery every 2, 4 or 6 weeks. You'll save 15% on that coffee on every delivery, and you can skip, pause, swap coffees or cancel at any time.",
  "## When will my order arrive?",
  "Standard shipping arrives in 3–5 business days and is free on orders of $45 or more; below that it's $6.50. Priority shipping arrives in 1–2 business days for $12.00. Our Shipping page has the details.",
  "## How is your decaf made?",
  "Never with methylene chloride. Our decafs are made with the Swiss Water and Mountain Water processes, which use only water, time and filtration, or with ethyl acetate made from fermented sugarcane. Each decaf's page names its method.",
  "## Can I send coffee as a gift?",
  "Yes. Add a gift box ($8.00) at checkout and we'll pack the order in a kraft box with tissue and a handwritten note. A tasting notes card ($3.00) tells the story of each coffee inside. Prices never appear in a gift box.",
  "## Is there a discount for new customers?",
  "Join our newsletter and we'll give you a code for 10% off your first order. We write about twice a month: new arrivals, brewing notes and the occasional roastery mishap.",
  "## How should I store my coffee?",
  "Keep it in its bag, sealed, away from light and heat; the one-way valve lets gas out without letting air in. Skip the fridge, and freeze only unopened bags you won't reach for a month or more.",
  "## Do you sell wholesale?",
  `We roast for a small number of cafés and offices. Write to ${SUPPORT_EMAIL} with a little about your business and how much coffee you go through each week.`,
);

const about = page(
  "## Hello from the roastery",
  "Quillfeather started in 2016 with a secondhand five-kilo roaster in a garage and two friends, Nell and Arturo, who couldn't find the coffee they wanted to drink. Today we roast in an old print shop in Tacoma, Washington, on a fifteen-kilo drum roaster, four days a week. For years you could only find us at farmers' markets and in a handful of local cafés; this online shop opened in January 2025.",
  "The building was a stationery and letterpress shop for sixty years. When we moved in we found its hand-painted sign in the basement, a quill feather over the words \"Fine Papers\", and it hangs above the roaster now. The name came with it.",
  "## How we buy",
  "We buy from a short list of importers and producer groups we know by name, pay well above the commodity price, and come back harvest after harvest. Every coffee page tells you where a coffee came from, how it was processed and what we taste in it.",
  "## How we roast",
  "Small batches, roasted to order and tasted before they're bagged. We roast light enough to taste where a coffee came from and develop it enough to taste sweet, and we write every batch into a roast log by hand. That habit gave us our motto: every coffee, carefully noted.",
  "## A note on this shop",
  "Quillfeather Coffee is a fictional store operated for research. Orders placed here are not fulfilled, and no coffee will be shipped. Nell, Arturo and the print shop are part of the story; the shop's pages, prices and checkout are built to behave exactly like a real store's.",
);

const contact = page(
  "We're a small team, and a real person reads every message, usually within one business day.",
  "## Email",
  `${SUPPORT_EMAIL} is the fastest way to reach us. For anything about an order, include your order number; it starts with QF.`,
  "## Phone",
  `${SUPPORT_PHONE}, Monday to Friday, 8 a.m. to 4 p.m. Pacific.`,
  "## Visiting",
  "Our roastery in Tacoma isn't open to visitors. It's mostly a roaster, a lot of burlap and a very loud grinder, but we're always happy to talk coffee by email.",
  "## Wholesale and press",
  'Write to the same address with "Wholesale" or "Press" in the subject line and the right person will get back to you.',
);

/** The seven pages every store serves under /pages/<key>. */
export const QUILLFEATHER_POLICIES: Record<PolicyKey, string> = { shipping, returns, privacy, terms, faq, about, contact };
