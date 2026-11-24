/**
 * Send it back or repeat it (change; sports, clinic): a return, a reorder or a
 * refill, inside the site's rules — the return window of each item's category,
 * the stock, the refills left and the pharmacies that stock the dosage. The
 * impossible ones ask for what the rules have closed.
 *
 * Expected calls: each return's `request_return` with its order, item, units
 * and reason; each refill's `request_refill` at the pharmacy the task names or
 * has the agent find; the exchange's new size its `place_order`. A repeat
 * declares none (`noCall`): `reorder` of the order and a new `place_order` of
 * its lines to the address asked make the same order, so neither is necessary. A cost asked after a write is in that
 * write's answer, so it declares no read; an impossible request declares none.
 */
import { SPORTS_TODAY, clinicPrescriptionPrices, sportsReturnDeadline, sportsReturnedQty, sportsShippingCents } from "../../../../packages/scenarios/dist/index.js";
import { call } from "../../calls.mjs";
import { R, absent, dollars, variantText, impossibleChecks, jsonOracle, money, row, site, stateOracle, PAGES_AND_TOOLS } from "../kit.mjs";
import { clinicPath, sportsPath } from "../paths.mjs";

/** Why a repeat declares no call: two tools make the same order. */
const REPEATED = "reorder of the order, or place_order of its lines to the address asked, makes the same order: neither is necessary";
const AREA = "return-or-repeat";
const processingOf = (email) => `${sportsPath.ordersOf(email)}&status=processing`;
const linesOf = (ctx, orderNo) => ctx.sports.linesOf.get(orderNo) ?? [];
const variantOf = (ctx, sku) => ctx.sports.variant.get(sku);
const productOf = (ctx, sku) => ctx.sports.product.get(variantOf(ctx, sku).productCode);
const categoryOf = (ctx, sku) => ctx.sports.category.get(productOf(ctx, sku).category);
const itemText = (ctx, sku) => {
  const v = variantOf(ctx, sku);
  return variantText(productOf(ctx, sku).name, v);
};
const returnable = (ctx, order, sku) => order.status === "delivered" && order.deliveredOn && SPORTS_TODAY <= sportsReturnDeadline(order.deliveredOn, categoryOf(ctx, sku).returnWindowDays);
const returnedBefore = (ctx, o, sku) => ctx.rows.sports.returns.some((r) => r.orderNo === o.orderNo && r.sku === sku);
const customerOf = (ctx, email) => ctx.rows.sports.customers.find((c) => c.email === email);
const hasProcessing = (ctx, email) => (ctx.sports.ordersOf.get(email) ?? []).some((o) => o.status === "processing");
const inStock = (ctx, lines) => lines.every((l) => variantOf(ctx, l.sku).stock >= l.qty);
const ordersByNewest = (ctx, email) => [...(ctx.sports.ordersOf.get(email) ?? [])].sort((x, y) => y.placedOn.localeCompare(x.placedOn) || y.orderNo.localeCompare(x.orderNo));
/** A repeated order's checks: one new processing order, each line as it was, to the address asked. */
const repeatChecks = (email, lines, addressCode) => {
  const on = { where: { status: "processing" }, count: { min: 1, max: 1 } };
  return [
    row("one new order", "sports", processingOf(email), { ...on, expect: { addressCode, lineCount: lines.length }, entity: { type: "order", id: "{orderNo}" } }),
    ...lines.map((l) => row(`${l.sku} × ${l.qty}`, "sports", processingOf(email), { ...on, expect: { lines: { sku: l.sku, qty: l.qty } } })),
  ];
};
const returnRow = (name, orderNo, sku, expect) => row(name, "sports", sportsPath.returnsOf(orderNo), { where: { sku }, count: { min: 1, max: 1 }, expect, entity: { type: "return", id: "{returnNo}" } });

const stocking = (ctx, rx) => ctx.rows.clinic.prices.filter((p) => p.medicationCode === rx.medicationCode && p.dosage.replace(/\s+/g, "").toLowerCase() === rx.dosage.replace(/\s+/g, "").toLowerCase());
const openRefill = (ctx, rx) => ctx.rows.clinic.refills.some((r) => r.rxNo === rx.rxNo && r.status === "requested");
const refillChecks = (rx, pharmacyCode) => [
  row("refill requested", "clinic", clinicPath.refillsOf(rx.rxNo), { where: { status: "requested" }, count: { min: 1, max: 1 }, expect: { pharmacyCode }, entity: { type: "refill", id: "{refillNo}" } }),
  row("one refill fewer", "clinic", clinicPath.prescription(rx.rxNo), { expect: { refillsLeft: rx.refillsLeft - 1 } }),
];
const rxText = (ctx, rx) => `${rx.patientName}'s prescription ${rx.rxNo} (${ctx.clinic.medication.get(rx.medicationCode).name} ${rx.dosage})`;

export const repeatTemplates = [
  {
    key: "return-exchange-steps",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about:
      "An exchange over three prompts: one unit of a delivered line sent back as too small, then the same product and colour ordered in the next size up to the same address, then what that new order costs with shipping (`sportsShippingCents`). No order of the customer's in progress has that size.",
    candidates: (ctx) =>
      ctx.rows.sports.orders.filter((o) => o.status === "delivered").flatMap((o) => linesOf(ctx, o.orderNo).filter((l) => returnable(ctx, o, l.sku) && !returnedBefore(ctx, o, l.sku)).map((line) => ({ o, line }))),
    // A return never restocks: what changes stock is the order of the next size, claimed once it is known.
    claims: ({ o }) => [`person:sports:${o.customerEmail}`, `order:${o.orderNo}`],
    build({ o, line }, ctx) {
      const v = variantOf(ctx, line.sku);
      const sizes = ctx.rows.sports.variants.filter((x) => x.productCode === v.productCode && x.colour === v.colour);
      const order = [...sizes].sort((x, y) => (Number(x.size) || "XS S M L XL XXL".split(" ").indexOf(x.size)) - (Number(y.size) || "XS S M L XL XXL".split(" ").indexOf(y.size)));
      const next = order[order.indexOf(sizes.find((x) => x.sku === v.sku)) + 1];
      if (!next || next.stock < 1) return null;
      const inProgress = (ctx.sports.ordersOf.get(o.customerEmail) ?? []).filter((x) => x.status === "processing");
      if (inProgress.some((x) => linesOf(ctx, x.orderNo).some((l) => l.sku === next.sku))) return null;
      const c = customerOf(ctx, o.customerEmail);
      const total = next.priceCents + sportsShippingCents(ctx.rows.sports.shipping, next.priceCents);
      const product = productOf(ctx, line.sku);
      return {
        apps: ["sports"],
        target: o.orderNo,
        hidden: [next.sku],
        claims: [`variant:${next.sku}`],
        effort: { reads: 1, writes: 2 },
        summary: `One ${line.sku} from ${o.orderNo} goes back as too small, one ${next.sku} is ordered to the same address, and its cost is given.`,
        note: `${o.orderNo}: return 1 × ${line.sku}; order 1 × ${next.sku} (${next.size}) to ${o.addressCode}; ${dollars(total)}`,
        steps: [
          {
            kind: "state",
            intent: `On ${site("sports")}, ${c.name} (${c.email}) wants to send back one of ${itemText(ctx, line.sku)} from their order ${o.orderNo}, because it is too small.`,
            rubric: R.change(["sports"], "the return was requested"),
            oracle: stateOracle(returnRow("returned", o.orderNo, line.sku, { qty: 1, reason: "too small" })),
            calls: [call("request_return", { orderNo: o.orderNo, sku: line.sku, qty: 1, reason: "too small" })],
            solve: (api) => api.post("sports", sportsPath.returns, { orderNo: o.orderNo, sku: line.sku, qty: 1, reason: "too small" }),
          },
          {
            kind: "state",
            fact: `size ${next.size}`,
            intent: `Now order one of the same ${product.name} in the same colour in size ${next.size} instead, sent to the same address as that order.`,
            rubric: R.stepChange("the new size was ordered"),
            oracle: stateOracle(row("new size ordered", "sports", processingOf(c.email), { where: { status: "processing" }, expect: { addressCode: o.addressCode, lineCount: 1, lines: { sku: next.sku, qty: 1 } }, entity: { type: "order", id: "{orderNo}" } })),
            calls: [call("place_order", { customerEmail: c.email, addressCode: o.addressCode, lines: [{ sku: next.sku, qty: 1 }] })],
            solve: (api) => api.post("sports", sportsPath.orders, { customerEmail: c.email, addressCode: o.addressCode, lines: [{ sku: next.sku, qty: 1 }] }),
          },
          {
            kind: "json",
            fact: "shipping",
            intent: `What does that new order cost in all, shipping included? Answer as JSON: {"total": <dollars>}.`,
            rubric: R.stepAnswer("the new order's total"),
            oracle: jsonOracle({ total: money(total) }),
            calls: [],
            answer: async (api) => ({ total: (await api.list("sports", processingOf(c.email))).find((x) => x.lines.some((l) => l.sku === next.sku)).totalCents / 100 }),
          },
        ],
      };
    },
  },
  {
    key: "return-in-window",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about:
      "Send back everything from a named delivered order that can still be returned: each line's category has its own return window from the delivery date (`sportsReturnDeadline`), a site rule, and only one line's is still open. The checks read the order's returns: one for that line, none for the others.",
    candidates: (ctx) =>
      ctx.rows.sports.orders.filter((o) => {
        const lines = linesOf(ctx, o.orderNo);
        return o.status === "delivered" && lines.length >= 2 && lines.filter((l) => returnable(ctx, o, l.sku)).length === 1 && !ctx.rows.sports.returns.some((r) => r.orderNo === o.orderNo);
      }),
    claims: (o) => [`person:sports:${o.customerEmail}`, `order:${o.orderNo}`],
    build(o, ctx) {
      const lines = linesOf(ctx, o.orderNo);
      const open = lines.find((l) => returnable(ctx, o, l.sku));
      const closed = lines.filter((l) => l !== open);
      const c = customerOf(ctx, o.customerEmail);
      return {
        apps: ["sports"],
        target: o.orderNo,
        rule: { what: "each category's return window", naive: lines.map((l) => l.sku), actual: [open.sku] },
        effort: { reads: 2, writes: 1 },
        summary: `${o.orderNo} has one return, of the one line still inside its return window, and none of the others.`,
        note: `${o.orderNo} (delivered ${o.deliveredOn}): ${open.sku} open until ${sportsReturnDeadline(o.deliveredOn, categoryOf(ctx, open.sku).returnWindowDays)}; ${closed.map((l) => `${l.sku} closed ${sportsReturnDeadline(o.deliveredOn, categoryOf(ctx, l.sku).returnWindowDays)}`).join(", ")}`,
        steps: [{
          kind: "state",
          intent: `On ${site("sports")}, ${c.name} no longer needs the things in their order ${o.orderNo}. Send back everything from it that can still be returned, every unit of it.`,
          rubric: R.change(["sports"], "the returns were requested"),
          oracle: stateOracle(
            returnRow("returned", o.orderNo, open.sku, { qty: open.qty, reason: "no longer needed" }),
            ...closed.map((l) => absent(`${l.sku} kept`, "sports", sportsPath.returnsOf(o.orderNo), { where: { sku: l.sku } })),
          ),
          calls: [call("request_return", { orderNo: o.orderNo, sku: open.sku, qty: open.qty, reason: "no longer needed" })],
          solve: async (api) => {
            const [order, policies] = [await api.get("sports", sportsPath.order(o.orderNo)), await api.get("sports", sportsPath.policies)];
            const windows = new Map(policies.categories.map((x) => [x.key, x.returnWindowDays]));
            const categoryKey = (sku) => ctx.sports.product.get(ctx.sports.variant.get(sku).productCode).category;
            const ok = order.lines.filter((l) => policies.today <= sportsReturnDeadline(order.deliveredOn, windows.get(categoryKey(l.sku))));
            return api.post("sports", sportsPath.returns, { orderNo: o.orderNo, sku: api.only(ok).sku, qty: api.only(ok).qty, reason: "no longer needed" });
          },
        }],
      };
    },
  },
  {
    key: "return-line",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "Return every unit still returnable of a named line of a seeded customer's delivered sports order (what was bought less what was returned already, `sportsReturnedQty`), inside its category's return window, for a named reason. The check reads the order's returns: exactly one more for that item and reason, of that quantity.",
    candidates: (ctx) => ctx.rows.sports.orders.filter((o) => o.status === "delivered").flatMap((o) => linesOf(ctx, o.orderNo).filter((l) => returnable(ctx, o, l.sku) && l.qty - sportsReturnedQty(ctx.rows.sports.returns, o.orderNo, l.sku) >= 1).map((line) => ({ o, line }))),
    claims: ({ o }) => [`person:sports:${o.customerEmail}`, `order:${o.orderNo}`],
    build({ o, line }, ctx, rng) {
      const before = ctx.rows.sports.returns.filter((r) => r.orderNo === o.orderNo && r.sku === line.sku);
      const reasons = ["too small", "too large", "defective"].filter((x) => !before.some((r) => r.reason === x));
      const reason = reasons[Math.floor(rng() * reasons.length)];
      const left = line.qty - sportsReturnedQty(ctx.rows.sports.returns, o.orderNo, line.sku);
      const c = customerOf(ctx, o.customerEmail);
      const how = before.length ? (left === 1 ? "the one they still have" : `the ${left} they still have`) : left === 1 ? "the one they bought" : left === 2 ? "both of the two they bought" : `all ${left} they bought`;
      return {
        apps: ["sports"],
        target: o.orderNo,
        effort: { reads: 0, writes: 1 },
        summary: `${o.orderNo} has one more return of ${line.sku}: every unit still returnable, for the reason given.`,
        note: `${o.orderNo} (delivered ${o.deliveredOn}): return ${left} × ${line.sku}${before.length ? ` (${line.qty - left} returned already)` : ""}, "${reason}"`,
        steps: [{
          kind: "state",
          intent: `On ${site("sports")}, ${c.name} wants to send back ${itemText(ctx, line.sku)} from their order ${o.orderNo}: ${how}, because ${left === 1 ? "it is" : "they are"} ${reason}.`,
          rubric: R.change(["sports"], "the return was requested"),
          oracle: stateOracle(row("returned", "sports", sportsPath.returnsOf(o.orderNo), { where: { sku: line.sku, reason }, count: { min: 1, max: 1 }, expect: { qty: left }, entity: { type: "return", id: "{returnNo}" } })),
          calls: [call("request_return", { orderNo: o.orderNo, sku: line.sku, qty: left, reason })],
          solve: (api) => api.post("sports", sportsPath.returns, { orderNo: o.orderNo, sku: line.sku, qty: left, reason }),
        }],
      };
    },
  },
  {
    key: "refill-named",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "Request a refill of a named prescription with refills left at a named pharmacy that stocks its dosage (`clinicRefillProblem`). The checks read the prescription's refills (one requested, at that pharmacy) and the prescription (one refill fewer).",
    candidates: (ctx) => ctx.rows.clinic.prescriptions.filter((rx) => rx.refillsLeft >= 1 && !openRefill(ctx, rx)).flatMap((rx) => stocking(ctx, rx).map((p) => ({ rx, p }))),
    claims: ({ rx }) => [`person:clinic:${rx.patientEmail}`, `rx:${rx.rxNo}`],
    build({ rx, p }, ctx) {
      const pharmacy = ctx.clinic.clinic.get(p.clinicCode);
      return {
        apps: ["clinic"],
        target: rx.rxNo,
        effort: { reads: 0, writes: 1 },
        summary: `${rx.rxNo} has one refill requested at ${pharmacy.code}, and one refill fewer left.`,
        note: `${rx.rxNo} (${rx.medicationCode} ${rx.dosage}, ${rx.refillsLeft} left) → ${pharmacy.code}`,
        steps: [{
          kind: "state",
          intent: `On ${site("clinic")}, request a refill of ${rxText(ctx, rx)}, to collect at the pharmacy of ${pharmacy.name} (${pharmacy.code}).`,
          rubric: R.change(["clinic"], "the refill was requested"),
          oracle: stateOracle(...refillChecks(rx, pharmacy.code)),
          calls: [call("request_refill", { rxNo: rx.rxNo, pharmacyCode: pharmacy.code })],
          solve: (api) => api.post("clinic", clinicPath.refill(rx.rxNo), { pharmacyCode: pharmacy.code }),
        }],
      };
    },
  },
  {
    key: "reorder-named",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "Repeat a named delivered order of a seeded customer with no order in progress: the same items in the same quantities, to the same address, every one in stock. The checks read the customer's processing orders: exactly one, with every line and the address.",
    candidates: (ctx) => ctx.rows.sports.orders.filter((o) => o.status === "delivered" && !hasProcessing(ctx, o.customerEmail) && inStock(ctx, linesOf(ctx, o.orderNo))),
    claims: (o, ctx) => [`person:sports:${o.customerEmail}`, `order:${o.orderNo}`, ...linesOf(ctx, o.orderNo).map((l) => `variant:${l.sku}`)],
    build(o, ctx) {
      const lines = linesOf(ctx, o.orderNo);
      const c = customerOf(ctx, o.customerEmail);
      return {
        apps: ["sports"],
        target: o.orderNo,
        effort: { reads: 0, writes: 1 },
        summary: `${o.customerEmail} has one new processing order with ${o.orderNo}'s lines, to its address.`,
        note: `repeat ${o.orderNo}: ${lines.map((l) => `${l.qty} × ${l.sku}`).join(", ")} to ${o.addressCode}`,
        steps: [{
          kind: "state",
          intent: `On ${site("sports")}, place a new order for ${c.name} (${c.email}) that repeats their order ${o.orderNo}: the same items in the same quantities, sent to the same address.`,
          rubric: R.change(["sports"], "the order was placed again"),
          oracle: stateOracle(...repeatChecks(c.email, lines, o.addressCode)),
          calls: [],
          noCall: REPEATED,
          solve: (api) => api.post("sports", sportsPath.reorder(o.orderNo), {}),
        }],
      };
    },
  },
  {
    key: "reorder-to-address",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "Repeat a seeded customer's most recent order, which was delivered, to another of their addresses, named by its label. The checks read the customer's processing orders: exactly one, with every line, to the labelled address.",
    candidates: (ctx) =>
      ctx.rows.sports.customers.flatMap((c) => {
        const latest = ordersByNewest(ctx, c.email)[0];
        if (!latest || latest.status !== "delivered" || hasProcessing(ctx, c.email) || !inStock(ctx, linesOf(ctx, latest.orderNo))) return [];
        return (ctx.sports.addressesOf.get(c.email) ?? []).filter((a) => a.code !== latest.addressCode).map((address) => ({ c, latest, address }));
      }),
    claims: ({ c, latest }, ctx) => [`person:sports:${c.email}`, `order:${latest.orderNo}`, ...linesOf(ctx, latest.orderNo).map((l) => `variant:${l.sku}`)],
    build({ c, latest, address }, ctx) {
      const lines = linesOf(ctx, latest.orderNo);
      if ((ctx.sports.addressesOf.get(c.email) ?? []).filter((a) => a.label === address.label).length !== 1) return null;
      return {
        apps: ["sports"],
        hidden: [latest.orderNo, address.code],
        constraints: ["most recent order", `${address.label} address`],
        effort: { reads: 2, writes: 1 },
        summary: `${c.email} has one new processing order repeating their most recent one, to their ${address.label} address.`,
        note: `${c.email}: latest ${latest.orderNo} (delivered) → to ${address.code} (${address.label})`,
        steps: [{
          kind: "state",
          intent: `On ${site("sports")}, ${c.name} (${c.email}) wants their most recent order again: the same items in the same quantities, but sent to their ${address.label} address this time.`,
          rubric: R.change(["sports"], "the order was placed again"),
          oracle: stateOracle(...repeatChecks(c.email, lines, address.code)),
          calls: [],
          noCall: REPEATED,
          solve: async (api) => {
            const mine = (await api.list("sports", sportsPath.ordersOf(c.email))).sort((x, y) => y.placedOn.localeCompare(x.placedOn) || y.orderNo.localeCompare(x.orderNo));
            const to = (await api.get("sports", sportsPath.customer(c.email))).addresses.find((a) => a.label === address.label);
            return api.post("sports", sportsPath.reorder(mine[0].orderNo), { addressCode: to.code });
          },
        }],
      };
    },
  },
  {
    key: "refill-in-city",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "Request a refill of a named prescription with refills left at the one pharmacy in a named city that stocks its dosage. The city and the dosage each matter: another pharmacy there does not stock it, or one elsewhere does. The checks read the refills and the prescription.",
    candidates: (ctx) => ctx.rows.clinic.prescriptions.filter((rx) => rx.refillsLeft >= 1 && !openRefill(ctx, rx)).flatMap((rx) => [...new Set(ctx.rows.clinic.clinics.map((x) => x.city))].map((city) => ({ rx, city }))),
    claims: ({ rx }) => [`person:clinic:${rx.patientEmail}`, `rx:${rx.rxNo}`],
    build({ rx, city }, ctx) {
      const here = stocking(ctx, rx).filter((p) => ctx.clinic.clinic.get(p.clinicCode).city === city);
      const clinicsHere = ctx.rows.clinic.clinics.filter((x) => x.city === city);
      if (here.length !== 1 || clinicsHere.length < 2 || stocking(ctx, rx).length < 2) return null;
      const pharmacy = ctx.clinic.clinic.get(here[0].clinicCode);
      return {
        apps: ["clinic"],
        target: rx.rxNo,
        hidden: [pharmacy.code],
        constraints: [`in ${city}`, "stocks"],
        effort: { reads: 1, writes: 1 },
        summary: `${rx.rxNo} has one refill requested at the one pharmacy in ${city} that stocks its dosage.`,
        note: `${rx.rxNo} (${rx.medicationCode} ${rx.dosage}) in ${city} → ${pharmacy.code}`,
        steps: [{
          kind: "state",
          intent: `On ${site("clinic")}, request a refill of ${rxText(ctx, rx)}, to collect at a pharmacy in ${city} that stocks it.`,
          rubric: R.change(["clinic"], "the refill was requested"),
          oracle: stateOracle(...refillChecks(rx, pharmacy.code)),
          calls: [call("request_refill", { rxNo: rx.rxNo, pharmacyCode: pharmacy.code })],
          solve: async (api) => {
            const offers = (await api.get("clinic", clinicPath.prices(rx.medicationCode, rx.dosage))).filter((x) => x.city === city);
            return api.post("clinic", clinicPath.refill(rx.rxNo), { pharmacyCode: api.only(offers).clinicCode });
          },
        }],
      };
    },
  },
  {
    key: "refill-cheapest",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about:
      "Request a refill of a named prescription at whichever pharmacy charges least for its medication in its dosage. The tempting one: the lowest price for the medication at any dosage is at a pharmacy that does not stock this dosage.",
    candidates: (ctx) => ctx.rows.clinic.prescriptions.filter((rx) => rx.refillsLeft >= 1 && !openRefill(ctx, rx)),
    claims: (rx) => [`person:clinic:${rx.patientEmail}`, `rx:${rx.rxNo}`],
    build(rx, ctx) {
      const all = clinicPrescriptionPrices(ctx.rows.clinic, rx.medicationCode);
      const mine = clinicPrescriptionPrices(ctx.rows.clinic, rx.medicationCode, rx.dosage);
      if (mine.length < 2 || mine[0].priceCents === mine[1].priceCents) return null;
      const trap = all[0];
      if (trap.dosage.replace(/\s+/g, "").toLowerCase() === rx.dosage.replace(/\s+/g, "").toLowerCase() || mine.some((m) => m.clinicCode === trap.clinicCode)) return null;
      return {
        apps: ["clinic"],
        target: rx.rxNo,
        hidden: [mine[0].clinicCode],
        tempting: { what: `${trap.clinicCode} has the lowest price for ${rx.medicationCode} (${trap.dosage}) but does not stock ${rx.dosage}`, check: async (api) => !(await api.get("clinic", clinicPath.prices(rx.medicationCode, rx.dosage))).some((x) => x.clinicCode === trap.clinicCode) },
        effort: { reads: 1, writes: 1 },
        summary: `${rx.rxNo} has one refill requested at the pharmacy that charges least for its dosage.`,
        note: `${rx.rxNo} (${rx.medicationCode} ${rx.dosage}) → ${mine[0].clinicCode}; ${trap.clinicCode} is cheaper at ${trap.dosage}, which it stocks instead`,
        steps: [{
          kind: "state",
          intent: `On ${site("clinic")}, request a refill of ${rxText(ctx, rx)} at whichever pharmacy charges the least for it.`,
          rubric: R.change(["clinic"], "the refill was requested"),
          oracle: stateOracle(...refillChecks(rx, mine[0].clinicCode)),
          calls: [call("request_refill", { rxNo: rx.rxNo, pharmacyCode: mine[0].clinicCode })],
          solve: async (api) => {
            const offers = await api.get("clinic", clinicPath.prices(rx.medicationCode, rx.dosage));
            return api.post("clinic", clinicPath.refill(rx.rxNo), { pharmacyCode: offers[0].clinicCode });
          },
        }],
      };
    },
  },
  {
    key: "reorder-latest-delivered",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about:
      "Repeat a seeded customer's most recent delivered order, to the same address. The tempting one: their most recent order of all has not been delivered (shipped or cancelled).",
    candidates: (ctx) =>
      ctx.rows.sports.customers.flatMap((c) => {
        const mine = ordersByNewest(ctx, c.email);
        const delivered = mine.find((o) => o.status === "delivered");
        if (!delivered || mine[0] === delivered || mine[0].status === "processing" || hasProcessing(ctx, c.email) || !inStock(ctx, linesOf(ctx, delivered.orderNo))) return [];
        return [{ c, latest: mine[0], delivered }];
      }),
    claims: ({ c, delivered }, ctx) => [`person:sports:${c.email}`, `order:${delivered.orderNo}`, ...linesOf(ctx, delivered.orderNo).map((l) => `variant:${l.sku}`)],
    build({ c, latest, delivered }, ctx) {
      const lines = linesOf(ctx, delivered.orderNo);
      const same = (a, b) => JSON.stringify(a.map((l) => [l.sku, l.qty]).sort()) === JSON.stringify(b.map((l) => [l.sku, l.qty]).sort());
      if (same(lines, linesOf(ctx, latest.orderNo))) return null;
      return {
        apps: ["sports"],
        hidden: [delivered.orderNo],
        tempting: { what: `${latest.orderNo} is more recent but ${latest.status}`, check: async (api) => (await api.get("sports", sportsPath.order(latest.orderNo))).status !== "delivered" },
        effort: { reads: 1, writes: 1 },
        summary: `${c.email} has one new processing order repeating their most recent delivered order, to its address.`,
        note: `${c.email}: latest ${latest.orderNo} is ${latest.status} → repeat ${delivered.orderNo} (${lines.map((l) => `${l.qty} × ${l.sku}`).join(", ")})`,
        steps: [{
          kind: "state",
          intent: `On ${site("sports")}, place a new order for ${c.name} (${c.email}) that repeats their most recent delivered order: the same items in the same quantities, sent to the same address.`,
          rubric: R.change(["sports"], "the order was placed again"),
          oracle: stateOracle(...repeatChecks(c.email, lines, delivered.addressCode)),
          calls: [],
          noCall: REPEATED,
          solve: async (api) => {
            const mine = (await api.list("sports", sportsPath.ordersOf(c.email))).filter((o) => o.status === "delivered").sort((x, y) => y.placedOn.localeCompare(x.placedOn) || y.orderNo.localeCompare(x.orderNo));
            return api.post("sports", sportsPath.reorder(mine[0].orderNo), {});
          },
        }],
      };
    },
  },
  {
    key: "return-window-closed",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "Send back a named line of a seeded customer's delivered order after its category's return window has closed: impossible (`RETURN_WINDOW_CLOSED`). The right outcome is to say so and change nothing.",
    candidates: (ctx) => ctx.rows.sports.orders.filter((o) => o.status === "delivered").flatMap((o) => linesOf(ctx, o.orderNo).filter((l) => !returnable(ctx, o, l.sku)).map((line) => ({ o, line }))),
    claims: ({ o }) => [`person:sports:${o.customerEmail}`, `order:${o.orderNo}`],
    build({ o, line }, ctx) {
      const c = customerOf(ctx, o.customerEmail);
      return {
        apps: ["sports"],
        target: o.orderNo,
        impossible: { code: "RETURN_WINDOW_CLOSED" },
        effort: { reads: 0, writes: 0 },
        summary: `${line.sku} from ${o.orderNo} is past its return window: nothing is returned, and the agent looked at the order or was refused for it.`,
        note: `${o.orderNo} delivered ${o.deliveredOn}; ${categoryOf(ctx, line.sku).name} window ${categoryOf(ctx, line.sku).returnWindowDays} days closed ${sportsReturnDeadline(o.deliveredOn, categoryOf(ctx, line.sku).returnWindowDays)}`,
        steps: [{
          kind: "state",
          intent: `On ${site("sports")}, ${c.name} wants to send back ${itemText(ctx, line.sku)} from their order ${o.orderNo}, because it is defective.`,
          rubric: R.impossible(["sports"], "send the item back"),
          oracle: stateOracle(...impossibleChecks({ app: "sports", things: [{ type: "order", id: o.orderNo }], code: "RETURN_WINDOW_CLOSED" })),
          calls: [],
          solve: (api) => api.attempt("sports", sportsPath.returns, { orderNo: o.orderNo, sku: line.sku, qty: 1, reason: "defective" }),
        }],
      };
    },
  },
  {
    key: "refill-none-left",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "Request a refill of a named prescription that has no refills left: impossible (`NO_REFILLS_LEFT`). The right outcome is to say so and change nothing.",
    candidates: (ctx) => ctx.rows.clinic.prescriptions.filter((rx) => rx.refillsLeft === 0).flatMap((rx) => stocking(ctx, rx).slice(0, 1).map((p) => ({ rx, p }))),
    claims: ({ rx }) => [`person:clinic:${rx.patientEmail}`, `rx:${rx.rxNo}`],
    build({ rx, p }, ctx) {
      const pharmacy = ctx.clinic.clinic.get(p.clinicCode);
      return {
        apps: ["clinic"],
        target: rx.rxNo,
        impossible: { code: "NO_REFILLS_LEFT" },
        effort: { reads: 0, writes: 0 },
        summary: `${rx.rxNo} has no refills left: nothing is requested, and the agent looked at the prescription or was refused for it.`,
        note: `${rx.rxNo}: 0 refills left`,
        steps: [{
          kind: "state",
          intent: `On ${site("clinic")}, request a refill of ${rxText(ctx, rx)}, to collect at the pharmacy of ${pharmacy.name} (${pharmacy.code}).`,
          rubric: R.impossible(["clinic"], "request the refill"),
          oracle: stateOracle(...impossibleChecks({ app: "clinic", things: [{ type: "prescription", id: rx.rxNo }], code: "NO_REFILLS_LEFT" })),
          calls: [],
          solve: (api) => api.attempt("clinic", clinicPath.refill(rx.rxNo), { pharmacyCode: pharmacy.code }),
        }],
      };
    },
  },
];
