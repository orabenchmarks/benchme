/**
 * The sports retailer site (apps/sports, "Brackenford Sports"): a catalog of
 * products with variants, seeded customer accounts with saved addresses, and
 * their order history — orders, lines and returns. Natural keys only (SKU,
 * ORD-…, RET-…, AD-…), no database ids. Money is cents. Rules: ./rules.ts.
 */

/** A catalog category and its return policy: a line may be returned up to `returnWindowDays` after its order was delivered. */
export type SportCategory = { key: string; name: string; returnWindowDays: number };
/** One fee per order, waived when the order's subtotal reaches `freeFromCents`. */
export type SportShippingPolicy = { feeCents: number; freeFromCents: number };
export type SportProduct = { code: string; name: string; brand: string; category: string; material: string; description: string };
/** One size and colour of a product, with its own SKU, price, weight and stock (units free to order now). */
export type SportVariant = { sku: string; productCode: string; size: string; colour: string; weightGrams: number; priceCents: number; stock: number };
export type SportCustomer = { email: string; name: string };
export type SportAddress = { code: string; customerEmail: string; label: string; line1: string; city: string; postcode: string; isDefault: boolean };
export type SportOrderStatus = "processing" | "shipped" | "delivered" | "cancelled";
export type SportOrder = {
  orderNo: string;
  customerEmail: string;
  addressCode: string;
  status: SportOrderStatus;
  /** "YYYY-MM-DD"; orders placed through the site are dated SPORTS_TODAY. */
  placedOn: string;
  shippedOn: string | null;
  deliveredOn: string | null;
  cancelledOn: string | null;
  trackingNo: string | null;
  subtotalCents: number;
  shippingCents: number;
  totalCents: number;
};
/** One SKU of an order; an order never carries the same SKU twice. */
export type SportOrderLine = { orderNo: string; sku: string; qty: number; unitPriceCents: number };
export type SportReturn = { returnNo: string; orderNo: string; sku: string; qty: number; reason: string; requestedOn: string; refundCents: number };
export type SportsRows = {
  categories: SportCategory[];
  shipping: SportShippingPolicy;
  products: SportProduct[];
  variants: SportVariant[];
  customers: SportCustomer[];
  addresses: SportAddress[];
  orders: SportOrder[];
  lines: SportOrderLine[];
  returns: SportReturn[];
};
