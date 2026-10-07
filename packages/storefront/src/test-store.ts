import type { StoreDef } from "./catalog.js";

/** A tiny store for unit tests (excluded from the build). */
export const demoStore: StoreDef = {
  id: "wrenfield",
  orderPrefix: "WF",
  defaultSurface: "payment-element",
  brand: {
    name: "Demo",
    tagline: "",
    logoSvg: "",
    announcement: "",
    supportEmail: "",
    supportPhone: "",
    fonts: { display: "serif", body: "sans-serif", href: "" },
    tokens: { bg: "#fff", fg: "#000", muted: "#666", accent: "#333", accentFg: "#fff", surface: "#fafafa", border: "#ddd", radius: "4px" },
  },
  collections: [{ slug: "all", name: "All", blurb: "" }],
  products: [
    {
      sku: "B1", slug: "b1", name: "Bouquet", collection: "all", priceCents: 6499, summary: "", description: "", details: [], images: [],
      options: [{ id: "size", name: "Size", values: [{ id: "m", label: "Medium" }, { id: "l", label: "Large", priceDeltaCents: 2000 }] }],
      reviews: [], stock: 20, tags: [],
    },
    {
      sku: "C1", slug: "c1", name: "Coffee", collection: "all", priceCents: 2200, summary: "", description: "", details: [], images: [],
      options: [], reviews: [], stock: 20, tags: [], subscription: { savePct: 15, intervals: ["2 weeks", "4 weeks"] },
    },
  ],
  addOns: [
    { sku: "VASE", name: "Glass vase", priceCents: 1500, description: "" },
    { sku: "CLUB", name: "Club", priceCents: 2499, recurring: "year", description: "" },
  ],
  shipping: [
    { id: "standard", label: "Standard", priceCents: 999, days: [3, 5], freeOverCents: 10000 },
    { id: "express", label: "Express", priceCents: 1999, days: [1, 2] },
  ],
  promoCodes: { WELCOME10: { pctBp: 1000, minSubtotalCents: 5000 } },
  delivery: { sameDayFeeCents: 1500, cutoffHourLocal: 14, giftMessage: true },
  policies: { shipping: "", returns: "", privacy: "", terms: "", faq: "", about: "", contact: "" },
};
