import { formatUsd, type Product } from "@benchme/storefront";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { storeInvariantErrors } from "./invariants.js";
import { WRENFIELD } from "./wrenfield.js";

/** apps/shops/public, where the catalogue's image paths resolve. */
const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "public");

const inCollection = (slug: string) => WRENFIELD.products.filter((p) => p.collection === slug);
const sizes = (p: Product) => p.options.find((g) => g.id === "size");

describe("WRENFIELD", () => {
  it("keeps the content contract", () => {
    expect(storeInvariantErrors(WRENFIELD, PUBLIC_DIR)).toEqual([]);
  });

  it("is Wrenfield Flowers: identity, palette, type and delivery rules", () => {
    expect(WRENFIELD).toMatchObject({ id: "wrenfield", orderPrefix: "WF", defaultSurface: "payment-element" });
    expect(WRENFIELD.brand.name).toBe("Wrenfield Flowers");
    expect(WRENFIELD.brand.tokens).toEqual({ bg: "#FBF7F2", fg: "#1F2A24", muted: "#6B6F68", accent: "#2F4A3A", accentFg: "#FBF7F2", surface: "#FFFFFF", border: "#E7DED3", radius: "2px" });
    expect(WRENFIELD.brand.fonts).toMatchObject({ display: "Fraunces", body: "Inter" });
    expect(WRENFIELD.delivery).toEqual({ sameDayFeeCents: 1499, cutoffHourLocal: 14, giftMessage: true });
    // Florists charge for delivery: no free-shipping threshold; the announcement names the same-day cutoff instead.
    expect(WRENFIELD.freeShippingOverCents).toBeUndefined();
    expect(WRENFIELD.brand.announcement).toMatch(/\b2 ?pm\b/i);
  });

  it("has a logo that renders as a well-formed SVG", async () => {
    expect(WRENFIELD.brand.logoSvg).toMatch(/^<svg [^>]*viewBox="[\d. ]+"/);
    expect(WRENFIELD.brand.logoSvg).not.toMatch(/(?:href|url)\s*[=(]/i);
    const meta = await sharp(await sharp(Buffer.from(WRENFIELD.brand.logoSvg)).png().toBuffer()).metadata();
    expect(meta.width).toBeGreaterThan(0);
    expect(meta.height).toBeGreaterThan(0);
  });

  it("sorts its catalogue into Bestsellers, Birthday, Sympathy and Plants, each with a hero", () => {
    expect(WRENFIELD.collections.map((c) => [c.slug, c.name])).toEqual([
      ["bestsellers", "Bestsellers"],
      ["birthday", "Birthday"],
      ["sympathy", "Sympathy"],
      ["plants", "Plants"],
    ]);
    for (const c of WRENFIELD.collections) expect(c.hero, c.slug).toMatch(/^img\/wrenfield\//);
  });

  it("offers at least eight bouquets in Classic, Deluxe (+$20) and Premium (+$40), every size orderable", () => {
    const sized = WRENFIELD.products.filter((p) => sizes(p));
    expect(sized.length).toBeGreaterThanOrEqual(8);
    for (const p of sized) {
      const g = sizes(p)!;
      expect(g.name, p.slug).toBe("Size");
      expect(
        g.values.map((v) => [v.id, v.priceDeltaCents ?? 0, v.soldOut ?? false]),
        p.slug,
      ).toEqual([
        ["classic", 0, false],
        ["deluxe", 2000, false],
        ["premium", 4000, false],
      ]);
    }
  });

  it("has at least four Sympathy arrangements, each at its own price", () => {
    const sympathy = inCollection("sympathy");
    expect(sympathy.length).toBeGreaterThanOrEqual(4);
    expect(new Set(sympathy.map((p) => p.priceCents)).size).toBe(sympathy.length);
    // One price per arrangement, so comparing them is comparing their prices.
    for (const p of sympathy) expect(p.options, p.slug).toEqual([]);
  });

  it("has at least three plants, none sold by size", () => {
    const plants = inCollection("plants");
    expect(plants.length).toBeGreaterThanOrEqual(3);
    for (const p of plants) expect(sizes(p), p.slug).toBeUndefined();
  });

  it("sells a vase, chocolates, a balloon and the yearly Wrenfield Rewards membership as add-ons", () => {
    expect(WRENFIELD.addOns.map((a) => [a.sku, a.priceCents, a.recurring ?? null])).toEqual([
      ["WF-ADD-VASE", 1500, null],
      ["WF-ADD-CHOCOLATES", 1499, null],
      ["WF-ADD-BALLOON", 799, null],
      ["WF-ADD-REWARDS", 2499, "year"],
    ]);
    const rewards = WRENFIELD.addOns.find((a) => a.sku === "WF-ADD-REWARDS")!;
    expect(rewards.name).toBe("Wrenfield Rewards — yearly membership");
    expect(rewards.description).toMatch(/free standard delivery/i);
  });

  it("delivers standard or before noon, and takes WELCOME10 and SPRING15", () => {
    expect(WRENFIELD.shipping.map((m) => [m.id, m.label, m.priceCents, m.freeOverCents ?? null])).toEqual([
      ["standard", "Standard delivery", 1499, null],
      ["morning", "Morning delivery (before noon)", 2499, null],
    ]);
    expect(WRENFIELD.promoCodes).toEqual({ WELCOME10: { pctBp: 1000 }, SPRING15: { pctBp: 1500, minSubtotalCents: 5000 } });
  });

  it("writes its pages as plain text: paragraphs, ## subheadings, no HTML", () => {
    for (const [key, text] of Object.entries(WRENFIELD.policies)) {
      expect(text, key).toBe(text.trim());
      expect(text, key).not.toMatch(/<\/?[a-z][^>]*>/i);
      expect(text, key).not.toMatch(/\n{3,}/);
      for (const line of text.split("\n")) if (line.startsWith("#")) expect(line, key).toMatch(/^## \S/);
    }
  });

  it("says plainly on its terms and about pages that the store is fictional and orders are not fulfilled", () => {
    for (const key of ["terms", "about"] as const) {
      expect(WRENFIELD.policies[key], key).toContain("Wrenfield Flowers is a fictional store operated for research.");
      expect(WRENFIELD.policies[key], key).toContain("Orders are not fulfilled.");
    }
  });

  it("quotes the delivery prices, the same-day fee and the cutoff its checkout charges", () => {
    const { shipping, faq } = WRENFIELD.policies;
    for (const m of WRENFIELD.shipping) {
      expect(shipping).toContain(m.label);
      expect(shipping).toContain(formatUsd(m.priceCents));
    }
    expect(shipping).toContain(formatUsd(WRENFIELD.delivery!.sameDayFeeCents));
    expect(shipping).toMatch(/\b2 ?pm\b/i);
    expect(faq).toMatch(/\b2 ?pm\b/i);
  });
});
