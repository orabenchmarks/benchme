import type { PolicyKey } from "@benchme/storefront";

/**
 * Wrenfield Flowers' pages, in the brand's voice: plain text, paragraphs separated by a blank
 * line, "## " starting a subheading. Every price, cutoff and rule quoted here is the one the
 * catalogue and checkout charge (stores/wrenfield.ts; wrenfield.test.ts holds them together).
 */

const shipping = `Every Wrenfield order is hand-delivered on the date you choose, seven days a week, to addresses in all 50 states and Washington, DC. Your flowers are made up by one of our partner florists near the recipient on the morning of delivery, so they travel a few miles in a van rather than across the country in a truck.

## Delivery options

Standard delivery — $14.99. Delivered between 9 am and 8 pm on your chosen date, in the recipient's local time.

Morning delivery (before noon) — $24.99. Delivered before 12 pm on your chosen date. We recommend it for funeral services, offices and anything that can't wait until the afternoon.

## Same-day delivery

Order by 2 pm Pacific time and we can deliver today. Same-day delivery adds a $14.99 fee to your delivery charge. After 2 pm Pacific time, the earliest date in the checkout calendar is tomorrow.

## Choosing a date

Pick the delivery date at checkout. It's set to tomorrow unless you change it, and until 2 pm Pacific time you can choose today. You can also schedule birthdays and anniversaries weeks ahead; we'll make the flowers fresh on the day.

## Card messages

Every order includes a free printed card. Write up to 200 characters, sign it however you like, and we'll print it exactly as you typed it. We never put prices or a receipt in the box.

## If nobody is home

Our drivers leave the box in a shaded, sheltered spot, with a neighbor, or at the front desk of an apartment building or office, and leave a note saying where. Hospitals and funeral homes accept flowers at reception; please add the room, ward or service name in address line 2.

## Wrenfield Rewards members

Members get free standard delivery on every order for twelve months, starting with the order after they join. Morning delivery and the same-day fee are charged as usual.

## Delays

Storms and holidays occasionally slow us down. If we can't deliver on your chosen date, we'll email you that day and deliver at the next opportunity at no extra cost, or refund your delivery charge if you'd rather.`;

const returns = `Flowers can't be sent back, so instead of a returns window we offer a freshness guarantee, and we keep it.

## Our 7-day freshness guarantee

Our bouquets and arrangements are made up on the day of delivery and should look good for at least seven days. If they arrive damaged or wilted, or fade within seven days of delivery, email us a photo within those seven days and we'll send a fresh replacement or refund the flowers, whichever you prefer.

## Plants

Plants are covered for 30 days. If a plant arrives damaged, or declines within 30 days even though you followed its care card, send us a photo and we'll replace or refund it.

## Add-ons

A vase that arrives chipped or broken is replaced free of charge. Chocolates and balloons can't be returned once delivered, but if they arrive damaged we'll refund them.

## Wrenfield Rewards

You can cancel your membership at any time from your account or by emailing us, and it won't renew. If you cancel within 30 days of joining or of a renewal, and haven't used free delivery in that time, we'll refund the $24.99 in full.

## Changing or canceling an order

You can change the date, address or card message, or cancel for a full refund, until 2 pm Pacific time the day before delivery. Same-day orders go to the florist straight away and can't be changed once placed.

## How refunds work

Refunds go back to the card you paid with. Most banks show them within 5–10 business days.`;

const privacy = `This policy explains what Wrenfield Flowers collects when you shop with us, why we collect it, and what you can ask us to do with it. Last updated September 14, 2026.

## What we collect

When you place an order we collect your name, email address and phone number; the recipient's name and delivery address; your card message and signature; and the date and delivery option you chose. If you sign up for our newsletter, we keep your email address and the date you subscribed. When you browse, we log basic technical information such as your browser type and the pages you visit.

## Payments

Card payments are handled by our payment processor, Stripe. Your card details go directly to Stripe and never pass through or rest on our servers; we see only the card brand, the last four digits and whether the payment went through.

## How we use your information

We use your details to make and deliver your order, to send your order confirmation and delivery updates, to answer your questions, and to prevent fraud. We use a recipient's details only to deliver their flowers. We never add recipients to our mailing list.

## Marketing emails

We send marketing emails only if you opt in, at checkout or through our newsletter sign-up. Every email has an unsubscribe link, and unsubscribing takes effect immediately.

## Cookies

We use essential cookies to keep your cart and checkout working. With your permission, given through the cookie banner, we also use analytics cookies to learn which pages are useful. You can withdraw that permission at any time by clearing this site's cookies in your browser.

## Sharing

We share delivery details with the partner florist who makes and delivers your order, and with the service providers who host our website, send our emails and process payments, under contracts that limit how they may use it. We do not sell your personal information or share it for advertising.

## Keeping and deleting your data

We keep order records for seven years for tax purposes and delete newsletter data when you unsubscribe. You can ask for a copy of your data, or ask us to correct or delete it, by emailing support@wrenfield.example. We reply within 30 days.

## California residents

California residents have the right to know what personal information we hold about them and to ask us to delete it. We do not sell or share personal information as those terms are defined under California law.`;

const terms = `Wrenfield Flowers is a fictional store operated for research. Orders are not fulfilled.

These terms apply to every order placed on this site.

## Orders

When you place an order you'll receive a confirmation email with your order number. An order is accepted once payment succeeds. We may decline or cancel an order, and refund it in full, if an item is unavailable, a delivery address can't be reached, or we suspect fraud.

## Prices and tax

Prices are in US dollars and cover the flowers or plant and their packaging. Delivery, the same-day fee, add-ons and sales tax are shown separately at checkout before you pay. Sales tax is charged according to the delivery address.

## Substitutions

Flowers are seasonal and every stem is different. If a flower in your bouquet isn't at its best on the day, our florist will substitute one of equal or greater value in a similar color and style. Product photos show our Classic size unless stated otherwise.

## Delivery

We deliver on the date you choose, with the delivery option you select, as described in our Delivery policy. We can't be responsible for a missed delivery caused by an incorrect address or by access to a building being refused.

## Card messages

We print card messages as you write them, up to 200 characters. We may decline a message that is abusive or unlawful.

## Promo codes

One promo code per order. Percentage codes apply to the flowers and plants in your cart, not to add-ons, delivery or the same-day fee, and a code's minimum spend is measured on that same amount. Codes have no cash value and can't be added after an order is placed.

## Wrenfield Rewards

Wrenfield Rewards is a yearly membership costing $24.99. It gives free standard delivery on every order for twelve months, starting with the order after you join, and renews automatically at $24.99 a year, charged to the card you joined with, until you cancel. You can cancel at any time and it won't renew; our Returns policy explains refunds.

## Liability

Our liability for an order is limited to the amount you paid for it. Nothing in these terms limits the rights you have under consumer protection law.

## Questions

Write to support@wrenfield.example with any question about these terms.`;

const faq = `## When will my flowers arrive?

On the date you choose at checkout. Standard delivery ($14.99) arrives between 9 am and 8 pm, and Morning delivery ($24.99) arrives before noon. Order by 2 pm Pacific time and we can deliver the same day for an extra $14.99.

## Can I choose a delivery time?

You can choose before noon with Morning delivery. Otherwise we deliver throughout the day and can't promise a particular time.

## Do you deliver on weekends?

Yes, seven days a week, including most holidays.

## What will the recipient get?

Bouquets arrive hand-tied in a water pouch, packed upright in a recyclable box with your printed card. They don't include a vase unless you add one. Plants arrive potted, and most sympathy arrangements arrive in their own vessel or basket; each product page says what's included.

## Will they see the price?

Never. The box holds the flowers, your card and a care card, with no receipt or prices.

## What do Classic, Deluxe and Premium mean?

They're bouquet sizes. Deluxe adds $20.00 and about half as many stems again; Premium adds $40.00 and roughly doubles the stems of Classic. Every bouquet's page lists the stem count for each size.

## Can I add a vase, chocolates or a balloon?

Yes, at checkout: a glass vase ($15.00), a box of nine chocolate truffles ($14.99) or a gold foil balloon ($7.99).

## What is Wrenfield Rewards?

A yearly membership. For $24.99 a year you get free standard delivery on every order for twelve months, starting with your next order. It renews automatically each year until you cancel.

## How do I use a promo code?

Enter it in the promo code field in your cart or at checkout. One code per order. Sign up for our newsletter and we'll give you 10% off your first order.

## How long will my flowers last?

Most bouquets last five to seven days, some longer. Trim the stems, change the water every two days, and keep them out of direct sun and away from the fruit bowl. Each bouquet's page lists its vase life.

## Is paying online safe?

Yes. Payments are processed by Stripe, and your card details never touch our servers.

## Do I need an account?

No. You can check out as a guest. An account lets you see past orders and manage Wrenfield Rewards.

## Can I change or cancel my order?

Yes, until 2 pm Pacific time the day before delivery. Email or call us with your order number.`;

const about = `Wrenfield began in 2019 with two florists, a borrowed van and a cutting garden at the end of a lane in Sonoma County, delivering bouquets to friends of friends on Saturday mornings. The idea was simple: send flowers the way a good local florist would, seasonal, loosely arranged and delivered by someone who cares, rather than the stiff, cellophane-wrapped kind that arrive from a warehouse.

## How we work

Today we deliver across the United States through a network of independent partner florists. Your order goes to the studio nearest the recipient, where it's made up on the morning of delivery from that week's flowers and driven over in a van. We buy from growers we know by name wherever we can: tulips from Washington, roses from the high valleys of Ecuador, peonies from Oregon and, out of season, from the Southern Hemisphere.

## What we care about

Flowers that look picked, not manufactured. Honest photos and stem counts. Packaging without plastic foam or cellophane: our boxes, sleeves and paper wraps go straight into the recycling. And a care team of real florists who answer the phone.

## The name

A wren is a small brown bird with a loud song and a cocked tail, and it nests in the hedgerows at the edges of fields. We liked the idea of something small that makes itself heard, which is more or less what a good bunch of flowers does.

## A note about this site

Wrenfield Flowers is a fictional store operated for research. Orders are not fulfilled.`;

const contact = `We're a small team of florists, and we read every message ourselves.

## Customer care

Email support@wrenfield.example or call +1 (877) 555-0134. We're here from 7 am to 7 pm Pacific time, seven days a week, and we answer emails within a few hours during those times.

## Questions about an order

Have your order number ready; it starts with WF and is in your confirmation email. If something is wrong with a delivery, a photo helps us put it right quickly.

## Same-day and time-sensitive orders

If you need flowers today, order by 2 pm Pacific time. For a funeral service, choose Morning delivery so the flowers arrive before noon, and call us if the service is the same day.

## Florists and press

Florists who'd like to join our partner network, and members of the press, can write to the same address with "Partners" or "Press" in the subject line.`;

export const WRENFIELD_POLICIES: Record<PolicyKey, string> = { shipping, returns, privacy, terms, faq, about, contact };
