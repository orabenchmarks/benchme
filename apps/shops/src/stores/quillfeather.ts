import type { OptionGroup, Product, Review, StoreDef } from "@benchme/storefront";
import { QUILLFEATHER_POLICIES } from "./copy/quillfeather.js";

/**
 * Quillfeather Coffee: a small-lot roaster in an old print shop, warm and precise about where each
 * coffee comes from. Every coffee comes in two bag sizes and five grinds, one-time or on a
 * subscription; gear is sold as it comes. Pays through the Express Checkout Element (Link) above a
 * Payment Element.
 */

const img = (file: string) => `img/quillfeather/${file}.jpg`;

/** The bag sizes and grinds every coffee is offered in: the 2 lb bag costs $22.00 more than the 12 oz. */
function coffeeOptions(): OptionGroup[] {
  return [
    {
      id: "size",
      name: "Size",
      values: [
        { id: "12oz", label: "12 oz" },
        { id: "2lb", label: "2 lb", priceDeltaCents: 2200 },
      ],
    },
    {
      id: "grind",
      name: "Grind",
      values: [
        { id: "whole-bean", label: "Whole bean" },
        { id: "drip", label: "Drip" },
        { id: "espresso", label: "Espresso" },
        { id: "french-press", label: "French press" },
        { id: "pour-over", label: "Pour-over" },
      ],
    },
  ];
}

type Draft = Omit<Product, "images" | "options" | "subscription"> & { image: string };

/** A coffee: both sizes, every grind, and subscribe & save (15 % off every 2, 4 or 6 weeks). */
function coffee({ image, ...p }: Draft): Product {
  return { ...p, images: [img(image)], options: coffeeOptions(), subscription: { savePct: 15, intervals: ["2 weeks", "4 weeks", "6 weeks"] } };
}

/** Brew gear: one item as it comes, no options, no subscription. */
function gear({ image, ...p }: Draft): Product {
  return { ...p, images: [img(image)], options: [] };
}

const review = (date: string, author: string, rating: Review["rating"], title: string, body: string, verified = true): Review => ({ author, rating, title, body, date, verified });

const LOGO =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 236 40" width="236" height="40" role="img" aria-label="Quillfeather Coffee">' +
  '<path d="M30 2C20.5 5.5 12 14 10.2 26.5l2.2 2.3C24 24.5 31.5 14.5 30 2Z" fill="#B5532E"/>' +
  '<path d="M12.2 17.6l3.6 1.9M16.6 10.6l3.2 1.6M26.8 17.6l-3.3 2.1M28.9 9.6l-2.6 1.7" stroke="#FFF8F0" stroke-width="1.25" stroke-linecap="round"/>' +
  '<path d="M28.6 4.6C23.5 12.5 16.5 21.5 6 36.5" fill="none" stroke="#2B201A" stroke-width="1.6" stroke-linecap="round"/>' +
  '<text x="40" y="27.5" fill="#2B201A" font-family="DM Serif Display, Georgia, serif" font-size="25" textLength="131" lengthAdjust="spacingAndGlyphs">Quillfeather</text>' +
  '<text x="178" y="27" fill="#B5532E" font-family="Work Sans, Helvetica, Arial, sans-serif" font-size="8.5" font-weight="600" letter-spacing="2.2" textLength="55" lengthAdjust="spacing">COFFEE</text>' +
  "</svg>";

const singleOrigins: Product[] = [
  coffee({
    sku: "QF-ETH-GUJI",
    slug: "ethiopia-guji-hambela",
    name: "Ethiopia Guji Hambela",
    collection: "single-origins",
    priceCents: 2100,
    summary: "A natural-process Guji that tastes of blueberry, jasmine and cacao nib, roasted light for pour-over.",
    description:
      "Natural-process coffees from Guji can be loud. This one sings instead. Smallholder farmers around Hambela Wamena deliver ripe cherry to a station that dries it slowly on raised beds for three to four weeks, turning it by hand through the hottest hours. The result smells like a blueberry muffin as you grind it and drinks cleaner than you'd expect: blueberry and jasmine up front, cacao nib as it cools. We roast it light; give it a week from the roast date and it opens up fully on pour-over. Try 15 g of coffee to 250 g of water just off the boil, or brew it double strength over ice for a wildly fruity iced coffee.",
    details: [
      "Tasting notes: blueberry, jasmine, cacao nib",
      "Origin: Hambela Wamena, Guji, Ethiopia",
      "Variety: Ethiopian landrace varieties",
      "Process: Natural, dried on raised beds",
      "Altitude: 2,000–2,250 m",
      "Roast: Light",
    ],
    image: "ethiopia-guji-hambela",
    reviews: [
      review("2025-03-14", "Maya R.", 5, "Blueberry, no joke", "I was skeptical about the tasting notes, but the blueberry is right there when you open the bag. Best on my cone dripper at 1:16."),
      review("2025-06-02", "Tomasz K.", 4, "Lovely, a bit wild as espresso", "Fantastic as pour-over. Pulled as espresso it was a little too funky for me, so I'll keep it for filter."),
      review("2025-09-21", "Denise W.", 5, "Smells like a bakery", "Grinding this in the morning is half the pleasure. Arrived two days after it was roasted, well packed."),
      review("2026-01-11", "Jamal O.", 3, "Not my thing", "Well roasted and clearly good quality, but naturals are too fruity for me. My partner loves it, so it won't go to waste.", false),
      review("2026-07-08", "Priya S.", 5, "Iced coffee of the summer", "Brewed double strength over ice like the page suggests. Tastes like blueberry iced tea. Went for the 2 lb bag the second time."),
    ],
    stock: 24,
    tags: ["single-origin", "ethiopia", "africa", "natural", "light-roast"],
  }),
  coffee({
    sku: "QF-KEN-NYERI",
    slug: "kenya-nyeri-ab",
    name: "Kenya Nyeri AB",
    collection: "single-origins",
    priceCents: 2300,
    summary: "A juicy, double-washed Kenyan with blackcurrant and pink grapefruit, finished with raw sugar.",
    description:
      "Kenyan coffee is the reason a lot of us fell for light roasts, and this AB lot from Nyeri is a textbook example. Cherry from the smallholder members of a cooperative society is pulped, fermented, washed and soaked again before drying on raised beds, a slow double-washed process that gives a cup of remarkable clarity. Expect blackcurrant and pink grapefruit, a syrupy body and a raw-sugar finish that keeps it from tipping into sour. It's at its best as pour-over or in a flat-bottom drip brewer. We bought every bag of this lot we could, but it was a small one, so when it's gone it's gone until next year's harvest.",
    details: [
      "Tasting notes: blackcurrant, pink grapefruit, raw sugar",
      "Origin: Nyeri County, Kenya",
      "Variety: SL28, SL34 and Ruiru 11",
      "Process: Washed, double-fermented",
      "Altitude: 1,750–1,900 m",
      "Roast: Light",
    ],
    image: "kenya-nyeri-ab",
    reviews: [
      review("2025-02-19", "Hannah B.", 5, "The Kenyan I've been chasing", "Blackcurrant for days. I've tried Kenyans from four roasters this year and this is the cleanest."),
      review("2025-05-30", "Greg T.", 4, "Bright, in a good way", "Sharp when it's hot, lovely as it cools. I add a gram or two more coffee than usual to round it out."),
      review("2025-11-03", "Aiko N.", 5, "You can taste the care", "Every cup is clean and sweet. Shipped quickly in a nicely sealed bag."),
      review("2026-04-17", "Ben F.", 3, "Too tart for me", "Clearly a quality coffee, but it was too acidic for my stomach in the mornings. Switched to the Guatemala."),
    ],
    stock: 5,
    tags: ["single-origin", "kenya", "africa", "washed", "light-roast"],
  }),
  coffee({
    sku: "QF-COL-HUILA",
    slug: "colombia-huila-pitalito",
    name: "Colombia Huila Pitalito",
    collection: "single-origins",
    priceCents: 1800,
    summary: "An easy, sweet washed Colombian with red apple, panela and milk chocolate that works in any brewer.",
    description:
      "If you're not sure where to start, start here. Pitalito sits in the south of Huila, where small family farms pick ripe cherry over a long harvest and ferment it in tanks behind the house before drying it in parabolic dryers. This lot brings together farms around the town that taste of red apple, panela and milk chocolate, and stay that way for weeks. We roast it a touch past light so it's forgiving: great in an automatic drip machine, sweet in a French press and more than respectable as espresso with milk. It's the coffee we drink at the roastery when we're not tasting anything else.",
    details: [
      "Tasting notes: red apple, panela, milk chocolate",
      "Origin: Pitalito, Huila, Colombia",
      "Variety: Caturra, Castillo and Colombia",
      "Process: Washed, dried in parabolic dryers",
      "Altitude: 1,600–1,850 m",
      "Roast: Medium-light",
    ],
    image: "colombia-huila-pitalito",
    reviews: [
      review("2025-01-27", "Carmen D.", 5, "Our house coffee now", "Easy to brew, never bitter, and my husband who 'doesn't like fancy coffee' drinks it black."),
      review("2025-07-12", "Rachel L.", 4, "Solid daily drinker", "Nothing wild, just really good. The 2 lb bag lasts the two of us about three weeks."),
      review("2025-10-05", "Dev P.", 5, "Great in the drip machine", "I don't have any fancy gear and it still tastes like the tasting notes. The drip grind was spot on."),
      review("2026-02-23", "Sofia G.", 4, "Sweet and steady", "Good as espresso with oat milk too. The roast date was three days before it arrived."),
      review("2026-08-30", "Marcus J.", 3, "Fine, a bit plain", "Perfectly nice, but I wanted something with more character. It would suit someone who likes it simple."),
    ],
    stock: 32,
    tags: ["single-origin", "colombia", "south-america", "washed", "medium-light-roast"],
  }),
  coffee({
    sku: "QF-GUA-HUEHUE",
    slug: "guatemala-huehuetenango",
    name: "Guatemala Huehuetenango",
    collection: "single-origins",
    priceCents: 1900,
    summary: "A round, toffee-sweet Guatemalan from the high, dry hills of Huehuetenango, with orange zest and almond.",
    description:
      "Huehuetenango's high, dry plateau is sheltered from the hot winds coming off the Mexican plains, which lets coffee ripen slowly at altitudes that would be too cold almost anywhere else in the country. This lot comes from a group of small farms near La Libertad that wash their coffee at home and dry it on patios. It's a classic cup roasted to a true medium: toffee and almond sweetness, a little orange zest to lift it, and a round body that stands up to milk. It's lovely in a French press, generous in a drip machine and a favorite of anyone who loved coffee before they knew what a natural process was.",
    details: [
      "Tasting notes: toffee, orange zest, almond",
      "Origin: La Libertad, Huehuetenango, Guatemala",
      "Variety: Bourbon, Caturra and Pache",
      "Process: Washed, sun-dried on patios",
      "Altitude: 1,650–1,900 m",
      "Roast: Medium",
    ],
    image: "guatemala-huehuetenango",
    reviews: [
      review("2025-04-08", "Elena V.", 5, "Toffee in a cup", "Exactly what I want first thing in the morning. Great in my French press."),
      review("2025-08-19", "Ruth A.", 4, "Good with milk", "Holds up beautifully in a latte. I'd call it more chocolate than toffee, but no complaints."),
      review("2026-01-30", "Kwame A.", 5, "Reordered three times", "Consistent from bag to bag, which is what I want from a daily coffee. Sturdy packaging, too."),
      review("2026-06-14", "Lily C.", 4, "Nice and balanced", "Not too bright, not too dark. My go-to when I'm not feeling adventurous.", false),
    ],
    stock: 27,
    tags: ["single-origin", "guatemala", "central-america", "washed", "medium-roast"],
  }),
  coffee({
    sku: "QF-CRI-TARRAZU",
    slug: "costa-rica-tarrazu-honey",
    name: "Costa Rica Tarrazu Honey",
    collection: "single-origins",
    priceCents: 2000,
    summary: "A yellow-honey Costa Rican that tastes of apricot, wildflower honey and brown butter.",
    description:
      "In a honey process the cherry skin comes off, but the sticky fruit underneath stays on the bean while it dries. Tarrazu's micro-mills perfected the method, and they call a honey yellow, red or black by how much of that fruit they leave and how slowly the beds dry. This yellow honey, from a family micro-mill in the Los Santos hills, dries for twelve days on raised beds, and you can taste it: apricot and wildflower honey, a silky body and a brown-butter finish. It's the coffee we hand to people who say they don't like light roasts. Brew it as pour-over, or in a flat-bottom drip brewer for something rounder.",
    details: [
      "Tasting notes: apricot, wildflower honey, brown butter",
      "Origin: Los Santos, Tarrazu, Costa Rica",
      "Variety: Catuai and Caturra",
      "Process: Yellow honey, dried on raised beds",
      "Altitude: 1,500–1,750 m",
      "Roast: Medium-light",
    ],
    image: "costa-rica-tarrazu-honey",
    reviews: [
      review("2025-03-03", "Owen H.", 5, "Converted me to lighter roasts", "Sweet, round and not sour at all. I finally get what people mean by 'honey process'."),
      review("2025-06-25", "Nadia F.", 4, "Really pleasant", "The apricot is subtle but the sweetness is obvious. Lovely as cold brew, too."),
      review("2025-12-09", "Pete S.", 4, "Good, and quick", "Ordered on Monday, here on Wednesday. A nice cup, though I preferred the Guji."),
      review("2026-05-02", "Yusuf A.", 5, "Brown butter is accurate", "I laughed at the tasting notes and then I tasted it. Wonderful."),
    ],
    stock: 18,
    tags: ["single-origin", "costa-rica", "central-america", "honey-process", "medium-light-roast"],
  }),
  coffee({
    sku: "QF-IDN-GAYO",
    slug: "sumatra-aceh-gayo",
    name: "Sumatra Aceh Gayo",
    collection: "single-origins",
    priceCents: 1700,
    summary: "A heavy, earthy Sumatran with dark chocolate, cedar and molasses for people who like their coffee bold.",
    description:
      "Most of Indonesia's coffee is wet-hulled, a local method in which the parchment comes off while the beans are still damp, and it's the reason Sumatran coffee tastes like nothing else: heavy, low in acidity, a little earthy and wonderfully syrupy. This lot comes from smallholders around Lake Laut Tawar in the Gayo highlands of Aceh, who grow coffee in the shade of tall trees beside their vegetable gardens. We roast it to medium-dark to bring out dark chocolate, cedar and molasses without letting it turn smoky. It's built for French press and drip, and it makes a seriously good cup with cream.",
    details: [
      "Tasting notes: dark chocolate, cedar, molasses",
      "Origin: Gayo highlands, Aceh, Indonesia",
      "Variety: Ateng, Tim Tim and Bergendal",
      "Process: Wet-hulled",
      "Altitude: 1,300–1,600 m",
      "Roast: Medium-dark",
    ],
    image: "sumatra-aceh-gayo",
    reviews: [
      review("2025-02-11", "Claire M.", 5, "Bold without being burnt", "Finally a dark coffee that doesn't taste like charcoal. Thick and chocolatey in the French press."),
      review("2025-09-02", "Diego R.", 4, "Great with cream", "Earthy in a good way. A bit much black for me, perfect with a splash of cream."),
      review("2026-03-19", "Ingrid L.", 3, "Earthier than expected", "Well made, but more cedar and earth than chocolate for my taste. My dad loves it."),
      review("2026-09-12", "Sam W.", 5, "The only coffee my dad will drink", "Got it for him on a subscription. He says it's like the coffee he had in the Navy, only better."),
    ],
    stock: 21,
    tags: ["single-origin", "sumatra", "indonesia", "asia", "wet-hulled", "medium-dark-roast"],
  }),
  coffee({
    sku: "QF-RWA-NYAMASHEKE",
    slug: "rwanda-nyamasheke",
    name: "Rwanda Nyamasheke",
    collection: "single-origins",
    priceCents: 2200,
    summary: "A limited washed lot from the shore of Lake Kivu with red currant, black tea and cane sugar.",
    description:
      "Nyamasheke runs along the eastern shore of Lake Kivu, where steep hills and cool lake air give coffee a long, slow ripening. This lot comes from a single washing station that buys cherry from about eight hundred nearby farmers, sorts it by hand, floats it and ferments it overnight before drying it on raised tables for up to three weeks. In the cup it's delicate and layered: red currant and black tea, a cane-sugar sweetness and a long, clean finish. There isn't much of it, so it won't be with us for long. Brew it as pour-over and let it cool a little before your first sip.",
    details: [
      "Tasting notes: red currant, black tea, cane sugar",
      "Origin: Nyamasheke, Western Province, Rwanda",
      "Variety: Red Bourbon",
      "Process: Washed, dried on raised tables",
      "Altitude: 1,700–1,900 m",
      "Roast: Light",
    ],
    image: "rwanda-nyamasheke",
    reviews: [
      review("2025-05-17", "Fatima Z.", 5, "Elegant", "Tastes like a good black tea with a spoonful of currant jam. Gone too fast."),
      review("2025-10-22", "Jonah K.", 4, "Delicate", "Easy to over-extract, so grind a little coarser than you think. Once dialed in, it's beautiful."),
      review("2026-04-04", "Mei L.", 5, "Get it while it lasts", "Ordered two bags this spring and they arrived perfectly packed, valve and all."),
    ],
    badges: ["Limited lot"],
    stock: 4,
    tags: ["single-origin", "rwanda", "africa", "washed", "light-roast"],
  }),
];

const blends: Product[] = [
  coffee({
    sku: "QF-BLEND-MORNING",
    slug: "morning-letter",
    name: "Morning Letter",
    collection: "blends",
    priceCents: 1600,
    summary: "Our everyday blend of Brazil and Guatemala, with milk chocolate, toasted hazelnut and a little red apple.",
    description:
      "Morning Letter is named for the kind of letter you read slowly with your first cup, and it's the coffee we'd send to anyone we love. We blend a sweet, nutty natural Brazil from the Cerrado Mineiro with a washed Guatemala that brings a little red-apple brightness, and roast them together to a true medium. The result is balanced and forgiving: milk chocolate and toasted hazelnut, a gentle sweetness and a clean finish whether you brew it in a drip machine, a French press or a cone dripper. It's our bestseller by a wide margin and the coffee most of our subscribers start with.",
    details: [
      "Tasting notes: milk chocolate, toasted hazelnut, red apple",
      "Origin: Brazil (Cerrado Mineiro) and Guatemala (Huehuetenango)",
      "Process: Natural and washed",
      "Altitude: 1,000–1,800 m",
      "Roast: Medium",
      "Best for: drip machines, French press, cone drippers",
    ],
    image: "morning-letter",
    reviews: [
      review("2025-01-15", "Theo B.", 5, "Exactly what it says", "The cup I want every morning. Never sour, never bitter."),
      review("2025-04-29", "Grace O.", 5, "Subscribed after one bag", "Every four weeks like clockwork, and the subscription saving adds up."),
      review("2025-08-08", "Raúl C.", 4, "Reliable", "Good, balanced and the same every time. I'd love a slightly darker version."),
      review("2025-12-01", "Beth N.", 5, "Office favorite", "We buy the 2 lb bag for an office of eight. Nobody complains, which is a first."),
      review("2026-03-06", "Andre P.", 3, "Pleasant but safe", "Nice enough, but after trying the single origins it feels a bit ordinary.", false),
      review("2026-07-21", "Kim H.", 5, "Lovely packaging, too", "The bag is gorgeous, and the tasting card I added was a sweet touch."),
    ],
    badges: ["Bestseller"],
    stock: 36,
    tags: ["blend", "brazil", "guatemala", "medium-roast", "everyday"],
  }),
  coffee({
    sku: "QF-BLEND-INKWELL",
    slug: "inkwell-espresso",
    name: "Inkwell Espresso",
    collection: "blends",
    priceCents: 1800,
    summary: "Our house espresso blend, dense and syrupy with dark chocolate, black cherry and brown sugar.",
    description:
      "Inkwell is the espresso we pour at every tasting and the one our wholesale cafés build their menus around. It combines a natural Brazil for body and chocolate, a washed Colombia for sweetness and structure, and a small share of natural Ethiopia that adds a flicker of black cherry. We roast it a shade past medium so it pulls dense and syrupy under a thick crema and still tastes like fruit rather than smoke. Start at 18 g in and 36–40 g out in 27–30 seconds. In milk it reads as chocolate cake; as a straight shot it's round, sweet and long. It's just as good in a moka pot.",
    details: [
      "Tasting notes: dark chocolate, black cherry, brown sugar",
      "Origin: Brazil, Colombia and Ethiopia",
      "Process: Natural and washed",
      "Altitude: 1,100–2,100 m",
      "Roast: Medium-dark",
      "Best for: espresso, moka pot",
    ],
    image: "inkwell-espresso",
    reviews: [
      review("2025-02-06", "Will D.", 5, "Dialed in on the first try", "18 in, 38 out, 28 seconds. Chocolate and cherry, gorgeous crema."),
      review("2025-06-18", "Noor H.", 4, "Great in flat whites", "Fantastic with milk. As a straight shot I prefer something brighter, but that's personal."),
      review("2025-11-26", "Zoe T.", 5, "Better than my local café", "I'm a little embarrassed to say it, but it is."),
      review("2026-02-14", "Frank M.", 4, "Give it a week", "Arrived two days off roast, so I let it rest a week before it really settled. Worth the wait."),
      review("2026-08-03", "Ivy L.", 5, "Moka pot approved", "Rich and sweet in my stovetop pot, with no bitterness at all."),
    ],
    stock: 30,
    tags: ["blend", "espresso", "medium-dark-roast", "chocolate"],
  }),
  coffee({
    sku: "QF-BLEND-POSTSCRIPT",
    slug: "postscript",
    name: "Postscript",
    collection: "blends",
    priceCents: 1900,
    summary: "A bright, fruit-forward blend of Ethiopia, Kenya and Colombia with stone fruit, bergamot and honey.",
    description:
      "Every letter worth writing has a postscript, the line you add because you couldn't leave it out. Ours is a brighter blend for people who love fruit in their coffee but want something more forgiving than a single origin: a washed Ethiopia from Yirgacheffe for florals and bergamot, a Kenyan for juicy stone fruit, and a washed Colombia to round them out with honey sweetness. The components follow the harvests, so the blend shifts a little every few months, and we taste every batch to keep it bright, sweet and clean. Brew it as pour-over or in a drip machine, or make it a fruity flat white.",
    details: [
      "Tasting notes: stone fruit, bergamot, honey",
      "Origin: Ethiopia, Kenya and Colombia",
      "Process: Washed",
      "Altitude: 1,600–2,200 m",
      "Roast: Light-medium",
      "Best for: pour-over, drip machines, flat whites",
    ],
    image: "postscript",
    reviews: [
      review("2025-05-09", "Hector V.", 4, "Bright and fun", "Like a fruit bowl in a mug. A little sharp in my drip machine, wonderful as pour-over."),
      review("2025-09-15", "Lauren K.", 5, "Peach and Earl Grey", "That's what I taste, anyway. My favorite of the blends."),
      review("2026-02-02", "Ravi M.", 3, "Changed since last time", "The new batch is more lemony than the one I had in the spring. Still good, just different."),
      review("2026-06-27", "Ellie J.", 5, "A lovely gift", "Sent it to my sister in the gift box. She called just to tell me how pretty the packaging was."),
    ],
    stock: 22,
    tags: ["blend", "ethiopia", "kenya", "light-medium-roast", "fruity"],
  }),
  coffee({
    sku: "QF-BLEND-LASTDRAFT",
    slug: "last-draft",
    name: "Last Draft",
    collection: "blends",
    priceCents: 1700,
    summary: "Our dark roast, with bittersweet cocoa, molasses and a whisper of smoke, for late nights and strong cups.",
    description:
      "Some nights you need a coffee that stays up with you, and Last Draft is that coffee. We blend a wet-hulled Sumatra for weight with a natural Brazil for cocoa sweetness and roast them to the edge of second crack, where the sugars turn to molasses and a whisper of smoke shows up without burning. It's heavy, low in acidity and strong without bitterness, with bittersweet cocoa, molasses and a long, dark finish. Use it in a French press, a drip machine or a moka pot, and don't be shy with milk and sugar. If you've been buying dark roast at the supermarket, this is what it should taste like.",
    details: [
      "Tasting notes: bittersweet cocoa, molasses, a little smoke",
      "Origin: Sumatra and Brazil",
      "Process: Wet-hulled and natural",
      "Altitude: 1,000–1,600 m",
      "Roast: Dark",
      "Best for: French press, drip machines, moka pot",
    ],
    image: "last-draft",
    reviews: [
      review("2025-03-22", "Tom W.", 5, "A dark roast that isn't burnt", "Strong and smooth. I drink it black in a big mug."),
      review("2025-10-14", "Gabriela S.", 4, "Bold and cozy", "Great with milk and a little sugar. It's a bit oily, so my grinder needs cleaning more often."),
      review("2026-01-08", "Chris E.", 5, "Night-shift fuel", "Night-shift nurse here. This gets me through."),
      review("2026-05-25", "Anna P.", 3, "Too dark for me", "Well made, but I should have read the description: it's genuinely dark. My husband has taken it over."),
    ],
    stock: 25,
    tags: ["blend", "sumatra", "brazil", "dark-roast"],
  }),
];

const decaf: Product[] = [
  coffee({
    sku: "QF-DECAF-COLOMBIA",
    slug: "decaf-colombia-huila",
    name: "Decaf Colombia Huila",
    collection: "decaf",
    priceCents: 1800,
    summary: "A sweet sugarcane-process decaf from Huila, with panela, red grape and milk chocolate.",
    description:
      "Decaf has a reputation it stopped deserving years ago, and this one helps clear its name. The coffee is grown by smallholders across Huila, washed and dried, then decaffeinated in Colombia with ethyl acetate made from fermented local sugarcane. The method is gentle on the bean and leaves a natural sweetness behind, so the cup tastes of panela, red grape and milk chocolate rather than cardboard. We roast it to medium to keep that sweetness front and center. It brews beautifully in any filter method and makes a creamy, convincing decaf latte. It's the decaf our own team drinks after lunch, and nobody picks it out in a blind tasting.",
    details: [
      "Tasting notes: panela, red grape, milk chocolate",
      "Origin: Huila, Colombia",
      "Process: Washed, then decaffeinated with sugarcane ethyl acetate",
      "Altitude: 1,500–1,800 m",
      "Roast: Medium",
      "Caffeine: at least 97% removed",
    ],
    image: "decaf-colombia-huila",
    reviews: [
      review("2025-01-20", "Mike R.", 5, "Can't tell it's decaf", "Served it to friends after dinner and nobody guessed. Sweet and chocolatey."),
      review("2025-07-03", "Jess C.", 4, "Great evening coffee", "A lovely pour-over at 8 p.m. without the 3 a.m. regret."),
      review("2025-11-18", "Darnell W.", 5, "Finally, a decaf I enjoy", "My wife is expecting, so we both switched. This is the only decaf that tastes like real coffee to us."),
      review("2026-04-28", "Kate S.", 4, "Good with milk", "Makes a really nice latte. Black, it's a touch flatter than the regular Colombia."),
    ],
    stock: 28,
    tags: ["decaf", "colombia", "south-america", "sugarcane-process", "medium-roast"],
  }),
  coffee({
    sku: "QF-DECAF-PERU",
    slug: "decaf-peru-cajamarca",
    name: "Decaf Peru Cajamarca",
    collection: "decaf",
    priceCents: 1900,
    summary: "A Swiss Water decaf from northern Peru with cocoa, walnut and dried cherry, roasted for comfort.",
    description:
      "Cajamarca, in the far north of Peru, is a region of small farms, many of them only a hectare or two, where coffee grows among fruit trees on steep slopes. This lot was decaffeinated with the Swiss Water Process, which uses only water, temperature, time and carbon filtration to draw the caffeine out and leaves the coffee 99.9% caffeine-free. What's left is a comforting cup of cocoa, walnut and a little dried cherry, with a medium body and no harsh edges. We roast it to a full medium, so it's at home in a French press or an afternoon drip pot. Pair it with a slice of something chocolate.",
    details: [
      "Tasting notes: cocoa, walnut, dried cherry",
      "Origin: Cajamarca, Peru",
      "Process: Washed, then decaffeinated by the Swiss Water Process",
      "Altitude: 1,600–1,900 m",
      "Roast: Medium",
      "Caffeine: 99.9% caffeine-free",
    ],
    image: "decaf-peru-cajamarca",
    reviews: [
      review("2025-04-12", "Viktor I.", 4, "Comfortable and nutty", "Exactly what I want at 4 p.m. Very good in the French press."),
      review("2025-08-27", "Paula G.", 5, "Made the right way", "I care about how decaf is made, so I appreciate that the method is on the bag and the page."),
      review("2026-01-24", "Ahmed K.", 3, "A bit flat", "Fine, but the Colombia decaf has more going on. This one is for people who want a simple cup.", false),
      review("2026-06-05", "June P.", 4, "Arrived well packed", "Two days to Oregon, sealed and fresh. Good with oat milk."),
    ],
    stock: 20,
    tags: ["decaf", "peru", "south-america", "swiss-water", "medium-roast"],
  }),
  coffee({
    sku: "QF-DECAF-ETHIOPIA",
    slug: "decaf-ethiopia-sidama",
    name: "Decaf Ethiopia Sidama",
    collection: "decaf",
    priceCents: 2100,
    summary: "A rare fruity decaf from Sidama, decaffeinated with mountain water, with peach, black tea and honey.",
    description:
      "Fruity decafs are hard to find, because most decaffeination flattens the delicate flavors that make Ethiopian coffee special. This washed Sidama was decaffeinated in Mexico with the Mountain Water Process, which uses glacier water from Pico de Orizaba and no chemical solvents, and its florals survive surprisingly well. Expect peach and black tea, a honeyed sweetness and a silky body that would fool most people into thinking it was the real thing. We roast it lighter than our other decafs to keep the fruit, so treat it like a single origin: pour-over or a flat-bottom dripper, with water just off the boil.",
    details: [
      "Tasting notes: peach, black tea, honey",
      "Origin: Sidama, Ethiopia",
      "Process: Washed, then decaffeinated by the Mountain Water Process",
      "Altitude: 1,900–2,200 m",
      "Roast: Light-medium",
      "Caffeine: 99.9% caffeine-free",
    ],
    image: "decaf-ethiopia-sidama",
    reviews: [
      review("2025-03-31", "Luca B.", 5, "A decaf with real flavor", "Peachy and floral. I didn't know decaf could taste like this."),
      review("2025-09-09", "Sara E.", 5, "My evening pour-over", "Light, fruity and calm. It arrived four days after the roast date."),
      review("2026-02-09", "Tobias N.", 3, "Nice, not an everyday cup", "Lovely, but it's a special-occasion decaf for me rather than one I drink every day."),
      review("2026-08-19", "Ines M.", 4, "More tea than coffee", "Definitely tea-like. I grind it a little finer than the regular Ethiopia."),
    ],
    stock: 16,
    tags: ["decaf", "ethiopia", "africa", "mountain-water", "light-medium-roast"],
  }),
  coffee({
    sku: "QF-DECAF-NIGHTOWL",
    slug: "night-owl-decaf-espresso",
    name: "Night Owl Decaf Espresso",
    collection: "decaf",
    priceCents: 1700,
    summary: "A decaf espresso blend that pulls thick and chocolatey, for a flat white after dinner.",
    description:
      "Night Owl started as a request from one of our wholesale cafés: a decaf their baristas couldn't tell apart from the regular espresso in a flat white. It took us eleven roasts to get there. We blend a sugarcane-process Colombia for sweetness with a Swiss Water Brazil for body, and roast them to medium-dark so the shot pulls thick under a proper crema, with dark chocolate and toasted almond that stand up to milk. As a straight shot it's round and gentle. It also makes an excellent moka pot coffee and a strong French press for anyone who wants all of the ritual and none of the caffeine.",
    details: [
      "Tasting notes: dark chocolate, toasted almond, caramel",
      "Origin: Colombia and Brazil",
      "Process: Decaffeinated with sugarcane ethyl acetate and by the Swiss Water Process",
      "Altitude: 1,100–1,800 m",
      "Roast: Medium-dark",
      "Best for: espresso, moka pot",
    ],
    image: "night-owl-decaf",
    reviews: [
      review("2025-02-25", "Hugo L.", 5, "Café-level decaf shots", "Pulls just like regular espresso on my machine. Great crema."),
      review("2025-07-30", "Paige W.", 4, "Great in a flat white", "Rich and chocolatey with milk. Slightly thin as a straight shot."),
      review("2025-12-13", "Oscar F.", 4, "Better than I expected", "I've tried a few decaf espressos and this is the first one I'd happily drink every day."),
      review("2026-05-11", "Bianca R.", 5, "After-dinner ritual", "We have a decaf cortado every night now. A 2 lb bag lasts us about a month."),
      review("2026-09-04", "Nate G.", 3, "Grind it yourself", "The espresso grind ran a little fast on my machine. Whole bean and my own grinder fixed it."),
    ],
    stock: 24,
    tags: ["decaf", "espresso", "blend", "medium-dark-roast"],
  }),
];

const brewGear: Product[] = [
  gear({
    sku: "QF-GEAR-KETTLE",
    slug: "copper-gooseneck-kettle",
    name: "Copper Gooseneck Kettle",
    collection: "brew-gear",
    priceCents: 6400,
    compareAtCents: 7200,
    summary: "A hammered copper-finish gooseneck kettle that pours the slow, steady stream a good pour-over needs.",
    description:
      "A pour-over is only as good as the stream that makes it, and a gooseneck spout is what turns a splash into a slow, steady pour you can aim. This stovetop kettle has a stainless-steel body with a hammered copper finish, a long, narrow spout that holds a thin stream even when the kettle is full, and a heat-resistant handle that stays comfortable through a four-minute brew. It holds a liter, enough for two large cups, and works on gas, electric and induction stoves. It's the kettle on our own tasting bench and the one we reach for when we're showing someone how to brew.",
    details: [
      "Capacity: 1 liter (34 oz)",
      "Material: Stainless steel with a hammered copper finish",
      "Works on gas, electric and induction stoves",
      "Heat-resistant handle",
      "Care: Hand wash and dry upside down",
    ],
    image: "gooseneck-kettle",
    reviews: [
      review("2025-04-23", "Lena K.", 5, "Beautiful and practical", "Pours like a dream and looks great on the stove."),
      review("2025-10-30", "Marco T.", 4, "Lovely, but mind the flame", "The stream control is excellent. The handle warms up on a big gas flame, so keep it low."),
      review("2026-03-15", "Aisha B.", 5, "A gift that gets used", "Arrived in a sturdy box with plenty of padding. My husband uses it every morning."),
      review("2026-07-02", "Rob J.", 4, "Shows fingerprints", "Works perfectly, but the copper finish needs a wipe now and then to stay shiny."),
    ],
    badges: ["Sale"],
    stock: 12,
    tags: ["gear", "kettle", "pour-over"],
  }),
  gear({
    sku: "QF-GEAR-DRIPPER",
    slug: "ceramic-cone-dripper",
    name: "Ceramic Cone Dripper",
    collection: "brew-gear",
    priceCents: 2800,
    summary: "A glazed ceramic cone dripper that brews one or two cups of bright, clean pour-over.",
    description:
      "This is the simplest way we know to brew a great cup at home. The cone is made of ceramic in a warm copper-brown glaze, which holds heat well, so the water stays hot from the first pour to the last. Ribs inside keep the paper from sealing against the walls, and a single wide opening at the bottom lets you set the pace of the brew with your pour and your grind. It takes standard #2 cone filters and sits steadily on most mugs and carafes. Rinse the filter with hot water, add 15 g of coffee ground for pour-over, and pour 250 g of water in slow circles.",
    details: ["Brews 1–2 cups", "Material: Glazed ceramic, copper brown", "Filters: Standard #2 cone filters", "Fits most mugs and carafes", "Care: Dishwasher-safe"],
    image: "cone-dripper",
    reviews: [
      review("2025-01-09", "Nina P.", 5, "Better than my old plastic one", "Holds its temperature much better, and the glaze is lovely."),
      review("2025-06-11", "Carlos M.", 4, "Great, but heavy", "Brews beautifully. It's a bit heavy for a thin-walled mug, so I use a carafe."),
      review("2025-11-29", "Hye-jin K.", 5, "Easy to learn on", "Paired it with the Guji and followed the recipe on the page. Great by my second try."),
      review("2026-03-27", "Wes A.", 3, "Arrived chipped", "Small chip on the rim. Support sent a replacement within the week, which was great, but the packing could be better."),
      review("2026-09-18", "Imogen R.", 5, "Lovely everyday dripper", "Simple and pretty, and it rinses clean in seconds."),
    ],
    stock: 26,
    tags: ["gear", "dripper", "pour-over"],
  }),
  gear({
    sku: "QF-GEAR-GRINDER",
    slug: "heritage-hand-grinder",
    name: "Heritage Hand Grinder",
    collection: "brew-gear",
    priceCents: 8900,
    summary: "A box-style hand grinder with a brass-finished crank and a steel conical burr, adjustable from espresso to French press.",
    description:
      "Grinding just before you brew is the biggest single improvement most people can make to their coffee, and this grinder makes it a pleasure. It's built in the old box-mill style, with a solid beech base, a brass-finished crank and a wide, open hopper, but inside is a modern hardened-steel conical burr that grinds evenly from espresso-fine to French-press coarse. A thumb nut under the crank sets the grind, and the drawer below holds up to 30 g, enough for two large mugs. Expect about a minute of turning for a pour-over. We make these in small runs with a workshop in Oregon, so stock comes and goes.",
    details: [
      "Burr: Hardened-steel conical burr",
      "Grind range: Espresso to French press",
      "Capacity: 30 g in the drawer",
      "Materials: Beech base, brass-finished crank",
      "Care: Brush clean; never wash the burr",
    ],
    image: "box-grinder",
    reviews: [
      review("2025-02-28", "Harold P.", 5, "A joy to use", "Grinding by hand has become my favorite five minutes of the day. Very even grind."),
      review("2025-08-06", "Simone A.", 4, "Takes some elbow grease", "Grinds beautifully, but espresso-fine takes a while. Perfect for pour-over."),
      review("2026-01-16", "Kenji O.", 5, "Looks great on the counter", "Guests always ask about it. It arrived very well packed."),
      review("2026-06-20", "Dana L.", 3, "Hard to keep a setting", "The thumb nut slips a little and I lose my setting. The grind is excellent once it's set."),
    ],
    stock: 3,
    tags: ["gear", "grinder"],
  }),
  gear({
    sku: "QF-GEAR-CUP",
    slug: "stoneware-cup-and-saucer",
    name: "Stoneware Cup & Saucer",
    collection: "brew-gear",
    priceCents: 2400,
    summary: "A hand-glazed stoneware cup and saucer sized for a cappuccino or a short pour-over.",
    description:
      "We wanted a cup that felt as good to hold as the coffee in it tastes, and found it at a small pottery that glazes every piece by hand. The cup holds 7 oz, the classic size for a cappuccino or a flat white, with walls thick enough to keep it warm and a lip thin enough to sip from comfortably. The cream glaze is crossed with a fine brown pattern and finished with a toasted rim, so no two sets look quite alike. The saucer has a shallow well that keeps the cup from sliding. Both pieces are dishwasher- and microwave-safe, and they stack neatly in a cupboard.",
    details: ["Capacity: 7 oz (200 ml)", "Material: Hand-glazed stoneware", "Includes: One cup and one saucer", "Dishwasher- and microwave-safe"],
    image: "cup-and-saucer",
    reviews: [
      review("2025-03-08", "Eleanor S.", 5, "Perfect cappuccino cup", "The size is just right, and the glaze is gorgeous in person."),
      review("2025-09-26", "Ty B.", 4, "Bought two", "Lovely, though one has a slightly darker rim than the other. Handmade, I suppose."),
      review("2026-02-19", "Rosa F.", 5, "Wrapped like treasure", "It arrived in so much paper I thought the box was empty. Not a scratch on it."),
      review("2026-08-11", "Jordan H.", 4, "Nice weight", "Feels substantial without being clunky. I'd buy a mug version.", false),
    ],
    stock: 34,
    tags: ["gear", "cup", "drinkware"],
  }),
  gear({
    sku: "QF-GEAR-MUG",
    slug: "enamel-camp-mug",
    name: "Enamel Camp Mug",
    collection: "brew-gear",
    priceCents: 1800,
    summary: "A glossy black enamel mug with a cream interior that's as happy on a campfire grate as on your desk.",
    description:
      "Enamelware has gone camping for a hundred years for good reason: it's light, it's tough and it doesn't mind a little heat. Our camp mug is steel coated in glossy black enamel, with a cream interior so you can see exactly how dark your coffee is. It holds 12 oz, a full cup from a pour-over with room for milk, and the rolled rim is comfortable to drink from. Set it at the cool edge of a campfire grate to keep your coffee warm, or use it every day at home. It will pick up a few honest chips over the years, which is part of its charm.",
    details: ["Capacity: 12 oz (350 ml)", "Material: Enamel-coated steel", "Color: Black with a cream interior", "Care: Hand wash; not for the microwave"],
    image: "camp-mug",
    reviews: [
      review("2025-05-24", "Gus T.", 5, "Camping essential", "Took it on a week of backpacking. Light, tough, and it keeps coffee warm longer than I expected."),
      review("2025-10-07", "Maren L.", 4, "Love it, chipped quickly", "Got a small chip on the rim after a month, but it's a camp mug, so I don't mind."),
      review("2026-04-13", "Phil N.", 4, "Great desk mug", "I use it at my desk every day. The handle gets warm with very hot coffee."),
      review("2026-09-27", "Amara E.", 5, "Matches my kettle", "Bought it with the copper kettle and they look great together."),
    ],
    stock: 38,
    tags: ["gear", "mug", "drinkware", "outdoors"],
  }),
];

export const QUILLFEATHER: StoreDef = {
  id: "quillfeather",
  orderPrefix: "QF",
  defaultSurface: "express-checkout",
  brand: {
    name: "Quillfeather Coffee",
    tagline: "Small-lot coffee, roasted to order and carefully noted.",
    heroImage: "img/quillfeather/home-hero.jpg",
    logoSvg: LOGO,
    announcement: "Free standard shipping on orders of $45 or more · Every bag roasted to order",
    supportEmail: "support@quillfeathercoffee.example",
    supportPhone: "+1 (253) 555-0148",
    fonts: {
      display: "'DM Serif Display', Georgia, serif",
      body: "'Work Sans', system-ui, sans-serif",
      href: "https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=Work+Sans:wght@400;500;600&display=swap",
    },
    tokens: { bg: "#F4EFE6", fg: "#2B201A", muted: "#7A6A5F", accent: "#B5532E", accentFg: "#FFF8F0", surface: "#FFFDF9", border: "#E4D8C8", radius: "14px" },
  },
  collections: [
    {
      slug: "single-origins",
      name: "Single Origins",
      blurb: "One place, one harvest, one way of processing: coffees roasted to taste exactly where they came from.",
      hero: img("single-origins-hero"),
    },
    {
      slug: "blends",
      name: "Blends",
      blurb: "Built for the cup you make every morning: balanced, forgiving and the same lovely way bag after bag.",
      hero: img("blends-hero"),
    },
    {
      slug: "decaf",
      name: "Decaf",
      blurb: "All of the flavor and none of the 3 a.m. ceiling-staring, decaffeinated without harsh solvents and roasted as carefully as everything else.",
      hero: img("decaf-hero"),
    },
    {
      slug: "brew-gear",
      name: "Brew Gear",
      blurb: "The kettle, dripper and grinder from our own tasting bench, and the cups we drink from.",
      hero: img("brew-gear-hero"),
    },
  ],
  products: [...singleOrigins, ...blends, ...decaf, ...brewGear],
  addOns: [
    {
      sku: "QF-ADD-TASTING-CARD",
      name: "Tasting notes card",
      priceCents: 300,
      description: "A letterpress card for each coffee in the box, with its origin, process, our tasting notes and a brew recipe.",
    },
    {
      sku: "QF-ADD-GIFT-BOX",
      name: "Gift box",
      priceCents: 800,
      description: "Your order packed in a kraft gift box with tissue and a handwritten note; prices never appear inside.",
    },
  ],
  shipping: [
    { id: "standard", label: "Standard shipping", priceCents: 650, days: [3, 5], freeOverCents: 4500 },
    { id: "priority", label: "Priority shipping", priceCents: 1200, days: [1, 2] },
  ],
  freeShippingOverCents: 4500,
  promoCodes: { WELCOME10: { pctBp: 1000 } },
  policies: QUILLFEATHER_POLICIES,
};
