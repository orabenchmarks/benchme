import { CITY_LIST, FIRST_NAMES, LAST_NAMES, word } from "../../acme-v1/names.js";
import { type Rng, int, pick, shuffle, substream } from "../../prng.js";
import { addDays } from "../../stays.js";
import { PIZZA_CHEESES, PIZZA_CRUSTS, PIZZA_SAUCES, PIZZA_SIZE_KEYS, PIZZA_SIZE_SHAPES, PIZZA_SLOT_TIMES, PIZZA_TOPPING_SHAPES } from "./catalog.js";
import { pizzaMenuSearch, pizzaOutOfStock, pizzaPlaceOrder, pizzaSlotLeft, type PizzaLineInput, type PizzaMenuQuery } from "./rules.js";
import type { PizzaMenuItem, PizzaBranch, PizzaFulfilment, PizzaOrder, PizzaOrderStatus, PizzaRows, PizzaSize, PizzaStockout, PizzaTopping } from "./types.js";

/**
 * The pizza site's rows: two branches in each of six cities, the menu, the
 * toppings each branch has run out of, and orders already placed. Drawn from a
 * stream of its own (`substream(seed, "pizza")`), so adding the site moved no
 * other row. Some slots are full on purpose (and the slot after each such run
 * has room for one pizza only), and a few customers ordered their favourite
 * pizza more than once: a search has to check slots and stock, not just prices.
 */
export const PIZZA_ROW_COUNTS = { branchesPerCity: 2, pickupOnly: 3, menu: 14, customers: 24, orders: 64, fullRuns: 6, repeatCustomers: 4 } as const;

/** Seeded slots fall in these three weeks; the rest of 2027 is empty. */
const BUSY_FROM = "2027-05-03";
const BUSY_DAYS = 21;
const DISTRICTS = ["Market Street", "Riverside", "Old Town", "Station Road", "Harbour Quay", "North Gate", "Mill Lane", "Castle Hill"] as const;
const MENU_SUFFIXES = ["Garden", "Feast", "Melt", "Harvest", "Supreme", "Special", "Original", "Deluxe"] as const;
const STREETS = ["Street", "Road", "Lane", "Avenue"] as const;
type Kind = "meat" | "vegetarian" | "vegan";
type Customer = { name: string; email: string; city: string; address: string; favourite: PizzaMenuItem };

const r5 = (cents: number) => Math.round(cents / 5) * 5;
const listed = (xs: readonly string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

function makeSizes(rng: Rng): PizzaSize[] {
  let cents = int(rng, 16, 19) * 50;
  return PIZZA_SIZE_SHAPES.map((s, i) => {
    if (i > 0) cents += int(rng, 5, 7) * 50;
    return { ...s, baseCents: cents };
  });
}

function makeToppings(rng: Rng): PizzaTopping[] {
  return PIZZA_TOPPING_SHAPES.map(({ meat, ...t }) => {
    const small = (int(rng, 16, 30) + (meat ? 8 : 0)) * 5;
    return { ...t, allergens: [...t.allergens], pricesCents: { small, medium: r5(small * 1.25), large: r5(small * 1.5), xlarge: r5(small * 1.75) } };
  });
}

function makeMenu(rng: Rng, toppings: PizzaTopping[]): PizzaMenuItem[] {
  const meat = PIZZA_TOPPING_SHAPES.filter((t) => t.meat).map((t) => t.key);
  const vegetarian = toppings.filter((t) => t.vegetarian).map((t) => t.key);
  const vegan = toppings.filter((t) => t.vegan).map((t) => t.key);
  const kinds: Kind[] = shuffle(rng, [...Array<Kind>(5).fill("meat"), ...Array<Kind>(5).fill("vegetarian"), ...Array<Kind>(4).fill("vegan")]);
  const names = new Set<string>();
  return kinds.map((kind, i) => {
    let name = "";
    do name = `${word(rng)} ${pick(rng, MENU_SUFFIXES)}`;
    while (names.has(name));
    names.add(name);
    const crust = pick(rng, ["classic", "classic", "thin"]);
    const sauce = pick(rng, kind === "vegan" ? ["tomato", "tomato", "bbq"] : kind === "vegetarian" ? ["tomato", "tomato", "pesto", "garlic-cream", "bbq"] : ["tomato", "tomato", "bbq", "garlic-cream"]);
    const cheese = pick(rng, kind === "vegan" ? ["none", "cashew"] : ["regular", "regular", "extra"]);
    const chosen =
      kind === "meat"
        ? [...shuffle(rng, meat).slice(0, int(rng, 1, 2)), ...shuffle(rng, vegetarian).slice(0, int(rng, 1, 2))]
        : shuffle(rng, kind === "vegan" ? vegan : vegetarian).slice(0, int(rng, 2, 4));
    const parts = [sauce === "none" ? null : `${PIZZA_SAUCES.find((s) => s.key === sauce)?.name.toLowerCase()} sauce`, cheese === "none" ? null : PIZZA_CHEESES.find((c) => c.key === cheese)?.name.toLowerCase(), ...chosen.map((t) => toppings.find((x) => x.key === t)?.name.toLowerCase())];
    const text = listed(parts.filter((p): p is string => !!p));
    return {
      code: `PZ-${101 + i}`,
      name,
      description: `${text[0]?.toUpperCase()}${text.slice(1)} on a ${PIZZA_CRUSTS.find((c) => c.key === crust)?.name.toLowerCase()} crust.`,
      crust,
      sauce,
      cheese,
      toppings: [...chosen].sort(),
    };
  });
}

function makeBranches(rng: Rng): PizzaBranch[] {
  const total = CITY_LIST.length * PIZZA_ROW_COUNTS.branchesPerCity;
  const pickupOnly = new Set(shuffle(rng, Array.from({ length: total }, (_, i) => i)).slice(0, PIZZA_ROW_COUNTS.pickupOnly));
  return CITY_LIST.flatMap((city, c) =>
    shuffle(rng, DISTRICTS)
      .slice(0, PIZZA_ROW_COUNTS.branchesPerCity)
      .map((district, d) => {
        const n = c * PIZZA_ROW_COUNTS.branchesPerCity + d;
        const delivers = !pickupOnly.has(n);
        return {
          code: `BR-${101 + n}`,
          name: `${city} ${district}`,
          city,
          address: `${int(rng, 2, 98)} ${word(rng)} ${pick(rng, STREETS)}, ${city}`,
          delivers,
          deliveryFeeCents: delivers ? int(rng, 6, 10) * 50 : null,
          freeDeliveryFromCents: delivers ? pick(rng, [3000, 3500, 4000, 4500, 5000]) : null,
          slotCapacity: int(rng, 4, 8),
        };
      }),
  );
}

/** Diet filters a guest asks for; the cheapest menu pizza meeting each is out at a few branches on purpose. */
const DIET_TRAPS: readonly Omit<PizzaMenuQuery, "size">[] = [{ vegetarian: true, without: ["nuts"] }, { vegan: true, without: ["nuts"] }, { without: ["dairy"] }];

/**
 * 0–2 toppings out at each branch, drawn from those the menu uses, so some menu
 * pizzas cannot be made somewhere. Then, for each diet trap, two more branches
 * run out of a topping of the cheapest menu pizza that meets it: there, the
 * pizza a guest would pick from the menu alone cannot be made.
 */
function makeStockouts(rng: Rng, catalog: Omit<PizzaRows, "stockouts" | "orders">): PizzaStockout[] {
  const used = [...new Set(catalog.pizzas.flatMap((p) => p.toppings))].sort();
  const out = catalog.branches.flatMap((b) => shuffle(rng, used).slice(0, int(rng, 0, 2)).map((toppingKey) => ({ branchCode: b.code, toppingKey })));
  for (const trap of DIET_TRAPS) {
    const cheapest = pizzaMenuSearch({ ...catalog, stockouts: [] }, { size: "medium", ...trap })[0];
    if (!cheapest) continue;
    const able = catalog.branches.filter((b) => pizzaOutOfStock(out, b.code, cheapest.toppings).length === 0);
    for (const b of shuffle(rng, able).slice(0, 2)) out.push({ branchCode: b.code, toppingKey: pick(rng, cheapest.toppings) });
  }
  return out.sort((x, y) => x.branchCode.localeCompare(y.branchCode) || x.toppingKey.localeCompare(y.toppingKey));
}

function makeCustomers(rng: Rng, menu: PizzaMenuItem[]): Customer[] {
  const out = new Map<string, Customer>();
  while (out.size < PIZZA_ROW_COUNTS.customers) {
    const first = pick(rng, FIRST_NAMES);
    const last = pick(rng, LAST_NAMES);
    const email = `${first}.${last}${int(rng, 1, 9)}@example.org`.toLowerCase();
    const city = pick(rng, CITY_LIST);
    const address = `${int(rng, 2, 98)} ${word(rng)} ${pick(rng, STREETS)}, ${city}`;
    if (!out.has(email)) out.set(email, { name: `${first} ${last}`, email, city, address, favourite: pick(rng, menu) });
  }
  return [...out.values()];
}

export function pizzaRows(seed: number): PizzaRows {
  const rng = substream(seed, "pizza");
  const sizes = makeSizes(rng);
  const toppings = makeToppings(rng);
  const pizzas = makeMenu(rng, toppings);
  const branches = makeBranches(rng);
  const stockouts = makeStockouts(rng, { sizes, toppings, pizzas, branches });
  const customers = makeCustomers(rng, pizzas);
  const rows: PizzaRows = { sizes, toppings, pizzas, branches, stockouts, orders: [] };
  const canMake = (b: PizzaBranch, p: PizzaMenuItem) => pizzaOutOfStock(stockouts, b.code, p.toppings).length === 0;

  const customLine = (b: PizzaBranch): PizzaLineInput => {
    const size = pick(rng, PIZZA_SIZE_KEYS);
    const crusts = PIZZA_CRUSTS.filter((c) => c.sizes.includes(size));
    const stocked = toppings.filter((t) => pizzaOutOfStock(stockouts, b.code, [t.key]).length === 0).map((t) => t.key);
    return { size, crust: pick(rng, crusts).key, sauce: pick(rng, ["tomato", "tomato", "bbq", "pesto"]), cheese: pick(rng, ["regular", "regular", "extra"]), toppings: shuffle(rng, stocked).slice(0, int(rng, 1, 4)), quantity: int(rng, 1, 2) };
  };
  const menuLine = (b: PizzaBranch, want: PizzaMenuItem | null, quantity: number): PizzaLineInput | null => {
    const p = want && canMake(b, want) ? want : pick(rng, pizzas.filter((x) => canMake(b, x)));
    return p ? { pizzaCode: p.code, size: pick(rng, PIZZA_SIZE_KEYS), quantity } : null;
  };
  const place = (c: Customer, b: PizzaBranch, slotDate: string, slotTime: string, lines: PizzaLineInput[], status: PizzaOrderStatus, fulfilment: PizzaFulfilment): boolean => {
    const r = pizzaPlaceOrder(rows, { branchCode: b.code, fulfilment, address: fulfilment === "delivery" ? c.address : null, slotDate, slotTime, lines });
    if ("problem" in r) return false;
    const order: PizzaOrder = {
      orderNo: `PO-${10001 + rows.orders.length}`,
      branchCode: b.code,
      customerName: c.name,
      customerEmail: c.email,
      fulfilment,
      address: fulfilment === "delivery" ? c.address : null,
      slotDate,
      slotTime,
      status,
      lines: r.quote.lines,
      subtotalCents: r.quote.subtotalCents,
      deliveryFeeCents: r.quote.deliveryFeeCents,
      totalCents: r.quote.totalCents,
      createdAt: new Date(Date.UTC(2027, 3, 1 + int(rng, 0, 29), int(rng, 8, 22), int(rng, 0, 59))).toISOString(),
    };
    rows.orders.push(order);
    return true;
  };
  const busyDay = () => addDays(BUSY_FROM, int(rng, 0, BUSY_DAYS - 1));
  const inCity = (city: string) => branches.filter((b) => b.city === city);

  for (let i = 0; i < PIZZA_ROW_COUNTS.orders; i++) {
    const c = pick(rng, customers);
    const b = pick(rng, inCity(c.city));
    const fulfilment: PizzaFulfilment = b.delivers && rng() < 0.5 ? "delivery" : "pickup";
    const lines = Array.from({ length: rng() < 0.7 ? 1 : 2 }, () => (rng() < 0.75 ? menuLine(b, rng() < 0.6 ? c.favourite : null, int(rng, 1, 2)) : customLine(b))).filter((x): x is PizzaLineInput => !!x);
    const roll = rng();
    const status: PizzaOrderStatus = roll < 0.45 ? "received" : roll < 0.6 ? "preparing" : roll < 0.75 ? (fulfilment === "delivery" ? "out_for_delivery" : "preparing") : roll < 0.9 ? "delivered" : "cancelled";
    place(c, b, busyDay(), pick(rng, PIZZA_SLOT_TIMES), lines, status, fulfilment);
  }
  // Full on purpose: a run of 2–3 slots with no room left, then a slot with room for one pizza.
  for (let i = 0; i < PIZZA_ROW_COUNTS.fullRuns; i++) {
    const b = pick(rng, branches);
    const date = busyDay();
    const start = int(rng, 6, 14);
    const length = int(rng, 2, 3);
    for (let s = start; s <= start + length; s++) {
      const time = PIZZA_SLOT_TIMES[s] as string;
      const keep = s === start + length ? 1 : 0;
      for (let guard = 0; pizzaSlotLeft(b, rows.orders, date, time) > keep && guard < 20; guard++) {
        const c = pick(rng, customers);
        const item = menuLine(b, c.favourite, Math.min(pizzaSlotLeft(b, rows.orders, date, time) - keep, int(rng, 1, 3)));
        if (item) place(c, b, date, time, [item], rng() < 0.7 ? "received" : "preparing", "pickup");
      }
    }
  }
  // A few customers with their favourite pizza in two more received orders.
  for (const c of shuffle(rng, customers).slice(0, PIZZA_ROW_COUNTS.repeatCustomers)) {
    for (let n = 0, guard = 0; n < 2 && guard < 10; guard++) {
      const b = pick(rng, inCity(c.city).filter((x) => canMake(x, c.favourite)).concat(branches.filter((x) => canMake(x, c.favourite))));
      if (place(c, b, busyDay(), pick(rng, PIZZA_SLOT_TIMES), [{ pizzaCode: c.favourite.code, size: pick(rng, PIZZA_SIZE_KEYS), quantity: 1 }], "received", "pickup")) n++;
    }
  }
  return rows;
}
