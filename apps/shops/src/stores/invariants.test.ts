import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Product, Review, StoreDef } from "@benchme/storefront";
import sharp from "sharp";
import { afterAll, describe, expect, it } from "vitest";
import { brandInvariantErrors, storeInvariantErrors, type ManifestEntry } from "./invariants.js";
import { PAYLANTERN_BRAND } from "./paylantern.js";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const entry = (file: string, license = "cc0"): ManifestEntry => ({
  file,
  source: `https://example.org/photos/${file}`,
  creator: "A. Photographer",
  license,
  title: `Photo ${file}`,
  provider: "fixture",
});
/** On disk: every photo but "ghost". In the manifest: every photo but "unlisted"; "c" is upper-case PDM, "by-licensed" is not CC0/PDM. */
const PHOTOS = ["a", "b", "c", "d", "e", "hero", "by-licensed", "unlisted"];
const MANIFEST = [entry("a"), entry("b"), entry("c", "PDM"), entry("d"), entry("e"), entry("hero"), entry("by-licensed", "by"), entry("ghost")];

/** A throwaway public/ holding the fixture photos under img/halden/ and, unless null, this manifest. */
function publicDir(manifest: unknown = MANIFEST): string {
  const root = mkdtempSync(join(tmpdir(), "shops-invariants-"));
  dirs.push(root);
  const img = join(root, "img", "halden");
  mkdirSync(img, { recursive: true });
  for (const f of PHOTOS) writeFileSync(join(img, `${f}.jpg`), "fixture bytes");
  if (manifest !== null) writeFileSync(join(img, "manifest.json"), typeof manifest === "string" ? manifest : JSON.stringify(manifest));
  return root;
}
const pub = publicDir();

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
const review = (rating: Review["rating"], date = "2025-06-01"): Review => ({ author: "Sam P.", rating, title: "Solid", body: "Does what it says.", date, verified: true });
const COLLECTIONS = ["alpha", "beta", "gamma"];

function product(i: number): Product {
  return {
    sku: `HA-FIXTURE-${i}`,
    slug: `fixture-${i}`,
    name: `Fixture ${i}`,
    collection: COLLECTIONS[i % 3]!,
    priceCents: 4999,
    summary: "A plain product that keeps the content contract.",
    description: words(80),
    details: ["Detail one", "Detail two", "Detail three"],
    images: ["img/halden/a.jpg"],
    options: [{ id: "colour", name: "Colour", values: [{ id: "black", label: "Black" }, { id: "sand", label: "Sand", priceDeltaCents: 1000 }] }],
    reviews: [review(5), review(4), review(4)],
    stock: i < 2 ? 3 : 20,
    tags: [],
  };
}

/** A fresh store that keeps every rule (and exercises the optional fields: compare-at, subscription, hero, add-on image). */
function good(): StoreDef {
  const products = Array.from({ length: 18 }, (_, i) => product(i));
  products[0]!.compareAtCents = 5999;
  products[0]!.images = ["img/halden/a.jpg", "img/halden/b.jpg"];
  products[0]!.subscription = { savePct: 15, intervals: ["2 weeks", "4 weeks"] };
  products[1]!.images = ["img/halden/c.jpg"];
  return {
    id: "halden",
    orderPrefix: "HA",
    defaultSurface: "checkout",
    brand: {
      name: "Halden Audio",
      tagline: "A fixture tagline.",
      logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>',
      announcement: "Free standard shipping on orders over $75",
      supportEmail: "help@fixture.example",
      supportPhone: "+1 (555) 010-0000",
      fonts: {
        display: "Space Grotesk",
        body: "'Inter', sans-serif",
        href: "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Inter:wght@400;600&display=swap",
      },
      tokens: { bg: "#FFFFFF", fg: "#111111", muted: "#666666", accent: "#333399", accentFg: "#FFFFFF", surface: "#F5F5F5", border: "#DDDDDD", radius: "6px" },
    },
    collections: [
      { slug: "alpha", name: "Alpha", blurb: "The first collection.", hero: "img/halden/hero.jpg" },
      { slug: "beta", name: "Beta", blurb: "The second collection." },
      { slug: "gamma", name: "Gamma", blurb: "The third collection." },
    ],
    products,
    addOns: [{ sku: "HA-FIXTURE-CARE", name: "Care plan", priceCents: 2999, description: "Two years of cover.", image: "img/halden/e.jpg" }],
    shipping: [
      { id: "standard", label: "Standard", priceCents: 599, days: [3, 5], freeOverCents: 7500 },
      { id: "express", label: "Express", priceCents: 1499, days: [1, 2] },
    ],
    freeShippingOverCents: 7500,
    promoCodes: { WELCOME10: { pctBp: 1000 }, SAVE20: { offCents: 2000, minSubtotalCents: 15000 } },
    policies: { shipping: "Text.", returns: "Text.", privacy: "Text.", terms: "Text.", faq: "Text.", about: "Text.", contact: "Text." },
  };
}

const p = (s: StoreDef, i = 0) => s.products[i]!;
const colour = (s: StoreDef) => p(s).options[0]!;

type Case = { name: string; mutate: (s: StoreDef) => void; error: RegExp };

/** Each mutation breaks exactly one rule, and the store then reports exactly that one violation. */
const cases: Case[] = [
  // identity
  { name: "another store's brand name", mutate: (s) => void (s.brand.name = "Wrenfield Flowers"), error: /^brand\.name is "Wrenfield Flowers" \(want "Halden Audio"\)$/ },
  { name: "another store's order prefix", mutate: (s) => void (s.orderPrefix = "WF"), error: /^orderPrefix is "WF" \(want "HA"\)$/ },
  { name: "another store's default surface", mutate: (s) => void (s.defaultSurface = "payment-element"), error: /^defaultSurface is "payment-element" \(want "checkout"\)$/ },
  // brand
  { name: "an empty tagline", mutate: (s) => void (s.brand.tagline = " "), error: /^brand\.tagline is empty$/ },
  { name: "a support email that is not one", mutate: (s) => void (s.brand.supportEmail = "help"), error: /^brand\.supportEmail "help" is not an email address$/ },
  { name: "a logo that is not inline SVG", mutate: (s) => void (s.brand.logoSvg = '<img src="logo.png">'), error: /^brand\.logoSvg is not an inline <svg>…<\/svg> without scripts$/ },
  { name: "a logo with a script", mutate: (s) => void (s.brand.logoSvg = "<svg><script>alert(1)</script></svg>"), error: /^brand\.logoSvg is not an inline/ },
  { name: "fonts not from Google Fonts over https", mutate: (s) => void (s.brand.fonts.href = "http://fonts.googleapis.com/css2?family=Inter"), error: /^brand\.fonts\.href "http:\/\/fonts\.googleapis\.com\/css2\?family=Inter" is not an https:\/\/fonts\.googleapis\.com URL$/ },
  { name: "a display font the stylesheet does not load", mutate: (s) => void (s.brand.fonts.display = "Fraunces"), error: /^brand\.fonts\.display "Fraunces" is not loaded by brand\.fonts\.href$/ },
  { name: "a colour token that is not a hex colour", mutate: (s) => void (s.brand.tokens.accent = "blue"), error: /^brand\.tokens\.accent "blue" is not a hex colour$/ },
  { name: "a radius that is not a CSS length", mutate: (s) => void (s.brand.tokens.radius = "round"), error: /^brand\.tokens\.radius "round" is not a CSS length$/ },
  // collections
  {
    name: "two collections",
    mutate: (s) => {
      s.collections.pop();
      for (const x of s.products) if (x.collection === "gamma") x.collection = "alpha";
    },
    error: /^2 collections \(want 3–5\)$/,
  },
  {
    name: "six collections",
    mutate: (s) => {
      for (const [i, slug] of ["delta", "epsilon", "zeta"].entries()) {
        s.collections.push({ slug, name: slug, blurb: "More." });
        p(s, 3 + i).collection = slug;
      }
    },
    error: /^6 collections \(want 3–5\)$/,
  },
  { name: "a duplicate collection slug", mutate: (s) => void s.collections.push({ slug: "alpha", name: "Alpha again", blurb: "Again." }), error: /^duplicate collection slug "alpha"$/ },
  {
    name: "a collection slug that is not a lowercase slug",
    mutate: (s) => {
      s.collections[0]!.slug = "Alpha";
      for (const x of s.products) if (x.collection === "alpha") x.collection = "Alpha";
    },
    error: /^collection slug "Alpha" is not a lowercase slug$/,
  },
  { name: "a collection without a name", mutate: (s) => void (s.collections[1]!.name = ""), error: /^collection "beta": name is empty$/ },
  { name: "a collection without a blurb", mutate: (s) => void (s.collections[1]!.blurb = ""), error: /^collection "beta": blurb is empty$/ },
  { name: "an empty collection", mutate: (s) => void s.collections.push({ slug: "delta", name: "Delta", blurb: "Nothing yet." }), error: /^collection "delta" has no products$/ },
  { name: "a collection hero missing on disk", mutate: (s) => void (s.collections[0]!.hero = "img/halden/ghost.jpg"), error: /^collection "alpha": image "img\/halden\/ghost\.jpg" is missing or empty in public\/$/ },
  // catalogue size, ids
  { name: "17 products", mutate: (s) => void s.products.pop(), error: /^17 products \(want 18–24\)$/ },
  { name: "25 products", mutate: (s) => void s.products.push(...Array.from({ length: 7 }, (_, i) => product(18 + i))), error: /^25 products \(want 18–24\)$/ },
  { name: "a duplicate sku", mutate: (s) => void (p(s, 1).sku = p(s, 0).sku), error: /^duplicate sku "HA-FIXTURE-0"$/ },
  { name: "an add-on sku equal to a product's", mutate: (s) => void (s.addOns[0]!.sku = "HA-FIXTURE-0"), error: /^duplicate sku "HA-FIXTURE-0"$/ },
  { name: "a duplicate product slug", mutate: (s) => void (p(s, 1).slug = "fixture-0"), error: /^duplicate product slug "fixture-0"$/ },
  { name: "a lower-case sku", mutate: (s) => void (p(s).sku = "HA-fixture-0"), error: /^sku "HA-fixture-0" is not an upper-case id starting with "HA-"$/ },
  { name: "a sku with another store's prefix", mutate: (s) => void (p(s).sku = "WF-FIXTURE-0"), error: /^sku "WF-FIXTURE-0" is not an upper-case id starting with "HA-"$/ },
  { name: "an add-on sku without the prefix", mutate: (s) => void (s.addOns[0]!.sku = "CARE"), error: /^sku "CARE" is not an upper-case id starting with "HA-"$/ },
  { name: "a product slug that is not a lowercase slug", mutate: (s) => void (p(s).slug = "Fixture-0"), error: /^product slug "Fixture-0" is not a lowercase slug$/ },
  { name: "a product in a collection that does not exist", mutate: (s) => void (p(s).collection = "nope"), error: /^product "fixture-0": collection "nope" does not exist$/ },
  { name: "a product without a name", mutate: (s) => void (p(s).name = ""), error: /^product "fixture-0": name is empty$/ },
  // prices
  { name: "a zero price", mutate: (s) => void (p(s).priceCents = 0), error: /^product "fixture-0": price 0 is not a positive whole number of cents$/ },
  { name: "a price ending in .97", mutate: (s) => void (p(s, 1).priceCents = 6497), error: /^product "fixture-1": price \$64\.97 does not end in \.00, \.95 or \.99$/ },
  { name: "a compare-at price below the price", mutate: (s) => void (p(s).compareAtCents = 4000), error: /^product "fixture-0": compare-at price 4000 is not above the price or does not end in \.00, \.95 or \.99$/ },
  // copy
  { name: "a two-sentence summary", mutate: (s) => void (p(s).summary = "Two sentences. Right here."), error: /^product "fixture-0": summary is not one sentence$/ },
  { name: "a summary without a full stop", mutate: (s) => void (p(s).summary = "No full stop"), error: /^product "fixture-0": summary is not one sentence$/ },
  { name: "a 59-word description", mutate: (s) => void (p(s).description = words(59)), error: /^product "fixture-0": description has 59 words \(want 60–150\)$/ },
  { name: "a 151-word description", mutate: (s) => void (p(s).description = words(151)), error: /^product "fixture-0": description has 151 words \(want 60–150\)$/ },
  { name: "two details", mutate: (s) => void p(s).details.pop(), error: /^product "fixture-0": 2 details \(want 3–6\)$/ },
  { name: "seven details", mutate: (s) => void p(s).details.push("4", "5", "6", "7"), error: /^product "fixture-0": 7 details \(want 3–6\)$/ },
  { name: "an empty detail", mutate: (s) => void (p(s).details[1] = " "), error: /^product "fixture-0": a detail is empty$/ },
  // images
  { name: "a product without images", mutate: (s) => void (p(s).images = []), error: /^product "fixture-0": 0 images \(want 1–3\)$/ },
  { name: "a product with four images", mutate: (s) => void (p(s).images = ["a", "b", "c", "d"].map((f) => `img/halden/${f}.jpg`)), error: /^product "fixture-0": 4 images \(want 1–3\)$/ },
  { name: "an image under another store", mutate: (s) => void (p(s, 2).images = ["img/wrenfield/a.jpg"]), error: /^product "fixture-2": image "img\/wrenfield\/a\.jpg" is not img\/halden\/<file>\.jpg$/ },
  { name: "an image path that climbs out", mutate: (s) => void (p(s, 2).images = ["img/halden/../halden/a.jpg"]), error: /^product "fixture-2": image "img\/halden\/\.\.\/halden\/a\.jpg" is not img\/halden\/<file>\.jpg$/ },
  { name: "an image missing on disk", mutate: (s) => void (p(s, 2).images = ["img/halden/ghost.jpg"]), error: /^product "fixture-2": image "img\/halden\/ghost\.jpg" is missing or empty in public\/$/ },
  { name: "an image the manifest does not list", mutate: (s) => void (p(s, 2).images = ["img/halden/unlisted.jpg"]), error: /^product "fixture-2": image "img\/halden\/unlisted\.jpg" is not listed in img\/halden\/manifest\.json$/ },
  { name: "an image under another license", mutate: (s) => void (p(s, 2).images = ["img/halden/by-licensed.jpg"]), error: /^product "fixture-2": image "img\/halden\/by-licensed\.jpg" is licensed "by" \(want cc0 or pdm\)$/ },
  // options
  { name: "an option group twice", mutate: (s) => void p(s).options.push(structuredClone(colour(s))), error: /^product "fixture-0": option "colour" appears twice$/ },
  { name: "an option id that is not a lowercase slug", mutate: (s) => void (colour(s).id = "Colour"), error: /^product "fixture-0": option id "Colour" is not a lowercase slug$/ },
  { name: "an option without a name", mutate: (s) => void (colour(s).name = ""), error: /^product "fixture-0": option "colour" has an empty name or value label$/ },
  { name: "an option value without a label", mutate: (s) => void (colour(s).values[1]!.label = ""), error: /^product "fixture-0": option "colour" has an empty name or value label$/ },
  { name: "an option without values", mutate: (s) => void (colour(s).values = []), error: /^product "fixture-0": option "colour" has no values$/ },
  { name: "a repeated option value id", mutate: (s) => void (colour(s).values[1]!.id = "black"), error: /^product "fixture-0": option "colour" repeats value "black"$/ },
  { name: "an option value id that is not a lowercase slug", mutate: (s) => void (colour(s).values[1]!.id = "Sand"), error: /^product "fixture-0": option "colour" value id "Sand" is not a lowercase slug$/ },
  { name: "a zero option delta", mutate: (s) => void (colour(s).values[1]!.priceDeltaCents = 0), error: /^product "fixture-0": option "colour" value "sand" has a price delta of 0 \(want a positive whole number of cents\)$/ },
  // reviews
  { name: "two reviews", mutate: (s) => void (p(s).reviews = [review(5), review(4)]), error: /^product "fixture-0": 2 reviews \(want 3–8\)$/ },
  { name: "nine reviews", mutate: (s) => void (p(s).reviews = [5, 4, 4, 5, 4, 4, 5, 4, 4].map((r) => review(r as Review["rating"]))), error: /^product "fixture-0": 9 reviews \(want 3–8\)$/ },
  { name: "a review date that is not a calendar date", mutate: (s) => void (p(s).reviews[0]!.date = "2025-02-30"), error: /^product "fixture-0": review 1 date "2025-02-30" is not an ISO date \(YYYY-MM-DD\)$/ },
  { name: "a review date in another format", mutate: (s) => void (p(s).reviews[0]!.date = "06/01/2025"), error: /^product "fixture-0": review 1 date "06\/01\/2025" is not an ISO date \(YYYY-MM-DD\)$/ },
  { name: "a review from before 2025", mutate: (s) => void (p(s).reviews[1]!.date = "2024-12-31"), error: /^product "fixture-0": review 2 date 2024-12-31 is outside 2025-01-01\.\.2026-10-06$/ },
  { name: "a review from the future", mutate: (s) => void (p(s).reviews[1]!.date = "2026-10-07"), error: /^product "fixture-0": review 2 date 2026-10-07 is outside 2025-01-01\.\.2026-10-06$/ },
  { name: "a rating of 6", mutate: (s) => void ((p(s).reviews[0] as { rating: number }).rating = 6), error: /^product "fixture-0": review 1 rating 6 is not 1–5$/ },
  { name: "a review without an author", mutate: (s) => void (p(s).reviews[2]!.author = ""), error: /^product "fixture-0": review 3 has an empty author, title or body$/ },
  { name: "an average above 4.8", mutate: (s) => void (p(s).reviews = [5, 5, 4, 5, 5, 5].map((r) => review(r as Review["rating"]))), error: /^product "fixture-0": average rating 4\.83 \(want 3\.5–4\.8\)$/ },
  { name: "an average below 3.5", mutate: (s) => void (p(s).reviews = [review(3), review(3), review(4)]), error: /^product "fixture-0": average rating 3\.33 \(want 3\.5–4\.8\)$/ },
  { name: "ratings that are all the same", mutate: (s) => void (p(s).reviews = [review(4), review(4), review(4)]), error: /^product "fixture-0": every review is rated 4 \(want mixed ratings\)$/ },
  // stock
  { name: "stock above 40", mutate: (s) => void (p(s, 5).stock = 41), error: /^product "fixture-5": stock 41 is not a whole number 0–40$/ },
  { name: "one low-stock product", mutate: (s) => void (p(s, 1).stock = 20), error: /^1 products at stock ≤ 5 \(want 2–3\)$/ },
  {
    name: "four low-stock products",
    mutate: (s) => {
      p(s, 2).stock = 0;
      p(s, 3).stock = 5;
    },
    error: /^4 products at stock ≤ 5 \(want 2–3\)$/,
  },
  // subscription
  { name: "a subscription saving of 0 %", mutate: (s) => void (p(s).subscription!.savePct = 0), error: /^product "fixture-0": subscription savePct 0 is not 1–99$/ },
  { name: "a subscription without intervals", mutate: (s) => void (p(s).subscription!.intervals = []), error: /^product "fixture-0": subscription intervals must be distinct and non-empty$/ },
  { name: "a repeated subscription interval", mutate: (s) => void (p(s).subscription!.intervals = ["4 weeks", "4 weeks"]), error: /^product "fixture-0": subscription intervals must be distinct and non-empty$/ },
  // add-ons
  { name: "a free add-on", mutate: (s) => void (s.addOns[0]!.priceCents = 0), error: /^add-on "HA-FIXTURE-CARE": price 0 is not a positive whole number of cents$/ },
  { name: "an add-on without a description", mutate: (s) => void (s.addOns[0]!.description = ""), error: /^add-on "HA-FIXTURE-CARE": name or description is empty$/ },
  { name: "an add-on image missing on disk", mutate: (s) => void (s.addOns[0]!.image = "img/halden/ghost.jpg"), error: /^add-on "HA-FIXTURE-CARE": image "img\/halden\/ghost\.jpg" is missing or empty in public\/$/ },
  // shipping
  { name: "one shipping method", mutate: (s) => void s.shipping.pop(), error: /^1 shipping methods \(want 2\)$/ },
  { name: "three shipping methods", mutate: (s) => void s.shipping.push({ id: "overnight", label: "Overnight", priceCents: 2999, days: [1, 1] }), error: /^3 shipping methods \(want 2\)$/ },
  { name: "a duplicate shipping method id", mutate: (s) => void (s.shipping[1]!.id = "standard"), error: /^duplicate shipping method "standard"$/ },
  { name: "a shipping method without a label", mutate: (s) => void (s.shipping[1]!.label = ""), error: /^shipping method "express": label is empty$/ },
  { name: "a negative shipping price", mutate: (s) => void (s.shipping[1]!.priceCents = -1), error: /^shipping method "express": price -1 is not a whole number of cents ≥ 0$/ },
  { name: "shipping days out of order", mutate: (s) => void (s.shipping[1]!.days = [5, 3]), error: /^shipping method "express": days \[5, 3\] is not a range of whole days$/ },
  {
    name: "a free-over threshold the store does not declare",
    mutate: (s) => void delete s.freeShippingOverCents,
    error: /^free-shipping threshold: freeShippingOverCents is unset but the shipping methods are free over \$75\.00 \(they must agree\)$/,
  },
  { name: "an announcement that hides the threshold", mutate: (s) => void (s.brand.announcement = "Free shipping on qualifying orders"), error: /^brand\.announcement does not mention the free-shipping threshold \(\$75\)$/ },
  // promo codes
  { name: "a lower-case promo code", mutate: (s) => void (s.promoCodes["spring15"] = { pctBp: 1500 }), error: /^promo code "spring15" is not upper-case \(codes are looked up upper-cased\)$/ },
  { name: "a promo code that gives nothing", mutate: (s) => void (s.promoCodes["NOTHING"] = {}), error: /^promo code "NOTHING" gives no discount \(want pctBp 1–10000 or offCents > 0\)$/ },
  { name: "no WELCOME10", mutate: (s) => void delete s.promoCodes["WELCOME10"], error: /^promo code WELCOME10 is missing$/ },
  { name: "a WELCOME10 that is not 10 % off", mutate: (s) => void (s.promoCodes["WELCOME10"] = { pctBp: 1500 }), error: /^promo code WELCOME10 must be 10 % off \(pctBp 1000\) with no minimum and no fixed amount$/ },
  { name: "a WELCOME10 with a minimum", mutate: (s) => void (s.promoCodes["WELCOME10"] = { pctBp: 1000, minSubtotalCents: 5000 }), error: /^promo code WELCOME10 must be 10 % off/ },
  // policies, delivery
  { name: "an empty policy page", mutate: (s) => void (s.policies.faq = "  "), error: /^policy "faq" is empty$/ },
  { name: "a free same-day delivery", mutate: (s) => void (s.delivery = { sameDayFeeCents: 0, cutoffHourLocal: 14, giftMessage: true }), error: /^delivery\.sameDayFeeCents 0 is not a positive whole number of cents$/ },
  { name: "a cutoff hour of 24", mutate: (s) => void (s.delivery = { sameDayFeeCents: 1499, cutoffHourLocal: 24, giftMessage: true }), error: /^delivery\.cutoffHourLocal 24 is not an hour 0–23$/ },
];

describe("storeInvariantErrors", () => {
  it("passes a store that keeps the content contract", () => {
    expect(storeInvariantErrors(good(), pub)).toEqual([]);
  });

  it.each(cases)("flags $name", ({ mutate, error }) => {
    const s = good();
    mutate(s);
    expect(storeInvariantErrors(s, pub)).toEqual([expect.stringMatching(error)]);
  });

  it("flags a shipping method that makes a one-unit order total nothing", () => {
    const s = good();
    s.shipping[1]!.priceCents = -100000;
    expect(storeInvariantErrors(s, pub)).toEqual([
      expect.stringMatching(/^shipping method "express": price -100000 is not a whole number of cents ≥ 0$/),
      expect.stringMatching(/^shipping "express": one unit of "fixture-0" and 17 more to CA does not total a positive whole number of cents$/),
    ]);
  });

  it("names a missing manifest once instead of every image", () => {
    expect(storeInvariantErrors(good(), publicDir(null))).toEqual([expect.stringMatching(/^img\/halden\/manifest\.json is missing/)]);
  });

  it("flags a manifest that is not a JSON array of entries", () => {
    expect(storeInvariantErrors(good(), publicDir("{not json"))).toEqual(["img/halden/manifest.json is not valid JSON"]);
    expect(storeInvariantErrors(good(), publicDir({ entries: MANIFEST }))).toEqual(["img/halden/manifest.json is not an array of entries"]);
  });

  it("flags a manifest entry with fields beyond the provenance it records", () => {
    const errors = storeInvariantErrors(good(), publicDir([...MANIFEST, { ...entry("spare"), tags: ["x"] }]));
    expect(errors).toEqual([expect.stringMatching(/^img\/halden\/manifest\.json entry 8 is invalid: /)]);
  });

  it("takes a note of how a photo was edited beside its title, as text", () => {
    const edited = { ...entry("spare"), edited: "a logo painted out" };
    expect(storeInvariantErrors(good(), publicDir([...MANIFEST, edited]))).toEqual([]);
    expect(storeInvariantErrors(good(), publicDir([...MANIFEST, { ...edited, edited: 3 }]))).toEqual([expect.stringMatching(/^img\/halden\/manifest\.json entry 8 is invalid: edited: /)]);
  });

  it("flags a manifest that lists a file twice", () => {
    expect(storeInvariantErrors(good(), publicDir([...MANIFEST, entry("a")]))).toEqual(['img/halden/manifest.json lists "a" more than once']);
  });
});

describe("PAYLANTERN_BRAND", () => {
  it("is a complete brand: the processor's name, tokens and Inter from Google Fonts", () => {
    expect(brandInvariantErrors(PAYLANTERN_BRAND)).toEqual([]);
    expect(PAYLANTERN_BRAND.name).toBe("PayLantern Checkout");
    expect(PAYLANTERN_BRAND.tokens).toEqual({ bg: "#F6F8FB", fg: "#1A2233", muted: "#6B778C", accent: "#0F62FE", accentFg: "#FFFFFF", surface: "#FFFFFF", border: "#D9E0EA", radius: "8px" });
    expect(PAYLANTERN_BRAND.fonts).toMatchObject({ display: "Inter", body: "Inter" });
  });

  it("has a logo that renders as a well-formed SVG", async () => {
    const png = await sharp(Buffer.from(PAYLANTERN_BRAND.logoSvg)).png().toBuffer();
    const meta = await sharp(png).metadata();
    expect(meta.width).toBeGreaterThan(0);
    expect(meta.height).toBeGreaterThan(0);
  });
});
