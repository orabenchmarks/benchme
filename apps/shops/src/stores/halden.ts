import type { OptionGroup, Review, StoreDef } from "@benchme/storefront";
import { HALDEN_POLICIES } from "./copy/halden.js";

/**
 * Halden Audio: a direct-to-consumer audio brand. Headphones, earbuds and speakers come in colors
 * (some sold out), specs live in each product's details ("Active noise cancelling" is listed on
 * exactly the products tagged "anc"), checkout offers two shipping speeds and an optional
 * protection plan. Ids (SKUs, option values, add-ons, shipping methods, promo codes) are stable:
 * hidden scenarios name them.
 */

const img = (file: string) => `img/halden/${file}.jpg`;

/** The "color" option every colored product shares; a value marked sold out can't be added to the cart. */
function colors(...values: [id: string, label: string, soldOut?: boolean][]): OptionGroup {
  return { id: "color", name: "Color", values: values.map(([id, label, soldOut]) => (soldOut ? { id, label, soldOut } : { id, label })) };
}

function review(author: string, rating: Review["rating"], title: string, body: string, date: string, verified = true): Review {
  return { author, rating, title, body, date, verified };
}

/** The spec line on every product with active noise cancelling (and only on those, which are also tagged "anc"). */
const ANC = "Active noise cancelling";

const LOGO =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 190 32" width="190" height="32" role="img" aria-label="Halden Audio">' +
  // The mark: an H whose crossbar is one period of a sine wave, on the accent tile (radius as the brand's).
  '<rect width="32" height="32" rx="10" fill="#3B5BFD"/>' +
  '<path d="M10 8.5v15M22 8.5v15" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round"/>' +
  '<path d="M10 16c2-3.4 4-3.4 6 0s4 3.4 6 0" fill="none" stroke="#FFFFFF" stroke-width="2.4" stroke-linecap="round"/>' +
  '<text x="41" y="22.5" fill="#0E0F12" font-family="Space Grotesk, Inter, Helvetica, Arial, sans-serif" font-size="20" font-weight="700" letter-spacing="-0.4">' +
  'Halden<tspan dx="6" fill="#5A5F6B" font-weight="500">Audio</tspan></text>' +
  "</svg>";

export const HALDEN: StoreDef = {
  id: "halden",
  orderPrefix: "HA",
  defaultSurface: "checkout",
  brand: {
    name: "Halden Audio",
    tagline: "Tuned by ear. Proven on the bench.",
    heroImage: "img/halden/skerry-dj.jpg",
    logoSvg: LOGO,
    announcement: "Free standard shipping on orders of $75 or more · 45-day returns",
    supportEmail: "support@haldenaudio.example",
    supportPhone: "+1 (503) 555-0147",
    fonts: {
      display: "Space Grotesk",
      body: "Inter",
      href: "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&display=swap",
    },
    tokens: { bg: "#FFFFFF", fg: "#0E0F12", muted: "#5A5F6B", accent: "#3B5BFD", accentFg: "#FFFFFF", surface: "#F4F5F7", border: "#E3E5EA", radius: "10px" },
  },
  collections: [
    {
      slug: "headphones",
      name: "Headphones",
      blurb: "Over-ear and on-ear headphones, wireless and wired. Every pair is tuned to the same reference curve, and every over-ear pair has cushions you can replace in under a minute.",
      hero: img("drift-commute"),
    },
    {
      slug: "earbuds",
      name: "Earbuds",
      blurb: "True wireless and sport earbuds for commutes, workouts and long-haul flights, with the specs that matter listed on every page.",
      hero: img("squall-sport"),
    },
    {
      slug: "speakers",
      name: "Speakers",
      blurb: "Shower-proof minis, a speaker for the kitchen, and desktop and bookshelf pairs for the rooms you actually listen in.",
      hero: img("hero-speakers"),
    },
    {
      slug: "accessories",
      name: "Accessories",
      blurb: "Cases, cables and spare cushions that keep your Halden gear going for years.",
      hero: img("ear-cushions"),
    },
  ],
  products: [
    // Headphones
    {
      sku: "HA-HP-BREAKWATER",
      slug: "breakwater-wireless-headphones",
      name: "Breakwater Wireless Headphones",
      collection: "headphones",
      priceCents: 32900,
      summary: "Our flagship over-ear headphones, with active noise cancelling that quiets a cabin without the pressure-in-your-ears feeling.",
      description:
        "Breakwater is what we build when nothing is held back. Six microphones feed a hybrid noise-cancelling system that adjusts thousands of times a second, so engine drone and office chatter drop away while your music stays exactly as it was tuned. The 40 mm beryllium-coated drivers are matched in pairs to within 0.5 dB, and every pair is measured against our reference curve before it ships. Memory-foam cushions in protein leather clip on magnetically, the hinges are machined aluminum, and the battery lasts 40 hours with noise cancelling on. Ten minutes on USB-C gives you five more hours. Multipoint Bluetooth keeps your laptop and phone connected at once, and the included cable keeps the music going when the battery is flat.",
      details: [
        ANC,
        "Driver: 40 mm dynamic, beryllium-coated dome",
        "Battery: up to 40 hours with noise cancelling on, 55 hours off",
        "Weight: 268 g",
        "Bluetooth: 5.3, multipoint; SBC, AAC, LC3",
        "In the box: USB-C cable and 3.5 mm cable",
      ],
      images: [img("breakwater-black")],
      options: [colors(["black", "Black"], ["stone", "Stone"], ["midnight", "Midnight Blue"])],
      reviews: [
        review("Daniel K.", 5, "Finally quiet on the red-eye", "Wore these on a six-hour flight from Boston to Seattle and the engine noise basically disappeared. Battery went from 100% to 81% for the whole trip with noise cancelling on.", "2025-02-11"),
        review("Priya S.", 5, "Worth the price", "I returned two other pairs before these. The cancelling doesn't give me that ear-pressure headache, and the sound is clean without the bass being overdone.", "2025-04-03"),
        review("Marcus T.", 4, "Great sound, warm ears", "Fantastic detail, and switching between my work laptop and my phone just works. After about three hours my ears get warm in summer, which is the only reason for four stars.", "2025-07-19"),
        review("Hannah L.", 4, "Excellent, case sold separately", "Sound and cancelling are excellent. I was surprised a $329 pair doesn't come with a case, so I added the soft case to my order. Arrived in two days with express.", "2025-10-28"),
        review("Owen R.", 5, "Magnetic cushions are genius", "The dog chewed one cushion. I ordered a replacement pair and snapped it on in about ten seconds. Everything else is as good as the day it arrived, a year on.", "2026-03-14"),
        review("Lucía M.", 3, "Clamps a bit tight", "Sounds lovely and the noise cancelling is strong, but the clamp is tight on my head. It has loosened a little over a month. Support answered my email the same day, at least.", "2026-08-22"),
      ],
      badges: ["Bestseller"],
      stock: 24,
      tags: ["over-ear", "wireless", "anc", "bluetooth"],
    },
    {
      sku: "HA-HP-DRIFT",
      slug: "drift-wireless-headphones",
      name: "Drift Wireless Headphones",
      collection: "headphones",
      priceCents: 11900,
      compareAtCents: 13900,
      summary: "Foldable wireless over-ear headphones with a 60-hour battery, built for commutes and long weeks between charges.",
      description:
        "Drift is the pair we'd hand to anyone who just wants good wireless headphones. It folds flat into a bag, weighs 210 grams and runs for 60 hours on a charge, so most people top it up every other week. Drift skips active noise cancelling, which is how the battery lasts; deep closed-back cushions seal out the worst of a commute instead. The 40 mm drivers use the same tuning targets as Breakwater, so vocals sit forward and the bass stays tight instead of booming. Physical buttons on the right cup handle volume, tracks and calls without any tapping guesswork, and a 3.5 mm socket means a flat battery never ends the music.",
      details: [
        "Driver: 40 mm dynamic",
        "Battery: up to 60 hours",
        "Weight: 210 g",
        "Bluetooth: 5.3; SBC, AAC",
        "Folds flat; 3.5 mm cable included for wired listening",
      ],
      images: [img("drift-black"), img("drift-front"), img("drift-commute")],
      options: [colors(["black", "Black"], ["white", "Chalk White"], ["coral", "Coral", true])],
      reviews: [
        review("Ben C.", 5, "60 hours is real", "Charged it on a Sunday, used it on my commute every day plus work calls, and it was at 30% the next Sunday. The buttons are easy to find without looking.", "2025-03-09"),
        review("Aisha B.", 4, "Great value", "Clear, punchy sound for the money, and they fold small enough for my tote. They don't block much noise on the subway, but I knew that going in.", "2025-05-27"),
        review("Tyler B.", 4, "Comfortable with glasses", "I wear glasses all day and these don't press the arms into my head. Wish a case came in the box.", "2025-09-04"),
        review("Megan F.", 3, "Fine, a bit plain", "Does the job and the battery is great. The sound is a little flat with acoustic music compared to my old pair, and the headband creaks when I turn my head.", "2025-12-15"),
        review("Jordan A.", 5, "Bought a second pair", "One for me and one for my son for school. Shipping was free and they arrived in three days, packed in a box with zero plastic.", "2026-02-21"),
      ],
      stock: 31,
      tags: ["over-ear", "wireless", "bluetooth"],
    },
    {
      sku: "HA-HP-KEEL",
      slug: "keel-studio-headphones",
      name: "Keel Studio Headphones",
      collection: "headphones",
      priceCents: 15900,
      summary: "Closed-back studio monitors with a flat, revealing tuning for tracking, mixing and long editing sessions.",
      description:
        "Keel is a wired, closed-back monitor for people who make things with sound. The tuning is deliberately flat from 40 Hz to 10 kHz, so a muddy low end or a harsh vocal is your mix, not our coloring. Its 45 mm drivers handle the sustained levels of a tracking session without compressing, and the closed cups keep the click track from bleeding into the vocal mic. The headband and cushions are the parts that wear out in studios, so both come off with a twist and are sold separately. A coiled 3 m cable and a straight 1.2 m cable are included, each locking into the left cup. At 38 ohms, Keel runs happily from a laptop or an audio interface.",
      details: [
        "Driver: 45 mm dynamic, 38 Ω",
        "Frequency response: 8 Hz to 28 kHz",
        "Connection: detachable locking cable; 3 m coiled and 1.2 m straight included",
        "Weight: 295 g",
        "Closed-back, with cups that rotate for one-ear monitoring",
      ],
      images: [img("keel-studio")],
      options: [],
      reviews: [
        review("Elena S.", 5, "Honest monitors", "I mix podcasts and these tell me exactly where the problems are. No hyped bass, no sizzle. The coiled cable reaches my interface across the desk.", "2025-02-26"),
        review("Raj P.", 4, "Great for tracking", "Isolation is excellent: no click bleed into the vocal mic even at loud levels. The pads get warm after a long session.", "2025-06-18"),
        review("Chris W.", 5, "Replaced my old studio pair", "Flat and detailed, and I like that the pads and headband come off. I expect to keep these for a decade.", "2025-11-02"),
        review("Nora E.", 3, "Too flat for casual listening", "Very accurate, which is what they're for, but for everyday music I find them a bit dry. Beautifully built.", "2026-04-10"),
      ],
      stock: 18,
      tags: ["over-ear", "wired", "studio"],
    },
    {
      sku: "HA-HP-SKERRY",
      slug: "skerry-dj-headphones",
      name: "Skerry DJ Headphones",
      collection: "headphones",
      priceCents: 13900,
      summary: "Wired DJ headphones with swiveling cups, a braided coiled cable and enough headroom for a loud booth.",
      description:
        "Skerry was built for the booth: loud monitors, cramped decks and a cue that has to cut through. The 50 mm drivers are tuned with a slight lift in the bass and upper mids, so a kick drum and a vocal stay distinct at high volume. Each cup swivels 90 degrees for one-ear cueing, and the spring-steel headband is wrapped in a stitched pad that survives being thrown in a record bag. The braided coiled cable stretches to 3 m and locks in with a bayonet connector, so a stray elbow won't pull it out mid-set. The cushions are protein leather over memory foam, and they come off for replacement.",
      details: [
        "Driver: 50 mm dynamic, 32 Ω",
        "Connection: detachable 3 m braided coiled cable with bayonet lock",
        "Weight: 310 g",
        "Cups swivel 90° for one-ear monitoring",
      ],
      images: [img("skerry-dj")],
      options: [],
      reviews: [
        review("Malik J.", 5, "Survives the booth", "Played three weekends in a row with these. Loud enough to cue over big monitors, and the bayonet cable never pulled out once.", "2025-04-12"),
        review("Sofia D.", 4, "Solid build", "Heavy, but it feels indestructible. The swivel is smooth and the bass is punchy without getting muddy.", "2025-08-07"),
        review("Kenji W.", 3, "Heavy for long sets", "Great sound and isolation, but at 310 grams my neck noticed after four hours. Packaging was nice and minimal.", "2026-01-23"),
        review("Andre P.", 5, "Love the coiled cable", "The braided coil is the best part. It stays out of the way on the decks and doesn't tangle in my bag.", "2026-06-30"),
      ],
      stock: 4,
      tags: ["over-ear", "wired", "dj"],
    },
    {
      sku: "HA-HP-FELL",
      slug: "fell-on-ear-headphones",
      name: "Fell On-Ear Headphones",
      collection: "headphones",
      priceCents: 6900,
      summary: "Featherweight wired on-ear headphones that fold into a jacket pocket, with a one-button remote and mic.",
      description:
        "Fell weighs 98 grams, folds into a jacket pocket and asks nothing of you: no charging, no pairing, no setup. Plug it into a laptop, a phone with a headphone socket or a seat-back screen and it simply plays. The 30 mm drivers are tuned warmer than our studio models, which flatters podcasts and acoustic records on a long walk. The single-button remote answers calls and skips tracks, and the microphone sits on the cable close to your mouth, so your voice doesn't sound like it's coming from a cave. Soft cushions rest on the ear rather than around it, so there's no pressure on glasses.",
      details: [
        "Driver: 30 mm dynamic, 32 Ω",
        "Connection: 1.2 m cable with 3.5 mm plug, one-button remote and mic",
        "Weight: 98 g",
        "Folds flat for a pocket",
      ],
      images: [img("fell-graphite")],
      options: [colors(["graphite", "Graphite"], ["sand", "Sand"])],
      reviews: [
        review("Grace N.", 4, "Perfect walking headphones", "Light enough that I forget I'm wearing them. Warm sound for podcasts, and the mic is clear on calls.", "2025-05-15"),
        review("Liam K.", 5, "No charging is a feature", "I'm tired of charging everything. These just work with my laptop and the screen on the plane.", "2025-09-29"),
        review("Isabel C.", 5, "Folds tiny", "Fits in my coat pocket folded and works with glasses. Shipping took four days, which matched the estimate.", "2026-02-02"),
        review("Henry W.", 3, "Leaks some sound", "Nice and light, but people next to me on the train can hear what I'm playing at higher volume. On-ear design, I guess.", "2026-07-11"),
      ],
      stock: 5,
      tags: ["on-ear", "wired"],
    },
    {
      sku: "HA-HP-EBB",
      slug: "ebb-kids-headphones",
      name: "Ebb Kids Headphones",
      collection: "headphones",
      priceCents: 3900,
      summary: "Volume-limited wired headphones for kids, in soft colors with a bendable headband that survives backpacks.",
      description:
        "Ebb caps volume at 85 decibels, the level hearing specialists recommend for children, so you don't have to police the volume from the front seat. The headband bends and flexes rather than snapping, the cushions wipe clean, and the 1.2 m cable has a built-in splitter so a second pair can share the same tablet on a long trip. Under the bright colors are proper 32 mm drivers tuned for clear voices, because audiobooks and cartoons are mostly dialogue. It weighs 90 grams, and there's nothing to charge. For ages 3 and up.",
      details: [
        "Volume limited to 85 dB",
        "Driver: 32 mm dynamic",
        "Connection: 1.2 m cable with 3.5 mm plug and built-in splitter",
        "Weight: 90 g",
      ],
      images: [img("ebb-seafoam")],
      options: [colors(["seafoam", "Seafoam"], ["blush", "Blush"], ["sky", "Sky Blue"])],
      reviews: [
        review("Rachel P.", 5, "Finally, quiet car rides", "Two kids, two pairs, one tablet thanks to the splitter. The volume limit means I'm not worrying about their ears.", "2025-03-30"),
        review("Diego F.", 5, "Survived a four-year-old", "Has been bent, sat on and dropped down the stairs, and still works. The cushions wipe clean, which matters.", "2025-07-02"),
        review("Mei L.", 5, "My daughter picked Blush", "She loves the color, and they're comfortable on her small head. Arrived nicely gift wrapped for her birthday.", "2025-11-19"),
        review("Sam O.", 4, "Good, long cable", "Clear sound for audiobooks. The cable is a bit long for a car seat, so we loop it.", "2026-01-08"),
        review("Victor G.", 2, "Too quiet on planes", "The 85 dB limit is great at home, but on a loud flight my son could barely hear his show. Fine for the car.", "2026-05-17", false),
      ],
      stock: 27,
      tags: ["on-ear", "wired", "kids"],
    },
    // Earbuds
    {
      sku: "HA-EB-SHOAL-LITE",
      slug: "shoal-lite-earbuds",
      name: "Shoal Lite Earbuds",
      collection: "earbuds",
      priceCents: 4900,
      summary: "Our lightest true wireless earbuds, with the Shoal shell and drivers and seven hours of playback per charge.",
      description:
        "Shoal Lite shares its shell and 10 mm drivers with Shoal and keeps the parts most people use every day: a secure fit, clear calls and seven hours of playback per charge. The case adds three more charges for 28 hours in total, and ten minutes in the case buys an hour of listening. Three sizes of silicone tips come in the box, and the stems carry simple press controls instead of touch panels, so adjusting a bud never pauses your podcast. Sweat and rain resistance is rated IPX4. If you want a capable pair to keep in a gym bag without worrying about it, this is the one.",
      details: [
        "Passive noise isolation",
        "Driver: 10 mm dynamic",
        "Battery: 7 hours, 28 hours with case",
        "Weight: 4.6 g per earbud",
        "Bluetooth: 5.3; SBC, AAC",
        "Water resistance: IPX4",
      ],
      images: [img("shoal-black")],
      options: [colors(["black", "Black"], ["white", "White"])],
      reviews: [
        review("Chloe R.", 4, "Great gym buds", "Secure fit with the medium tips, and I don't panic when they get sweaty. Seven hours is plenty for me.", "2026-04-06"),
        review("Ethan V.", 4, "Solid for the price", "Clear sound, and the press buttons beat touch controls. They don't block the bus much, so I turn the volume up more than I'd like.", "2026-05-01"),
        review("Fatima Z.", 2, "Case lid is loose", "The earbuds are fine, but the case lid wobbles and the right bud doesn't always start charging unless I press it down. Calls are poor in wind.", "2026-06-12"),
        review("Noah D.", 5, "Exactly what I needed", "Cheap enough to lose, good enough to enjoy. Paired instantly with my phone. The package arrived a day early.", "2026-07-20"),
        review("Ava L.", 4, "Comfortable for hours", "Small and light. I'd want something quieter for flights, but for walking around town they're great.", "2026-09-03"),
      ],
      stock: 36,
      tags: ["true-wireless", "wireless", "bluetooth"],
    },
    {
      sku: "HA-EB-SHOAL",
      slug: "shoal-earbuds",
      name: "Shoal Earbuds",
      collection: "earbuds",
      priceCents: 8900,
      summary: "Compact true wireless earbuds with active noise cancelling, six hours of battery and a pocket-sized case.",
      description:
        "Shoal puts active noise cancelling in a shell small enough to sleep in. Two microphones per earbud sample the room and cancel the low rumble of buses, fans and air conditioning, while a transparency mode lets station announcements through when you need them. The 10 mm drivers are tuned to the same curve as our headphones, with a little extra warmth so quiet listening never sounds thin. Battery life is six hours with noise cancelling on and 24 with the case. Calls use beamforming microphones that hold onto your voice on a windy street. Shoal shares its shell with Shoal Lite, so the fit is identical.",
      details: [
        ANC,
        "Driver: 10 mm dynamic",
        "Battery: 6 hours with noise cancelling, 24 hours with case",
        "Weight: 4.8 g per earbud",
        "Bluetooth: 5.3, multipoint; SBC, AAC",
        "Water resistance: IPX4",
      ],
      images: [img("shoal-black")],
      options: [colors(["black", "Black"], ["white", "White"], ["slate", "Slate"])],
      reviews: [
        review("Lucas B.", 5, "Cancelling at this price is wild", "Took them on the subway and the rumble just drops away. Not as strong as big headphones, but far better than I expected for $89.", "2026-04-02"),
        review("Imani T.", 4, "Tiny and comfortable", "I can sleep on my side with these in. Transparency mode is handy at the office.", "2026-04-28"),
        review("Caleb W.", 4, "Good all-rounder", "Balanced sound, and the case fits in the coin pocket of my jeans. Battery is about six hours with cancelling on, as advertised.", "2026-05-19"),
        review("Zoe M.", 5, "Upgraded from the Lite", "Same fit as Shoal Lite, but now the air-conditioning hum at work disappears. Worth the extra.", "2026-06-25"),
        review("Yuki S.", 3, "Calls could be better", "Music and cancelling are great. Outside, people say I sound far away on calls.", "2026-08-09"),
        review("Harriet H.", 4, "Slate is gorgeous", "The slate color looks more expensive than it is, and the fit is great with the small tips.", "2026-09-14"),
      ],
      badges: ["New"],
      stock: 22,
      tags: ["true-wireless", "wireless", "anc", "bluetooth"],
    },
    {
      sku: "HA-EB-SQUALL",
      slug: "squall-sport-earbuds",
      name: "Squall Sport Earbuds",
      collection: "earbuds",
      priceCents: 9900,
      summary: "Sweatproof neckband earbuds for running and the gym, with a magnetic clasp so they never hit the floor.",
      description:
        "Squall joins the earbuds with a flexible cord that rests on the back of your neck, which means nothing falls out mid-stride and nothing gets left behind on a gym bench. Magnets in the housings clasp together when you drop them around your neck and pause the music; pull them apart and it plays. The polished housings sit flush in the ear with wing tips in three sizes, and the whole assembly is rated IPX7, so sweat and a rinse under the tap are fine. Twelve hours of battery covers a week of training, and the 11 mm drivers bring enough low end to keep a running pace honest.",
      details: [
        "Driver: 11 mm dynamic",
        "Battery: 12 hours",
        "Weight: 27 g including the neckband",
        "Bluetooth: 5.3; SBC, AAC",
        "Water resistance: IPX7",
        "Magnetic clasp pauses playback",
      ],
      images: [img("squall-sport")],
      options: [colors(["black", "Black"], ["volt", "Volt"])],
      reviews: [
        review("Tom H.", 4, "Never fall out", "Ran a half marathon in these. The magnetic clasp is great for coffee stops: snap them together and the music pauses.", "2025-04-21"),
        review("Leah G.", 5, "Can't lose them", "I've lost three pairs of true wireless buds at the gym. With the neckband that isn't happening. Rinsed them after a sweaty class, no problem.", "2025-08-16"),
        review("Andrew M.", 3, "Punchy bass, bouncy cord", "Good energy for workouts, but the cord taps my neck on fast runs and it gets annoying after a few miles.", "2025-12-03"),
        review("Kayla J.", 3, "Battery shorter than I hoped", "I get around ten hours rather than twelve at high volume. Fit and build are excellent.", "2026-06-04"),
      ],
      stock: 19,
      tags: ["neckband", "wireless", "sport", "bluetooth"],
    },
    {
      sku: "HA-EB-LULL",
      slug: "lull-earbuds",
      name: "Lull Earbuds",
      collection: "earbuds",
      priceCents: 14900,
      summary: "Soft-fit noise-cancelling earbuds tuned for long, low-volume listening, with eight hours per charge.",
      description:
        "Lull is designed for the hours you don't notice passing: a flight, an afternoon of deep work, a night shift. The rounded shell sits inside the ear instead of hanging from it, and foam-lined tips spread the pressure so they stay comfortable past the fourth hour. Hybrid active noise cancelling uses three microphones per side to take out engine drone and the hum of an open office, and an adaptive mode eases off somewhere quiet to save battery. You get eight hours per charge, 32 with the case, and the case charges on any Qi pad. A low-volume EQ keeps detail intact when you listen quietly, which is how most of us listen most of the time.",
      details: [
        ANC,
        "Driver: 11 mm dynamic",
        "Battery: 8 hours with noise cancelling, 32 hours with case",
        "Weight: 5.4 g per earbud",
        "Bluetooth: 5.3, multipoint; SBC, AAC, LC3",
        "Wireless charging case",
      ],
      images: [img("lull-earbuds-pearl")],
      options: [colors(["pearl", "Pearl"], ["black", "Black"], ["sage", "Sage", true])],
      reviews: [
        review("Megan R.", 5, "A whole transatlantic flight", "Eight hours on one charge with cancelling on, and my ears didn't ache. The foam tips are the secret.", "2025-03-18"),
        review("Jonah W.", 5, "Best for working in cafes", "Takes the clatter and chatter down to a whisper. Detail at low volume is excellent, which is how I listen all day.", "2025-06-02"),
        review("Priya N.", 4, "Comfortable, chunky case", "The most comfortable earbuds I've owned. The case is a little big for small pockets.", "2025-09-10"),
        review("Grace H.", 4, "Wireless charging is handy", "I drop the case on my desk charger and forget about it. Stays connected to my laptop and phone at the same time.", "2025-12-21"),
        review("Robert F.", 3, "Good cancelling, not the best", "Comfortable and good sound, but on a plane they let through more engine noise than my over-ears. Great in the office.", "2026-03-07"),
        review("Sara K.", 5, "A gift that landed", "Bought them for my partner with gift wrap. They arrived beautifully wrapped with no price on the slip, and she uses them every day.", "2026-08-30"),
      ],
      stock: 14,
      tags: ["true-wireless", "wireless", "anc", "bluetooth"],
    },
    {
      sku: "HA-EB-BREAKWATER",
      slug: "breakwater-earbuds",
      name: "Breakwater Earbuds",
      collection: "earbuds",
      priceCents: 22900,
      summary: "Our best earbuds, with the strongest noise cancelling we make, nine hours of battery and a wireless charging case.",
      description:
        "Breakwater Earbuds carry the flagship's priorities into a 5.9-gram shell. Each earbud runs its own noise-cancelling processor fed by three microphones, so the cancelling adapts to the shape of your ear canal and stays strong when you turn your head. A 10 mm driver paired with a balanced-armature tweeter separates the detail that single-driver earbuds smear together: the breath before a vocal line, the decay of a cymbal. Battery life is nine hours with cancelling on and 36 with the case, which charges on a Qi pad or over USB-C. The tips are memory foam with a silicone core, in four sizes, and the fit test in the quick-start guide tells you which seal is right.",
      details: [
        ANC,
        "Driver: 10 mm dynamic plus balanced-armature tweeter",
        "Battery: 9 hours with noise cancelling, 36 hours with case",
        "Weight: 5.9 g per earbud",
        "Bluetooth: 5.4, multipoint; SBC, AAC, LC3",
        "Water resistance: IPX5",
      ],
      images: [img("breakwater-earbuds-red")],
      options: [colors(["red", "Signal Red"], ["black", "Black"], ["pearl", "Pearl"])],
      reviews: [
        review("Kevin L.", 5, "The quietest earbuds I've tried", "I compared them in the same week against two other flagship pairs, and these cancelled the most. The tweeter makes cymbals sound real.", "2025-11-24"),
        review("Natalie C.", 4, "Excellent once the fit is right", "It took me three tip sizes to get the seal right. Once I did, the bass and the cancelling were outstanding.", "2026-01-15"),
        review("Arjun S.", 5, "Red is a statement", "Signal Red looks fantastic and gets comments, and the battery really does last nine hours.", "2026-02-27"),
        review("Paula G.", 4, "Great but pricey", "The best sound I've had from earbuds. $229 is a lot, so I added Halden Care and don't worry about carrying them everywhere.", "2026-04-19"),
        review("Greg T.", 2, "Left earbud died", "The left earbud stopped charging after five weeks. Support replaced it under warranty within a week, so the service is great, but it shouldn't have happened.", "2026-06-08"),
        review("Hana Y.", 5, "Worth it for commuting", "Two hours on the train every day, and these make it bearable. The wireless charging case is a nice touch.", "2026-09-19"),
      ],
      stock: 17,
      tags: ["true-wireless", "wireless", "anc", "bluetooth"],
    },
    // Speakers
    {
      sku: "HA-SP-BUOY",
      slug: "buoy-shower-speaker",
      name: "Buoy Shower Speaker",
      collection: "speakers",
      priceCents: 3900,
      summary: "A waterproof mini speaker with a suction cup, made for showers, poolsides and the deck of a kayak.",
      description:
        "Buoy is a palm-sized speaker that sticks to tile, glass or a cooler lid and plays through the spray. The silicone body is rated IPX7, and it floats if it rolls into the pool. Its 40 mm full-range driver is tuned for voices first, so podcasts and the morning news stay clear over running water, and music has enough body for a shower playlist. The big rubber buttons work with wet hands, including one to answer a call. Ten hours of playback covers a couple of weeks of showers, and it charges over USB-C behind a sealed flap.",
      details: ["Driver: 40 mm full-range", "Battery: 10 hours", "Weight: 180 g", "Bluetooth: 5.3", "Water resistance: IPX7; floats", "Suction-cup mount"],
      images: [img("buoy-coral"), img("buoy-lagoon")],
      options: [colors(["coral", "Coral"], ["lagoon", "Lagoon Blue"], ["graphite", "Graphite", true])],
      reviews: [
        review("Emily D.", 5, "Shower podcasts", "Sticks to the tile and stays put. Voices are very clear even with the water running.", "2025-02-08"),
        review("Marco B.", 5, "Took it kayaking", "It fell in the lake and floated. Still works, and ten hours lasts us a whole weekend.", "2025-07-26"),
        review("Janet S.", 3, "Suction lets go", "Fine sound for the size, but the suction cup lets go after a day on textured tile. Works on glass.", "2025-10-14"),
        review("Will P.", 4, "Great little gift", "Bought three as stocking stuffers. Coral and Lagoon Blue look great, and they arrived fast.", "2025-12-12"),
        review("Ruth A.", 4, "Loud enough", "Not a party speaker, but plenty for the bathroom. The buttons work with wet hands.", "2026-05-03"),
      ],
      stock: 33,
      tags: ["portable", "waterproof", "bluetooth"],
    },
    {
      sku: "HA-SP-BEACON",
      slug: "beacon-portable-speaker",
      name: "Beacon Portable Speaker",
      collection: "speakers",
      priceCents: 7900,
      summary: "A compact Bluetooth speaker with stereo drivers and a 14-hour battery that sounds bigger than it looks.",
      description:
        "Beacon is the size of a paperback and the speaker we reach for in the kitchen, at the office and on a weekend away. Two 45 mm drivers and a passive radiator give it real stereo separation and a low end that doesn't collapse when you turn it up. The perforated steel grille wraps an aluminum frame, and a small blue light tells you it's paired without lighting up the room. You get fourteen hours of battery, USB-C charging and a built-in microphone for speakerphone calls. Pair two Beacons and they play as a left and right stereo pair.",
      details: ["Drivers: 2 × 45 mm plus passive radiator", "Battery: 14 hours", "Weight: 390 g", "Bluetooth: 5.3; pair two for stereo", "Speakerphone microphone"],
      images: [img("beacon-black")],
      options: [colors(["black", "Black"], ["stone", "Stone"])],
      reviews: [
        review("Daniel R.", 4, "Kitchen essential", "Plays all evening while I cook, and the battery lasts most of the week.", "2025-03-22"),
        review("Amira K.", 4, "Bigger sound than expected", "For something the size of a paperback the stereo is impressive. The bass thins out a little at full volume.", "2025-06-30"),
        review("Josh M.", 5, "Bought two for stereo", "Paired two as left and right in the living room and it's a proper little system. Setup took a minute.", "2025-11-08"),
        review("Laura V.", 3, "Light too bright at night", "Sounds good, but the pairing light is visible in a dark bedroom. I put tape over it.", "2026-02-14"),
        review("Peter N.", 4, "Solid build", "Feels dense and well made, and the speakerphone works well for calls.", "2026-07-29"),
      ],
      stock: 21,
      tags: ["portable", "bluetooth"],
    },
    {
      sku: "HA-SP-COVE",
      slug: "cove-desktop-speakers",
      name: "Cove Desktop Speakers",
      collection: "speakers",
      priceCents: 12900,
      summary: "A pair of powered desktop speakers on angled stands that aim the sound at your ears instead of your keyboard.",
      description:
        "Most desk speakers fire straight across the desk and into your keyboard. Cove sets each 50 mm driver in a cube tilted 30 degrees on its stand, so the sound reaches your ears at seated height and the stereo image opens up across your monitor. A small amplifier in the right speaker drives both, fed by USB-C audio from a laptop, a 3.5 mm input or Bluetooth from your phone. A volume ring and a quiet power switch sit on top, and the gloss shells wipe clean. They're small enough for a dorm desk and good enough to retire your laptop speakers for good.",
      details: ["Drivers: 2 × 50 mm full-range", "Power: 2 × 10 W", "Inputs: USB-C audio, 3.5 mm, Bluetooth 5.3", "Weight: 1.1 kg per pair", "Size: 11 cm cubes on 30° stands"],
      images: [img("cove-white")],
      options: [colors(["white", "White"], ["black", "Black"])],
      reviews: [
        review("Sophie T.", 5, "Huge upgrade from laptop speakers", "The angled stands really help: the sound comes to my ears instead of the desk. Took five minutes to set up.", "2025-05-06"),
        review("Brian K.", 5, "They look fantastic", "The white gloss looks great next to my monitor, and the USB-C connection is clean. Clear and surprisingly full.", "2025-09-17"),
        review("Aiko M.", 4, "Great for a small desk", "Small footprint and a good stereo image. Bass is limited, but that's expected at this size.", "2026-01-29"),
        review("Derek S.", 3, "Bluetooth lag in games", "Fine for music and video, but there's noticeable lag over Bluetooth in games. Over USB-C it's perfect.", "2026-06-21"),
      ],
      stock: 12,
      tags: ["desktop", "bluetooth"],
    },
    {
      sku: "HA-SP-MOORING",
      slug: "mooring-bookshelf-speakers",
      name: "Mooring Bookshelf Speakers",
      collection: "speakers",
      priceCents: 44900,
      summary: "Powered bookshelf speakers with woven aramid woofers, built for vinyl, TV and everything streamed in between.",
      description:
        "Mooring is a pair of powered bookshelf speakers for a living room, built around a 130 mm woofer woven from aramid fiber. The weave is stiff and light, so bass notes start and stop on time instead of blurring, and the soft-dome tweeter above it stays smooth even when a record is a little bright. Each speaker has its own 50-watt amplifier, and the inputs cover a room's worth of sources: HDMI ARC for the TV, a phono stage for a turntable, optical, 3.5 mm analog and Bluetooth. The cabinets are braced MDF in real wood veneer, and the magnetic grilles come off for a cleaner look. Sold as a pair.",
      details: [
        "Drivers: 130 mm aramid woofer and 25 mm soft-dome tweeter per speaker",
        "Power: 2 × 50 W",
        "Inputs: HDMI ARC, phono, optical, 3.5 mm analog, Bluetooth 5.3",
        "Weight: 6.2 kg per speaker",
        "Real wood veneer with magnetic grilles",
      ],
      images: [img("mooring-woofer")],
      options: [{ id: "finish", name: "Finish", values: [{ id: "walnut", label: "Walnut" }, { id: "black-ash", label: "Black Ash" }] }],
      reviews: [
        review("Thomas G.", 5, "Turntable heaven", "Plugged my turntable straight into the phono input, and the records sound fantastic. The walnut veneer is beautiful.", "2026-02-10"),
        review("Linda C.", 4, "Great TV speakers too", "HDMI ARC works with our TV remote and dialogue is much clearer than the TV's speakers. Heavy box, so plan for that on delivery day.", "2026-03-28"),
        review("Jamal W.", 5, "Tight bass, not boomy", "In a medium living room these fill the space without boom. The aramid woofers really are quick.", "2026-05-24"),
        review("Erin B.", 4, "Impressive packaging", "Double-boxed with molded inserts, and everything arrived perfect. It took a while to find the right spot away from the wall.", "2026-08-13"),
      ],
      badges: ["New"],
      stock: 3,
      tags: ["bookshelf", "powered", "bluetooth"],
    },
    // Accessories
    {
      sku: "HA-AC-CASE",
      slug: "soft-carry-case",
      name: "Soft Carry Case",
      collection: "accessories",
      priceCents: 2900,
      summary: "A padded microsuede carry case with a drawstring, sized for our folding wireless headphones.",
      description:
        "A soft case for the days a hard shell is too much. The outer is a dense gray microsuede that won't scratch aluminum or snag in a bag, lined with 3 mm of closed-cell padding, and a braided drawstring cinches it shut. It fits Breakwater and Drift wireless headphones with the ear cups turned flat, with room for their cables in the bottom, and Fell slips in folded with space to spare. Keel and Skerry studio headphones are too deep for it to close. Hand wash cold and air dry.",
      details: ["Fits Breakwater and Drift (cups turned flat) and Fell", "Microsuede outer with 3 mm padding", "Braided drawstring", "Size: 26 × 22 cm"],
      images: [img("carry-case"), img("carry-case-flat")],
      options: [],
      reviews: [
        review("Simon F.", 3, "Wanted a hard case", "Nice material, but it's a pouch. Fine in a bag; I wouldn't trust it in checked luggage.", "2025-10-03"),
        review("Hannah L.", 4, "Fits my Breakwaters", "Breakwater fits with the cups turned flat and the cable underneath. Soft and protective enough for a backpack.", "2025-11-06"),
        review("Ana R.", 5, "Perfect for Drift", "Drift slides right in, and the drawstring is easy to close with one hand.", "2026-01-19"),
        review("Michael O.", 4, "Good quality", "The padding is thicker than it looks in the photos. It shows lint a little.", "2026-07-05"),
      ],
      stock: 29,
      tags: ["case", "travel"],
    },
    {
      sku: "HA-AC-CABLE-35",
      slug: "audio-cable-3-5mm",
      name: "3.5 mm Audio Cable",
      collection: "accessories",
      priceCents: 1495,
      summary: "A replacement 3.5 mm headphone cable with molded strain reliefs and a ferrite choke against interference.",
      description:
        "The cable is the part of a pair of headphones most likely to fail, usually at the plug. Ours uses oxygen-free copper conductors, a slim but tough jacket and molded strain reliefs that flex instead of cracking where the cable meets the plug. A ferrite choke near one end suppresses the buzz that phones and laptop chargers can induce in a long run. It's a straight 3.5 mm to 3.5 mm cable with gold-plated plugs, so it works with Breakwater, Drift and most other headphones with a 3.5 mm socket, as well as the inputs on Cove and Mooring. Choose 1.2 m for a phone or 3 m to reach across a room.",
      details: ["Plugs: 3.5 mm TRS, gold-plated", "Conductors: oxygen-free copper", "Ferrite choke against interference", "Lengths: 1.2 m or 3 m"],
      images: [img("audio-cable")],
      options: [{ id: "length", name: "Length", values: [{ id: "1-2m", label: "1.2 m" }, { id: "3m", label: "3 m", priceDeltaCents: 500 }] }],
      reviews: [
        review("Ian F.", 4, "Does what it should", "Replaced the cable my cat chewed. Works perfectly with my Drift.", "2025-08-22"),
        review("Beth W.", 5, "No more buzz", "My old cable picked up a buzz from the laptop charger. This one is silent.", "2026-02-06"),
        review("Oscar L.", 3, "Chunky plug", "Works, but the plug body is a bit wide for my phone case. I got the 3 m one for my desk.", "2026-06-16"),
      ],
      stock: 40,
      tags: ["cable"],
    },
    {
      sku: "HA-AC-CUSHIONS",
      slug: "replacement-ear-cushions",
      name: "Replacement Ear Cushions",
      collection: "accessories",
      priceCents: 3900,
      summary: "A fresh pair of memory-foam ear cushions for Breakwater, Drift, Keel or Skerry that fits in under a minute.",
      description:
        "Ear cushions are the first thing to wear out on headphones you actually use, and a tired pair changes both the comfort and the sound: as the foam compresses, bass leaks out and the seal goes. Every Halden over-ear model has cushions that come off without tools, and these are the same parts we fit at the factory: slow-recovery memory foam wrapped in protein leather, with the acoustic mesh already attached. Choose your model; each pack contains a left and a right cushion. Most people replace them every 18 to 24 months.",
      details: ["Memory foam in protein leather", "Sold as a pair, left and right", "Tool-free fit", "Models: Breakwater, Drift, Keel, Skerry"],
      images: [img("ear-cushions")],
      options: [
        {
          id: "model",
          name: "Model",
          values: [
            { id: "breakwater", label: "Breakwater" },
            { id: "drift", label: "Drift" },
            { id: "keel", label: "Keel" },
            { id: "skerry", label: "Skerry" },
          ],
        },
      ],
      reviews: [
        review("Rachel M.", 5, "Like new again", "My Breakwater pads were flat after two years. These brought back the seal and the bass, and the swap took a minute.", "2025-04-25"),
        review("Kenny D.", 4, "Easy swap on Keel", "Twist off, twist on. Same feel as the originals.", "2025-09-08"),
        review("Alice J.", 5, "Fresh and comfy", "Ordered for Drift. Shipping was quick and the packaging was all paper.", "2026-03-11"),
        review("Frank T.", 3, "Pricey for pads", "The quality is excellent, but $39 for cushions feels steep.", "2026-08-01"),
      ],
      stock: 26,
      tags: ["cushions", "spares"],
    },
  ],
  addOns: [
    {
      sku: "HA-CARE-2Y",
      name: "Halden Care — 2-year protection",
      priceCents: 2999,
      description: "Two years of cover from delivery for every Halden product in this order: accidental damage, defects and battery wear, with up to two repairs or replacements per product.",
    },
    { sku: "HA-GIFT-WRAP", name: "Gift wrap", priceCents: 600, description: "Recycled kraft paper and a cotton ribbon, with prices left off the packing slip." },
  ],
  shipping: [
    { id: "standard", label: "Standard shipping", priceCents: 599, days: [3, 5], freeOverCents: 7500 },
    { id: "express", label: "Express shipping", priceCents: 1499, days: [1, 2] },
  ],
  freeShippingOverCents: 7500,
  promoCodes: {
    WELCOME10: { pctBp: 1000 },
    HALDEN20: { offCents: 2000, minSubtotalCents: 15000 },
  },
  policies: HALDEN_POLICIES,
};
