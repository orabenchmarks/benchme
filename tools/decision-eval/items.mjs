/**
 * decision-eval items — closed-set decisions whose answer is a pure function
 * of the STATE handed to the model, with ground truth computed from the same
 * seeded rows the workspace is built from (never hand-labelled).
 *
 * Every item is { id, family, subtype, kind, state, instructions, options?, truth }:
 *   kind "choice" → options is { optionId: text }, truth is the right optionId;
 *   kind "noul"   → truth is a boolean (is the statement true given the state).
 *
 * Families (see README § decision-eval):
 *   match   — pick the ONE record (customer / ticket / product) satisfying a two-part description
 *             (hard negatives satisfy exactly one part)
 *   argmin  — pick the cheapest of a handful of products (numeric comparison)
 *   claim   — is a statement true given evidence: a table lookup, an aggregate, a policy rule
 *   route   — which app handles a user request (warehouse / helpdesk / document vault)
 */
import { minstd, pick, shuffle, slaBreaches, stockOf } from "../../packages/scenarios/dist/index.js";

const usd = (cents) => `$${(cents / 100).toFixed(2)}`;
const optionIds = (n) => Array.from({ length: n }, (_, i) => `o${i + 1}`);

/** Shuffle candidates into lettered options; returns { options, truth }. */
function asOptions(rng, candidates, isTruth, textOf) {
  const shuffled = shuffle(rng, candidates);
  const ids = optionIds(shuffled.length);
  const options = Object.fromEntries(shuffled.map((c, i) => [ids[i], textOf(c)]));
  const truthIndex = shuffled.findIndex(isTruth);
  return { options, truth: ids[truthIndex] };
}

function matchCustomers(rows, rng, n) {
  const items = [];
  const customers = rows.warehouse.customers;
  const targets = shuffle(rng, customers).filter(
    (t) => customers.filter((c) => c.tier === t.tier && c.city === t.city).length === 1,
  );
  for (const t of targets.slice(0, n)) {
    const sameTier = shuffle(rng, customers.filter((c) => c.tier === t.tier && c.city !== t.city)).slice(0, 3);
    const sameCity = shuffle(rng, customers.filter((c) => c.city === t.city && c.tier !== t.tier)).slice(0, 3);
    const other = customers.filter((c) => c.tier !== t.tier && c.city !== t.city);
    const candidates = [t, ...sameTier, ...sameCity, pick(rng, other)];
    const { options, truth } = asOptions(rng, candidates, (c) => c === t, (c) => `${c.name} — ${c.tier} tier, based in ${c.city}`);
    items.push({
      family: "match",
      subtype: "customer",
      kind: "choice",
      state: { request: `the ${t.tier}-tier customer based in ${t.city}` },
      instructions: "Which candidate is the customer the request describes? Exactly one matches both parts.",
      options,
      truth,
    });
  }
  return items;
}

function matchTickets(rows, rng, n) {
  const items = [];
  const tickets = rows.helpdesk.tickets;
  const unique = tickets.filter((t) => tickets.filter((u) => u.priority === t.priority && u.subject === t.subject).length === 1);
  for (const t of shuffle(rng, unique).slice(0, n)) {
    const sameSubject = shuffle(rng, tickets.filter((u) => u.subject === t.subject && u.priority !== t.priority)).slice(0, 3);
    const samePriority = shuffle(rng, tickets.filter((u) => u.priority === t.priority && u.subject !== t.subject)).slice(0, 3);
    const other = tickets.filter((u) => u.priority !== t.priority && u.subject !== t.subject);
    const candidates = [t, ...sameSubject, ...samePriority, pick(rng, other)];
    const { options, truth } = asOptions(rng, candidates, (u) => u === t, (u) => `${u.ticketNo} — "${u.subject}", ${u.priority} priority, ${u.status}`);
    items.push({
      family: "match",
      subtype: "ticket",
      kind: "choice",
      state: { request: `the ${t.priority}-priority ticket about "${t.subject}"` },
      instructions: "Which candidate is the ticket the request describes? Exactly one matches both the priority and the subject.",
      options,
      truth,
    });
  }
  return items;
}

function matchProducts(rows, rng, n) {
  const items = [];
  const products = rows.warehouse.products;
  const unique = products.filter((p) => products.filter((q) => q.category === p.category && q.unitPriceCents === p.unitPriceCents).length === 1);
  for (const t of shuffle(rng, unique).slice(0, n)) {
    const sameCategory = shuffle(rng, products.filter((p) => p.category === t.category && p !== t)).slice(0, 3);
    const nearPrice = products
      .filter((p) => p.category !== t.category)
      .sort((a, b) => Math.abs(a.unitPriceCents - t.unitPriceCents) - Math.abs(b.unitPriceCents - t.unitPriceCents))
      .slice(0, 3);
    const candidates = [t, ...sameCategory, ...nearPrice, pick(rng, products.filter((p) => p.category !== t.category && !nearPrice.includes(p)))];
    const { options, truth } = asOptions(rng, candidates, (p) => p === t, (p) => `${p.name} (${p.sku}) — ${p.category}, ${usd(p.unitPriceCents)}`);
    items.push({
      family: "match",
      subtype: "product",
      kind: "choice",
      state: { request: `the ${t.category} item priced at ${usd(t.unitPriceCents)}` },
      instructions: "Which candidate is the product the request describes? Exactly one matches both the category and the price.",
      options,
      truth,
    });
  }
  return items;
}

function argminPrice(rows, rng, n) {
  const items = [];
  const byCategory = new Map();
  for (const p of rows.warehouse.products) byCategory.set(p.category, [...(byCategory.get(p.category) ?? []), p]);
  const categories = [...byCategory.keys()];
  while (items.length < n) {
    const set = shuffle(rng, byCategory.get(pick(rng, categories))).slice(0, 6);
    const min = Math.min(...set.map((p) => p.unitPriceCents));
    if (set.filter((p) => p.unitPriceCents === min).length !== 1) continue;
    const { options, truth } = asOptions(rng, set, (p) => p.unitPriceCents === min, (p) => `${p.name} (${p.sku}) — ${usd(p.unitPriceCents)}`);
    items.push({
      family: "argmin",
      subtype: "cheapest",
      kind: "choice",
      state: { request: "the cheapest of these products" },
      instructions: "Which candidate has the lowest unit price?",
      options,
      truth,
    });
  }
  return items;
}

/** A wrong number that is still plausible: ±10–40 %, never equal to the truth. */
function perturb(rng, value) {
  const factor = 1 + (rng() < 0.5 ? -1 : 1) * (0.1 + rng() * 0.3);
  const out = Math.round(value * factor);
  return out === value ? value + 1 : out;
}

function claimPrice(rows, rng, n) {
  const products = rows.warehouse.products;
  return shuffle(rng, products)
    .slice(0, n)
    .map((p, i) => {
      const table = shuffle(rng, [p, ...shuffle(rng, products.filter((q) => q !== p)).slice(0, 4)])
        .map((q) => `${q.sku} · ${q.name} · ${q.category} · ${usd(q.unitPriceCents)}`)
        .join("\n");
      const truth = i % 2 === 0;
      const stated = truth ? p.unitPriceCents : perturb(rng, p.unitPriceCents);
      return {
        family: "claim",
        subtype: "lookup",
        kind: "noul",
        state: { evidence: table, statement: `The ${p.name} (${p.sku}) costs ${usd(stated)} per unit.` },
        instructions: "Is the statement true given the evidence?",
        truth,
      };
    });
}

function claimStockSum(rows, rng, n) {
  const skus = [...new Set(rows.warehouse.stock.map((s) => s.sku))].filter((sku) => rows.warehouse.stock.filter((s) => s.sku === sku).length >= 2);
  const names = new Map(rows.warehouse.locations.map((l) => [l.code, l.name]));
  return shuffle(rng, skus)
    .slice(0, n)
    .map((sku, i) => {
      const total = stockOf(rows, sku);
      const lines = rows.warehouse.stock.filter((s) => s.sku === sku).map((s) => `${s.locationCode} (${names.get(s.locationCode)}): ${s.qty} units`);
      const truth = i % 2 === 0;
      return {
        family: "claim",
        subtype: "aggregate",
        kind: "noul",
        state: { evidence: `Stock of ${sku} by depot:\n${lines.join("\n")}`, statement: `${sku} has ${truth ? total : perturb(rng, total)} units in stock across all depots.` },
        instructions: "Is the statement true given the evidence?",
        truth,
      };
    });
}

function claimSla(rows, rng, n) {
  const breaches = new Set(slaBreaches(rows));
  const resolved = rows.helpdesk.tickets.filter((t) => t.resolvedAt !== null);
  const policy = rows.helpdesk.slaPolicies.map((p) => `${p.priority}: respond within ${p.respondHours} h, resolve within ${p.resolveHours} h`).join("\n");
  const late = shuffle(rng, resolved.filter((t) => breaches.has(t.ticketNo))).slice(0, Math.floor(n / 2));
  const onTime = shuffle(rng, resolved.filter((t) => !breaches.has(t.ticketNo))).slice(0, n - late.length);
  return shuffle(rng, [...late, ...onTime]).map((t) => ({
    family: "claim",
    subtype: "rule",
    kind: "noul",
    state: {
      evidence: `SLA policy by priority:\n${policy}\n\nTicket ${t.ticketNo} — priority ${t.priority}, opened ${t.openedAt}, resolved ${t.resolvedAt}.`,
      statement: `Ticket ${t.ticketNo} was resolved within its SLA resolve time.`,
    },
    instructions: "Is the statement true given the evidence?",
    truth: !breaches.has(t.ticketNo),
  }));
}

const ROUTE_OPTIONS = {
  warehouse: "Warehouse app — products, prices, stock levels by depot, customers, sales orders, stock transfers",
  helpdesk: "Helpdesk app — customer support tickets, agents, SLA policies, ticket comments",
  vaultdocs: "Document vault — company policies, reports, memos, meeting notes",
};

function routeRequests(rows, rng, perApp) {
  const w = rows.warehouse;
  const warehouse = Array.from({ length: perApp }, (_, i) => {
    const p = pick(rng, w.products);
    const l = pick(rng, w.locations);
    return [
      `Where is my order ${pick(rng, w.orders).orderNo}? Has it shipped?`,
      `How many ${p.name} do we have at the ${l.city} depot?`,
      `Move 12 units of ${p.sku} to the ${l.city} depot.`,
      `What would 40 units of ${p.name} cost?`,
    ][i % 4];
  });
  // Built from helpdesk-ONLY entities (tickets, agents, SLAs). The first cut
  // used raw ticket subjects, and a third of those labels were contestable:
  // "Update the shipping address on SO-…" or "Request for a datasheet on …"
  // arrive AS tickets but belong to the warehouse / the vault — every model
  // "missed" them the same way. A label a careful human would dispute is not
  // ground truth.
  const h = rows.helpdesk;
  const helpdesk = Array.from({ length: perApp }, (_, i) => {
    const t = pick(rng, h.tickets);
    const a = pick(rng, h.agents);
    return [
      `What is the status of ticket ${t.ticketNo}?`,
      `Assign ticket ${t.ticketNo} to ${a.name}.`,
      `Which support tickets are breaching their SLA right now?`,
      `Add a note to ${t.ticketNo} saying we called the customer back.`,
      `How many open tickets does ${a.name} have?`,
    ][i % 5];
  });
  const vaultdocs = shuffle(rng, rows.vault.documents)
    .slice(0, perApp)
    .map((d) => `I need to read the "${d.title}" document.`);
  const items = [];
  for (const [app, requests] of Object.entries({ warehouse, helpdesk, vaultdocs })) {
    for (const request of requests) {
      items.push({
        family: "route",
        subtype: app,
        kind: "choice",
        state: { request },
        instructions: "Which app should handle this request?",
        options: ROUTE_OPTIONS,
        truth: app,
      });
    }
  }
  return shuffle(rng, items);
}

/** Every item for one seed, ids stable per (family, subtype, index). */
export function buildItems(rows, seed, size = {}) {
  const rng = minstd(seed ^ 0x5eed);
  const n = { match: 30, argmin: 40, claim: 30, route: 15, ...size };
  const all = [
    ...matchCustomers(rows, rng, n.match),
    ...matchTickets(rows, rng, n.match),
    ...matchProducts(rows, rng, n.match),
    ...argminPrice(rows, rng, n.argmin),
    ...claimPrice(rows, rng, n.claim),
    ...claimStockSum(rows, rng, n.claim),
    ...claimSla(rows, rng, n.claim),
    ...routeRequests(rows, rng, n.route),
  ];
  const counters = new Map();
  return all.map((item) => {
    const key = `${item.family}.${item.subtype}`;
    const i = (counters.get(key) ?? 0) + 1;
    counters.set(key, i);
    return { id: `${key}.${i}`, ...item };
  });
}
