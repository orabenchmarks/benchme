/**
 * Warehouse intent templates: orders, cancellations and transfers to carry
 * out (state), and stock, price, customer, order and transfer questions to
 * answer (json). See ./index.mjs for the template contract.
 */
import { lowStock, orderTotalCents, stockOf } from "../../../packages/scenarios/dist/index.js";
import { int, pick, unique } from "../kit.mjs";

const ORDERS = "/api/v1/orders";
const TRANSFERS = "/api/v1/transfers";
const PAGES_AND_TOOLS = ["pages", "tools"];
// NLWeb's items carry a product's price and category, a customer's tier and
// city, and a depot's city — never quantities, orders or transfers.
const EVERY_SURFACE = ["pages", "tools", "nlweb"];

/**
 * The check every "place an order" task shares (intent-order-01's shape): the
 * customer's open orders, never a predicted order number; one MORE than the
 * seed gave that customer; the exact line on a fetched detail row. `exact`
 * also caps the count, so two lines must land on ONE new order.
 */
function openOrderLineCheck(name, customerCode, existingOpen, line, exact) {
  return {
    name,
    app: "warehouse",
    path: `${ORDERS}?customer=${customerCode}&status=open`,
    where: { customerCode, status: "open" },
    count: exact ? { min: existingOpen + 1, max: existingOpen + 1 } : { min: existingOpen + 1 },
    rowPath: `${ORDERS}/{orderNo}`,
    expect: { lines: line },
  };
}

/** A line no existing open order of this customer already carries — else the check could pass on an old order while the new one is wrong. */
function freshLine(ctx, rng, customerCode, avoidSku) {
  for (let tries = 0; tries < 20; tries++) {
    const p = pick(rng, ctx.rows.warehouse.products);
    const qty = int(rng, 1, 12) * 5;
    if (p.sku !== avoidSku && !ctx.hasOpenLine(customerCode, p.sku, qty)) return { p, qty };
  }
  return null;
}

const totalOf = (api, sku) => api.get("warehouse", `/api/v1/stock?sku=${encodeURIComponent(sku)}`);

export const warehouseTemplates = [
  {
    key: "order",
    app: "warehouse",
    oracle: "state",
    surfaces: PAGES_AND_TOOLS,
    count: 5,
    about: "A new order for one customer and one product (intent-order-01's shape): the customer's open orders, filtered by customer rather than a predicted order number, must number one MORE than the seed gave them, and one of them must carry the exact SKU/quantity line on its fetched detail row. The line is one none of the customer's existing open orders already carries.",
    candidates: (ctx) => ctx.rows.warehouse.customers,
    claims: (c) => [`customer:${c.code}`],
    build(c, ctx, rng) {
      const line = freshLine(ctx, rng, c.code);
      if (!line) return null;
      const { p, qty } = line;
      const existing = ctx.openOrdersOf(c.code).length;
      return {
        intent: `Place a new order for customer ${c.name} (${c.code}) for ${qty} units of the ${p.name} (SKU ${p.sku}).`,
        summary: `${c.code} ends up with one more open order than the seed gave it, carrying a line of ${qty} × ${p.sku}.`,
        oracle: { kind: "state", checks: [openOrderLineCheck("order-open-for-customer", c.code, existing, { sku: p.sku, qty }, false)] },
        note: `${c.code} (${existing} open in the seed) → one more open order with ${qty} × ${p.sku}`,
        solve: (api) => api.post("warehouse", ORDERS, { customer: c.code, lines: [{ sku: p.sku, qty }] }),
      };
    },
  },
  {
    key: "order-multi",
    app: "warehouse",
    oracle: "state",
    surfaces: PAGES_AND_TOOLS,
    count: 4,
    about: "ONE new order with two lines. Two checks, each requiring one of the lines on a fetched detail row, and both capping the customer's open orders at exactly one more than the seed gave them — so two separate single-line orders fail, and neither line may already sit on one of the customer's existing open orders.",
    candidates: (ctx) => ctx.rows.warehouse.customers,
    claims: (c) => [`customer:${c.code}`],
    build(c, ctx, rng) {
      const a = freshLine(ctx, rng, c.code);
      const b = a && freshLine(ctx, rng, c.code, a.p.sku);
      if (!a || !b) return null;
      const existing = ctx.openOrdersOf(c.code).length;
      return {
        intent: `Place ONE new order for customer ${c.name} (${c.code}) with two lines: ${a.qty} units of the ${a.p.name} (SKU ${a.p.sku}) and ${b.qty} units of the ${b.p.name} (SKU ${b.p.sku}).`,
        summary: `Exactly one new open order for ${c.code}, carrying ${a.qty} × ${a.p.sku} and ${b.qty} × ${b.p.sku}.`,
        oracle: {
          kind: "state",
          checks: [
            openOrderLineCheck("order-first-line", c.code, existing, { sku: a.p.sku, qty: a.qty }, true),
            openOrderLineCheck("order-second-line", c.code, existing, { sku: b.p.sku, qty: b.qty }, true),
          ],
        },
        note: `${c.code} (${existing} open in the seed) → exactly one more open order with ${a.qty} × ${a.p.sku} and ${b.qty} × ${b.p.sku}`,
        solve: (api) => api.post("warehouse", ORDERS, { customer: c.code, lines: [{ sku: a.p.sku, qty: a.qty }, { sku: b.p.sku, qty: b.qty }] }),
      };
    },
  },
  {
    key: "cancel",
    app: "warehouse",
    oracle: "state",
    surfaces: PAGES_AND_TOOLS,
    count: 5,
    about: "Cancel an order that is open in the seed (a shipped one cannot be cancelled — ALREADY_SHIPPED). The check reads the order's detail row for status `cancelled`. It claims the customer too: a cancellation lowers their open-order count, which an order task for the same customer counts.",
    candidates: (ctx) => ctx.rows.warehouse.orders.filter((o) => o.status === "open"),
    claims: (o) => [`order:${o.orderNo}`, `customer:${o.customerCode}`],
    build(o, ctx) {
      const c = ctx.customer.get(o.customerCode);
      return {
        intent: `Cancel order ${o.orderNo} for ${c.name} (${c.code}).`,
        summary: `Order ${o.orderNo} (open in the seed) has status cancelled.`,
        oracle: { kind: "state", checks: [{ name: "order-cancelled", app: "warehouse", path: `${ORDERS}/${o.orderNo}`, expect: { status: "cancelled" } }] },
        note: `${o.orderNo} (${c.code}, open in the seed) → cancelled`,
        solve: (api) => api.post("warehouse", `${ORDERS}/${o.orderNo}/cancel`, {}),
      };
    },
  },
  {
    key: "transfer",
    app: "warehouse",
    oracle: "state",
    surfaces: PAGES_AND_TOOLS,
    count: 4,
    about: "Move stock between depots and complete the transfer (intent-transfer-01's shape). The source row holds at least twice the quantity, no seeded pending transfer reserves it, and no seeded completed transfer already matches — so only the agent's own completed transfer passes.",
    candidates: (ctx) => ctx.rows.warehouse.stock.filter((s) => s.qty >= 20 && !ctx.pendingFrom(s.sku, s.locationCode)),
    claims: (s) => [`sku:${s.sku}`],
    build(s, ctx, rng) {
      const p = ctx.product.get(s.sku);
      const to = pick(rng, ctx.rows.warehouse.locations.filter((l) => l.code !== s.locationCode)).code;
      const qty = int(rng, 2, Math.min(40, Math.floor(s.qty / 2)));
      if (ctx.rows.warehouse.transfers.some((t) => t.sku === s.sku && t.fromCode === s.locationCode && t.toCode === to && t.qty === qty && t.status === "completed")) return null;
      return {
        intent: `Transfer ${qty} units of the ${p.name} (SKU ${p.sku}) from depot ${s.locationCode} to depot ${to}, and complete the transfer.`,
        summary: `A completed transfer of ${qty} units of ${p.sku} from ${s.locationCode} to ${to}.`,
        oracle: { kind: "state", checks: [{ name: "transfer-completed", app: "warehouse", path: TRANSFERS, where: { sku: p.sku, fromCode: s.locationCode, toCode: to }, expect: { qty, status: "completed" } }] },
        note: `${qty} × ${p.sku} ${s.locationCode} → ${to} (the seed holds ${s.qty} at ${s.locationCode})`,
        solve: async (api) => {
          const t = await api.post("warehouse", TRANSFERS, { sku: p.sku, from: s.locationCode, to, qty });
          await api.post("warehouse", `${TRANSFERS}/${t.transferNo}/complete`, {});
        },
      };
    },
  },
  {
    key: "complete-transfer",
    app: "warehouse",
    oracle: "state",
    surfaces: PAGES_AND_TOOLS,
    count: 4,
    about: "Complete a transfer the seed left pending. The check reads the transfer's own detail row for status `completed`; it claims the SKU, since completing moves stock another transfer task could need.",
    candidates: (ctx) => ctx.rows.warehouse.transfers.filter((t) => t.status === "pending"),
    claims: (t) => [`sku:${t.sku}`, `transfer:${t.transferNo}`],
    build(t, ctx) {
      const p = ctx.product.get(t.sku);
      return {
        intent: `Transfer ${t.transferNo} (${t.qty} units of the ${p.name}, SKU ${p.sku}, from depot ${t.fromCode} to depot ${t.toCode}) is still pending. Complete it.`,
        summary: `Transfer ${t.transferNo} (pending in the seed) has status completed.`,
        oracle: { kind: "state", checks: [{ name: "transfer-completed", app: "warehouse", path: `${TRANSFERS}/${t.transferNo}`, expect: { status: "completed" } }] },
        note: `${t.transferNo} (${t.qty} × ${p.sku}, ${t.fromCode} → ${t.toCode}, pending in the seed) → completed`,
        solve: (api) => api.post("warehouse", `${TRANSFERS}/${t.transferNo}/complete`, {}),
      };
    },
  },
  {
    key: "stock",
    app: "warehouse",
    oracle: "json",
    surfaces: PAGES_AND_TOOLS,
    count: 5,
    about: "Total stock of one product across every depot — `stockOf(rows, sku)` (intent-stock-01's shape); `GET /api/v1/stock?sku=` reports the same `total`.",
    candidates: (ctx) => ctx.rows.warehouse.products.filter((p) => stockOf(ctx.rows, p.sku) > 0),
    claims: (p) => [`stock-read:${p.sku}`],
    build(p, ctx) {
      const qty = stockOf(ctx.rows, p.sku);
      return {
        intent: `How many units of the ${p.name} (SKU ${p.sku}) are currently in stock across all depots? Answer as JSON: {"qty": <number>}.`,
        summary: `Total stock of ${p.sku} across every depot, derived by stockOf().`,
        oracle: { kind: "json", expect: { qty } },
        note: `${p.sku} → ${qty}`,
        answer: async (api) => ({ qty: (await totalOf(api, p.sku)).total }),
      };
    },
  },
  {
    key: "depot-stock",
    app: "warehouse",
    oracle: "json",
    surfaces: PAGES_AND_TOOLS,
    count: 5,
    about: "Stock of one product at ONE depot, for a product held at two or more depots — so the whole-company total is a wrong answer. `stockOf(rows, sku, depot)`.",
    candidates: (ctx) => ctx.rows.warehouse.stock.filter((s) => s.qty > 0 && ctx.depotsHolding(s.sku).length >= 2),
    claims: (s) => [`depot-read:${s.sku}`],
    build(s, ctx) {
      const p = ctx.product.get(s.sku);
      const l = ctx.location.get(s.locationCode);
      const qty = stockOf(ctx.rows, s.sku, s.locationCode);
      return {
        intent: `How many units of the ${p.name} (SKU ${p.sku}) are held at depot ${l.code} (${l.name})? Answer as JSON: {"qty": <number>}.`,
        summary: `Stock of ${p.sku} at ${l.code} alone, derived by stockOf(rows, sku, depot).`,
        oracle: { kind: "json", expect: { qty } },
        note: `${p.sku} at ${l.code} → ${qty} (of ${stockOf(ctx.rows, s.sku)} in total)`,
        answer: async (api) => ({ qty: (await totalOf(api, s.sku)).byLocation.find((r) => r.locationCode === s.locationCode).qty }),
      };
    },
  },
  {
    key: "lowstock",
    app: "warehouse",
    oracle: "json",
    // No page lists stock totals; the tools answer it in one call (low_stock).
    surfaces: ["tools"],
    count: 2,
    about: "The low-stock SKU set at another threshold (intent-lowstock-01's shape) — `lowStock(rows, t)`, which counts a product with no stock rows as zero. A threshold is used only when its set has 1–20 SKUs.",
    candidates: () => [5, 8, 12, 15, 20, 25],
    claims: (t) => [`lowstock:${t}`],
    build(t, ctx) {
      const skus = lowStock(ctx.rows, t);
      if (skus.length === 0 || skus.length > 20) return null;
      return {
        intent: `Which SKUs currently have fewer than ${t} total units in stock across all depots? Answer as JSON: {"skus": "<comma-separated SKUs, ascending>"}.`,
        summary: `The low-stock SKU set at threshold ${t}, derived by lowStock().`,
        oracle: { kind: "json", expect: { skus: skus.join(",") } },
        note: `threshold ${t} → ${skus.join(",")}`,
        answer: async (api) => ({ skus: (await api.get("warehouse", `/api/v1/stock/low?threshold=${t}`)).map((r) => r.sku).sort().join(",") }),
      };
    },
  },
  {
    key: "price",
    app: "warehouse",
    oracle: "json",
    surfaces: EVERY_SURFACE,
    count: 5,
    about: "The unit price of a product named by a name no other product carries (intent-price-01's shape): unitPriceCents / 100, ±0.005.",
    candidates: (ctx) => unique(ctx.rows.warehouse.products, (p) => p.name),
    claims: (p) => [`price-read:${p.sku}`],
    build(p) {
      const price = p.unitPriceCents / 100;
      return {
        intent: `What is the unit price of the ${p.name}? Answer as JSON: {"price": <number, USD>}.`,
        summary: `The unit price of ${p.sku} (the only product named "${p.name}").`,
        oracle: { kind: "json", expect: { price: { value: price, tolerance: 0.005 } } },
        note: `${p.sku} "${p.name}" → ${price}`,
        answer: async (api) => ({ price: (await api.list("warehouse", "/api/v1/products")).find((x) => x.name === p.name).unitPriceCents / 100 }),
      };
    },
  },
  {
    key: "customer",
    app: "warehouse",
    oracle: "json",
    surfaces: EVERY_SURFACE,
    count: 3,
    about: "The one customer of a tier in a city (intent-customer-01's shape) — used only for a (tier, city) pair no other customer shares.",
    candidates: (ctx) => unique(ctx.rows.warehouse.customers, (c) => `${c.tier}|${c.city}`),
    claims: (c) => [`customer-read:${c.code}`],
    build(c) {
      return {
        intent: `Which of our ${c.tier}-tier customers is based in ${c.city}? Answer as JSON: {"customerCode": "<code>"}.`,
        summary: `${c.code}, the only ${c.tier}-tier customer in ${c.city}.`,
        oracle: { kind: "json", expect: { customerCode: c.code } },
        note: `${c.tier} in ${c.city} → ${c.code}`,
        answer: async (api) => ({ customerCode: api.only((await api.list("warehouse", "/api/v1/customers")).filter((x) => x.tier === c.tier && x.city === c.city)).code }),
      };
    },
  },
  {
    key: "tier",
    app: "warehouse",
    oracle: "json",
    surfaces: EVERY_SURFACE,
    count: 4,
    about: "A customer's tier, asked by a name no other customer carries.",
    candidates: (ctx) => unique(ctx.rows.warehouse.customers, (c) => c.name),
    claims: (c) => [`tier-read:${c.code}`],
    build(c) {
      return {
        intent: `What tier is our customer ${c.name}? Answer as JSON: {"tier": "<tier>"}.`,
        summary: `The tier of ${c.code}.`,
        oracle: { kind: "json", expect: { tier: c.tier } },
        note: `${c.name} (${c.code}) → ${c.tier}`,
        answer: async (api) => ({ tier: (await api.list("warehouse", "/api/v1/customers")).find((x) => x.name === c.name).tier }),
      };
    },
  },
  {
    key: "open-orders",
    app: "warehouse",
    oracle: "json",
    surfaces: PAGES_AND_TOOLS,
    count: 4,
    about: "How many open orders a customer has — `openOrdersFor(rows, code)`; asked only of customers with at least one.",
    candidates: (ctx) => ctx.rows.warehouse.customers.filter((c) => ctx.openOrdersOf(c.code).length > 0),
    claims: (c) => [`open-orders-read:${c.code}`],
    build(c, ctx) {
      const count = ctx.openOrdersOf(c.code).length;
      return {
        intent: `How many open orders does ${c.name} (${c.code}) currently have? Answer as JSON: {"count": <number>}.`,
        summary: `The number of ${c.code}'s orders with status open.`,
        oracle: { kind: "json", expect: { count } },
        note: `${c.code} → ${count}`,
        answer: async (api) => ({ count: (await api.list("warehouse", `${ORDERS}?customer=${c.code}&status=open`)).length }),
      };
    },
  },
  {
    key: "order-status",
    app: "warehouse",
    oracle: "json",
    surfaces: PAGES_AND_TOOLS,
    count: 4,
    about: "An order's status (open, shipped or cancelled), from the seeded order row.",
    candidates: (ctx) => ctx.rows.warehouse.orders,
    claims: (o) => [`order-read:${o.orderNo}`],
    build(o) {
      return {
        intent: `What is the status of order ${o.orderNo}? Answer as JSON: {"status": "<status>"}.`,
        summary: `The status of ${o.orderNo}.`,
        oracle: { kind: "json", expect: { status: o.status } },
        note: `${o.orderNo} → ${o.status}`,
        answer: async (api) => ({ status: (await api.get("warehouse", `${ORDERS}/${o.orderNo}`)).status }),
      };
    },
  },
  {
    key: "order-total",
    app: "warehouse",
    oracle: "json",
    surfaces: PAGES_AND_TOOLS,
    count: 4,
    about: "An order's total value — `orderTotalCents(rows, orderNo)` / 100, ±0.005: every line's quantity × its product's unit price, for an order of two or more lines (the order detail's `totalCents`).",
    candidates: (ctx) => ctx.rows.warehouse.orders.filter((o) => ctx.linesOf(o.orderNo).length >= 2),
    claims: (o) => [`order-read:${o.orderNo}`],
    build(o, ctx) {
      const total = orderTotalCents(ctx.rows, o.orderNo) / 100;
      return {
        intent: `What is the total value of order ${o.orderNo} in US dollars — every line's quantity times its unit price, summed? Answer as JSON: {"total": <number>}.`,
        summary: `The total of ${o.orderNo} over its ${ctx.linesOf(o.orderNo).length} lines, derived by orderTotalCents().`,
        oracle: { kind: "json", expect: { total: { value: total, tolerance: 0.005 } } },
        note: `${o.orderNo} → ${total}`,
        answer: async (api) => ({ total: (await api.get("warehouse", `${ORDERS}/${o.orderNo}`)).totalCents / 100 }),
      };
    },
  },
  {
    key: "order-line",
    app: "warehouse",
    oracle: "json",
    surfaces: PAGES_AND_TOOLS,
    count: 3,
    about: "The quantity of one SKU on an order of two or more lines.",
    candidates: (ctx) => ctx.rows.warehouse.orders.filter((o) => ctx.linesOf(o.orderNo).length >= 2),
    claims: (o) => [`order-read:${o.orderNo}`],
    build(o, ctx, rng) {
      const line = pick(rng, ctx.linesOf(o.orderNo));
      return {
        intent: `How many units of SKU ${line.sku} does order ${o.orderNo} contain? Answer as JSON: {"qty": <number>}.`,
        summary: `The quantity of ${line.sku} on ${o.orderNo}.`,
        oracle: { kind: "json", expect: { qty: line.qty } },
        note: `${o.orderNo} / ${line.sku} → ${line.qty}`,
        answer: async (api) => ({ qty: (await api.get("warehouse", `${ORDERS}/${o.orderNo}`)).lines.find((l) => l.sku === line.sku).qty }),
      };
    },
  },
  {
    key: "transfer-destination",
    app: "warehouse",
    oracle: "json",
    surfaces: PAGES_AND_TOOLS,
    count: 3,
    about: "Where a seeded transfer is headed — its destination depot code.",
    candidates: (ctx) => ctx.rows.warehouse.transfers,
    claims: (t) => [`transfer-read:${t.transferNo}`],
    build(t) {
      return {
        intent: `Which depot is transfer ${t.transferNo} headed to? Answer with the depot code as JSON: {"toCode": "<code>"}.`,
        summary: `The destination depot of ${t.transferNo}.`,
        oracle: { kind: "json", expect: { toCode: t.toCode } },
        note: `${t.transferNo} → ${t.toCode}`,
        answer: async (api) => ({ toCode: (await api.get("warehouse", `${TRANSFERS}/${t.transferNo}`)).toCode }),
      };
    },
  },
  {
    key: "top-depot",
    app: "warehouse",
    oracle: "json",
    surfaces: PAGES_AND_TOOLS,
    count: 3,
    about: "The depot holding the most units of a product held at two or more depots — used only when that maximum is unique.",
    candidates: (ctx) =>
      ctx.rows.warehouse.products.filter((p) => {
        const held = ctx.depotsHolding(p.sku);
        const most = Math.max(...held.map((s) => s.qty));
        return held.length >= 2 && held.filter((s) => s.qty === most).length === 1;
      }),
    claims: (p) => [`top-depot-read:${p.sku}`],
    build(p, ctx) {
      const held = ctx.depotsHolding(p.sku);
      const top = held.reduce((a, b) => (b.qty > a.qty ? b : a));
      return {
        intent: `Which depot holds the most units of the ${p.name} (SKU ${p.sku})? Answer with the depot code as JSON: {"location": "<code>"}.`,
        summary: `The depot with the largest stock row for ${p.sku}.`,
        oracle: { kind: "json", expect: { location: top.locationCode } },
        note: `${p.sku} → ${top.locationCode} (${held.map((s) => `${s.locationCode} ${s.qty}`).join(", ")})`,
        answer: async (api) => ({ location: (await totalOf(api, p.sku)).byLocation.reduce((a, b) => (b.qty > a.qty ? b : a)).locationCode }),
      };
    },
  },
  {
    key: "priciest",
    app: "warehouse",
    oracle: "json",
    surfaces: PAGES_AND_TOOLS,
    count: 3,
    about: "The most expensive product in a category — used only when that maximum price is unique within it.",
    candidates: (ctx) =>
      [...new Set(ctx.rows.warehouse.products.map((p) => p.category))].filter((cat) => {
        const inCat = ctx.rows.warehouse.products.filter((p) => p.category === cat);
        const most = Math.max(...inCat.map((p) => p.unitPriceCents));
        return inCat.filter((p) => p.unitPriceCents === most).length === 1;
      }),
    claims: (cat) => [`category-read:${cat}`],
    build(cat, ctx) {
      const top = ctx.rows.warehouse.products.filter((p) => p.category === cat).reduce((a, b) => (b.unitPriceCents > a.unitPriceCents ? b : a));
      return {
        intent: `Which product in the ${cat} category has the highest unit price? Answer with its SKU as JSON: {"sku": "<SKU>"}.`,
        summary: `The priciest ${cat} product.`,
        oracle: { kind: "json", expect: { sku: top.sku } },
        note: `${cat} → ${top.sku} (${top.unitPriceCents / 100})`,
        answer: async (api) => ({ sku: (await api.list("warehouse", `/api/v1/products?category=${cat}`)).reduce((a, b) => (b.unitPriceCents > a.unitPriceCents ? b : a)).sku }),
      };
    },
  },
  {
    key: "depot-city",
    app: "warehouse",
    oracle: "json",
    surfaces: EVERY_SURFACE,
    count: 2,
    about: "The city a depot is in.",
    candidates: (ctx) => ctx.rows.warehouse.locations,
    claims: (l) => [`depot-city-read:${l.code}`],
    build(l) {
      return {
        intent: `In which city is depot ${l.code} (${l.name})? Answer as JSON: {"city": "<city>"}.`,
        summary: `The city of depot ${l.code}.`,
        oracle: { kind: "json", expect: { city: l.city } },
        note: `${l.code} → ${l.city}`,
        answer: async (api) => ({ city: (await api.get("warehouse", "/api/v1/locations")).find((x) => x.code === l.code).city }),
      };
    },
  },
];
