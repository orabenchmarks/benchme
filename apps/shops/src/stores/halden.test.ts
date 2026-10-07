import { formatUsd, type PolicyKey, type Product } from "@benchme/storefront";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { HALDEN } from "./halden.js";
import { readManifest, storeInvariantErrors } from "./invariants.js";

/** apps/shops/public, where the catalogue's image paths resolve. */
const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "public");
const POLICY_KEYS: readonly PolicyKey[] = ["shipping", "returns", "privacy", "terms", "faq", "about", "contact"];

const inCollection = (slug: string) => HALDEN.products.filter((p) => p.collection === slug);
const colours = (p: Product) => p.options.find((g) => g.id === "color");
const tagged = (tag: string) => (p: Product) => p.tags.includes(tag);
/** Active noise cancelling as a shopper finds it: the "anc" filter tag and the spec line. */
const ANC_LINE = "Active noise cancelling";
const hasAnc = (p: Product) => p.tags.includes("anc") && p.details.includes(ANC_LINE);
/** The model name a product's copy refers to it by: "Breakwater Wireless Headphones" → "Breakwater". */
const model = (p: Product) => p.name.split(" ")[0] ?? p.name;

const overEar = () => inCollection("headphones").filter(tagged("over-ear"));
const wirelessEarbuds = () => inCollection("earbuds").filter(tagged("wireless"));

describe("HALDEN", () => {
  it("keeps the content contract", () => {
    expect(storeInvariantErrors(HALDEN, PUBLIC_DIR)).toEqual([]);
  });

  it("keeps a retouched photo's source title as published, with the retouching noted beside it", () => {
    const lull = readManifest(PUBLIC_DIR, "halden").entries?.find((e) => e.file === "lull-earbuds-pearl");
    expect(lull?.title).toBe("ActiveSound wireless earbuds by Hykker (POJM200483) Brand of Biedronka");
    expect(lull?.edited).toMatch(/painted out/);
  });

  it("is Halden Audio: identity, palette and type", () => {
    expect(HALDEN).toMatchObject({ id: "halden", orderPrefix: "HA", defaultSurface: "checkout" });
    expect(HALDEN.brand.name).toBe("Halden Audio");
    expect(HALDEN.brand.tokens).toEqual({ bg: "#FFFFFF", fg: "#0E0F12", muted: "#5A5F6B", accent: "#3B5BFD", accentFg: "#FFFFFF", surface: "#F4F5F7", border: "#E3E5EA", radius: "10px" });
    expect(HALDEN.brand.fonts).toMatchObject({ display: "Space Grotesk", body: "Inter" });
    expect(HALDEN.delivery).toBeUndefined();
  });

  it("has a logo in the brand's colours that renders as a well-formed SVG", async () => {
    const svg = HALDEN.brand.logoSvg;
    expect(svg).toMatch(/^<svg [^>]*viewBox="[\d. ]+"/);
    expect(svg).not.toMatch(/(?:href|url)\s*[=(]/i);
    expect(svg).toContain(HALDEN.brand.tokens.accent);
    expect(svg).toContain(HALDEN.brand.tokens.fg);
    const meta = await sharp(await sharp(Buffer.from(svg)).png().toBuffer()).metadata();
    expect(meta.width).toBeGreaterThan(0);
    expect(meta.height).toBeGreaterThan(0);
  });

  it("sorts its catalogue into Headphones, Earbuds, Speakers and Accessories, each with a hero", () => {
    expect(HALDEN.collections.map((c) => [c.slug, c.name])).toEqual([
      ["headphones", "Headphones"],
      ["earbuds", "Earbuds"],
      ["speakers", "Speakers"],
      ["accessories", "Accessories"],
    ]);
    for (const c of HALDEN.collections) expect(c.hero, c.slug).toMatch(/^img\/halden\//);
  });

  it("sells Halden Care and gift wrap as one-off add-ons", () => {
    expect(HALDEN.addOns.map((a) => [a.name, a.priceCents, a.recurring])).toEqual([
      ["Halden Care — 2-year protection", 2999, undefined],
      ["Gift wrap", 600, undefined],
    ]);
  });

  it("ships standard (3–5 days, free from $75) or express (1–2 days)", () => {
    expect(HALDEN.shipping).toEqual([
      { id: "standard", label: expect.any(String), priceCents: 599, days: [3, 5], freeOverCents: 7500 },
      { id: "express", label: expect.any(String), priceCents: 1499, days: [1, 2] },
    ]);
    expect(HALDEN.freeShippingOverCents).toBe(7500);
  });

  it("takes the newsletter's WELCOME10 and HALDEN20, $20 off from $150", () => {
    expect(HALDEN.promoCodes).toEqual({ WELCOME10: { pctBp: 1000 }, HALDEN20: { offCents: 2000, minSubtotalCents: 15000 } });
  });

  it("can sell every product: in stock, with at least one colour available", () => {
    for (const p of HALDEN.products) {
      expect(p.stock, p.slug).toBeGreaterThan(0);
      for (const g of p.options) expect(g.values.some((v) => !v.soldOut), `${p.slug} ${g.id}`).toBe(true);
    }
  });

  describe("range: what a shopper compares and chooses between", () => {
    it("has at least four over-ear headphones, at least one offered in black", () => {
      expect(overEar().length).toBeGreaterThanOrEqual(4);
      expect(overEar().some((p) => colours(p)?.values.some((v) => v.id === "black" && !v.soldOut))).toBe(true);
    });

    it("has at least five wireless earbuds, three or more with active noise cancelling, each at its own price", () => {
      expect(wirelessEarbuds().length).toBeGreaterThanOrEqual(5);
      const anc = wirelessEarbuds().filter(hasAnc);
      expect(anc.length).toBeGreaterThanOrEqual(3);
      expect(new Set(anc.map((p) => p.priceCents)).size).toBe(anc.length);
      // A colour never changes an earbud's price, so its price is the one to compare.
      for (const p of inCollection("earbuds")) for (const g of p.options) for (const v of g.values) expect(v.priceDeltaCents, `${p.slug} ${v.id}`).toBeUndefined();
    });

    it("prices a pair without noise cancelling below every pair with it", () => {
      const cheapestAnc = Math.min(...wirelessEarbuds().filter(hasAnc).map((p) => p.priceCents));
      expect(wirelessEarbuds().some((p) => !hasAnc(p) && p.priceCents < cheapestAnc)).toBe(true);
    });

    it("states noise cancelling one way: the tag and the spec line go together, and pairs without it never claim it", () => {
      for (const p of HALDEN.products) expect(p.tags.includes("anc"), p.slug).toBe(p.details.includes(ANC_LINE));
      for (const p of wirelessEarbuds().filter((x) => !hasAnc(x))) {
        expect([p.name, p.summary, p.description, ...p.details].join(" "), p.slug).not.toMatch(/noise[- ]cancel/i);
      }
    });

    it("offers a colour choice on at least six products", () => {
      const coloured = HALDEN.products.filter((p) => colours(p));
      expect(coloured.length).toBeGreaterThanOrEqual(6);
      for (const p of coloured) expect(colours(p)?.name, p.slug).toBe("Color");
    });

    it("has at least two products with exactly one sold-out colour and another in stock", () => {
      const oneSoldOut = HALDEN.products.filter((p) => {
        const values = colours(p)?.values ?? [];
        return values.filter((v) => v.soldOut).length === 1 && values.some((v) => !v.soldOut);
      });
      expect(oneSoldOut.length).toBeGreaterThanOrEqual(2);
    });

    it("has a carrying case in Accessories that names the over-ear headphones it fits", () => {
      const cases = inCollection("accessories").filter(tagged("case"));
      expect(cases.some((c) => /\bfits\b/i.test(c.description) && overEar().some((h) => c.description.includes(model(h))))).toBe(true);
    });

    it("lists driver, weight and connection specs for every headphone and earbud, and battery life for the wireless ones", () => {
      for (const p of [...inCollection("headphones"), ...inCollection("earbuds")]) {
        const specs = p.details.join("\n");
        expect(specs, p.slug).toMatch(/^Driver: /m);
        expect(specs, p.slug).toMatch(/^Weight: /m);
        expect(specs, p.slug).toMatch(/^(?:Bluetooth|Connection): /m);
        if (p.tags.includes("wireless")) expect(specs, p.slug).toMatch(/^Battery: /m);
      }
    });
  });

  describe("pages", () => {
    it("are plain text: paragraphs, ## subheadings, no HTML", () => {
      for (const k of POLICY_KEYS) {
        const text = HALDEN.policies[k];
        expect(text, k).not.toMatch(/<\/?[a-z][^>]*>/i);
        expect(text.split(/\n{2,}/).length, k).toBeGreaterThan(2);
        for (const line of text.split("\n")) expect(line, k).not.toMatch(/^#(?!# )/);
      }
    });

    it("say plainly, on the terms and about pages, that the store is fictional and orders are not fulfilled", () => {
      for (const k of ["terms", "about"] as const) {
        expect(HALDEN.policies[k], k).toContain("Halden Audio is a fictional store operated for research. Orders are not fulfilled.");
      }
    });

    it("quote the prices, speeds and threshold the checkout charges", () => {
      const [standard, express] = HALDEN.shipping;
      const shipping = HALDEN.policies.shipping;
      expect(shipping).toContain(formatUsd(standard!.priceCents));
      expect(shipping).toContain(formatUsd(express!.priceCents));
      expect(shipping).toContain("$75");
      expect(shipping).toContain("3–5 business days");
      expect(shipping).toContain("1–2 business days");
      expect(HALDEN.policies.faq).toContain(formatUsd(HALDEN.addOns[0]!.priceCents));
      expect(HALDEN.policies.contact).toContain(HALDEN.brand.supportEmail);
      expect(HALDEN.policies.contact).toContain(HALDEN.brand.supportPhone);
    });

    it("leave the newsletter's welcome code to the newsletter", () => {
      for (const k of POLICY_KEYS) expect(HALDEN.policies[k], k).not.toContain("WELCOME10");
    });
  });
});
