import type { SportAddress, SportCategory, SportOrder, SportOrderStatus, SportProduct, SportReturn, SportVariant, SportsProblem } from "@benchme/scenarios";
import { DomainError } from "@benchme/site-kit";

/** One order line as the site shows it: the variant's product, size and colour, and how many units were already returned. */
export type LineView = { sku: string; productCode: string; productName: string; size: string; colour: string; qty: number; unitPriceCents: number; returnedQty: number };
export type AddressView = Omit<SportAddress, "customerEmail">;
/** An order with its customer's name, the address it ships to, its lines and its returns. List and detail routes return the same shape. */
export type OrderView = SportOrder & { customerName: string; address: AddressView; lineCount: number; lines: LineView[]; returns: SportReturn[] };

export type CategoryRow = { key: string; name: string; return_window_days: number };
export type ProductRow = { code: string; name: string; brand: string; category: string; material: string; description: string };
export type VariantRow = { sku: string; product_code: string; size: string; colour: string; weight_grams: number; price_cents: number; stock: number };
export type AddressRow = { code: string; customer_email: string; label: string; line1: string; city: string; postcode: string; is_default: boolean };
export type OrderRow = {
  order_no: string; customer_email: string; address_code: string; status: SportOrderStatus; placed_on: string; shipped_on: string | null; delivered_on: string | null;
  cancelled_on: string | null; tracking_no: string | null; subtotal_cents: number; shipping_cents: number; total_cents: number;
};
export type LineRow = { order_no: string; sku: string; qty: number; unit_price_cents: number; product_code: string; product_name: string; size: string; colour: string };
export type ReturnRow = { return_no: string; order_no: string; sku: string; qty: number; reason: string; requested_on: string; refund_cents: number };

export const toCategory = (r: CategoryRow): SportCategory => ({ key: r.key, name: r.name, returnWindowDays: r.return_window_days });
export const toProduct = (r: ProductRow): SportProduct => ({ code: r.code, name: r.name, brand: r.brand, category: r.category, material: r.material, description: r.description });
export const toVariant = (r: VariantRow): SportVariant => ({ sku: r.sku, productCode: r.product_code, size: r.size, colour: r.colour, weightGrams: r.weight_grams, priceCents: r.price_cents, stock: r.stock });
export const toAddress = (r: AddressRow): SportAddress => ({ code: r.code, customerEmail: r.customer_email, label: r.label, line1: r.line1, city: r.city, postcode: r.postcode, isDefault: r.is_default });
export const toOrder = (r: OrderRow): SportOrder => ({
  orderNo: r.order_no, customerEmail: r.customer_email, addressCode: r.address_code, status: r.status, placedOn: r.placed_on, shippedOn: r.shipped_on, deliveredOn: r.delivered_on,
  cancelledOn: r.cancelled_on, trackingNo: r.tracking_no, subtotalCents: r.subtotal_cents, shippingCents: r.shipping_cents, totalCents: r.total_cents,
});
export const toReturn = (r: ReturnRow): SportReturn => ({ returnNo: r.return_no, orderNo: r.order_no, sku: r.sku, qty: r.qty, reason: r.reason, requestedOn: r.requested_on, refundCents: r.refund_cents });

// DATE columns read as text: node-postgres turns a DATE into a local-midnight Date, which shifts a day in any zone west of UTC.
export const ORDER_COLS = `order_no, customer_email, address_code, status, to_char(placed_on, 'YYYY-MM-DD') AS placed_on, to_char(shipped_on, 'YYYY-MM-DD') AS shipped_on,
  to_char(delivered_on, 'YYYY-MM-DD') AS delivered_on, to_char(cancelled_on, 'YYYY-MM-DD') AS cancelled_on, tracking_no, subtotal_cents, shipping_cents, total_cents`;
export const RETURN_COLS = "return_no, order_no, sku, qty, reason, to_char(requested_on, 'YYYY-MM-DD') AS requested_on, refund_cents";
export const LINE_SELECT = `SELECT l.order_no, l.sku, l.qty, l.unit_price_cents, v.product_code, p.name AS product_name, v.size, v.colour
  FROM sports.order_lines l JOIN sports.variants v ON v.workspace_id = l.workspace_id AND v.sku = l.sku
  JOIN sports.products p ON p.workspace_id = v.workspace_id AND p.code = v.product_code`;

/** Unknown things are 404; stock that ran out, or a cancel that already happened, is 409; every other rule refusal is 422. */
const STATUS: Record<string, number> = { UNKNOWN_CUSTOMER: 404, UNKNOWN_SKU: 404, UNKNOWN_ORDER: 404, OUT_OF_STOCK: 409, ALREADY_CANCELLED: 409 };
export const refuse = (p: SportsProblem): never => {
  throw new DomainError(p.code, p.message, STATUS[p.code] ?? 422);
};
