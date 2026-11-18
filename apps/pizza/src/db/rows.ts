import { pizzaToppingsKey, type PizzaAllergen, type PizzaBranch, type PizzaFulfilment, type PizzaMenuItem, type PizzaOrder, type PizzaOrderLine, type PizzaOrderStatus, type PizzaSize, type PizzaSizeKey, type PizzaStockout, type PizzaTopping } from "@benchme/scenarios";

/** What the site returns for an order: the row, each line's topping set as one string, and counts a check can match on. */
export type OrderLineView = PizzaOrderLine & { toppingsKey: string };
export type OrderView = Omit<PizzaOrder, "lines"> & { lines: OrderLineView[]; lineCount: number; pizzaCount: number; updatedAt: string | null; cancelledAt: string | null };

export type SizeRow = { key: PizzaSizeKey; name: string; inches: number; serves: number; base_cents: number };
export type ToppingRow = { key: string; name: string; vegetarian: boolean; vegan: boolean; allergens: PizzaAllergen[]; small_cents: number; medium_cents: number; large_cents: number; xlarge_cents: number };
export type PizzaRow = { code: string; name: string; description: string; crust: string; sauce: string; cheese: string; toppings: string[] };
export type BranchRow = { code: string; name: string; city: string; address: string; delivers: boolean; delivery_fee_cents: number | null; free_delivery_from_cents: number | null; slot_capacity: number };
export type StockoutRow = { branch_code: string; topping_key: string };
export type OrderRow = {
  order_no: string; branch_code: string; customer_name: string; customer_email: string; fulfilment: PizzaFulfilment; address: string | null; slot_date: string; slot_time: string;
  status: PizzaOrderStatus; subtotal_cents: number; delivery_fee_cents: number; total_cents: number; created_at: Date; updated_at: Date | null; cancelled_at: Date | null;
};
export type LineRow = { order_no: string; line: number; pizza_code: string | null; size: string; crust: string; sauce: string; cheese: string; toppings: string[]; quantity: number; unit_cents: number; line_cents: number };

// A DATE column read as text: node-postgres turns a DATE into a local-midnight Date, which shifts a day in any zone west of UTC.
export const ORDER_COLS =
  "order_no, branch_code, customer_name, customer_email, fulfilment, address, to_char(slot_date, 'YYYY-MM-DD') AS slot_date, slot_time, status, subtotal_cents, delivery_fee_cents, total_cents, created_at, updated_at, cancelled_at";

export const toSize = (r: SizeRow): PizzaSize => ({ key: r.key, name: r.name, inches: r.inches, serves: r.serves, baseCents: r.base_cents });
export const toTopping = (r: ToppingRow): PizzaTopping => ({
  key: r.key, name: r.name, vegetarian: r.vegetarian, vegan: r.vegan, allergens: r.allergens,
  pricesCents: { small: r.small_cents, medium: r.medium_cents, large: r.large_cents, xlarge: r.xlarge_cents },
});
export const toPizza = (r: PizzaRow): PizzaMenuItem => ({ code: r.code, name: r.name, description: r.description, crust: r.crust, sauce: r.sauce, cheese: r.cheese, toppings: r.toppings });
export const toBranch = (r: BranchRow): PizzaBranch => ({
  code: r.code, name: r.name, city: r.city, address: r.address, delivers: r.delivers, deliveryFeeCents: r.delivery_fee_cents, freeDeliveryFromCents: r.free_delivery_from_cents, slotCapacity: r.slot_capacity,
});
export const toStockout = (r: StockoutRow): PizzaStockout => ({ branchCode: r.branch_code, toppingKey: r.topping_key });
export const toLine = (r: LineRow): OrderLineView => ({
  line: r.line, pizzaCode: r.pizza_code, size: r.size, crust: r.crust, sauce: r.sauce, cheese: r.cheese, toppings: r.toppings, quantity: r.quantity, unitCents: r.unit_cents, lineCents: r.line_cents,
  toppingsKey: pizzaToppingsKey(r.toppings),
});
export const toOrder = (r: OrderRow, lines: OrderLineView[]): OrderView => ({
  orderNo: r.order_no, branchCode: r.branch_code, customerName: r.customer_name, customerEmail: r.customer_email, fulfilment: r.fulfilment, address: r.address, slotDate: r.slot_date, slotTime: r.slot_time,
  status: r.status, lines, subtotalCents: r.subtotal_cents, deliveryFeeCents: r.delivery_fee_cents, totalCents: r.total_cents, createdAt: r.created_at.toISOString(),
  lineCount: lines.length, pizzaCount: lines.reduce((n, i) => n + i.quantity, 0), updatedAt: r.updated_at?.toISOString() ?? null, cancelledAt: r.cancelled_at?.toISOString() ?? null,
});
