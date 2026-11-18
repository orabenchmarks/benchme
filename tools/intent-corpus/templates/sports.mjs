/**
 * Sports retailer intent templates (apps/sports, "Brackenford Sports"). Shaped
 * on four GoogleChromeLabs/webmcp-tools demos (Apache-2.0) folded into one
 * store: sport-shop-angular and leather-bag (search the catalog with filters,
 * read the store's rules), order-tracking (order status in a timeframe,
 * returns of delivered orders) and coffee-shop (reorder from the order
 * history). Their evals grade the tool calls an agent makes; these grade the
 * answer or the site's end state instead, so an agent may use the pages,
 * REST, MCP or WebMCP. See ./index.mjs for the contract.
 *
 * The rules every answer key is derived with are @benchme/scenarios' sports
 * rules (packages/scenarios/src/sites/sports/rules.ts), the same functions the
 * site enforces. The generator leaves variants out of stock on purpose, gives
 * some customers two orders still processing, and makes some customers'
 * latest order one that was not delivered.
 *
 * Claims: stock decides what a search finds, and orders, cancellations and
 * reorders change stock, so every task that reads or changes a variant's stock
 * claims its SKU (`sports:sku:<sku>`). Tasks own their orders
 * (`sports:order:<no>`) and the state tasks their customer. A new order is dated
 * SPORTS_TODAY, so a reorder also claims the customer's orders of that month,
 * which the delivery question reads.
 */
import { SPORTS_RETURN_REASONS, SPORTS_TODAY, searchSportsVariants, sportsOrderTotals, sportsReturnDeadline, sportsReturnedQty } from "../../../packages/scenarios/dist/index.js";
import { int, pick, usd } from "../kit.mjs";

const APP = "sports";
const ORDERS = "/api/v1/orders";
const PAGES_AND_TOOLS = ["pages", "tools"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const enc = encodeURIComponent;

const groupBy = (items, keyOf) => {
  const out = new Map();
  for (const item of items) out.set(keyOf(item), [...(out.get(keyOf(item)) ?? []), item]);
  return out;
};
/** The sports rows indexed once per rows object (kit.mjs stays as it is). */
const indexes = new WeakMap();
function ix(ctx) {
  const r = ctx.rows.sports;
  if (indexes.has(r)) return indexes.get(r);
  const product = new Map(r.products.map((p) => [p.code, p]));
  const variant = new Map(r.variants.map((v) => [v.sku, v]));
  const category = new Map(r.categories.map((c) => [c.key, c]));
  const linesOf = groupBy(r.lines, (l) => l.orderNo);
  const ordersOf = groupBy(r.orders, (o) => o.customerEmail);
  const productOf = (sku) => product.get(variant.get(sku).productCode);
  const x = {
    r,
    product,
    variant,
    customer: new Map(r.customers.map((c) => [c.email, c])),
    address: new Map(r.addresses.map((a) => [a.code, a])),
    linesOf: (orderNo) => linesOf.get(orderNo) ?? [],
    ordersOf: (email) => ordersOf.get(email) ?? [],
    defaultAddress: (email) => r.addresses.find((a) => a.customerEmail === email && a.isDefault),
    productOf,
    categoryOf: (sku) => category.get(productOf(sku).category),
  };
  indexes.set(r, x);
  return x;
}
const skuClaims = (lines) => lines.map((l) => `sports:sku:${l.sku}`);
const variantText = (v) => (v.size === "one size" ? v.colour : `size ${v.size}, ${v.colour}`);
const monthOf = (date) => date.slice(0, 7);
const lastOfMonth = (ym) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).toISOString().slice(0, 10);
const searchPath = (q) => `/api/v1/search?${new URLSearchParams({ size: q.size, colour: q.colour, maxWeight: String(q.maxWeightGrams), inStock: "true" })}`;
/** (sku, qty) pairs of an order's lines, as one comparable string. */
const lineSet = (lines) => lines.map((l) => `${l.sku}×${l.qty}`).sort().join(",");

export const sportsTemplates = [
  {
    key: "sport-cancel-one",
    app: APP,
    oracle: "state",
    surfaces: PAGES_AND_TOOLS,
    count: 3,
    about:
      "Cancel the one order of a seeded customer that has a named product and has not shipped, out of their two orders still processing and one shipped, and leave the others alone. The product is in no other processing order of theirs. One check per order on its way: `cancelled` for the one named, `processing` / `shipped` for the rest. The miss cancels both processing orders (`sportsCancelProblem` refuses only shipped ones).",
    candidates: (ctx) => {
      const x = ix(ctx);
      return x.r.customers.flatMap((c) => {
        const mine = x.ordersOf(c.email);
        const processing = mine.filter((o) => o.status === "processing");
        if (processing.length < 2 || !mine.some((o) => o.status === "shipped")) return [];
        return processing.flatMap((target) =>
          x.linesOf(target.orderNo)
            .map((l) => x.productOf(l.sku))
            .filter((p) => processing.filter((o) => x.linesOf(o.orderNo).some((l) => x.productOf(l.sku).code === p.code)).length === 1)
            .map((product) => ({ customer: c, target, product, live: mine.filter((o) => o.status === "processing" || o.status === "shipped") })),
        );
      });
    },
    claims: ({ customer, live }, ctx) => [
      `sports:customer:${customer.email}`,
      ...live.map((o) => `sports:order:${o.orderNo}`),
      ...live.filter((o) => o.status === "processing").flatMap((o) => skuClaims(ix(ctx).linesOf(o.orderNo))),
    ],
    build({ customer, target, product, live }) {
      const status = (o) => (o.orderNo === target.orderNo ? "cancelled" : o.status);
      const cancel = (api, no) => api.post(APP, `${ORDERS}/${no}/cancel`, {});
      return {
        intent: `On the sports shop site, ${customer.name} (${customer.email}) has several orders on their way. Cancel only their order with the ${product.name} in it that has not shipped yet, and leave their other orders as they are.`,
        summary: `${customer.email}'s unshipped order with the ${product.name} is cancelled; their other orders on the way are unchanged.`,
        oracle: { kind: "state", checks: live.map((o) => ({ name: `${o.orderNo}-${status(o)}`, app: APP, path: `${ORDERS}/${o.orderNo}`, expect: { status: status(o) } })) },
        note: `${customer.email}: ${target.orderNo} (${product.code}) → cancelled; ${live.filter((o) => o !== target).map((o) => `${o.orderNo} stays ${o.status}`).join(", ")}`,
        solve: async (api) => {
          const mine = await api.list(APP, `${ORDERS}?customerEmail=${enc(customer.email)}&status=processing`);
          await cancel(api, api.only(mine.filter((o) => o.lines.some((l) => l.productCode === product.code))).orderNo);
        },
        miss: async (api) => {
          for (const o of live.filter((y) => y.status === "processing")) await cancel(api, o.orderNo);
        },
      };
    },
  },
  {
    key: "sport-reorder-last",
    app: APP,
    oracle: "state",
    surfaces: PAGES_AND_TOOLS,
    count: 3,
    about:
      "Place a new order for a seeded customer that repeats their most recent delivered order: the same SKUs and quantities, to the same address. Their latest order is shipped or cancelled, not delivered, and has other lines; they have no order processing, and every line of both orders is in stock. One check per line of the repeated order, and one for the address and the number of lines, each on exactly one processing order of theirs. The miss reorders their latest order instead.",
    candidates: (ctx) => {
      const x = ix(ctx);
      return x.r.customers.flatMap((c) => {
        const mine = [...x.ordersOf(c.email)].sort((a, b) => a.placedOn.localeCompare(b.placedOn));
        const delivered = mine.filter((o) => o.status === "delivered");
        const latest = mine.at(-1);
        const target = delivered.at(-1);
        if (!target || mine.some((o) => o.status === "processing") || latest.status === "delivered") return [];
        if (mine.filter((o) => o.placedOn === latest.placedOn).length > 1 || delivered.filter((o) => o.placedOn === target.placedOn || o.deliveredOn >= target.deliveredOn).length > 1) return [];
        if (lineSet(x.linesOf(target.orderNo)) === lineSet(x.linesOf(latest.orderNo))) return [];
        if (![...x.linesOf(target.orderNo), ...x.linesOf(latest.orderNo)].every((l) => x.variant.get(l.sku).stock >= l.qty)) return [];
        return [{ customer: c, target, latest }];
      });
    },
    claims: ({ customer, target, latest }, ctx) => [
      `sports:customer:${customer.email}`,
      `sports:order:${target.orderNo}`,
      `sports:order:${latest.orderNo}`,
      `sports:orders-of:${customer.email}:${monthOf(SPORTS_TODAY)}`,
      ...new Set(skuClaims([...ix(ctx).linesOf(target.orderNo), ...ix(ctx).linesOf(latest.orderNo)])),
    ],
    build({ customer, target, latest }, ctx) {
      const lines = ix(ctx).linesOf(target.orderNo);
      const path = `${ORDERS}?customerEmail=${enc(customer.email)}&status=processing`;
      const on = { app: APP, path, where: { status: "processing" }, count: { min: 1, max: 1 } };
      const reorder = (api, no) => api.post(APP, `${ORDERS}/${no}/reorder`, {});
      return {
        intent: `On the sports shop site, place a new order for ${customer.name} (${customer.email}) that repeats their most recent delivered order: the same items in the same quantities, shipped to the same address.`,
        summary: `${customer.email} has one new order with the lines and address of their most recent delivered order.`,
        oracle: {
          kind: "state",
          checks: [
            ...lines.map((l) => ({ name: `line-${l.sku}`, ...on, expect: { lines: { sku: l.sku, qty: l.qty } } })),
            { name: "same-address", ...on, expect: { addressCode: target.addressCode, lineCount: lines.length } },
          ],
        },
        note: `${customer.email}: repeat ${target.orderNo} (${lineSet(lines)} to ${target.addressCode}); their latest, ${latest.orderNo}, is ${latest.status}`,
        solve: (api) => reorder(api, target.orderNo),
        miss: (api) => reorder(api, latest.orderNo),
      };
    },
  },
  {
    key: "sport-return-item",
    app: APP,
    oracle: "state",
    surfaces: PAGES_AND_TOOLS,
    count: 3,
    about:
      "Request the return of part of one line of a delivered order, with a named reason: a line of 2 or more units, none returned yet, still within its category's return window on SPORTS_TODAY (`sportsReturnProblem`). The check reads the order's returns: exactly one return of that SKU, with the quantity and reason asked. The miss returns every unit of the line.",
    candidates: (ctx) => {
      const x = ix(ctx);
      return x.r.orders
        .filter((o) => o.status === "delivered")
        .flatMap((o) => x.linesOf(o.orderNo).map((line) => ({ order: o, line })))
        .filter(({ order, line }) => line.qty >= 2 && sportsReturnedQty(x.r.returns, order.orderNo, line.sku) === 0 && SPORTS_TODAY <= sportsReturnDeadline(order.deliveredOn, x.categoryOf(line.sku).returnWindowDays));
    },
    claims: ({ order }) => [`sports:order:${order.orderNo}`],
    build({ order, line }, ctx, rng) {
      const x = ix(ctx);
      const customer = x.customer.get(order.customerEmail);
      const product = x.productOf(line.sku);
      const qty = int(rng, 1, line.qty - 1);
      const reason = pick(rng, SPORTS_RETURN_REASONS);
      const ask = (n) => (api) => api.post(APP, "/api/v1/returns", { orderNo: order.orderNo, sku: line.sku, qty: n, reason });
      return {
        intent: `On the sports shop site, ${customer.name} (${customer.email}) wants to return ${qty} of the ${line.qty} units of the ${product.name} (${variantText(x.variant.get(line.sku))}) they received in order ${order.orderNo}. Request that return with the reason "${reason}".`,
        summary: `Order ${order.orderNo} has one return of that line, with the quantity and reason asked.`,
        oracle: {
          kind: "state",
          checks: [{ name: "returned", app: APP, path: `/api/v1/returns?orderNo=${order.orderNo}`, where: { sku: line.sku }, count: { min: 1, max: 1 }, expect: { qty, reason } }],
        },
        note: `${order.orderNo} ${line.sku}: return ${qty} of ${line.qty}, "${reason}"`,
        solve: ask(qty),
        miss: ask(line.qty),
      };
    },
  },
  {
    key: "sport-return-by",
    app: APP,
    oracle: "json",
    surfaces: PAGES_AND_TOOLS,
    count: 3,
    about:
      "The last day a product from a delivered order can be returned: the order's delivery date plus the return window of the product's category (`sportsReturnDeadline`). The order has lines from categories with different windows. The miss counts the window from the day the order was placed.",
    candidates: (ctx) => {
      const x = ix(ctx);
      return x.r.orders
        .filter((o) => o.status === "delivered" && new Set(x.linesOf(o.orderNo).map((l) => x.categoryOf(l.sku).returnWindowDays)).size >= 2)
        .flatMap((order) => x.linesOf(order.orderNo).map((line) => ({ order, line })));
    },
    claims: ({ order }) => [`sports:order:${order.orderNo}`],
    build({ order, line }, ctx) {
      const x = ix(ctx);
      const product = x.productOf(line.sku);
      const window = x.categoryOf(line.sku).returnWindowDays;
      return {
        intent: `On the sports shop site, what is the last day on which the ${product.name} from order ${order.orderNo} can be returned? Answer as JSON: {"lastDay": "<YYYY-MM-DD>"}.`,
        summary: `The order's delivery date plus the return window of the product's category.`,
        oracle: { kind: "json", expect: { lastDay: sportsReturnDeadline(order.deliveredOn, window) } },
        note: `${order.orderNo} delivered ${order.deliveredOn}, ${product.category} window ${window} days → ${sportsReturnDeadline(order.deliveredOn, window)}`,
        answer: async (api) => {
          const o = await api.get(APP, `${ORDERS}/${order.orderNo}`);
          const p = await api.get(APP, `/api/v1/products/${api.only(o.lines.filter((l) => l.productName === product.name)).productCode}`);
          const policy = await api.get(APP, "/api/v1/policies");
          return { lastDay: sportsReturnDeadline(o.deliveredOn, policy.categories.find((c) => c.key === p.category).returnWindowDays) };
        },
        miss: async () => ({ lastDay: sportsReturnDeadline(order.placedOn, window) }),
      };
    },
  },
  {
    key: "sport-delivered-where",
    app: APP,
    oracle: "json",
    surfaces: PAGES_AND_TOOLS,
    count: 3,
    about:
      "When and where a seeded customer's order was delivered, named by a product in it and the month it was placed: the only order of theirs placed that month with that product. It went to one of their saved addresses that is not their default one. The miss gives the day it shipped and the city of their default address.",
    candidates: (ctx) => {
      const x = ix(ctx);
      return x.r.orders
        .filter((o) => o.status === "delivered" && x.address.get(o.addressCode).city !== x.defaultAddress(o.customerEmail).city)
        .flatMap((order) => x.linesOf(order.orderNo).map((line) => ({ order, product: x.productOf(line.sku) })))
        .filter(({ order, product }) => x.ordersOf(order.customerEmail).filter((o) => monthOf(o.placedOn) === monthOf(order.placedOn) && x.linesOf(o.orderNo).some((l) => x.productOf(l.sku).code === product.code)).length === 1);
    },
    claims: ({ order }) => [`sports:order:${order.orderNo}`, `sports:orders-of:${order.customerEmail}:${monthOf(order.placedOn)}`],
    build({ order, product }, ctx) {
      const x = ix(ctx);
      const customer = x.customer.get(order.customerEmail);
      const ym = monthOf(order.placedOn);
      const city = x.address.get(order.addressCode).city;
      return {
        intent: `On the sports shop site, ${customer.name} (${customer.email}) ordered a ${product.name} in ${MONTHS[Number(ym.slice(5)) - 1]} ${ym.slice(0, 4)}. On what date was that order delivered, and to which city? Answer as JSON: {"deliveredOn": "<YYYY-MM-DD>", "city": "<the city>"}.`,
        summary: `The delivery date and the delivery city of the one order of theirs placed that month with that product.`,
        oracle: { kind: "json", expect: { deliveredOn: order.deliveredOn, city } },
        note: `${customer.email} ${ym} ${product.code} → ${order.orderNo}, delivered ${order.deliveredOn} to ${order.addressCode} in ${city} (default address in ${x.defaultAddress(order.customerEmail).city}; shipped ${order.shippedOn})`,
        answer: async (api) => {
          const mine = await api.list(APP, `${ORDERS}?customerEmail=${enc(customer.email)}&placedFrom=${ym}-01&placedTo=${lastOfMonth(ym)}`);
          const o = api.only(mine.filter((y) => y.lines.some((l) => l.productName === product.name)));
          return { deliveredOn: o.deliveredOn, city: o.address.city };
        },
        miss: async () => ({ deliveredOn: order.shippedOn, city: x.defaultAddress(order.customerEmail).city }),
      };
    },
  },
  {
    key: "sport-cheapest-fit",
    app: APP,
    oracle: "json",
    surfaces: PAGES_AND_TOOLS,
    count: 3,
    about:
      "The cheapest in-stock variant, in any category, in one size and colour that weighs at most a cap (`searchSportsVariants` with `inStock`, first offer; strictly cheaper than the next), and what a few of it cost with shipping (`sportsOrderTotals`: the fee unless the subtotal reaches the free-shipping threshold), ±0.01. A cheaper variant within the cap is out of stock, and a cheaper in-stock one is over the cap. The miss names the out-of-stock variant and its total.",
    candidates: (ctx) => {
      const x = ix(ctx);
      const groups = groupBy(x.r.variants.filter((v) => v.size !== "one size"), (v) => `${v.size}|${v.colour}`);
      return [...groups.keys()].sort().flatMap((key) => {
        const [size, colour] = key.split("|");
        const all = searchSportsVariants(x.r, { size, colour });
        return [...new Set(all.map((v) => Math.ceil(v.weightGrams / 10) * 10))].sort((a, b) => a - b).flatMap((cap) => {
          const within = all.filter((v) => v.weightGrams <= cap);
          const [best, next] = within.filter((v) => v.stock > 0);
          const oos = within[0];
          if (!best || oos.stock !== 0 || oos.priceCents >= best.priceCents || (next && next.priceCents === best.priceCents)) return [];
          if (!all.some((v) => v.weightGrams > cap && v.stock > 0 && v.priceCents < best.priceCents)) return [];
          return [{ size, colour, cap, best, oos, skus: within.map((v) => v.sku) }];
        });
      });
    },
    claims: (c) => c.skus.map((s) => `sports:sku:${s}`),
    build({ size, colour, cap, best, oos }, ctx, rng) {
      const x = ix(ctx);
      // A quantity whose subtotal stays under the free-shipping threshold when one exists, so the fee is part of the total.
      const underFree = [1, 2, 3].filter((n) => n * best.priceCents < x.r.shipping.freeFromCents);
      const qty = underFree.length ? pick(rng, underFree) : int(rng, 1, 3);
      const totalOf = (v) => sportsOrderTotals(x.r.shipping, [{ qty, unitPriceCents: v.priceCents }]).totalCents / 100;
      const q = { size, colour, maxWeightGrams: cap };
      return {
        intent: `On the sports shop site, which item in size ${size} and colour ${colour}, in any category, is the cheapest one that weighs at most ${cap} g and is in stock? What would ${qty} of it cost, shipping included? Answer as JSON: {"sku": "<the variant's SKU>", "total": <dollars>}.`,
        summary: `The cheapest in-stock variant in that size and colour within the weight cap, and ${qty} of it with shipping per the store's policy.`,
        oracle: { kind: "json", expect: { sku: best.sku, total: { value: totalOf(best), tolerance: 0.01 } } },
        note: `${size} ${colour} ≤ ${cap} g → ${best.sku} at ${usd(best.priceCents)} × ${qty} = $${totalOf(best).toFixed(2)} with shipping; ${oos.sku} at ${usd(oos.priceCents)} is out of stock`,
        answer: async (api) => {
          const found = (await api.get(APP, searchPath(q)))[0];
          const policy = await api.get(APP, "/api/v1/policies");
          return { sku: found.sku, total: sportsOrderTotals(policy.shipping, [{ qty, unitPriceCents: found.priceCents }]).totalCents / 100 };
        },
        miss: async () => ({ sku: oos.sku, total: totalOf(oos) }),
      };
    },
  },
];
