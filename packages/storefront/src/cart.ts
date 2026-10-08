import type { CartLine, StoreDef } from "./catalog.js";

export type { CartLine } from "./catalog.js";

/** Identity of a line: SKU + option values (order-independent) + purchase mode + interval. */
export function lineKey(l: Pick<CartLine, "sku" | "options" | "mode" | "interval">): string {
  const opts = Object.keys(l.options)
    .sort()
    .map((k) => `${k}=${l.options[k]}`)
    .join("&");
  return JSON.stringify([l.sku, opts, l.mode ?? "once", l.interval ?? ""]);
}

export function addLine(lines: CartLine[], add: CartLine, maxQty = 10): CartLine[] {
  const k = lineKey(add);
  const i = lines.findIndex((l) => lineKey(l) === k);
  if (i < 0) return [...lines, { ...add, qty: Math.min(Math.max(add.qty, 1), maxQty) }];
  return lines.map((l, j) => (j === i ? { ...l, qty: Math.min(l.qty + add.qty, maxQty) } : l));
}

export function setQty(lines: CartLine[], key: string, qty: number, maxQty = 10): CartLine[] {
  if (qty <= 0) return removeLine(lines, key);
  return lines.map((l) => (lineKey(l) === key ? { ...l, qty: Math.min(qty, maxQty) } : l));
}

export function removeLine(lines: CartLine[], key: string): CartLine[] {
  return lines.filter((l) => lineKey(l) !== key);
}

/** Unit price of a line: base + option deltas, less the subscription saving when subscribed. */
export function unitPrice(store: StoreDef, l: CartLine): number {
  const p = store.products.find((x) => x.sku === l.sku);
  if (!p) throw new Error(`unknown sku ${l.sku}`);
  let cents = p.priceCents;
  for (const g of p.options) {
    const v = g.values.find((x) => x.id === l.options[g.id]);
    if (v?.priceDeltaCents) cents += v.priceDeltaCents;
  }
  if (l.mode === "subscribe" && p.subscription) cents = Math.round((cents * (100 - p.subscription.savePct)) / 100);
  return cents;
}
