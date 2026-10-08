import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { computeTotals, type Product } from "@benchme/storefront";
import { describe, expect, it } from "vitest";
import { storeInvariantErrors } from "./invariants.js";
import { QUILLFEATHER } from "./quillfeather.js";

/**
 * Quillfeather's catalogue keeps the generic content contract and holds what a coffee shopper can be
 * asked to buy: enough coffees per collection to compare, every coffee in both sizes and every grind,
 * one-time or on subscription, and gear sold as it comes. Nothing here names any task's answer.
 */

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "public");
const store = QUILLFEATHER;
const inCollection = (slug: string) => store.products.filter((p) => p.collection === slug);
const coffees = store.products.filter((p) => p.collection !== "brew-gear");
const group = (p: Product, id: string) => p.options.find((g) => g.id === id);
/** [id, price delta, sold out] per value, so a missing delta reads as 0 and a missing flag as false. */
const values = (p: Product, id: string) => group(p, id)?.values.map((v) => [v.id, v.priceDeltaCents ?? 0, v.soldOut ?? false]);
/** The first family of a CSS font stack, unquoted. */
const family = (stack: string) => (stack.split(",")[0] ?? "").trim().replace(/^["']|["']$/g, "");

describe("Quillfeather Coffee", () => {
  it("keeps the content contract", () => {
    expect(storeInvariantErrors(store, PUBLIC)).toEqual([]);
  });

  it("is the coffee store, paid through the Express Checkout surface", () => {
    expect(store.id).toBe("quillfeather");
    expect(store.orderPrefix).toBe("QF");
    expect(store.defaultSurface).toBe("express-checkout");
    expect(store.brand.name).toBe("Quillfeather Coffee");
    expect(store.brand.tokens).toEqual({ bg: "#F4EFE6", fg: "#2B201A", muted: "#7A6A5F", accent: "#B5532E", accentFg: "#FFF8F0", surface: "#FFFDF9", border: "#E4D8C8", radius: "14px" });
    expect(family(store.brand.fonts.display)).toBe("DM Serif Display");
    expect(family(store.brand.fonts.body)).toBe("Work Sans");
  });

  it("draws its logo inline, with a view box and nothing fetched", () => {
    expect(store.brand.logoSvg).toMatch(/^<svg [^>]*viewBox="[\d. ]+"/);
    expect(store.brand.logoSvg).not.toMatch(/href|url\(|<image|@import/i);
  });

  it("stocks the four collections with enough coffees to compare", () => {
    expect(store.collections.map((c) => c.slug)).toEqual(["single-origins", "blends", "decaf", "brew-gear"]);
    expect(store.collections.every((c) => c.hero !== undefined)).toBe(true);
    expect(inCollection("single-origins").length).toBeGreaterThanOrEqual(6);
    expect(inCollection("blends").length).toBeGreaterThanOrEqual(3);
    expect(inCollection("brew-gear").length).toBeGreaterThanOrEqual(4);
    const decaf = inCollection("decaf");
    expect(decaf.length).toBeGreaterThanOrEqual(3);
    expect(new Set(decaf.map((p) => p.priceCents)).size).toBe(decaf.length);
  });

  it("sells every coffee in both sizes and every grind, all orderable, one-time or on subscription", () => {
    for (const p of coffees) {
      expect(p.options.map((g) => g.id), p.slug).toEqual(["size", "grind"]);
      expect(values(p, "size"), p.slug).toEqual([
        ["12oz", 0, false],
        ["2lb", 2200, false],
      ]);
      expect(values(p, "grind"), p.slug).toEqual(["whole-bean", "drip", "espresso", "french-press", "pour-over"].map((id) => [id, 0, false]));
      expect(p.subscription, p.slug).toEqual({ savePct: 15, intervals: ["2 weeks", "4 weeks", "6 weeks"] });
      expect(p.stock, p.slug).toBeGreaterThan(0);
    }
  });

  it("writes each coffee's tasting notes, origin, process, altitude and roast into its details", () => {
    for (const p of coffees) {
      for (const label of ["Tasting notes", "Origin", "Process", "Altitude", "Roast"]) {
        expect(p.details.some((d) => d.startsWith(`${label}: `)), `${p.slug} ${label}`).toBe(true);
      }
    }
  });

  it("sells gear as it comes: no options, no subscription, in stock", () => {
    for (const p of inCollection("brew-gear")) {
      expect(p.options, p.slug).toEqual([]);
      expect(p.subscription, p.slug).toBeUndefined();
      expect(p.stock, p.slug).toBeGreaterThan(0);
    }
  });

  it("offers the two gift extras, two shipping methods and the newsletter's code", () => {
    expect(store.addOns.map((a) => [a.name, a.priceCents, a.recurring ?? null])).toEqual([
      ["Tasting notes card", 300, null],
      ["Gift box", 800, null],
    ]);
    expect(store.shipping.map((m) => [m.id, m.priceCents, m.freeOverCents ?? null])).toEqual([
      ["standard", 650, 4500],
      ["priority", 1200, null],
    ]);
    expect(store.freeShippingOverCents).toBe(4500);
    expect(store.promoCodes).toEqual({ WELCOME10: { pctBp: 1000 } });
    expect(store.delivery).toBeUndefined();
  });

  it("ships free on standard once the merchandise reaches the threshold, never on priority", () => {
    const p = coffees[0]!;
    const lines = [{ sku: p.sku, options: { size: "2lb", grind: "whole-bean" }, qty: 3 }];
    const totals = (shippingId: string) => computeTotals({ store, lines, addOns: [], shippingId, state: null, promo: null });
    expect(totals("standard").shippingCents).toBe(0);
    expect(totals("priority").shippingCents).toBe(1200);
  });

  it("writes its policies as plain text in paragraphs, and says plainly that it is a fictional store", () => {
    for (const [key, text] of Object.entries(store.policies)) {
      expect(text, key).not.toMatch(/<\/?[a-z!][^>]*>/i);
      expect(text, key).not.toMatch(/\n{3,}|^\s|\s$/);
      expect(text.split("\n\n").length, key).toBeGreaterThanOrEqual(3);
    }
    for (const key of ["terms", "about"] as const) {
      expect(store.policies[key]).toContain("Quillfeather Coffee is a fictional store operated for research");
      expect(store.policies[key]).toMatch(/not fulfilled/);
    }
    expect(store.policies.shipping).toMatch(/\$6\.50[\s\S]*\$45[\s\S]*\$12\.00/);
  });

  it("keeps the welcome code out of its pages: the newsletter reveals it", () => {
    const pages = [
      ...Object.values(store.policies),
      store.brand.announcement,
      store.brand.tagline,
      ...store.collections.map((c) => c.blurb),
      ...store.addOns.map((a) => a.description),
    ];
    for (const p of store.products) pages.push(p.summary, p.description, ...p.details, ...p.reviews.map((r) => `${r.title} ${r.body}`));
    for (const text of pages) expect(text).not.toMatch(/WELCOME10/i);
  });
});
