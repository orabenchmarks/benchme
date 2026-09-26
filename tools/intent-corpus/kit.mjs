/**
 * What every intent-task template shares: the seed rows indexed by natural
 * key, a per-template random stream, and small helpers for deriving answers.
 */
import { int, minstd, pick } from "../../packages/scenarios/dist/index.js";

export { int, pick };

/**
 * A template's own stream: same (seed, template key) → same sequence on every
 * runtime, and adding or reordering templates never moves another template's
 * picks (each hashes its own key; nothing is drawn from a shared stream).
 */
export function streamFor(seed, key) {
  let h = 2166136261;
  for (const ch of `${seed}:${key}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return minstd((h % 2147483646) + 1);
}

/** Items whose `keyOf` value occurs exactly once — a question naming it names one thing. */
export function unique(items, keyOf) {
  const counts = new Map();
  for (const item of items) counts.set(keyOf(item), (counts.get(keyOf(item)) ?? 0) + 1);
  return items.filter((item) => counts.get(keyOf(item)) === 1);
}

/** The first capture of `pattern` in `text` as a number; throws when absent, so a changed document body fails the build instead of producing a null answer. */
export function numberIn(text, pattern) {
  const m = pattern.exec(text);
  if (!m) throw new Error(`no match for ${pattern} in: ${text.slice(0, 120)}…`);
  return Number(m[1].replace(/,/g, ""));
}

const groupBy = (items, keyOf) => {
  const out = new Map();
  for (const item of items) out.set(keyOf(item), [...(out.get(keyOf(item)) ?? []), item]);
  return out;
};

/** The seed rows, indexed once for every template. */
export function contextOf(rows) {
  const w = rows.warehouse;
  const h = rows.helpdesk;
  const linesOf = groupBy(w.orderLines, (l) => l.orderNo);
  return {
    rows,
    product: new Map(w.products.map((p) => [p.sku, p])),
    customer: new Map(w.customers.map((c) => [c.code, c])),
    location: new Map(w.locations.map((l) => [l.code, l])),
    agent: new Map(h.agents.map((a) => [a.code, a])),
    linesOf: (orderNo) => linesOf.get(orderNo) ?? [],
    commentsOf: (ticketNo) => h.comments.filter((c) => c.ticketNo === ticketNo),
    openOrdersOf: (customerCode) => w.orders.filter((o) => o.customerCode === customerCode && o.status === "open"),
    /** A customer's existing open orders already carry this exact line — a new-order check could pass on an old order. */
    hasOpenLine: (customerCode, sku, qty) => w.orders.some((o) => o.customerCode === customerCode && o.status === "open" && (linesOf.get(o.orderNo) ?? []).some((l) => l.sku === sku && l.qty === qty)),
    /** Seeded pending transfers reserve source stock; a new transfer from the same (sku, depot) could be refused. */
    pendingFrom: (sku, locationCode) => w.transfers.some((t) => t.status === "pending" && t.sku === sku && t.fromCode === locationCode),
    depotsHolding: (sku) => w.stock.filter((s) => s.sku === sku && s.qty > 0),
    ticketsBy: (requester) => h.tickets.filter((t) => t.requester === requester),
  };
}

/** `SO-1`, `HD-5001`… as a question writes them. Money as the pages print it. */
export const usd = (cents) => `$${(cents / 100).toFixed(2)}`;
