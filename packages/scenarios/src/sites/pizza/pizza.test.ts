import { describe, expect, it } from "vitest";
import { webmcpV1 } from "../../webmcp-v1/index.js";
import { CITY_LIST } from "../../acme-v1/names.js";
import { addDays } from "../../stays.js";
import { PIZZA_SIZE_KEYS, PIZZA_SLOT_TIMES } from "./catalog.js";
import { PIZZA_ROW_COUNTS, pizzaRows } from "./generate.js";
import {
  pizzaChangeLine, pizzaConfigProblem, pizzaDeliveryFeeCents, pizzaDiet, pizzaMenuSearch, pizzaOutOfStock, pizzaPlaceOrder, pizzaQuote, pizzaSizeFor, pizzaSlotLeft, pizzaSlots, pizzaUnitCents,
} from "./rules.js";
import type { PizzaOrder, PizzaRows } from "./types.js";

describe("webmcp-v1 pizza rows", () => {
  const rows = pizzaRows(4242);

  it("is byte-identical for the same seed, and the same rows webmcpV1.generate carries", () => {
    expect(JSON.stringify(pizzaRows(4242))).toBe(JSON.stringify(rows));
    expect(JSON.stringify(pizzaRows(4243))).not.toBe(JSON.stringify(rows));
    expect(webmcpV1.generate(4242).pizza).toEqual(rows);
  });

  it("has two branches in every city, unique codes and names, and rows that reference what exists", () => {
    for (const city of CITY_LIST) expect(rows.branches.filter((b) => b.city === city)).toHaveLength(PIZZA_ROW_COUNTS.branchesPerCity);
    for (const xs of [rows.branches.map((b) => b.code), rows.branches.map((b) => b.name), rows.pizzas.map((p) => p.code), rows.pizzas.map((p) => p.name), rows.orders.map((o) => o.orderNo)]) expect(new Set(xs).size).toBe(xs.length);
    expect(rows.sizes.map((s) => s.key)).toEqual(PIZZA_SIZE_KEYS);
    const toppings = new Set(rows.toppings.map((t) => t.key));
    const branches = new Set(rows.branches.map((b) => b.code));
    const pizzas = new Set(rows.pizzas.map((p) => p.code));
    for (const p of rows.pizzas) for (const t of p.toppings) expect(toppings.has(t)).toBe(true);
    for (const s of rows.stockouts) expect([branches.has(s.branchCode), toppings.has(s.toppingKey)]).toEqual([true, true]);
    for (const o of rows.orders) {
      expect(branches.has(o.branchCode)).toBe(true);
      for (const i of o.lines) expect(i.pizzaCode === null || pizzas.has(i.pizzaCode)).toBe(true);
    }
    for (const b of rows.branches) expect([b.delivers, b.delivers]).toEqual([b.deliveryFeeCents !== null, b.freeDeliveryFromCents !== null]);
    expect(rows.branches.filter((b) => !b.delivers)).toHaveLength(PIZZA_ROW_COUNTS.pickupOnly);
  });

  it("holds every menu pizza and every order to the rules: options, stock, the window, slot room and totals", () => {
    for (const p of rows.pizzas) for (const size of PIZZA_SIZE_KEYS) expect(pizzaConfigProblem(rows, { size, crust: p.crust, sauce: p.sauce, cheese: p.cheese, toppings: p.toppings })).toBeNull();
    const branch = new Map(rows.branches.map((b) => [b.code, b]));
    for (const o of rows.orders) {
      const q = pizzaQuote(rows, { branchCode: o.branchCode, fulfilment: o.fulfilment, lines: o.lines });
      if (!("quote" in q)) throw new Error(`${o.orderNo}: ${q.problem.message}`);
      expect(q.quote.lines.map((i) => [i.unitCents, i.lineCents])).toEqual(o.lines.map((i) => [i.unitCents, i.lineCents]));
      expect([o.subtotalCents, o.deliveryFeeCents, o.totalCents]).toEqual([q.quote.subtotalCents, q.quote.deliveryFeeCents, q.quote.totalCents]);
      expect(o.slotDate >= "2027-01-01" && o.slotDate <= "2027-12-31" && PIZZA_SLOT_TIMES.includes(o.slotTime)).toBe(true);
      expect(o.fulfilment === "delivery" ? !!o.address && branch.get(o.branchCode)?.delivers : o.address === null).toBe(true);
      if (o.status !== "cancelled") expect(q.quote.outOfStock).toEqual([]);
    }
    const slots = new Set(rows.orders.map((o) => `${o.branchCode}|${o.slotDate}|${o.slotTime}`));
    for (const key of slots) {
      const [code, date, time] = key.split("|") as [string, string, string];
      const b = branch.get(code)!;
      const held = rows.orders.filter((o) => o.status !== "cancelled" && `${o.branchCode}|${o.slotDate}|${o.slotTime}` === key).reduce((n, o) => n + o.lines.reduce((m, i) => m + i.quantity, 0), 0);
      expect(held).toBeLessThanOrEqual(b.slotCapacity);
      expect(pizzaSlotLeft(b, rows.orders, date, time)).toBe(b.slotCapacity - held);
    }
  });

  it("fills some slots on purpose, leaves one pizza of room after them, and seeds the states the tasks need", () => {
    const left = rows.branches.flatMap((b) => Array.from({ length: 21 }, (_, d) => pizzaSlots(rows, { branchCode: b.code, date: addDays("2027-05-03", d) })).flat());
    expect(left.filter((s) => s.left === 0).length).toBeGreaterThanOrEqual(PIZZA_ROW_COUNTS.fullRuns * 2);
    expect(left.some((s) => s.left === 1)).toBe(true);
    expect(rows.orders.some((o) => o.status === "cancelled")).toBe(true);
    expect(new Set(rows.orders.map((o) => o.status)).size).toBe(5);
    expect(rows.pizzas.some((p) => rows.branches.some((b) => pizzaOutOfStock(rows.stockouts, b.code, p.toppings).length > 0))).toBe(true);
    const received = rows.orders.filter((o) => o.status === "received");
    const repeat = rows.toppings.some((t) => new Set(received.filter((o) => o.lines.some((i) => i.toppings.includes(t.key))).map((o) => o.customerEmail)).size < received.filter((o) => o.lines.some((i) => i.toppings.includes(t.key))).length);
    expect(repeat).toBe(true);
  });
});

describe("pizza rules", () => {
  const base: PizzaRows = {
    sizes: [
      { key: "small", name: "Small", inches: 10, serves: 1, baseCents: 1000 },
      { key: "medium", name: "Medium", inches: 12, serves: 2, baseCents: 1300 },
      { key: "large", name: "Large", inches: 14, serves: 4, baseCents: 1600 },
      { key: "xlarge", name: "Extra large", inches: 16, serves: 6, baseCents: 1900 },
    ],
    toppings: [
      { key: "mushroom", name: "Mushrooms", vegetarian: true, vegan: true, allergens: [], pricesCents: { small: 100, medium: 125, large: 150, xlarge: 175 } },
      { key: "walnut", name: "Walnuts", vegetarian: true, vegan: true, allergens: ["nuts"], pricesCents: { small: 120, medium: 150, large: 180, xlarge: 210 } },
      { key: "ham", name: "Ham", vegetarian: false, vegan: false, allergens: [], pricesCents: { small: 150, medium: 190, large: 225, xlarge: 260 } },
    ],
    pizzas: [
      { code: "PZ-1", name: "Veg", description: "", crust: "classic", sauce: "tomato", cheese: "regular", toppings: ["mushroom"] },
      { code: "PZ-2", name: "Nut", description: "", crust: "classic", sauce: "tomato", cheese: "none", toppings: ["mushroom", "walnut"] },
      { code: "PZ-3", name: "Ham", description: "", crust: "thin", sauce: "bbq", cheese: "regular", toppings: ["ham"] },
    ],
    branches: [
      { code: "BR-1", name: "One", city: "Velmora", address: "1 A Street", delivers: true, deliveryFeeCents: 400, freeDeliveryFromCents: 3000, slotCapacity: 3 },
      { code: "BR-2", name: "Two", city: "Velmora", address: "2 B Street", delivers: false, deliveryFeeCents: null, freeDeliveryFromCents: null, slotCapacity: 2 },
    ],
    stockouts: [{ branchCode: "BR-2", toppingKey: "walnut" }],
    orders: [],
  };
  const order = (o: Partial<PizzaOrder> & { quantity?: number }): PizzaOrder => ({
    orderNo: "PO-1", branchCode: "BR-1", customerName: "C", customerEmail: "c@example.com", fulfilment: "pickup", address: null, slotDate: "2027-04-10", slotTime: "18:00", status: "received",
    lines: [{ line: 1, pizzaCode: "PZ-1", size: "small", crust: "classic", sauce: "tomato", cheese: "regular", toppings: ["mushroom"], quantity: o.quantity ?? 2, unitCents: 1100, lineCents: 1100 * (o.quantity ?? 2) }],
    subtotalCents: 2200, deliveryFeeCents: 0, totalCents: 2200, createdAt: "", ...o,
  });
  const input = { branchCode: "BR-1", fulfilment: "pickup" as const, slotDate: "2027-04-10", slotTime: "18:00", lines: [{ pizzaCode: "PZ-1", size: "small", quantity: 1 }] };
  const codeOf = (r: { problem: { code: string } } | object) => ("problem" in r ? r.problem.code : null);
  const cfg = { size: "medium", crust: "classic", sauce: "tomato", cheese: "regular", toppings: ["mushroom"] };

  it("refuses each configuration rule on its own", () => {
    expect(pizzaConfigProblem(base, cfg)).toBeNull();
    for (const [c, code] of [
      [{ size: "huge" }, "UNKNOWN_SIZE"], [{ crust: "deep" }, "UNKNOWN_CRUST"], [{ size: "large", crust: "gluten-free" }, "CRUST_NOT_IN_SIZE"], [{ size: "small", crust: "stuffed" }, "CRUST_NOT_IN_SIZE"],
      [{ sauce: "salsa" }, "UNKNOWN_SAUCE"], [{ cheese: "blue" }, "UNKNOWN_CHEESE"], [{ toppings: ["kale"] }, "UNKNOWN_TOPPING"], [{ toppings: ["ham", "ham"] }, "DUPLICATE_TOPPING"],
      [{ sauce: "none", cheese: "none", toppings: [] }, "EMPTY_PIZZA"],
    ] as const) expect(pizzaConfigProblem(base, { ...cfg, ...c, toppings: [...("toppings" in c ? c.toppings : cfg.toppings)] })?.code).toBe(code);
    const six = { ...base, toppings: Array.from({ length: 6 }, (_, i) => ({ ...base.toppings[0]!, key: `t${i}` })) };
    expect(pizzaConfigProblem(six, { ...cfg, toppings: six.toppings.map((t) => t.key) })?.code).toBe("TOO_MANY_TOPPINGS");
  });

  it("refuses each order rule on its own, and prices what it takes", () => {
    expect(codeOf(pizzaPlaceOrder(base, input))).toBeNull();
    for (const [o, code] of [
      [{ branchCode: "BR-9" }, "UNKNOWN_BRANCH"], [{ slotDate: "2027-02-30" }, "BAD_DATE"], [{ slotDate: "2028-01-03" }, "OUTSIDE_WINDOW"], [{ slotTime: "18:15" }, "BAD_SLOT_TIME"],
      [{ fulfilment: "delivery" }, "NO_ADDRESS"], [{ branchCode: "BR-2", fulfilment: "delivery", address: "x" }, "NO_DELIVERY"], [{ lines: [] }, "NO_LINES"],
      [{ lines: Array(7).fill(input.lines[0]) }, "TOO_MANY_LINES"], [{ lines: [{ size: "small", quantity: 11 }] }, "BAD_QUANTITY"], [{ lines: [{ pizzaCode: "PZ-9", size: "small", quantity: 1 }] }, "UNKNOWN_PIZZA"],
      [{ branchCode: "BR-2", lines: [{ pizzaCode: "PZ-2", size: "small", quantity: 1 }] }, "TOPPING_OUT"], [{ lines: [{ pizzaCode: "PZ-1", size: "small", quantity: 4 }] }, "SLOT_FULL"],
    ] as const) expect(codeOf(pizzaPlaceOrder(base, { ...input, ...o } as typeof input))).toBe(code);
    expect(codeOf(pizzaPlaceOrder({ ...base, orders: [order({})] }, { ...input, lines: [{ pizzaCode: "PZ-1", size: "small", quantity: 2 }] }))).toBe("SLOT_FULL");
    expect(codeOf(pizzaPlaceOrder({ ...base, orders: [order({ status: "cancelled" })] }, { ...input, lines: [{ pizzaCode: "PZ-1", size: "small", quantity: 3 }] }))).toBeNull();
  });

  it("prices a pizza by size, crust, cheese and toppings, and delivery by the branch's threshold", () => {
    expect(pizzaUnitCents(base, { size: "large", crust: "stuffed", sauce: "pesto", cheese: "extra", toppings: ["mushroom", "walnut"] })).toBe(1600 + 300 + 200 + 150 + 180);
    expect(pizzaUnitCents(base, { size: "small", crust: "gluten-free", sauce: "tomato", cheese: "cashew", toppings: [] })).toBe(1000 + 300 + 150);
    const br = base.branches[0]!;
    expect([pizzaDeliveryFeeCents(br, "delivery", 2999), pizzaDeliveryFeeCents(br, "delivery", 3000), pizzaDeliveryFeeCents(br, "pickup", 10)]).toEqual([400, 0, 0]);
    const q = pizzaQuote(base, { branchCode: "BR-1", fulfilment: "delivery", lines: [{ pizzaCode: "PZ-1", size: "medium", toppings: ["ham"], quantity: 2 }] });
    expect("quote" in q && [q.quote.lines[0]?.toppings, q.quote.subtotalCents, q.quote.totalCents]).toEqual([["ham"], 2 * 1490, 2 * 1490 + 400]);
    expect(pizzaDiet(base, { crust: "classic", sauce: "pesto", cheese: "none", toppings: ["walnut"] })).toEqual({ vegetarian: true, vegan: false, allergens: ["gluten", "dairy", "nuts"] });
    expect([pizzaSizeFor(base.sizes, 3)?.key, pizzaSizeFor(base.sizes, 5)?.key, pizzaSizeFor(base.sizes, 7)]).toEqual(["large", "xlarge", null]);
  });

  it("changes a received order's line only, re-prices it, and refuses what the rules refuse", () => {
    const o = order({ branchCode: "BR-1", fulfilment: "delivery", address: "x", quantity: 1, subtotalCents: 1100, deliveryFeeCents: 400, totalCents: 1500 });
    const r = pizzaChangeLine(base, o, 1, { removeToppings: ["mushroom"], addToppings: ["ham"], quantity: 2 });
    expect("order" in r && [r.order.lines[0]?.toppings, r.order.lines[0]?.pizzaCode, r.order.subtotalCents, r.order.deliveryFeeCents]).toEqual([["ham"], "PZ-1", 2 * 1150, 400]);
    const big = pizzaChangeLine(base, o, 1, { size: "xlarge", quantity: 2 });
    expect("order" in big && [big.order.subtotalCents, big.order.deliveryFeeCents]).toEqual([2 * 2075, 0]);
    expect(codeOf(pizzaChangeLine(base, { ...o, status: "preparing" }, 1, { quantity: 1 }))).toBe("ORDER_LOCKED");
    expect(codeOf(pizzaChangeLine(base, { ...o, status: "cancelled" }, 1, { quantity: 1 }))).toBe("ALREADY_CANCELLED");
    expect(codeOf(pizzaChangeLine(base, o, 2, { quantity: 1 }))).toBe("UNKNOWN_LINE");
    expect(codeOf(pizzaChangeLine(base, o, 1, { removeToppings: ["ham"] }))).toBe("TOPPING_NOT_ON_PIZZA");
    expect(codeOf(pizzaChangeLine(base, { ...o, branchCode: "BR-2", fulfilment: "pickup" }, 1, { addToppings: ["walnut"] }))).toBe("TOPPING_OUT");
    expect(codeOf(pizzaChangeLine({ ...base, orders: [order({ orderNo: "PO-2", quantity: 2 })] }, o, 1, { quantity: 2 }))).toBe("SLOT_FULL");
  });

  it("searches the menu by size, diet, allergens, branch stock, cap and toppings, cheapest first; counts slots", () => {
    const q = { size: "small" };
    expect(pizzaMenuSearch(base, q).map((o) => [o.pizzaCode, o.priceCents])).toEqual([["PZ-1", 1100], ["PZ-3", 1150], ["PZ-2", 1220]]);
    expect(pizzaMenuSearch(base, { ...q, vegetarian: true }).map((o) => o.pizzaCode)).toEqual(["PZ-1", "PZ-2"]);
    expect(pizzaMenuSearch(base, { ...q, vegan: true }).map((o) => o.pizzaCode)).toEqual(["PZ-2"]);
    expect(pizzaMenuSearch(base, { ...q, vegetarian: true, without: ["nuts"] }).map((o) => o.pizzaCode)).toEqual(["PZ-1"]);
    expect(pizzaMenuSearch(base, { ...q, branchCode: "BR-2" }).map((o) => o.pizzaCode)).toEqual(["PZ-1", "PZ-3"]);
    expect(pizzaMenuSearch(base, { ...q, maxPriceCents: 1150 }).map((o) => o.pizzaCode)).toEqual(["PZ-1", "PZ-3"]);
    expect(pizzaMenuSearch(base, { ...q, toppings: ["walnut"] }).map((o) => o.pizzaCode)).toEqual(["PZ-2"]);
    expect(pizzaMenuSearch(base, { ...q, branchCode: "BR-9" })).toEqual([]);
    const rows = { ...base, orders: [order({ quantity: 2 }), order({ orderNo: "PO-2", slotTime: "18:30", quantity: 3 }), order({ orderNo: "PO-3", slotTime: "19:00", status: "cancelled", quantity: 3 })] };
    expect(pizzaSlots(rows, { branchCode: "BR-1", date: "2027-04-10", from: "18:00" }).slice(0, 3)).toEqual([{ time: "18:00", capacity: 3, left: 1 }, { time: "18:30", capacity: 3, left: 0 }, { time: "19:00", capacity: 3, left: 3 }]);
    expect(pizzaSlots(rows, { branchCode: "BR-1", date: "2027-04-10", from: "18:00", pizzas: 2 })[0]?.time).toBe("19:00");
    expect(pizzaSlots(rows, { branchCode: "BR-1", date: "2028-04-10" })).toEqual([]);
  });
});
