/**
 * Pizza ordering intent templates (apps/pizza, "Marlivo Pizza"). Shaped on the
 * pizza-maker demo in GoogleChromeLabs/webmcp-tools and its webmcp-evals
 * (Apache-2.0): build an exact pizza (a size for a number of people, a crust,
 * toppings taken off and added), revise a pizza already made, and price it —
 * here as orders at a branch, with slots and stock. Those suites grade the tool
 * calls an agent makes; these grade the answer or the site's end state, so an
 * agent may use the pages, REST, MCP or WebMCP. See ./index.mjs for the contract.
 *
 * Stock and slots are what most of these turn on: some branches have run out of
 * a topping, so a menu pizza that fits every filter cannot be made there, and
 * some slots are full on purpose (packages/scenarios/src/sites/pizza/generate.ts).
 * The rules every answer key is derived with are @benchme/scenarios' pizza rules,
 * the same functions the site enforces.
 *
 * Claims: an order takes pizzas out of its slot, so every task that places an
 * order claims its branch's day (`pizza:day:<branch>:<date>`); a task about a
 * customer claims the customer; a change claims each order it may touch. Menu
 * and price questions depend on stock and prices, which no task writes; they
 * claim their branch only to spread over branches (and the two menu kinds
 * never ask the same branch, size and filter).
 *
 * Expected calls: an order's `place_order` with what the task fixes or has the
 * agent find (the branch, the slot, the menu pizza, its size, crust and
 * quantity, its topping set in any order, the customer's email; the name left
 * free); a topping taken off is `change_order_line` of the order and line
 * named, which a run may say by what goes (`removeToppings`) or by what stays
 * (`toppings`), so neither is published. A price is in a quote and in the menu
 * with the branch's fees, and a menu question is answered by a search or by
 * the menu itself, so no question declares a call.
 */
import { PIZZA_CHEESES, PIZZA_CRUSTS, PIZZA_SAUCES, addDays, pizzaChangeLine, pizzaDeliveryFeeCents, pizzaMenuSearch, pizzaOutOfStock, pizzaPlaceOrder, pizzaSizeFor, pizzaSlots, pizzaToppingsKey, pizzaUnitCents, shuffle } from "../../../packages/scenarios/dist/index.js";
import { anyOrder, call, free, published } from "../calls.mjs";
import { int, pick, usd } from "../kit.mjs";
import { R } from "../rubrics.mjs";

const APP = "pizza";
const ORDERS = "/api/v1/orders";
const PAGES_AND_TOOLS = ["pages", "tools"];
/** New customers the ordering tasks order for: names no seeded customer has, at a domain no seeded email uses. */
const GUEST_FIRST = ["Aurelio", "Brisa", "Caspian", "Dagny", "Elio", "Florin"];
const GUEST_LAST = ["Ashdown", "Brightwater", "Copperfield", "Dunmore", "Everly", "Foxley"];
/** No seeded slot is after May 2027, so every slot is empty in the autumn. */
const QUIET_FROM = "2027-09-06";
/** The menu filters the menu tasks ask for, and how an intent says each. */
const FILTERS = [
  { key: "vegetarian-nuts", text: "vegetarian and contains no nuts", query: { vegetarian: true, without: ["nuts"] }, params: { vegetarian: "true", without: "nuts" } },
  { key: "vegan-nuts", text: "vegan and contains no nuts", query: { vegan: true, without: ["nuts"] }, params: { vegan: "true", without: "nuts" } },
  { key: "any-dairy", text: "free of dairy", query: { without: ["dairy"] }, params: { without: "dairy" } },
];

const cache = new WeakMap();
/** The pizza rows indexed once per scenario (kit.mjs's context does not know this site). */
function ix(ctx) {
  const rows = ctx.rows.pizza;
  if (!cache.has(rows)) {
    cache.set(rows, {
      rows,
      branch: new Map(rows.branches.map((b) => [b.code, b])),
      size: new Map(rows.sizes.map((s) => [s.key, s])),
      topping: new Map(rows.toppings.map((t) => [t.key, t])),
      canMake: (b, p) => pizzaOutOfStock(rows.stockouts, b.code, p.toppings).length === 0,
    });
  }
  return cache.get(rows);
}
const sizeText = (size) => size.name.toLowerCase();
const crustText = (key) => `${PIZZA_CRUSTS.find((c) => c.key === key).name.toLowerCase()} crust`;
const sauceText = (key) => `${PIZZA_SAUCES.find((s) => s.key === key).name.toLowerCase()} sauce`;
const cheeseText = (key) => PIZZA_CHEESES.find((c) => c.key === key).name.toLowerCase();
const listed = (xs) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const dollars = (cents) => `$${cents / 100}`;
const guestOf = (i) => {
  const first = GUEST_FIRST[i % GUEST_FIRST.length];
  const last = GUEST_LAST[Math.floor(i / GUEST_FIRST.length) % GUEST_LAST.length];
  return { name: `${first} ${last}`, email: `${first}.${last}@order.example`.toLowerCase() };
};
const enc = encodeURIComponent;
const ordersOf = (email) => `${ORDERS}?customerEmail=${enc(email)}`;
const order = (api, body) => api.post(APP, ORDERS, body);
const searchPath = (size, branch, filter, maxCents) =>
  `/api/v1/search?${new URLSearchParams({ size, branch, ...filter.params, ...(maxCents !== undefined ? { maxPrice: String(maxCents / 100) } : {}) })}`;
const pickupBody = (branch, guest, slotDate, slotTime, lines) => ({ branchCode: branch.code, fulfilment: "pickup", slotDate, slotTime, customerName: guest.name, customerEmail: guest.email, lines });
/** The order a correct solution makes: the reference one's body, through the tool. */
const ordering = (body) => call("place_order", body, { customerName: free });
/**
 * A topping set the integrity tool sends as given, published as the same toppings in any order: webmcp-evals
 * matches an array element by element, and a run may list a pizza's toppings in any order.
 */
const toppingSet = (keys) => published(keys, anyOrder(keys));

/** (branch, size, filter) for every branch and size: the menu tasks' search space. */
const menuSpace = (ctx) => {
  const { rows } = ix(ctx);
  return rows.branches.flatMap((branch) => rows.sizes.flatMap((size) => FILTERS.map((filter) => ({ branch, size, filter }))));
};
/** The two menu tasks never ask the same (branch, size, filter); each spreads over branches by its own claim. */
const menuClaim = (s) => `pizza:menu:${s.branch.code}:${s.size.key}:${s.filter.key}`;
/** The cheapest menu pizza in the size that meets the filter, is cheaper than `than`, and cannot be made at the branch. */
const unmakeableBelow = (rows, branch, size, filter, than) =>
  pizzaMenuSearch(rows, { size: size.key, ...filter.query }).find((o) => o.priceCents < than && pizzaOutOfStock(rows.stockouts, branch.code, o.toppings).length > 0);

export const pizzaTemplates = [
  {
    key: "pizza-custom-order",
    app: APP,
    oracle: "state",
    surfaces: PAGES_AND_TOOLS,
    count: 3,
    about:
      "Order, for a new customer, one menu pizza changed in the builder: the smallest size that serves a number of people (`pizzaSizeFor`), another crust made in that size, one of its toppings taken off and one added (in stock at the branch), for pickup in an empty autumn slot. The check reads the customer's orders: exactly one received order in that slot, with one line whose size, crust, sauce, cheese, exact topping set and quantity are the ones asked. The miss keeps the topping that was to be taken off.",
    candidates: (ctx) => {
      const { rows, canMake } = ix(ctx);
      return rows.pizzas.flatMap((pizza, p) => rows.branches.filter((b) => canMake(b, pizza)).map((branch, b) => ({ pizza, branch, i: p * 12 + b })));
    },
    claims: (s, ctx) => {
      const guest = guestOf(s.i);
      return [`pizza:customer:${guest.email}`, `pizza:day:${s.branch.code}:${addDays(QUIET_FROM, s.i % 50)}`];
    },
    build({ pizza, branch, i }, ctx, rng) {
      const { rows, size: sizeOf, topping } = ix(ctx);
      const people = pick(rng, [2, 3, 5]);
      const size = pizzaSizeFor(rows.sizes, people);
      const crusts = PIZZA_CRUSTS.filter((c) => c.key !== pizza.crust && c.sizes.includes(size.key));
      const off = pick(rng, pizza.toppings);
      const addable = rows.toppings.filter((t) => !pizza.toppings.includes(t.key) && pizzaOutOfStock(rows.stockouts, branch.code, [t.key]).length === 0);
      if (!size || crusts.length === 0 || addable.length === 0) return null;
      const crust = pick(rng, crusts).key;
      const on = pick(rng, addable).key;
      const guest = guestOf(i);
      const slotDate = addDays(QUIET_FROM, i % 50);
      const slotTime = pick(rng, ["12:30", "13:00", "18:00", "18:30", "19:00", "19:30"]);
      const toppings = [...pizza.toppings.filter((t) => t !== off), on].sort();
      const body = pickupBody(branch, guest, slotDate, slotTime, [{ pizzaCode: pizza.code, size: size.key, crust, toppings, quantity: 1 }]);
      const kept = pickupBody(branch, guest, slotDate, slotTime, [{ pizzaCode: pizza.code, size: size.key, crust, toppings: [...pizza.toppings, on].sort(), quantity: 1 }]);
      if ("problem" in pizzaPlaceOrder(rows, body) || "problem" in pizzaPlaceOrder(rows, kept)) return null;
      const offName = topping.get(off).name.toLowerCase();
      const onName = topping.get(on).name.toLowerCase();
      return {
        intent: `On the pizza ordering site, place a pickup order at ${branch.name} (${branch.code}) for ${guest.name} (${guest.email}), in the ${slotTime} slot on ${slotDate}: one ${pizza.name} (${pizza.code}) in the smallest size that serves ${people} people, on the ${crustText(crust)}, without the ${offName} and with ${onName} added.`,
        summary: `${guest.email} has one received pickup order at ${branch.code} for ${slotDate} ${slotTime}: one ${pizza.code} in the size for ${people} people, on the asked crust, with the asked topping off and the other on.`,
        rubric: R.change([APP], "the order was placed"),
        oracle: {
          kind: "state",
          checks: [
            {
              name: "ordered-as-built",
              app: APP,
              path: ordersOf(guest.email),
              where: { branchCode: branch.code, slotDate, slotTime, status: "received" },
              count: { min: 1, max: 1 },
              expect: { fulfilment: "pickup", lineCount: 1, lines: { size: size.key, crust, sauce: pizza.sauce, cheese: pizza.cheese, toppingsKey: pizzaToppingsKey(toppings), quantity: 1 } },
            },
          ],
        },
        calls: [ordering({ ...body, lines: body.lines.map((line) => ({ ...line, toppings: toppingSet(line.toppings) })) })],
        note: `${guest.email} → ${branch.code} ${slotDate} ${slotTime}: ${pizza.code} ${size.key} (serves ${sizeOf.get(size.key).serves} ≥ ${people}), ${crust}, −${off} +${on} → ${pizzaToppingsKey(toppings)}`,
        solve: (api) => order(api, body),
        miss: (api) => order(api, kept),
      };
    },
  },
  {
    key: "pizza-quote-delivery",
    app: APP,
    oracle: "json",
    surfaces: PAGES_AND_TOOLS,
    count: 3,
    about:
      "What an order of several identical pizzas costs in total, delivered from a named branch: quantity × the pizza's price (the size's base, the crust and cheese surcharges in that size, each topping's price in that size), plus the branch's delivery fee unless the subtotal reaches its free-delivery threshold (`pizzaUnitCents`, `pizzaDeliveryFeeCents`), ±0.01. The quantity puts the subtotal within one pizza of the threshold, below it or at or above it. The miss gets the fee the wrong way round: added when it is waived, left out when it is due.",
    candidates: (ctx) => ix(ctx).rows.branches.filter((b) => b.delivers),
    claims: (branch) => [`pizza:quote:${branch.code}`],
    build(branch, ctx, rng) {
      const { rows, size: sizeOf, topping } = ix(ctx);
      const size = sizeOf.get(pick(rng, ["medium", "large", "xlarge"]));
      const crust = pick(rng, PIZZA_CRUSTS.filter((c) => c.sizes.includes(size.key))).key;
      const sauce = pick(rng, ["tomato", "bbq", "pesto", "garlic-cream"]);
      const cheese = pick(rng, ["regular", "extra", "cashew"]);
      const stocked = rows.toppings.filter((t) => pizzaOutOfStock(rows.stockouts, branch.code, [t.key]).length === 0).map((t) => t.key);
      const toppings = shuffle(rng, stocked).slice(0, int(rng, 2, 3)).sort();
      const config = { size: size.key, crust, sauce, cheese, toppings };
      const unit = pizzaUnitCents(rows, config);
      const below = Math.ceil(branch.freeDeliveryFromCents / unit) - 1;
      const quantity = rng() < 0.5 && below >= 1 ? below : below + 1;
      if (quantity < 1 || quantity > 6) return null;
      const subtotal = unit * quantity;
      const fee = pizzaDeliveryFeeCents(branch, "delivery", subtotal);
      const total = (subtotal + fee) / 100;
      const wrong = (subtotal + (fee ? 0 : branch.deliveryFeeCents)) / 100;
      const what = `${quantity === 1 ? `one ${sizeText(size)} pizza` : `${quantity} ${sizeText(size)} pizzas, each`} on the ${crustText(crust)} with ${sauceText(sauce)} and ${cheeseText(cheese)}, topped with ${listed(toppings.map((t) => topping.get(t).name.toLowerCase()))}`;
      return {
        intent: `On the pizza ordering site, what would this order from ${branch.name} (${branch.code}) cost in total, delivered: ${what}? Answer as JSON: {"total": <dollars>}.`,
        summary: `${quantity} × one ${size.key} configuration at ${branch.code}, plus the branch's delivery fee unless the subtotal reaches its free-delivery threshold.`,
        rubric: R.answer([APP], "what the order costs in total, delivered,"),
        oracle: { kind: "json", expect: { total: { value: total, tolerance: 0.01 } } },
        calls: [],
        note: `${branch.code}: ${quantity} × ${usd(unit)} (${size.key} ${crust} ${sauce} ${cheese} ${toppings.join("+")}) = ${usd(subtotal)}; free from ${usd(branch.freeDeliveryFromCents)}, so fee ${usd(fee)} → $${total.toFixed(2)}`,
        answer: async (api) => {
          const b = await api.get(APP, "/api/v1/builder");
          const br = await api.get(APP, `/api/v1/branches/${branch.code}`);
          const s = b.sizes.find((x) => x.key === size.key);
          const each = s.baseCents + (b.crusts.find((x) => x.key === crust).surchargeCents[size.key] ?? 0) + b.cheeses.find((x) => x.key === cheese).surchargeCents[size.key] + toppings.reduce((n, t) => n + b.toppings.find((x) => x.key === t).pricesCents[size.key], 0);
          const sub = each * quantity;
          return { total: (sub + (sub >= br.freeDeliveryFromCents ? 0 : br.deliveryFeeCents)) / 100 };
        },
        miss: async () => ({ total: wrong }),
      };
    },
  },
  {
    key: "pizza-cheapest-menu",
    app: APP,
    oracle: "json",
    surfaces: PAGES_AND_TOOLS,
    count: 3,
    about:
      "Which menu pizza is the cheapest in a size that meets a diet or allergen filter and can be made at a named branch, with the toppings it has in stock (`pizzaMenuSearch` with the branch; strictly cheaper than the next). A cheaper menu pizza meets the filter too, but the branch is out of one of its toppings. The miss names that pizza.",
    candidates: menuSpace,
    claims: (s) => [`pizza:cheapest:${s.branch.code}`, `pizza:cheapest:${s.size.key}:${s.filter.key}`, menuClaim(s)],
    build({ branch, size, filter }, ctx) {
      const { rows } = ix(ctx);
      const [best, next] = pizzaMenuSearch(rows, { size: size.key, branchCode: branch.code, ...filter.query });
      if (!best || (next && next.priceCents === best.priceCents)) return null;
      const near = unmakeableBelow(rows, branch, size, filter, best.priceCents);
      if (!near) return null;
      return {
        intent: `On the pizza ordering site, which ${sizeText(size)} menu pizza is the cheapest one that is ${filter.text}, among those the ${branch.name} branch (${branch.code}) can make with the toppings it has in stock? Answer as JSON: {"pizza": "<the pizza's code, PZ-…>"}.`,
        summary: `The cheapest ${size.key} menu pizza that is ${filter.text} and that ${branch.code} can make.`,
        rubric: R.answer([APP], "the cheapest menu pizza that meets every requirement"),
        oracle: { kind: "json", expect: { pizza: best.pizzaCode } },
        calls: [],
        note: `${branch.code} ${size.key} ${filter.text} → ${best.pizzaCode} at ${usd(best.priceCents)}; ${near.pizzaCode} at ${usd(near.priceCents)} fits but ${branch.code} is out of ${pizzaOutOfStock(rows.stockouts, branch.code, near.toppings).join(", ")}`,
        answer: async (api) => ({ pizza: (await api.get(APP, searchPath(size.key, branch.code, filter)))[0]?.pizzaCode ?? "" }),
        miss: async () => ({ pizza: near.pizzaCode }),
      };
    },
  },
  {
    key: "pizza-menu-none",
    app: APP,
    oracle: "json",
    surfaces: PAGES_AND_TOOLS,
    count: 3,
    about:
      "Whether any menu pizza in a size meets a diet or allergen filter, costs no more than a cap, and can be made at a named branch — none does — and which comes closest: the cheapest that meets the filter and can be made there, at any price (no tie for cheapest). The cap alone can be met at the branch. One menu pizza meets the filter within the cap, but the branch is out of one of its toppings. The miss says one exists and names that pizza.",
    candidates: menuSpace,
    claims: (s) => [`pizza:none:${s.branch.code}`, `pizza:none:${s.size.key}:${s.filter.key}`, menuClaim(s)],
    build({ branch, size, filter }, ctx) {
      const { rows } = ix(ctx);
      const [closest, next] = pizzaMenuSearch(rows, { size: size.key, branchCode: branch.code, ...filter.query });
      if (!closest || (next && next.priceCents === closest.priceCents)) return null;
      const near = unmakeableBelow(rows, branch, size, filter, closest.priceCents);
      if (!near) return null;
      const cap = Math.ceil(near.priceCents / 100) * 100;
      if (closest.priceCents <= cap || pizzaMenuSearch(rows, { size: size.key, branchCode: branch.code, maxPriceCents: cap }).length === 0) return null;
      return {
        intent: `On the pizza ordering site, is there ${/^[aeiou]/.test(sizeText(size)) ? "an" : "a"} ${sizeText(size)} menu pizza that is ${filter.text}, costs no more than ${dollars(cap)}, and that the ${branch.name} branch (${branch.code}) can make with the toppings it has in stock? Also name the one that comes closest: the cheapest ${sizeText(size)} menu pizza that is ${filter.text} and that the branch can make, at any price. Answer as JSON: {"exists": <true or false>, "closest": "<the pizza's code, PZ-…>"}.`,
        summary: `No ${size.key} menu pizza meets the filter and the cap at ${branch.code}; the closest is the cheapest that meets the filter there at any price.`,
        rubric: R.answer([APP], "whether any menu pizza meets every requirement, and the one that comes closest,"),
        oracle: { kind: "json", expect: { exists: false, closest: closest.pizzaCode } },
        calls: [],
        note: `${branch.code} ${size.key} ${filter.text} ≤ ${dollars(cap)} → none; closest ${closest.pizzaCode} at ${usd(closest.priceCents)}; ${near.pizzaCode} at ${usd(near.priceCents)} would fit but ${branch.code} is out of ${pizzaOutOfStock(rows.stockouts, branch.code, near.toppings).join(", ")}`,
        answer: async (api) => ({
          exists: (await api.get(APP, searchPath(size.key, branch.code, filter, cap))).length > 0,
          closest: (await api.get(APP, searchPath(size.key, branch.code, filter)))[0]?.pizzaCode ?? "",
        }),
        miss: async () => ({ exists: true, closest: near.pizzaCode }),
      };
    },
  },
  {
    key: "pizza-earliest-slot",
    app: APP,
    oracle: "state",
    surfaces: PAGES_AND_TOOLS,
    count: 3,
    about:
      "Order, for a new customer, several of one menu pizza for pickup at a branch on a busy day, in the earliest slot at or after a named time that has room for all of them (`pizzaSlots`). The named time's slot is full, and so may be the next ones, or they have room for fewer pizzas. The check reads the customer's orders: exactly one received order at that branch on that day, in that slot, with the pizzas asked. The miss orders them in a later slot with room, not the earliest.",
    candidates: (ctx) => {
      const { rows } = ix(ctx);
      const days = [...new Set(rows.orders.map((o) => `${o.branchCode}|${o.slotDate}`))].sort();
      return days.flatMap((d) => {
        const [code, date] = d.split("|");
        const branch = rows.branches.find((b) => b.code === code);
        return pizzaSlots(rows, { branchCode: code, date }).filter((s) => s.left === 0).map((s) => ({ branch, date, time: s.time }));
      }).map((s, i) => ({ ...s, guest: guestOf(i + 18) }));
    },
    claims: (s) => [`pizza:customer:${s.guest.email}`, `pizza:day:${s.branch.code}:${s.date}`],
    build({ branch, date, time, guest }, ctx, rng) {
      const { rows, size: sizeOf, canMake } = ix(ctx);
      const pizzas = int(rng, 2, 3);
      const [slot, later] = pizzaSlots(rows, { branchCode: branch.code, date, pizzas, from: time });
      if (!slot || !later) return null;
      const pizza = pick(rng, rows.pizzas.filter((p) => canMake(branch, p)));
      const size = sizeOf.get(pick(rng, ["small", "medium", "large"]));
      const item = { pizzaCode: pizza.code, size: size.key, quantity: pizzas };
      const skipped = pizzaSlots(rows, { branchCode: branch.code, date, from: time }).filter((s) => s.time < slot.time && s.left > 0).map((s) => `${s.time} has ${s.left}`);
      return {
        intent: `On the pizza ordering site, place a pickup order at ${branch.name} (${branch.code}) for ${guest.name} (${guest.email}) on ${date}: ${pizzas} ${sizeText(size)} ${pizza.name} pizzas (${pizza.code}), in the earliest slot at or after ${time} that has room for ${pizzas === 2 ? "both" : `all ${pizzas}`}.`,
        summary: `${guest.email} has one received pickup order at ${branch.code} on ${date} for ${pizzas} × ${pizza.code}, in the earliest slot from ${time} with room for ${pizzas} pizzas.`,
        rubric: R.change([APP], "the order was placed"),
        oracle: {
          kind: "state",
          checks: [
            {
              name: "earliest-slot",
              app: APP,
              path: ordersOf(guest.email),
              where: { branchCode: branch.code, slotDate: date, status: "received" },
              count: { min: 1, max: 1 },
              expect: { slotTime: slot.time, fulfilment: "pickup", lineCount: 1, lines: { size: size.key, crust: pizza.crust, sauce: pizza.sauce, cheese: pizza.cheese, toppingsKey: pizzaToppingsKey(pizza.toppings), quantity: pizzas } },
            },
          ],
        },
        calls: [ordering(pickupBody(branch, guest, date, slot.time, [item]))],
        note: `${branch.code} ${date} from ${time} (full), ${pizzas} pizzas → ${slot.time}${skipped.length ? ` (${skipped.join(", ")} left)` : ""}; next with room ${later.time}`,
        solve: async (api) => {
          const slots = await api.get(APP, `/api/v1/branches/${branch.code}/slots?date=${date}&pizzas=${pizzas}&from=${enc(time)}`);
          return order(api, pickupBody(branch, guest, date, slots[0].time, [item]));
        },
        miss: async (api) => {
          const slots = await api.get(APP, `/api/v1/branches/${branch.code}/slots?date=${date}&pizzas=${pizzas}&from=${enc(time)}`);
          return order(api, pickupBody(branch, guest, date, slots[1].time, [item]));
        },
      };
    },
  },
  {
    key: "pizza-remove-topping",
    app: APP,
    oracle: "state",
    surfaces: PAGES_AND_TOOLS,
    count: 3,
    about:
      "Take one topping off the pizza in one of a seeded customer's received orders, named by its branch and slot, and leave their other orders alone. Asked of a customer with at least two received orders that carry that topping, where the named one carries it on one line only. One check per line: the named line without the topping (and the order still received, re-priced by `pizzaChangeLine`), every other line of that order unchanged, and the topping still on each of the customer's other received orders. The miss takes the topping off all of them.",
    candidates: (ctx) => {
      const { rows } = ix(ctx);
      const byCustomer = new Map();
      for (const o of rows.orders) byCustomer.set(o.customerEmail, [...(byCustomer.get(o.customerEmail) ?? []), o]);
      return [...byCustomer.values()].flatMap((all) =>
        rows.toppings.flatMap((t) => {
          const carrying = all.filter((o) => o.status === "received" && o.lines.some((i) => i.toppings.includes(t.key)));
          if (carrying.length < 2) return [];
          return carrying
            .filter((o) => o.lines.filter((i) => i.toppings.includes(t.key)).length === 1 && all.filter((x) => x.branchCode === o.branchCode && x.slotDate === o.slotDate && x.slotTime === o.slotTime).length === 1)
            .map((target) => ({ target, topping: t, carrying }));
        }),
      );
    },
    claims: ({ target, carrying }) => [`pizza:customer:${target.customerEmail}`, ...carrying.map((o) => `pizza:order:${o.orderNo}`)],
    build({ target, topping, carrying }, ctx) {
      const { rows, branch: branchOf } = ix(ctx);
      const off = (o) => o.lines.filter((i) => i.toppings.includes(topping.key)).map((i) => i.line);
      const changed = pizzaChangeLine(rows, target, off(target)[0], { removeToppings: [topping.key] });
      if ("problem" in changed) return null;
      // The miss must be a write the site takes: every other carrying line can lose the topping too.
      for (const o of carrying) for (const line of off(o)) if ("problem" in pizzaChangeLine(rows, o, line, { removeToppings: [topping.key] })) return null;
      const branch = branchOf.get(target.branchCode);
      const line = off(target)[0];
      const name = topping.name.toLowerCase();
      const others = carrying.filter((o) => o !== target);
      const keyOf = (o, l) => pizzaToppingsKey(o.lines.find((i) => i.line === l).toppings);
      const change = (api, no, l) => api.post(APP, `${ORDERS}/${no}/lines/${l}`, { removeToppings: [topping.key] });
      return {
        intent: `On the pizza ordering site, ${target.customerName} (${target.customerEmail}) has several orders. Remove the ${name} from their order at ${branch.name} for the ${target.slotTime} slot on ${target.slotDate}, and leave their other orders as they are.`,
        summary: `${target.customerEmail}'s ${branch.code} order for ${target.slotDate} ${target.slotTime} no longer has ${name} and is still received; their other orders still have it.`,
        rubric: R.change([APP], "the topping was taken off"),
        oracle: {
          kind: "state",
          checks: [
            { name: `${target.orderNo}-line-${line}`, app: APP, path: `${ORDERS}/${target.orderNo}`, expect: { status: "received", totalCents: changed.order.totalCents, lines: { line, toppingsKey: pizzaToppingsKey(changed.order.lines.find((i) => i.line === line).toppings) } } },
            ...target.lines.filter((i) => i.line !== line).map((i) => ({ name: `${target.orderNo}-line-${i.line}`, app: APP, path: `${ORDERS}/${target.orderNo}`, expect: { lines: { line: i.line, toppingsKey: keyOf(target, i.line) } } })),
            ...others.flatMap((o) => off(o).map((l) => ({ name: `${o.orderNo}-line-${l}`, app: APP, path: `${ORDERS}/${o.orderNo}`, expect: { status: "received", lines: { line: l, toppingsKey: keyOf(o, l) } } }))),
          ],
        },
        calls: [call("change_order_line", { orderNo: target.orderNo, line, removeToppings: [topping.key] }, { removeToppings: free })],
        note: `${target.customerEmail}: ${target.orderNo} (${branch.code}, ${target.slotDate} ${target.slotTime}) line ${line} −${topping.key} → ${usd(changed.order.totalCents)}; ${others.map((o) => o.orderNo).join(", ")} keep ${topping.key}`,
        solve: async (api) => {
          const mine = await api.list(APP, ordersOf(target.customerEmail));
          const o = api.only(mine.filter((x) => x.branchCode === branch.code && x.slotDate === target.slotDate && x.slotTime === target.slotTime));
          return change(api, o.orderNo, o.lines.find((i) => i.toppings.includes(topping.key)).line);
        },
        miss: async (api) => {
          for (const o of carrying) for (const l of off(o)) await change(api, o.orderNo, l);
        },
      };
    },
  },
];
