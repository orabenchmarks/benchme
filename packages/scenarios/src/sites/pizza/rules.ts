import { isDate } from "../../stays.js";
import { PIZZA_ALLERGENS, PIZZA_CHEESES, PIZZA_CRUSTS, PIZZA_HOLDING, PIZZA_MAX_LINES, PIZZA_MAX_QUANTITY, PIZZA_MAX_TOPPINGS, PIZZA_SAUCES, PIZZA_SLOT_TIMES, PIZZA_WINDOW } from "./catalog.js";
import type { PizzaMenuItem, PizzaAllergen, PizzaBranch, PizzaConfig, PizzaFulfilment, PizzaOption, PizzaOrder, PizzaOrderLine, PizzaRows, PizzaSize, PizzaStockout } from "./types.js";

/**
 * The pizza site's rules, as pure functions over rows. apps/pizza enforces them
 * inside every write's transaction and answers every search with them, and the
 * intent corpus derives its answer keys with them, so the site and the keys
 * cannot disagree about what can be ordered, when, or what it costs.
 */

export type PizzaProblem = { code: string; message: string };
export type PizzaCatalog = Pick<PizzaRows, "sizes" | "toppings">;
/** One line of an order as a caller asks for it: a menu pizza (with any option named in its place), or a pizza from scratch. */
export type PizzaLineInput = { pizzaCode?: string | null; size: string; crust?: string; sauce?: string; cheese?: string; toppings?: readonly string[]; quantity: number };
export type PizzaQuoteInput = { branchCode: string; fulfilment: PizzaFulfilment; lines: readonly PizzaLineInput[] };
export type PizzaOrderInput = PizzaQuoteInput & { address?: string | null; slotDate: string; slotTime: string };
export type PizzaQuote = { branchCode: string; fulfilment: PizzaFulfilment; lines: PizzaOrderLine[]; subtotalCents: number; deliveryFeeCents: number; totalCents: number; outOfStock: string[] };
export type PizzaDiet = { vegetarian: boolean; vegan: boolean; allergens: PizzaAllergen[] };
export type PizzaMenuQuery = { size: string; branchCode?: string; vegetarian?: boolean; vegan?: boolean; without?: readonly string[]; maxPriceCents?: number; toppings?: readonly string[] };
export type PizzaMenuOffer = PizzaDiet & { pizzaCode: string; name: string; size: string; priceCents: number; crust: string; sauce: string; cheese: string; toppings: string[] };
export type PizzaSlot = { time: string; capacity: number; left: number };
export type PizzaSlotQuery = { branchCode: string; date: string; pizzas?: number; from?: string };
/** A change to one line of a received order: options replaced, toppings replaced, added or removed, quantity. */
export type PizzaLineChange = { size?: string; crust?: string; sauce?: string; cheese?: string; toppings?: readonly string[]; addToppings?: readonly string[]; removeToppings?: readonly string[]; quantity?: number };

const norm = (s: string) => s.trim().toLowerCase();
const code = (s: string) => s.trim().toUpperCase();
const byKey = <T extends { key: string }>(xs: readonly T[], key: string): T | undefined => xs.find((x) => x.key === key);
const listed = (xs: readonly string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const fail = (c: string, message: string) => ({ problem: { code: c, message } });

/** A topping set as one comparable string: the keys sorted and comma-joined. */
export const pizzaToppingsKey = (toppings: readonly string[]): string => [...toppings].sort().join(",");

/** The smallest size that serves `people`, or null when none does. */
export function pizzaSizeFor(sizes: readonly PizzaSize[], people: number): PizzaSize | null {
  return [...sizes].sort((x, y) => x.serves - y.serves).find((s) => s.serves >= people) ?? null;
}

/** The configuration a line asks for: its menu pizza's, with each option it names in its place; from scratch, a classic crust, tomato sauce, mozzarella and the toppings it names. */
export function pizzaResolveLine(pizzas: readonly PizzaMenuItem[], item: PizzaLineInput): { config: PizzaConfig; pizzaCode: string | null } | { problem: PizzaProblem } {
  const base = item.pizzaCode ? pizzas.find((p) => p.code === code(item.pizzaCode as string)) : undefined;
  if (item.pizzaCode && !base) return fail("UNKNOWN_PIZZA", `no menu pizza ${item.pizzaCode}`);
  const from = base ?? { crust: "classic", sauce: "tomato", cheese: "regular", toppings: [] as string[] };
  return {
    pizzaCode: base?.code ?? null,
    config: { size: norm(item.size), crust: norm(item.crust ?? from.crust), sauce: norm(item.sauce ?? from.sauce), cheese: norm(item.cheese ?? from.cheese), toppings: (item.toppings ?? from.toppings).map(norm).sort() },
  };
}

/** Why a configuration cannot be made at all: an unknown option, a crust not made in the size, a topping twice, too many, or nothing on it. */
export function pizzaConfigProblem(catalog: PizzaCatalog, c: PizzaConfig): PizzaProblem | null {
  const size = byKey(catalog.sizes, c.size);
  if (!size) return { code: "UNKNOWN_SIZE", message: `no size ${c.size}; the sizes are ${listed(catalog.sizes.map((s) => s.key))}` };
  const crust = byKey(PIZZA_CRUSTS, c.crust);
  if (!crust) return { code: "UNKNOWN_CRUST", message: `no crust ${c.crust}; the crusts are ${listed(PIZZA_CRUSTS.map((x) => x.key))}` };
  if (!crust.sizes.includes(size.key)) return { code: "CRUST_NOT_IN_SIZE", message: `the ${crust.name} crust is made in ${listed(crust.sizes)} only, not ${size.key}` };
  if (!byKey(PIZZA_SAUCES, c.sauce)) return { code: "UNKNOWN_SAUCE", message: `no sauce ${c.sauce}; the sauces are ${listed(PIZZA_SAUCES.map((x) => x.key))}` };
  if (!byKey(PIZZA_CHEESES, c.cheese)) return { code: "UNKNOWN_CHEESE", message: `no cheese ${c.cheese}; the cheeses are ${listed(PIZZA_CHEESES.map((x) => x.key))}` };
  const unknown = c.toppings.find((t) => !byKey(catalog.toppings, t));
  if (unknown !== undefined) return { code: "UNKNOWN_TOPPING", message: `no topping ${unknown}` };
  if (new Set(c.toppings).size !== c.toppings.length) return { code: "DUPLICATE_TOPPING", message: "each topping can be on a pizza once" };
  if (c.toppings.length > PIZZA_MAX_TOPPINGS) return { code: "TOO_MANY_TOPPINGS", message: `a pizza has at most ${PIZZA_MAX_TOPPINGS} toppings` };
  if (c.sauce === "none" && c.cheese === "none" && c.toppings.length === 0) return { code: "EMPTY_PIZZA", message: "a pizza needs a sauce, a cheese or a topping" };
  return null;
}

/** One pizza's price: the size's base, the crust and cheese surcharges in that size, and each topping's price in that size. The configuration must be valid. */
export function pizzaUnitCents(catalog: PizzaCatalog, c: PizzaConfig): number {
  const size = byKey(catalog.sizes, c.size) as PizzaSize;
  const crust = byKey(PIZZA_CRUSTS, c.crust);
  const cheese = byKey(PIZZA_CHEESES, c.cheese);
  const toppings = c.toppings.reduce((sum, t) => sum + (byKey(catalog.toppings, t)?.pricesCents[size.key] ?? 0), 0);
  return size.baseCents + (crust?.surchargeCents[size.key] ?? 0) + (cheese?.surchargeCents[size.key] ?? 0) + toppings;
}

/** Vegetarian or vegan when every part is; the allergens of every part, in PIZZA_ALLERGENS order. */
export function pizzaDiet(catalog: PizzaCatalog, c: Omit<PizzaConfig, "size">): PizzaDiet {
  const parts: PizzaOption[] = [byKey(PIZZA_CRUSTS, c.crust), byKey(PIZZA_SAUCES, c.sauce), byKey(PIZZA_CHEESES, c.cheese), ...c.toppings.map((t) => byKey(catalog.toppings, t))].filter((p): p is PizzaOption => !!p);
  return { vegetarian: parts.every((p) => p.vegetarian), vegan: parts.every((p) => p.vegan), allergens: PIZZA_ALLERGENS.filter((a) => parts.some((p) => p.allergens.includes(a))) };
}

/** The toppings in `toppings` that the branch has run out of, sorted. */
export function pizzaOutOfStock(stockouts: readonly PizzaStockout[], branchCode: string, toppings: readonly string[]): string[] {
  const out = new Set(stockouts.filter((s) => s.branchCode === code(branchCode)).map((s) => s.toppingKey));
  return [...new Set(toppings.filter((t) => out.has(t)))].sort();
}

/** No fee for pickup; for delivery the branch's fee, unless the subtotal reaches its free-delivery threshold. */
export function pizzaDeliveryFeeCents(branch: PizzaBranch, fulfilment: PizzaFulfilment, subtotalCents: number): number {
  if (fulfilment === "pickup") return 0;
  return branch.freeDeliveryFromCents !== null && subtotalCents >= branch.freeDeliveryFromCents ? 0 : (branch.deliveryFeeCents ?? 0);
}

/** Pizzas the branch can still make in one slot: its capacity less every pizza of the orders that hold it (all but cancelled), `exceptOrderNo` left out. */
export function pizzaSlotLeft(branch: PizzaBranch, orders: readonly PizzaOrder[], date: string, time: string, exceptOrderNo?: string): number {
  const held = orders
    .filter((o) => o.branchCode === branch.code && o.slotDate === date && o.slotTime === time && PIZZA_HOLDING.includes(o.status) && o.orderNo !== exceptOrderNo)
    .reduce((sum, o) => sum + o.lines.reduce((n, i) => n + i.quantity, 0), 0);
  return Math.max(0, branch.slotCapacity - held);
}

/** A branch's slots on a date, from `from` on, each with what it can still make — only those with room for `pizzas` when it is given. */
export function pizzaSlots(rows: Pick<PizzaRows, "branches" | "orders">, q: PizzaSlotQuery): PizzaSlot[] {
  const branch = rows.branches.find((b) => b.code === code(q.branchCode));
  if (!branch || !isDate(q.date) || q.date < PIZZA_WINDOW.first || q.date > PIZZA_WINDOW.last) return [];
  return PIZZA_SLOT_TIMES.filter((t) => !q.from || t >= q.from)
    .map((time) => ({ time, capacity: branch.slotCapacity, left: pizzaSlotLeft(branch, rows.orders, q.date, time) }))
    .filter((s) => s.left >= (q.pizzas ?? 0));
}

/** Every line resolved, checked and priced at the branch, and the order's subtotal, delivery fee and total. Stock is reported, not refused. */
export function pizzaQuote(rows: Omit<PizzaRows, "orders">, input: PizzaQuoteInput): { quote: PizzaQuote } | { problem: PizzaProblem } {
  const branch = rows.branches.find((b) => b.code === code(input.branchCode));
  if (!branch) return fail("UNKNOWN_BRANCH", `no branch ${input.branchCode}`);
  if (input.fulfilment === "delivery" && !branch.delivers) return fail("NO_DELIVERY", `${branch.name} does not deliver; order for pickup`);
  if (input.lines.length === 0) return fail("NO_LINES", "an order needs at least one pizza");
  if (input.lines.length > PIZZA_MAX_LINES) return fail("TOO_MANY_LINES", `an order has at most ${PIZZA_MAX_LINES} lines`);
  const lines: PizzaOrderLine[] = [];
  for (const [i, item] of input.lines.entries()) {
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > PIZZA_MAX_QUANTITY) return fail("BAD_QUANTITY", `a line is 1 to ${PIZZA_MAX_QUANTITY} pizzas`);
    const r = pizzaResolveLine(rows.pizzas, item);
    if ("problem" in r) return r;
    const p = pizzaConfigProblem(rows, r.config);
    if (p) return { problem: p };
    const unitCents = pizzaUnitCents(rows, r.config);
    lines.push({ line: i + 1, pizzaCode: r.pizzaCode, ...r.config, quantity: item.quantity, unitCents, lineCents: unitCents * item.quantity });
  }
  const subtotalCents = lines.reduce((sum, i) => sum + i.lineCents, 0);
  const deliveryFeeCents = pizzaDeliveryFeeCents(branch, input.fulfilment, subtotalCents);
  const outOfStock = pizzaOutOfStock(rows.stockouts, branch.code, lines.flatMap((i) => i.toppings));
  return { quote: { branchCode: branch.code, fulfilment: input.fulfilment, lines, subtotalCents, deliveryFeeCents, totalCents: subtotalCents + deliveryFeeCents, outOfStock } };
}

/** The slot rules: a date in the window, one of the slot times. */
function slotProblem(date: string, time: string): PizzaProblem | null {
  if (!isDate(date)) return { code: "BAD_DATE", message: `slot date ${date} is not a date (YYYY-MM-DD)` };
  if (date < PIZZA_WINDOW.first || date > PIZZA_WINDOW.last) return { code: "OUTSIDE_WINDOW", message: `orders are taken for slots from ${PIZZA_WINDOW.first} to ${PIZZA_WINDOW.last}` };
  if (!PIZZA_SLOT_TIMES.includes(time)) return { code: "BAD_SLOT_TIME", message: `slots start every 30 minutes from ${PIZZA_SLOT_TIMES[0]} to ${PIZZA_SLOT_TIMES[PIZZA_SLOT_TIMES.length - 1]}` };
  return null;
}

const outMessage = (rows: Pick<PizzaRows, "toppings">, branch: string, out: readonly string[]) =>
  `the ${branch} branch is out of ${listed(out.map((t) => rows.toppings.find((x) => x.key === t)?.name.toLowerCase() ?? t))}`;

/** The rule every new order is held to: the slot, the address, the lines (pizzaQuote), stock at the branch, then room in the slot. On success, the priced order. */
export function pizzaPlaceOrder(rows: PizzaRows, input: PizzaOrderInput): { quote: PizzaQuote } | { problem: PizzaProblem } {
  if (!rows.branches.some((b) => b.code === code(input.branchCode))) return fail("UNKNOWN_BRANCH", `no branch ${input.branchCode}`);
  const slot = slotProblem(input.slotDate, input.slotTime);
  if (slot) return { problem: slot };
  if (input.fulfilment === "delivery" && !(input.address ?? "").trim()) return fail("NO_ADDRESS", "a delivery needs an address");
  const q = pizzaQuote(rows, input);
  if ("problem" in q) return q;
  const branch = rows.branches.find((b) => b.code === q.quote.branchCode) as PizzaBranch;
  if (q.quote.outOfStock.length) return fail("TOPPING_OUT", outMessage(rows, branch.name, q.quote.outOfStock));
  const need = q.quote.lines.reduce((n, i) => n + i.quantity, 0);
  const left = pizzaSlotLeft(branch, rows.orders, input.slotDate, input.slotTime);
  if (need > left) return fail("SLOT_FULL", `${branch.name} can make ${left} more pizza(s) in the ${input.slotTime} slot on ${input.slotDate}; this order has ${need}`);
  return q;
}

/** Only a received order can be changed or cancelled. */
export function pizzaLockProblem(order: Pick<PizzaOrder, "orderNo" | "status">): PizzaProblem | null {
  if (order.status === "cancelled") return { code: "ALREADY_CANCELLED", message: `order ${order.orderNo} is already cancelled` };
  if (order.status !== "received") return { code: "ORDER_LOCKED", message: `order ${order.orderNo} is ${order.status.replace(/_/g, " ")}; only a received order can be changed or cancelled` };
  return null;
}

/** One line of a received order changed: the new configuration checked, its toppings in stock, the slot's room for the new quantities, the order re-priced. */
export function pizzaChangeLine(rows: PizzaRows, order: PizzaOrder, line: number, change: PizzaLineChange): { order: PizzaOrder } | { problem: PizzaProblem } {
  const lock = pizzaLockProblem(order);
  if (lock) return { problem: lock };
  const item = order.lines.find((i) => i.line === line);
  if (!item) return fail("UNKNOWN_LINE", `order ${order.orderNo} has no line ${line}`);
  let toppings = (change.toppings ?? item.toppings).map(norm);
  for (const t of (change.removeToppings ?? []).map(norm)) {
    if (!toppings.includes(t)) return fail("TOPPING_NOT_ON_PIZZA", `line ${line} has no ${t} to remove`);
    toppings = toppings.filter((x) => x !== t);
  }
  toppings = [...toppings, ...(change.addToppings ?? []).map(norm)];
  const asInput = (i: PizzaOrderLine): PizzaLineInput => ({ size: i.size, crust: i.crust, sauce: i.sauce, cheese: i.cheese, toppings: i.toppings, quantity: i.quantity });
  const changed: PizzaLineInput = { size: change.size ?? item.size, crust: change.crust ?? item.crust, sauce: change.sauce ?? item.sauce, cheese: change.cheese ?? item.cheese, toppings, quantity: change.quantity ?? item.quantity };
  const q = pizzaQuote(rows, { branchCode: order.branchCode, fulfilment: order.fulfilment, lines: order.lines.map((i) => (i.line === line ? changed : asInput(i))) });
  if ("problem" in q) return q;
  const branch = rows.branches.find((b) => b.code === order.branchCode) as PizzaBranch;
  const now = q.quote.lines[order.lines.indexOf(item)] as PizzaOrderLine;
  const out = pizzaOutOfStock(rows.stockouts, branch.code, now.toppings);
  if (out.length) return fail("TOPPING_OUT", outMessage(rows, branch.name, out));
  const need = q.quote.lines.reduce((n, i) => n + i.quantity, 0);
  const left = pizzaSlotLeft(branch, rows.orders, order.slotDate, order.slotTime, order.orderNo);
  if (need > left) return fail("SLOT_FULL", `${branch.name} can make ${left} more pizza(s) for this order's slot; it would have ${need}`);
  const lines = q.quote.lines.map((i, n) => ({ ...i, pizzaCode: order.lines[n]?.pizzaCode ?? null, line: order.lines[n]?.line ?? i.line }));
  return { order: { ...order, lines, subtotalCents: q.quote.subtotalCents, deliveryFeeCents: q.quote.deliveryFeeCents, totalCents: q.quote.totalCents } };
}

/** Every menu pizza that can be made in the size (at the branch, when one is named: none of its toppings out there) and meets each filter, cheapest first. */
export function pizzaMenuSearch(rows: Omit<PizzaRows, "orders">, q: PizzaMenuQuery): PizzaMenuOffer[] {
  const size = norm(q.size);
  const without = (q.without ?? []).map(norm).filter(Boolean);
  const must = (q.toppings ?? []).map(norm).filter(Boolean);
  if (q.branchCode && !rows.branches.some((b) => b.code === code(q.branchCode as string))) return [];
  const offers: PizzaMenuOffer[] = [];
  for (const p of rows.pizzas) {
    const config: PizzaConfig = { size, crust: p.crust, sauce: p.sauce, cheese: p.cheese, toppings: p.toppings };
    if (pizzaConfigProblem(rows, config)) continue;
    if (q.branchCode && pizzaOutOfStock(rows.stockouts, q.branchCode, p.toppings).length) continue;
    const diet = pizzaDiet(rows, config);
    if ((q.vegetarian && !diet.vegetarian) || (q.vegan && !diet.vegan) || without.some((a) => (diet.allergens as string[]).includes(a))) continue;
    if (must.some((t) => !p.toppings.includes(t))) continue;
    const priceCents = pizzaUnitCents(rows, config);
    if (q.maxPriceCents !== undefined && priceCents > q.maxPriceCents) continue;
    offers.push({ pizzaCode: p.code, name: p.name, size, priceCents, crust: p.crust, sauce: p.sauce, cheese: p.cheese, toppings: p.toppings, ...diet });
  }
  return offers.sort((x, y) => x.priceCents - y.priceCents || x.pizzaCode.localeCompare(y.pizzaCode));
}
