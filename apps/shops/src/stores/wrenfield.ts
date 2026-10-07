import type { OptionGroup, Review, StoreDef } from "@benchme/storefront";
import { WRENFIELD_POLICIES } from "./copy/wrenfield.js";

/**
 * Wrenfield Flowers: a national flower-delivery store. Hand-tied bouquets come in three sizes,
 * Sympathy arrangements and plants have one price each, and checkout adds a delivery date (with a
 * same-day cutoff), a card message and add-ons. Ids (SKUs, option values, add-ons, shipping
 * methods, promo codes) are stable: hidden scenarios name them.
 */

const img = (file: string) => `img/wrenfield/${file}.jpg`;

/** A bouquet's sizes: its price is Classic's; Deluxe and Premium add stems and $20 / $40. */
function bouquetSizes(): OptionGroup[] {
  return [
    {
      id: "size",
      name: "Size",
      values: [
        { id: "classic", label: "Classic" },
        { id: "deluxe", label: "Deluxe", priceDeltaCents: 2000 },
        { id: "premium", label: "Premium", priceDeltaCents: 4000 },
      ],
    },
  ];
}

function review(author: string, rating: Review["rating"], title: string, body: string, date: string, verified = true): Review {
  return { author, rating, title, body, date, verified };
}

const LOGO =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 150 40" width="150" height="40" role="img" aria-label="Wrenfield Flowers">' +
  // The wren: cocked tail, round body, a leaf for a wing, perched on a sprig.
  '<path d="M3.2 9.6 10.9 21.4l3.5-2.3L7 7.4a2.2 2.2 0 0 0-3.8 2.2Z" fill="#2F4A3A"/>' +
  '<path d="M9.5 23.2c0-6 5.2-10.6 11.4-10.6 1.3 0 2.5.2 3.6.6a5.6 5.6 0 0 1 8.9 3.1l3.6 1.3-3.8 1c-.3 6.7-6.2 11.9-13.3 11.9-5.9 0-10.4-2.9-10.4-7.3Z" fill="#2F4A3A"/>' +
  '<circle cx="28.9" cy="16.6" r="1.15" fill="#FBF7F2"/>' +
  '<path d="M13.2 22.6c3.1-3.3 8.1-3.9 11.8-1.4-3.2 3.4-8.2 3.9-11.8 1.4Z" fill="#FBF7F2"/>' +
  '<path d="M13.6 22.5c3.6-.6 7.3-.9 11-1.2" fill="none" stroke="#2F4A3A" stroke-width=".7" stroke-linecap="round"/>' +
  '<path d="M17.6 30.4 16.6 35M21.6 30.3l.4 4.7" stroke="#2F4A3A" stroke-width="1.4" stroke-linecap="round"/>' +
  '<path d="M6.5 35.5h24.5" stroke="#2F4A3A" stroke-width="1.2" stroke-linecap="round"/>' +
  '<path d="M30.6 35.4c1.6-2.6 4.3-3.6 6.9-3.1-1.3 2.5-4.1 3.7-6.9 3.1Z" fill="#2F4A3A"/>' +
  '<text x="44" y="24" fill="#1F2A24" font-family="Fraunces, Georgia, serif" font-size="22" font-weight="500" letter-spacing="-0.2">Wrenfield</text>' +
  '<text x="45" y="35.5" fill="#6B6F68" font-family="Inter, Helvetica, Arial, sans-serif" font-size="7" font-weight="500" letter-spacing="3.2">FLOWERS</text>' +
  "</svg>";

const HAND_TIED = "Arrives hand-tied in a water pouch; vase not included";
const PRINTED_CARD = "Includes a printed card with your message";

export const WRENFIELD: StoreDef = {
  id: "wrenfield",
  orderPrefix: "WF",
  defaultSurface: "payment-element",
  brand: {
    name: "Wrenfield Flowers",
    tagline: "Seasonal flowers, hand-tied and delivered nationwide.",
    heroImage: "img/wrenfield/hero-table-bouquet.jpg",
    logoSvg: LOGO,
    announcement: "Order by 2 pm PT for same-day delivery · Hand-tied and delivered seven days a week",
    supportEmail: "support@wrenfield.example",
    supportPhone: "+1 (877) 555-0134",
    fonts: {
      display: "Fraunces",
      body: "Inter",
      href: "https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400..600;1,9..144,400&family=Inter:wght@400;500;600&display=swap",
    },
    tokens: { bg: "#FBF7F2", fg: "#1F2A24", muted: "#6B6F68", accent: "#2F4A3A", accentFg: "#FBF7F2", surface: "#FFFFFF", border: "#E7DED3", radius: "2px" },
  },
  collections: [
    {
      slug: "bestsellers",
      name: "Bestsellers",
      blurb: "The bouquets people send most, hand-tied on the morning of delivery from what's best at our growers that week.",
      hero: img("hero-table-bouquet"),
    },
    {
      slug: "birthday",
      name: "Birthday",
      blurb: "Bright, generous bunches for people who deserve a fuss: sunflowers, dahlias, zinnias and garden roses.",
      hero: img("hero-market-bucket"),
    },
    {
      slug: "sympathy",
      name: "Sympathy",
      blurb: "Quiet arrangements in white and cream, delivered with care to a home or a service, each with your message on a printed card.",
      hero: img("hero-white-orchid"),
    },
    {
      slug: "plants",
      name: "Plants",
      blurb: "Easygoing houseplants that outlast any bouquet, potted and ready for a windowsill or a desk.",
      hero: img("hero-potted-greens"),
    },
  ],
  products: [
    // Bestsellers
    {
      sku: "WF-BQ-MEADOW-SONG",
      slug: "meadow-song",
      name: "Meadow Song",
      collection: "bestsellers",
      priceCents: 6499,
      summary: "Daisies, soft pink hydrangea and zinnias gathered loosely, the way you'd pick them from a summer border.",
      description:
        "Meadow Song is the bouquet we make most often, and the one our florists still enjoy making. White daisies set the tone, pink hydrangea gives it body, and zinnias, snapdragon buds and spires of veronica add movement at the edges. Nothing is clipped into a dome: stems are left at different heights so it looks gathered rather than arranged. It suits a kitchen table as well as a desk at work, and it's a safe choice when you don't know someone's taste. Our florists swap in whatever is best that week while keeping the palette white and pink.",
      details: [
        "Classic: 15 stems · Deluxe: 22 stems · Premium: 30 stems",
        "Daisies, pink hydrangea, zinnias, snapdragons, veronica and seasonal greens",
        "About 16 in tall in Classic",
        HAND_TIED,
        "Vase life: 5–7 days",
      ],
      images: [img("daisy-hydrangea-urn")],
      options: bouquetSizes(),
      reviews: [
        review("Hannah L.", 5, "Exactly like the photo", "Sent to my sister for her new apartment. She texted me a picture and it looked just like the one on the site, maybe even fuller.", "2025-06-14"),
        review("Marcus T.", 4, "Lovely, a bit smaller than expected", "Pretty and very fresh. Classic is on the modest side, so I'd go Deluxe next time for a centerpiece.", "2025-07-02"),
        review("Grace O.", 5, "Lasted ten days", "The daisies were still going strong ten days later. I changed the water every other day like the care card said.", "2025-08-21"),
        review("Julia M.", 3, "Hydrangea wilted early", "Delivery was on time and the box was well packed, but the hydrangea drooped by day three. The rest was lovely.", "2025-09-09"),
        review("Peter A.", 5, "Mother's Day save", "Ordered at 1 pm and it arrived the same afternoon. Mom loved it.", "2026-05-10"),
        review("Simone R.", 4, "Charming", "Loose and natural, not stiff like supermarket bouquets.", "2026-07-18", false),
      ],
      badges: ["Bestseller"],
      stock: 24,
      tags: ["daisies", "hydrangea", "pink", "white", "mixed"],
    },
    {
      sku: "WF-BQ-BLUSH-TULIPS",
      slug: "blush-tulips",
      name: "Blush Tulips",
      collection: "bestsellers",
      priceCents: 5499,
      summary: "Soft pink tulips with cream-flushed petals, bunched simply with their own leaves.",
      description:
        "Some flowers need no help, and tulips are one of them. We bunch these blush-pink stems with their own leaves and nothing else, so you can see the color shift from rose at the tips to cream at the base. Tulips keep growing after they're cut, often by an inch or two, and turn toward the light, so the bouquet changes shape over the week. Trim the stems, use cold water and a tall vase, and let them lean. They come from a family farm in Washington's Skagit Valley in spring and from greenhouse growers the rest of the year.",
      details: [
        "Classic: 20 stems · Deluxe: 30 stems · Premium: 40 stems",
        "Pink tulips with their own foliage",
        "Delivered in bud so they open at home",
        HAND_TIED,
        "Vase life: 5–8 days",
      ],
      images: [img("pink-tulips")],
      options: bouquetSizes(),
      reviews: [
        review("Ellie W.", 5, "Spring in a box", "Arrived in tight bud and fully open two days later. Gorgeous color.", "2025-03-15"),
        review("Raj P.", 4, "Good value", "Simple and pretty. Two stems were bent from the box but straightened out in water.", "2025-04-02"),
        review("Cora D.", 5, "My go-to", "I've sent these three times now. Always fresh, always on time.", "2026-02-12"),
        review("Ben H.", 3, "Shorter than I hoped", "Nice tulips, but the stems were shorter than the picture suggests. Fine for a small vase.", "2026-03-28"),
        review("Ana G.", 4, "Happy birthday to me", "Bought them for myself. Zero regrets.", "2026-04-19"),
      ],
      stock: 30,
      tags: ["tulips", "pink", "spring"],
    },
    {
      sku: "WF-BQ-PEONY-SEASON",
      slug: "peony-season",
      name: "Peony Season",
      collection: "bestsellers",
      priceCents: 8999,
      summary: "Big blush-white peonies, cut in bud and wrapped in brown paper, for the weeks of the year they're at their best.",
      description:
        "Peonies are the flower people ask us for by name. These are a blush-white variety that opens from tight, round buds into blooms the size of a fist, with a scent somewhere between rose and lemon. We cut them in bud so you see every stage, and wrap them in plain brown paper because they need nothing else. Our season starts with Oregon growers in late spring and moves to the Southern Hemisphere in the fall, so supply comes and goes. If we can't get peonies we're proud of, we'll email you before substituting garden roses.",
      details: [
        "Classic: 10 stems · Deluxe: 15 stems · Premium: 20 stems",
        "Blush-white peonies, cut in bud",
        "Wrapped in brown paper; vase not included",
        "Opens over 2–3 days; vase life 5–7 days",
        "Limited supply, sold while the season lasts",
      ],
      images: [img("blush-peonies")],
      options: bouquetSizes(),
      reviews: [
        review("Charlotte B.", 5, "Worth every penny", "Huge blooms that opened over three days and filled the room with scent.", "2025-05-24"),
        review("Daniel K.", 4, "Beautiful but slow to open", "It took four days for the buds to open, so plan ahead if it's for an event. Stunning once they did.", "2025-06-03"),
        review("Mei S.", 5, "Anniversary tears", "Peonies were in my wedding bouquet. My husband found these and I cried. Perfectly packed.", "2025-06-11"),
        review("Laura F.", 3, "Two buds never opened", "Most were lovely, but two stayed shut. Customer care gave me a credit without any fuss.", "2025-11-20"),
        review("Owen J.", 5, "Peonies in November", "Didn't expect to find peonies this late in the year. Fresh and fragrant.", "2025-11-29"),
        review("Isabel C.", 4, "Gorgeous", "Pricey, but nothing else looks like a big jug of peonies.", "2026-06-07"),
      ],
      badges: ["Seasonal"],
      stock: 4,
      tags: ["peonies", "white", "blush", "seasonal", "fragrant"],
    },
    {
      sku: "WF-BQ-VELVET-RED-ROSES",
      slug: "velvet-red-roses",
      name: "Velvet Red Roses",
      collection: "bestsellers",
      priceCents: 6999,
      summary: "Long-stemmed red roses with deep, velvety heads, hand-tied with their own glossy leaves.",
      description:
        "When only red roses will do, they should be very good red roses. Ours are a deep, velvety variety grown at altitude in Ecuador, where cool nights make for large heads and long, straight stems. We keep the leaves on the upper stem, strip the thorns, and tie them without filler, so they read as a classic bunch of roses rather than a mixed bouquet. They arrive with their outer guard petals still on: peel those away gently and the bloom underneath will be flawless. For anniversaries, apologies and everything in between.",
      details: [
        "Classic: 12 stems · Deluxe: 18 stems · Premium: 24 stems",
        "Red roses on 20 in stems, thorns removed",
        HAND_TIED,
        "Vase life: 7–10 days",
      ],
      images: [img("red-roses")],
      options: bouquetSizes(),
      reviews: [
        review("James R.", 5, "Anniversary sorted", "Ordered the Deluxe for our tenth anniversary. The heads were huge and properly deep red.", "2025-02-13"),
        review("Sofia N.", 4, "Very good roses", "Beautiful color. One head was bent on arrival, but the rest lasted over a week.", "2025-02-18"),
        review("Will T.", 5, "Same day, no stress", "Forgot until lunchtime, ordered by 1:30 and they were at her door by 6 pm.", "2025-09-27"),
        review("Rachel G.", 4, "Classic for a reason", "Nothing fancy, just really good red roses. The water pouch kept them fresh in the box.", "2025-12-24"),
        review("Kofi A.", 5, "She loved them", "Simple and elegant.", "2026-02-14"),
        review("Nadia P.", 2, "Arrived a day late", "The roses were fine, but they came the day after Valentine's Day. Disappointing at this price.", "2026-02-15"),
        review("Tom E.", 5, "Lasted 12 days", "I kept peeling off the outer petals like the note said. Still looking good almost two weeks later.", "2026-08-30"),
      ],
      badges: ["Bestseller"],
      stock: 36,
      tags: ["roses", "red", "romance", "anniversary"],
    },
    {
      sku: "WF-BQ-APRICOT-RANUNCULUS",
      slug: "apricot-ranunculus",
      name: "Apricot Ranunculus",
      collection: "bestsellers",
      priceCents: 7499,
      summary: "Butter-apricot ranunculus with silvery dusty miller and rosemary, small in scale and big on detail.",
      description:
        "Ranunculus look like a rose that has been folded a hundred times. These are a warm apricot that fades to butter-yellow as the blooms open, paired with velvety dusty miller and a few sprigs of rosemary for scent. It's a quieter bouquet than most, which is exactly why people choose it: for a bedside table, a new mother, or someone who doesn't like a fuss. The petals are tissue-thin, so we pack each head in a soft paper sleeve; remove it gently when you unpack. Ranunculus drink a lot, so top up the water daily.",
      details: [
        "Classic: 12 stems · Deluxe: 18 stems · Premium: 24 stems",
        "Apricot ranunculus, dusty miller and rosemary",
        "Each bloom sleeved for the journey",
        HAND_TIED,
        "Vase life: 6–9 days",
      ],
      images: [img("apricot-ranunculus")],
      options: bouquetSizes(),
      reviews: [
        review("Priya S.", 5, "So delicate", "The petals are like tissue paper. My mother-in-law keeps sending me photos of them.", "2025-04-07"),
        review("Gemma H.", 4, "Lovely, but small heads", "Very pretty, but the heads are smaller than I expected. Go Deluxe if you want impact.", "2025-05-01"),
        review("Alex M.", 5, "Smelled amazing", "The rosemary was a nice touch. The whole hallway smelled of it.", "2025-10-16"),
        review("Diane W.", 4, "Beautifully packed", "Each flower came in its own little paper sleeve. Not a single damaged petal.", "2026-03-09"),
      ],
      stock: 5,
      tags: ["ranunculus", "peach", "yellow"],
    },
    {
      sku: "WF-BQ-GARDEN-ROSE-POSY",
      slug: "garden-rose-posy",
      name: "Garden Rose Posy",
      collection: "bestsellers",
      priceCents: 7999,
      compareAtCents: 8999,
      summary: "Old-fashioned garden roses in blush, rose and mauve, tied with a length of silk ribbon.",
      description:
        "Garden roses are the full, many-petaled roses you'd find in an old cottage garden rather than at the supermarket. This posy mixes three of them, a pale blush, a clear pink and a dusky mauve, with nothing but their own leaves, then ties the stems with a length of washed-silk ribbon. They open wide and fast, so the posy looks fuller every day, and the mauve one carries a proper old-rose scent. It's the bouquet we send for thank-yous and birthdays alike, and the one we'd send our own mothers.",
      details: [
        "Classic: 10 stems · Deluxe: 15 stems · Premium: 20 stems",
        "Blush, pink and mauve garden roses",
        "Tied with washed-silk ribbon; vase not included",
        "Fragrant",
        "Vase life: 5–7 days",
      ],
      images: [img("pink-garden-roses")],
      options: bouquetSizes(),
      reviews: [
        review("Claire V.", 5, "The scent!", "The mauve roses smell incredible. They opened beautifully over a couple of days.", "2025-05-18"),
        review("Hugo B.", 4, "Lovely ribbon", "The silk ribbon is a nice detail. The roses started dropping petals around day five.", "2025-07-26"),
        review("Amara E.", 5, "Teacher thank-you", "Sent to my son's teacher at the end of term. She said they were the prettiest flowers she'd ever been given.", "2025-12-12"),
        review("Lena K.", 3, "Not as pink as pictured", "Pretty, but mostly cream and pale blush rather than the deeper pink in the photo. A substitution, I assume.", "2026-01-22"),
        review("Sam O.", 5, "On sale and still lovely", "Got these on sale for my wife. Beautifully wrapped and delivered first thing.", "2026-04-04"),
        review("Fiona T.", 4, "Very romantic", "Soft colors, gorgeous ribbon.", "2026-09-14", false),
      ],
      stock: 15,
      tags: ["roses", "pink", "fragrant"],
    },
    {
      sku: "WF-BQ-CUTTING-GARDEN",
      slug: "cutting-garden",
      name: "Cutting Garden",
      collection: "bestsellers",
      priceCents: 5999,
      summary: "Ruffled purple iris and peach tulips with white blossom and lilac, gathered like an armful from a cutting garden.",
      description:
        "This is the bouquet our florists make for themselves at the end of a spring day. Ruffled bearded iris in violet and pale blue sits among peach-pink tulips, sprigs of white blossom and a little lilac, with nettle-leaved greenery to loosen the shape. It has the slightly wild look of something cut from a garden rather than ordered from a shop, and that's the point. Iris open one bloom at a time along each stem, so snip off the faded ones and the next will follow. New this year and already a favorite in the studio.",
      details: [
        "Classic: 14 stems · Deluxe: 21 stems · Premium: 28 stems",
        "Bearded iris, peach tulips, white blossom, lilac and garden greenery",
        HAND_TIED,
        "Vase life: 4–6 days",
      ],
      images: [img("tulips-iris")],
      options: bouquetSizes(),
      reviews: [
        review("Noor A.", 5, "Like a painting", "The iris colors are incredible in person.", "2026-04-23"),
        review("Jake L.", 4, "Beautiful, short-lived", "Gorgeous for four days, then the iris faded quickly. Still worth it.", "2026-05-06"),
        review("Teresa M.", 5, "Unusual and lovely", "Nice to find something other than roses. Delivered before noon as requested.", "2026-05-30"),
        review("Ollie R.", 3, "Missing the lilac", "Nice bouquet, but there was no lilac in mine, just a few extra tulips instead.", "2026-06-21"),
      ],
      badges: ["New"],
      stock: 20,
      tags: ["iris", "tulips", "purple", "spring"],
    },

    // Birthday
    {
      sku: "WF-BQ-MARKET-BUNCH",
      slug: "market-bunch",
      name: "Market Bunch",
      collection: "birthday",
      priceCents: 5999,
      summary: "Sunflowers, dahlias, lisianthus and wild carrot wrapped in paper, as bright and generous as a farmers' market armful.",
      description:
        "We built Market Bunch around the armful of mixed stems you'd carry home from a good farmers' market: a couple of sunflowers, a magenta dahlia or two, ruffled lisianthus, frothy wild carrot and whatever else is peaking in the field that week. It's deliberately unfussy and very cheerful, which makes it our most-sent birthday bouquet. Because it's built from the best of each week's harvest, no two are quite the same, but the palette of gold, magenta, plum and green stays put. It's wrapped in uncoated paper you can recycle with the box.",
      details: [
        "Classic: 15 stems · Deluxe: 22 stems · Premium: 30 stems",
        "Sunflowers, dahlias, lisianthus, wild carrot and seasonal stems",
        "Wrapped in recyclable paper; vase not included",
        "The mix changes with the weekly harvest",
        "Vase life: 5–7 days",
      ],
      images: [img("market-bouquet")],
      options: bouquetSizes(),
      reviews: [
        review("Kayla B.", 5, "Huge and happy", "Got the Premium for my best friend's 30th. It was enormous and so colorful.", "2025-08-09"),
        review("Ivan D.", 4, "Cheerful", "Very bright and fun. The dahlias didn't last as long as the sunflowers.", "2025-08-30"),
        review("Rosa M.", 5, "Perfect birthday flowers", "Arrived on the morning of her birthday with the card exactly as I wrote it.", "2025-09-19"),
        review("Chris P.", 3, "Different from the photo", "Nice flowers, but mine had no sunflowers, mostly zinnias and snapdragons. Still pretty.", "2025-10-25"),
        review("Hana Y.", 5, "Love the paper wrap", "No plastic, which I really appreciated.", "2026-07-11"),
        review("Mateo G.", 4, "Good value for the size", "Lots of stems for the price.", "2026-08-22"),
      ],
      stock: 22,
      tags: ["sunflowers", "dahlias", "mixed", "bright"],
    },
    {
      sku: "WF-BQ-SUNNY-SIDE",
      slug: "sunny-side",
      name: "Sunny Side",
      collection: "birthday",
      priceCents: 4999,
      summary: "A sheaf of golden sunflowers with dark chocolate centers and their leaves left on.",
      description:
        "Sunflowers are impossible to look at without smiling, which makes them our go-to for birthdays, get-wells and congratulations. We choose a variety with dark chocolate centers and pollen-free faces, so there's no yellow dust on the tablecloth. The heads are big, and we leave the leaves on the stems for a bit of country-garden fullness. Sunflowers drink fast: give them a deep vase and check the water daily, and they'll hold their heads up for a week or more. A small bouquet that does a big job.",
      details: [
        "Classic: 6 stems · Deluxe: 9 stems · Premium: 12 stems",
        "Pollen-free sunflowers with dark centers",
        HAND_TIED,
        "Vase life: 6–10 days",
      ],
      images: [img("sunflowers-vase")],
      options: bouquetSizes(),
      reviews: [
        review("Megan S.", 5, "Instant mood lift", "Sent these to a friend recovering from surgery. She said they made the whole room brighter.", "2025-07-08"),
        review("Luis F.", 4, "Big heads", "Five of the six heads were huge and one was a little droopy. It perked up after a fresh cut.", "2025-08-17"),
        review("Abby N.", 5, "Birthday for my dad", "He's not a flowers guy, but he loved these.", "2025-09-03"),
        review("Greg H.", 3, "Fine", "Decent sunflowers, nothing special. Delivery was on time.", "2026-06-29"),
        review("Yasmin R.", 5, "No pollen mess", "Really appreciated that they're pollen-free. My cat is curious about everything.", "2026-09-02"),
      ],
      stock: 34,
      tags: ["sunflowers", "yellow", "get-well"],
    },
    {
      sku: "WF-BQ-ZINNIA-DAYDREAM",
      slug: "zinnia-daydream",
      name: "Zinnia Daydream",
      collection: "birthday",
      priceCents: 5499,
      summary: "Peach and pink zinnias with black-eyed Susans and white daisies, warm as late-summer light.",
      description:
        "Zinnias are a florist's summer workhorse: sturdy, long-lasting and in colors that look good together without trying. For Zinnia Daydream we pick the soft end of the range, peach, coral and candy pink, then add black-eyed Susans for a flash of gold, a few white daisies and some feathery grasses. The result is warm and a little nostalgic, like the last weeks of summer. It's a lovely birthday bouquet for someone who'd find red roses too much. Zinnias dislike wet leaves, so strip any below the waterline when you arrange them.",
      details: [
        "Classic: 15 stems · Deluxe: 22 stems · Premium: 30 stems",
        "Zinnias, black-eyed Susans, daisies and ornamental grasses",
        HAND_TIED,
        "Vase life: 6–8 days",
      ],
      images: [img("zinnias")],
      options: bouquetSizes(),
      reviews: [
        review("Jenna P.", 5, "So pretty", "The peachy colors are exactly as pictured. Made my mom's day.", "2025-08-02"),
        review("Victor A.", 4, "Nice change from roses", "Cheerful, and it lasted over a week.", "2025-09-14"),
        review("Ruth K.", 5, "Gorgeous soft colors", "Bought for a friend who hates bright flowers. She adored them.", "2025-09-28"),
        review("Sean C.", 3, "A few broken stems", "The box arrived crushed on one side and two zinnias were snapped. The rest were lovely.", "2026-08-15"),
        review("Mira J.", 4, "Sweet", "Simple, sweet and a good size for the price.", "2026-09-20", false),
      ],
      stock: 18,
      tags: ["zinnias", "peach", "pink"],
    },
    {
      sku: "WF-BQ-BONFIRE",
      slug: "bonfire",
      name: "Bonfire",
      collection: "birthday",
      priceCents: 6999,
      summary: "Dinner-plate dahlias, hot-pink garden roses and orange berries for a birthday that deserves some drama.",
      description:
        "Bonfire is our loudest bouquet, and we mean that kindly. A dinner-plate dahlia in burnt orange sits at the heart of it, surrounded by hot-pink garden roses, clusters of orange hypericum berries, black-eyed Susans, burgundy smoke-bush leaves and speckled aucuba. It's big, textural and unapologetically colorful, the kind of bouquet that gets talked about at the party. Dahlias are at their best from late summer into fall; outside that window we build it around orange roses instead. Keep it out of direct sun and it will glow for a week.",
      details: [
        "Classic: 14 stems · Deluxe: 21 stems · Premium: 28 stems",
        "Dahlias, garden roses, hypericum berries, black-eyed Susans, smoke bush and aucuba",
        HAND_TIED,
        "Vase life: 5–7 days",
      ],
      images: [img("dahlia-roses")],
      options: bouquetSizes(),
      reviews: [
        review("Becca T.", 5, "Showstopper", "Everyone at the party asked where it was from. The dahlia was the size of a plate.", "2025-09-06"),
        review("Andre W.", 4, "Bold!", "Exactly what I wanted for my partner's 40th. A few berries dropped in the box.", "2025-10-04"),
        review("Kim L.", 5, "Fall perfection", "Those oranges and pinks together are so good.", "2025-10-18"),
        review("Paul S.", 4, "Great colors", "Bright, fresh and very carefully packed.", "2026-09-12"),
        review("Jo B.", 4, "Arrived early afternoon", "I chose standard delivery and it came around 1 pm. The flowers were perfect.", "2026-09-26"),
      ],
      stock: 16,
      tags: ["dahlias", "roses", "orange", "bright"],
    },
    {
      sku: "WF-BQ-CONFETTI",
      slug: "confetti",
      name: "Confetti",
      collection: "birthday",
      priceCents: 6499,
      summary: "A round, hand-tied posy of peach and pink roses with a succulent rosette and silver brunia.",
      description:
        "Confetti is all small things: spray roses in peach, coral and candy pink, a couple of full garden roses, a single echeveria rosette tucked into the middle, silver brunia berries and lisianthus buds, all hand-tied into a neat, round posy. It's compact enough for a desk or a café table and full of tiny details for the person who looks closely. When the roses fade, pull out the echeveria, let its stem dry for a few days, then plant it in gritty soil: it will root and stay long after the birthday.",
      details: [
        "Classic: 16 stems · Deluxe: 24 stems · Premium: 32 stems",
        "Spray roses, garden roses, echeveria, brunia and lisianthus",
        HAND_TIED,
        "Vase life: 6–8 days",
      ],
      images: [img("roses-succulents")],
      options: bouquetSizes(),
      reviews: [
        review("Lucy F.", 5, "The succulent is genius", "Planted it after the roses faded and it's actually growing!", "2025-04-29"),
        review("Ethan V.", 4, "Pretty and compact", "Smaller than I expected, but very detailed. Perfect for her desk.", "2025-06-20"),
        review("Zara Q.", 5, "Birthday at work", "Delivered to her office reception before noon. Her colleagues loved it.", "2025-11-07"),
        review("Martin D.", 2, "Roses browned fast", "The spray roses had brown edges by day three. Customer care gave me a partial refund, which I appreciated.", "2026-01-17"),
        review("Ines P.", 5, "So cute", "Little details everywhere.", "2026-03-14"),
        review("Carl N.", 4, "Nicely done", "Good packaging and fresh flowers.", "2026-07-03"),
      ],
      stock: 20,
      tags: ["roses", "succulents", "peach", "pink"],
    },

    // Sympathy: one price per arrangement.
    {
      sku: "WF-SY-KINDEST-THOUGHTS",
      slug: "kindest-thoughts",
      name: "Kindest Thoughts",
      collection: "sympathy",
      priceCents: 8499,
      summary: "White hydrangea, cream ranunculus and spray roses with soft eucalyptus, hand-tied and finished with chiffon ribbon.",
      description:
        "When words are hard to find, a gentle bouquet can say what you mean. Kindest Thoughts brings together white hydrangea, cream ranunculus, white spray roses and lisianthus with trailing eucalyptus and variegated pittosporum, hand-tied and finished with a length of soft chiffon ribbon. Nothing about it is stark or formal; it's full and quietly beautiful, which makes it right for a family home, and at a funeral service it can be laid down just as it is. It travels in a water pouch, so it stays fresh until it reaches a vase. Our care team checks every sympathy order by hand before it goes out.",
      details: [
        "Hand-tied with chiffon ribbon, about 14 in across",
        "White hydrangea, ranunculus, spray roses, lisianthus and eucalyptus",
        "Arrives in a water pouch; vase not included",
        PRINTED_CARD,
        "Suitable for homes and funeral services",
      ],
      images: [img("white-roses-greenery")],
      options: [],
      reviews: [
        review("Margaret H.", 5, "Thank you", "Sent to my oldest friend after her husband died. She said it was the most beautiful arrangement she received.", "2025-03-11"),
        review("David R.", 5, "Handled with care", "The care team called the funeral home to confirm the delivery time, and it arrived well before the service.", "2025-08-28"),
        review("Elena S.", 4, "Lovely and calm", "Soft and elegant, if a little smaller than I pictured.", "2025-12-02"),
        review("Robert C.", 4, "Appropriate", "Tasteful and not over the top.", "2026-04-15"),
        review("Ayesha K.", 5, "Beautiful", "Arrived fresh and stayed beautiful for over a week.", "2026-07-22"),
      ],
      stock: 14,
      tags: ["white", "hydrangea", "roses", "service"],
    },
    {
      sku: "WF-SY-STILL-WATER",
      slug: "still-water",
      name: "Still Water",
      collection: "sympathy",
      priceCents: 7499,
      summary: "Tall white amaryllis with long green leaves, arranged simply in a clear glass cylinder.",
      description:
        "Still Water is the simplest arrangement we make, and for many people the most fitting. Tall stems of white amaryllis, each carrying several trumpet-shaped blooms, stand in a clear glass cylinder with a few long blades of lily grass. White amaryllis open slowly over a week and a half, so the arrangement keeps changing as the days pass, something many families tell us they found comforting. It's unscented, which makes it a considerate choice for a hospital room or a home where people are coming and going. The glass cylinder is theirs to keep.",
      details: [
        "Arranged in a clear glass cylinder, about 24 in tall",
        "White amaryllis and lily grass",
        "Unscented",
        PRINTED_CARD,
        "Vase life: 7–12 days",
      ],
      images: [img("white-lilies")],
      options: [],
      reviews: [
        review("Susan B.", 5, "Elegant", "Simple and dignified. Exactly what I wanted to send.", "2025-01-21"),
        review("Kevin M.", 4, "Beautiful but fragile", "One bloom was bruised on arrival; the rest opened beautifully over the following week.", "2025-10-09"),
        review("Patricia L.", 5, "Comforting", "My aunt said watching the flowers open each morning helped.", "2026-02-03"),
        review("Henry W.", 4, "Right for a hospital", "No scent, which the ward needed.", "2026-05-27"),
      ],
      stock: 12,
      tags: ["white", "amaryllis", "unscented", "hospital"],
    },
    {
      sku: "WF-SY-EVENSONG",
      slug: "evensong",
      name: "Evensong",
      collection: "sympathy",
      priceCents: 9999,
      summary: "Clusters of white garden roses and rosebuds with their own dark leaves, arranged in a footed stone-colored urn.",
      description:
        "Evensong takes its name from the quiet evening service, and it has that same hush about it. Clusters of white garden roses, some fully open and some still in bud, are arranged with their own dark leaves and trailing stems in a footed, stone-colored urn. The roses are a lightly scented, old-fashioned variety, and they open over several days. It's a generous arrangement without being showy, suitable for the front of a service, a reception afterward or a family's home. We include a care card so whoever receives it knows how to keep it fresh.",
      details: [
        "Arranged in a footed stone-colored urn, about 18 in tall",
        "White garden roses and spray roses with seasonal foliage",
        "Lightly scented",
        PRINTED_CARD,
        "Suitable for homes and funeral services",
      ],
      images: [img("white-garden-roses")],
      options: [],
      reviews: [
        review("Gloria A.", 5, "Perfect for Mom's service", "The urn sat beside her photo at the service. Several people asked who had sent it.", "2025-06-05"),
        review("Stephen T.", 4, "Lovely roses", "Beautiful and fragrant. The delivery window was wide, but it came in time.", "2025-11-14"),
        review("Wendy F.", 5, "Graceful", "The roses opened over the week and were still lovely after the funeral.", "2026-01-30"),
        review("Michael J.", 3, "Urn was chipped", "The flowers were beautiful, but the urn had a chip on the base. Customer care replaced it.", "2026-03-19"),
        review("Deborah N.", 5, "Thoughtful", "Understated and beautiful.", "2026-08-11"),
      ],
      stock: 10,
      tags: ["white", "roses", "service", "fragrant"],
    },
    {
      sku: "WF-SY-SIMPLE-GESTURE",
      slug: "simple-gesture",
      name: "Simple Gesture",
      collection: "sympathy",
      priceCents: 5999,
      summary: "Cream roses with a few of their dark leaves, wrapped in plain brown paper and tied with cotton string.",
      description:
        "Sometimes a big arrangement feels like too much, and something modest says it better. Simple Gesture is a hand-tied bunch of cream roses with a few of their own dark leaves, wrapped in plain brown paper and tied with cotton string. It's the kind of thing a neighbor would bring to the door, and that's what makes it feel personal rather than formal. It suits a home rather than a service and fits easily into whatever vase is at hand. The roses are a softly scented variety that opens wide over four or five days.",
      details: [
        "Hand-tied in brown paper with cotton string",
        "Cream roses and their own foliage",
        PRINTED_CARD,
        "Best sent to a home",
        "Vase life: 5–7 days",
      ],
      images: [img("cream-roses-kraft")],
      options: [],
      reviews: [
        review("Janet C.", 5, "Just right", "Sent to a colleague who lost her father. She said it felt personal, not corporate.", "2025-04-24"),
        review("Frank O.", 4, "Simple and kind", "Nice roses, nicely wrapped. Exactly as described.", "2025-09-22"),
        review("Lily P.", 4, "Modest in the best way", "Not huge, but that was the point.", "2026-01-08"),
        review("George S.", 5, "Thank you, Wrenfield", "Delivered the morning after I ordered and beautifully wrapped. My neighbor was touched.", "2026-05-12"),
        review("Beatrice M.", 3, "Smaller than expected", "Lovely roses, but only about ten of them. I wish the page gave a stem count.", "2026-09-04"),
      ],
      stock: 26,
      tags: ["cream", "roses", "home"],
    },
    {
      sku: "WF-SY-GARDEN-OF-REMEMBRANCE",
      slug: "garden-of-remembrance",
      name: "Garden of Remembrance",
      collection: "sympathy",
      priceCents: 14999,
      summary: "An abundant willow basket of white spray roses, stock and trailing ivy, sized for the front of a funeral service.",
      description:
        "Garden of Remembrance is our largest sympathy piece, made for a funeral or a memorial gathering. Dozens of white spray roses, scented white stock, lisianthus and trailing ivy are arranged in a deep willow basket so the flowers spill over the edge, the way a well-loved garden does in June. It's large enough to stand on its own at the front of a chapel or beside a photograph, yet soft enough to go home with the family afterward. Choose Morning delivery so it arrives before noon on the day of the service.",
      details: [
        "Arranged in a willow basket, about 26 in wide",
        "White spray roses, stock, lisianthus and trailing ivy",
        PRINTED_CARD,
        "Delivered to funeral homes, chapels and homes",
      ],
      images: [img("white-spray-roses")],
      options: [],
      reviews: [
        review("Carol D.", 5, "A stunning tribute", "It stood at the front of the chapel and was the most beautiful arrangement there.", "2025-02-27"),
        review("Brian K.", 4, "Large and lovely", "Big and generous, and with morning delivery it arrived well before the service.", "2025-07-17"),
        review("Theresa G.", 5, "We took it home", "After the service the family took it home, and it lasted another week.", "2025-10-30"),
        review("Nathan H.", 3, "Beautiful, but pricey", "The flowers were gorgeous, but it felt smaller than the price suggested.", "2026-06-16"),
      ],
      stock: 6,
      tags: ["white", "roses", "basket", "service"],
    },

    // Plants: one price each, no sizes.
    {
      sku: "WF-PL-MONSTERA",
      slug: "monstera-deliciosa",
      name: "Monstera Deliciosa",
      collection: "plants",
      priceCents: 5999,
      summary: "A young Swiss cheese plant with glossy, heart-shaped leaves that split as it grows.",
      description:
        "Every houseplant collection starts with a monstera, and ours are grown slowly at a Florida nursery so they arrive sturdy rather than leggy. Young plants like this one have broad, heart-shaped leaves; the famous splits and holes appear as the plant matures and gets more light. Give it bright, indirect light, water when the top two inches of soil are dry, and it will put out a new leaf every few weeks in spring and summer. It ships in a 6-inch nursery pot that slips into most planters, packed upright with a paper sleeve around the leaves.",
      details: [
        "Monstera deliciosa, about 18–24 in tall",
        "Ships in a 6 in nursery pot; planter not included",
        "Bright, indirect light; water every 1–2 weeks",
        "Not pet-safe",
      ],
      images: [img("monstera")],
      options: [],
      reviews: [
        review("Sarah T.", 5, "Healthy plant", "Arrived upright without a single torn leaf. Already has a new leaf unfurling.", "2025-05-09"),
        review("Jordan B.", 4, "Good size", "A bit smaller than the photo, but very healthy.", "2025-08-14"),
        review("Elif A.", 5, "Housewarming hit", "Sent to my brother's new place. It was boxed so well.", "2025-11-02"),
        review("Marco V.", 3, "The pot is basic", "The plant is fine, but the plastic nursery pot looks cheap. Budget for a planter.", "2026-02-26"),
        review("Hailey S.", 4, "Thriving", "Two months in and it's doing great.", "2026-06-12"),
      ],
      stock: 12,
      tags: ["foliage", "large", "easy-care"],
    },
    {
      sku: "WF-PL-GOLDEN-POTHOS",
      slug: "golden-pothos",
      name: "Golden Pothos",
      collection: "plants",
      priceCents: 3999,
      summary: "A trailing pothos with marbled green-and-gold leaves in a matte stoneware pot.",
      description:
        "If you want to send a plant to someone who swears they kill plants, send this one. Golden pothos is about as forgiving as houseplants get: it copes with low light, tells you when it's thirsty by drooping slightly, and perks up within hours of a drink. The heart-shaped leaves are splashed with gold, and the vines trail happily from a shelf or can be trained up a small trellis. We plant it in a matte charcoal stoneware pot with a drainage hole, so it's ready to set down the moment it's unboxed. A good desk plant for a new job.",
      details: [
        "Epipremnum aureum, trailing to about 12 in",
        "Planted in a 5 in matte stoneware pot with drainage",
        "Low to bright, indirect light; water when the soil feels dry",
        "Not pet-safe",
      ],
      images: [img("pothos")],
      options: [],
      reviews: [
        review("Tess R.", 5, "Unkillable", "Six months in and somehow it's still alive. Highly recommended for plant beginners.", "2025-03-30"),
        review("Aaron G.", 4, "Nice pot", "The stoneware pot is lovely. The plant was a little sparse at first but has filled out.", "2025-06-26"),
        review("Monica E.", 5, "Great office gift", "Sent to a colleague for her promotion. It looks great on her desk.", "2025-09-11"),
        review("Felix H.", 4, "Healthy", "Good roots and no yellow leaves.", "2026-01-14"),
        review("Dana W.", 3, "Soil spilled in transit", "The plant was fine, but some soil had come out in the box. Easy to clean up.", "2026-04-08"),
        review("Omar S.", 5, "Growing like crazy", "Already trailing over the bookshelf.", "2026-08-03"),
      ],
      stock: 28,
      tags: ["foliage", "trailing", "low-light", "easy-care"],
    },
    {
      sku: "WF-PL-WHITE-ORCHID",
      slug: "white-phalaenopsis-orchid",
      name: "White Phalaenopsis Orchid",
      collection: "plants",
      priceCents: 6499,
      summary: "A white moth orchid with a single arching spike of blooms, planted in bark in a white ceramic pot.",
      description:
        "A white phalaenopsis is the plant people keep on the windowsill for months, long after cut flowers have gone. Ours arrive with a single arching spike of large white blooms and several buds still to open, planted in orchid bark inside a glazed white ceramic pot and supported by a slim bamboo stake. Moth orchids like bright, indirect light and very little fuss: three ice cubes a week is all the water they want. With luck they flower for two to three months, and they often bloom again the following year.",
      details: [
        "Phalaenopsis, one flower spike, about 20 in tall",
        "Planted in bark in a white ceramic pot",
        "Bright, indirect light; water lightly once a week",
        "Flowers for 6–12 weeks",
        "Pet-safe",
      ],
      images: [img("white-orchid")],
      options: [],
      reviews: [
        review("Victoria L.", 5, "Still blooming", "Eight weeks later it's still covered in flowers.", "2025-02-06"),
        review("Nick P.", 4, "Elegant", "Lovely plant, though one bud dropped in transit.", "2025-05-15"),
        review("Grace H.", 5, "Get-well gift", "Sent to my grandmother in the hospital. Easy for her to look after.", "2025-10-02"),
        review("Liam C.", 4, "Classy", "Looks expensive, and the ceramic pot is good quality.", "2026-03-02"),
        review("Paula R.", 3, "Fewer buds than pictured", "Only four open flowers and two buds. A nice plant, just smaller.", "2026-07-29"),
      ],
      badges: ["Pet-safe"],
      stock: 20,
      tags: ["orchid", "white", "flowering", "pet-safe"],
    },
    {
      sku: "WF-PL-LITTLE-ELM-BONSAI",
      slug: "little-elm-bonsai",
      name: "Little Elm Bonsai",
      collection: "plants",
      priceCents: 7999,
      summary: "A Chinese elm bonsai with a gnarled trunk and a canopy of tiny leaves, potted in a glazed stoneware tray.",
      description:
        "Our bonsai come from a grower in Northern California who has been shaping Chinese elms for more than twenty years. Each tree is at least six years old, with a thickened, slightly twisting trunk and a dome of small glossy leaves pruned into shape over several seasons. Chinese elm is one of the most forgiving bonsai: it's happy indoors by a bright window, tolerates the odd missed watering, and can spend its summers outside. It arrives in a glazed stoneware tray with a fine gravel top, a care booklet and a small pair of pruning shears.",
      details: [
        "Chinese elm (Ulmus parvifolia), at least 6 years old",
        "About 10 in tall in a 9 in glazed stoneware tray",
        "Bright light indoors or part shade outdoors; check the soil daily",
        "Includes a care booklet and pruning shears",
        "Each tree is unique, so its shape will vary",
      ],
      images: [img("bonsai")],
      options: [],
      reviews: [
        review("Kenji M.", 5, "Beautiful tree", "Healthy, well shaped, and the pot is lovely. Better than I expected from a florist.", "2025-03-22"),
        review("Alice W.", 4, "Lovely gift", "My dad loves it. A few leaves dropped in the first week, but it recovered.", "2025-06-18"),
        review("Ryan O.", 5, "Great quality", "The trunk has real character, and the shears are a nice touch.", "2025-12-05"),
        review("Bianca F.", 3, "Arrived thirsty", "The soil was bone dry on arrival and it dropped leaves. It bounced back after two weeks.", "2026-05-21"),
      ],
      stock: 3,
      tags: ["bonsai", "tree"],
    },
    {
      sku: "WF-PL-LACE-ALOE",
      slug: "lace-aloe",
      name: "Lace Aloe",
      collection: "plants",
      priceCents: 3499,
      summary: "A small, spiky lace aloe in a square white ceramic pot, made for a sunny windowsill.",
      description:
        "Lace aloe is a compact succulent with slender, toothed leaves that form a neat rosette, and it is very nearly indestructible. It wants as much sun as you can give it and very little water: a good soak every two to three weeks, then let the soil dry out completely. We plant it in gritty succulent mix in a square, glossy white ceramic pot with a drainage hole and a scattering of pebbles on top. It's small enough for the narrowest windowsill or the corner of a desk, and an easy little gift for anyone who likes things tidy.",
      details: [
        "Aloe aristata, about 6 in tall",
        "Planted in a 4 in square white ceramic pot with drainage",
        "Full sun; water every 2–3 weeks",
        "Not pet-safe",
      ],
      images: [img("aloe")],
      options: [],
      reviews: [
        review("Chloe B.", 5, "Cute!", "Tiny and perfect for my windowsill.", "2025-04-11"),
        review("Martin G.", 4, "Healthy", "Came well packed, and the soil stayed in place.", "2025-07-23"),
        review("Nina T.", 5, "Great little gift", "Sent with a card to a friend who just moved. She loved it.", "2025-10-21"),
        review("Derek Y.", 3, "Smaller than I thought", "It's really small, more like 5 inches. Nice pot, though.", "2026-02-18"),
        review("Joy A.", 5, "Doing great", "Thriving on my desk after three months.", "2026-09-29"),
      ],
      stock: 26,
      tags: ["succulent", "small", "sun"],
    },
  ],
  addOns: [
    { sku: "WF-ADD-VASE", name: "Glass vase", priceCents: 1500, description: "A clear, weighted glass vase sized to the bouquet, so it goes straight from the box to the table." },
    { sku: "WF-ADD-CHOCOLATES", name: "Chocolate truffles, box of 9", priceCents: 1499, description: "Nine dark and milk chocolate truffles from a small chocolatier, boxed to travel alongside the flowers." },
    { sku: "WF-ADD-BALLOON", name: "Celebration balloon", priceCents: 799, description: "An 18-inch foil balloon in brushed gold, inflated by your florist and tied to the bouquet." },
    {
      sku: "WF-ADD-REWARDS",
      name: "Wrenfield Rewards — yearly membership",
      priceCents: 2499,
      recurring: "year",
      description: "Free standard delivery on every order for a year, starting with your next one. Renews automatically at $24.99 a year until you cancel.",
    },
  ],
  // Florists charge for delivery, so there is no free-delivery threshold; the date and the same-day fee come from `delivery`.
  shipping: [
    { id: "standard", label: "Standard delivery", priceCents: 1499, days: [1, 1] },
    { id: "morning", label: "Morning delivery (before noon)", priceCents: 2499, days: [1, 1] },
  ],
  promoCodes: {
    WELCOME10: { pctBp: 1000 },
    SPRING15: { pctBp: 1500, minSubtotalCents: 5000 },
  },
  delivery: { sameDayFeeCents: 1499, cutoffHourLocal: 14, giftMessage: true },
  policies: WRENFIELD_POLICIES,
};
