/**
 * The store model every site renders from. Prices are integer cents (USD);
 * ids are stable so hidden scenarios can name a SKU, an option value or an add-on.
 */
export type Surface = "payment-element" | "checkout" | "express-checkout";

/** One line of a cart: a SKU, its chosen option values, quantity, and (coffee) one-time or subscription. */
export type CartLine = { sku: string; options: Record<string, string>; qty: number; mode?: "once" | "subscribe"; interval?: string };

export type OptionValue = { id: string; label: string; priceDeltaCents?: number; soldOut?: boolean };
export type OptionGroup = { id: string; name: string; values: OptionValue[] };
export type Review = { author: string; rating: 1 | 2 | 3 | 4 | 5; title: string; body: string; date: string; verified?: boolean };

export type Product = {
  sku: string;
  slug: string;
  name: string;
  collection: string;
  priceCents: number;
  compareAtCents?: number;
  summary: string;
  description: string;
  details: string[];
  images: string[];
  options: OptionGroup[];
  reviews: Review[];
  badges?: string[];
  stock: number;
  tags: string[];
  subscription?: { savePct: number; intervals: string[] };
};

export type AddOn = { sku: string; name: string; priceCents: number; recurring?: "year" | "month"; description: string; image?: string };
export type ShippingMethod = { id: string; label: string; priceCents: number; days: [number, number]; freeOverCents?: number };
export type Collection = { slug: string; name: string; blurb: string; hero?: string };

export type Brand = {
  name: string;
  tagline: string;
  /** The home page's hero photograph, a path relative to the app's public directory ("img/<store>/<file>.jpg"). */
  heroImage?: string;
  logoSvg: string;
  announcement: string;
  supportEmail: string;
  supportPhone: string;
  fonts: { display: string; body: string; href: string };
  tokens: Record<"bg" | "fg" | "muted" | "accent" | "accentFg" | "surface" | "border" | "radius", string>;
};

export type DeliveryRules = { sameDayFeeCents: number; cutoffHourLocal: number; giftMessage: boolean };

export type PolicyKey = "shipping" | "returns" | "privacy" | "terms" | "faq" | "about" | "contact";

export type StoreDef = {
  id: "wrenfield" | "halden" | "quillfeather";
  brand: Brand;
  orderPrefix: "WF" | "HA" | "QF";
  defaultSurface: Surface;
  collections: Collection[];
  products: Product[];
  addOns: AddOn[];
  shipping: ShippingMethod[];
  freeShippingOverCents?: number;
  promoCodes: Record<string, { pctBp?: number; offCents?: number; minSubtotalCents?: number }>;
  delivery?: DeliveryRules;
  policies: Record<PolicyKey, string>;
};
