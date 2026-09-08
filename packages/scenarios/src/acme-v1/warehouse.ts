import { type Rng, int, pick, shuffle } from "../prng.js";
import type { Customer, Location, Order, OrderLine, Product, Stock, Transfer } from "../scenario.js";
import { CATEGORY_LIST, city, companyName, word } from "./names.js";

export function products(rng: Rng, count: number): Product[] {
  const out: Product[] = [];
  for (let i = 0; i < count; i++) {
    const category = CATEGORY_LIST[i % CATEGORY_LIST.length] as string;
    out.push({
      sku: `${category.slice(0, 3).toUpperCase()}-${String(1000 + i)}`,
      name: `${word(rng)} ${word(rng, 2)} ${pick(rng, ["kit", "unit", "pack", "module", "assembly"])}`,
      category,
      unitPriceCents: int(rng, 3, 900) * 25,
    });
  }
  return out;
}

export function locations(rng: Rng): Location[] {
  const codes = ["VLM", "OST", "QHV", "BRM"];
  return codes.map((code, i) => ({ code, name: `${word(rng)} depot ${i + 1}`, city: city(rng) }));
}

export function stock(rng: Rng, items: Product[], sites: Location[]): Stock[] {
  const out: Stock[] = [];
  for (const p of items) {
    for (const l of sites) {
      // roughly a third of (sku, location) pairs are simply not stocked there
      if (rng() < 0.34) continue;
      out.push({ sku: p.sku, locationCode: l.code, qty: int(rng, 0, 480) });
    }
  }
  return out;
}

export function customers(rng: Rng, count: number): Customer[] {
  const tiers = ["standard", "standard", "standard", "gold", "gold", "platinum"] as const;
  return Array.from({ length: count }, (_, i) => ({
    code: `C-${String(100 + i)}`,
    name: companyName(rng),
    tier: pick(rng, tiers),
    city: city(rng),
  }));
}

export function orders(rng: Rng, count: number, custs: Customer[], items: Product[]): { orders: Order[]; lines: OrderLine[] } {
  const orders: Order[] = [];
  const lines: OrderLine[] = [];
  const statuses = ["open", "open", "shipped", "shipped", "shipped", "cancelled"] as const;
  for (let i = 0; i < count; i++) {
    const orderNo = `SO-${String(20000 + i)}`;
    const day = int(rng, 0, 179);
    const placed = new Date(Date.UTC(2026, 0, 2 + day, int(rng, 8, 17), int(rng, 0, 59)));
    orders.push({ orderNo, customerCode: pick(rng, custs).code, status: pick(rng, statuses), placedAt: placed.toISOString() });
    const chosen = shuffle(rng, items).slice(0, int(rng, 1, 4));
    for (const p of chosen) lines.push({ orderNo, sku: p.sku, qty: int(rng, 1, 40) });
  }
  return { orders, lines };
}

export function transfers(rng: Rng, count: number, stockRows: Stock[]): Transfer[] {
  const out: Transfer[] = [];
  const stocked = stockRows.filter((s) => s.qty > 20);
  for (let i = 0; i < count; i++) {
    const src = pick(rng, stocked);
    const targets = ["VLM", "OST", "QHV", "BRM"].filter((c) => c !== src.locationCode);
    out.push({
      transferNo: `TR-${String(500 + i)}`,
      sku: src.sku,
      fromCode: src.locationCode,
      toCode: pick(rng, targets),
      qty: int(rng, 1, Math.min(20, src.qty)),
      status: rng() < 0.6 ? "completed" : "pending",
    });
  }
  return out;
}
