import { CITY_LIST, FIRST_NAMES, LAST_NAMES, word } from "../../acme-v1/names.js";
import { type Rng, int, pick, shuffle, substream } from "../../prng.js";
import { addDays } from "../../stays.js";
import { SPORTS_HISTORY_FROM, SPORTS_RETURN_REASONS, SPORTS_TODAY, sportsOrderTotals, sportsReturnDeadline } from "./rules.js";
import type { SportAddress, SportCategory, SportCustomer, SportOrder, SportOrderLine, SportOrderStatus, SportProduct, SportReturn, SportShippingPolicy, SportVariant, SportsRows } from "./types.js";

/**
 * The sports retailer's rows, drawn ONLY from `substream(seed, "sports")` so
 * adding the site moved no other row. Some variants are out of stock on
 * purpose: one in about a third of the products, a few at random, and the traps
 * below. Five customers have two orders still processing and one shipped,
 * seven more have a latest order that is shipped or cancelled rather than
 * delivered, and some delivered lines were already returned, in part or in full.
 */
export const SPORTS_SIZES = { customers: 18, busyCustomers: 5, notDeliveredLatest: 7, seededReturns: 10, stockTraps: 6 } as const;
export const SPORTS_COLOURS = ["black", "blue", "red", "grey"] as const;

const CATEGORIES = [
  { key: "running", name: "Running" },
  { key: "hiking", name: "Hiking" },
  { key: "cycling", name: "Cycling" },
  { key: "swimming", name: "Swimming" },
  { key: "tennis", name: "Tennis" },
  { key: "climbing", name: "Climbing" },
] as const;
const WINDOWS = [14, 21, 30, 45, 60, 90];
const SIZE_SETS = { shoe: ["41", "42", "43", "44"], apparel: ["S", "M", "L", "XL"], helmet: ["S", "M", "L"], grip: ["G2", "G3", "G4"], one: ["one size"] } as const;
const COLOUR_CODE: Record<string, string> = { black: "BLK", blue: "BLU", red: "RED", grey: "GRY" };
type Kind = { category: string; name: string; sizes: keyof typeof SIZE_SETS; dollars: [number, number]; grams: [number, number]; step: number; materials: string[]; models: number };
const KINDS: Kind[] = [
  { category: "running", name: "Trail Shoe", sizes: "shoe", dollars: [90, 160], grams: [270, 320], step: 10, materials: ["mesh upper and rubber sole", "knit upper and rubber sole"], models: 2 },
  { category: "running", name: "Road Shoe", sizes: "shoe", dollars: [80, 150], grams: [220, 270], step: 10, materials: ["knit upper and foam sole"], models: 1 },
  { category: "running", name: "Wind Jacket", sizes: "apparel", dollars: [60, 120], grams: [120, 180], step: 15, materials: ["ripstop nylon", "recycled polyester"], models: 1 },
  { category: "running", name: "Running Tights", sizes: "apparel", dollars: [40, 80], grams: [140, 190], step: 12, materials: ["polyester and elastane"], models: 1 },
  { category: "hiking", name: "Hiking Boot", sizes: "shoe", dollars: [120, 220], grams: [480, 600], step: 20, materials: ["full-grain leather", "suede and mesh"], models: 1 },
  { category: "hiking", name: "Rain Shell", sizes: "apparel", dollars: [110, 240], grams: [280, 400], step: 20, materials: ["three-layer nylon"], models: 1 },
  { category: "hiking", name: "Daypack", sizes: "one", dollars: [50, 110], grams: [600, 900], step: 0, materials: ["coated polyester"], models: 1 },
  { category: "hiking", name: "Trekking Poles", sizes: "one", dollars: [40, 120], grams: [400, 560], step: 0, materials: ["aluminium", "carbon fibre"], models: 1 },
  { category: "cycling", name: "Road Helmet", sizes: "helmet", dollars: [70, 190], grams: [220, 300], step: 20, materials: ["polycarbonate shell and foam liner"], models: 2 },
  { category: "cycling", name: "Cycling Jersey", sizes: "apparel", dollars: [45, 110], grams: [110, 160], step: 10, materials: ["polyester mesh"], models: 1 },
  { category: "cycling", name: "Cycling Gloves", sizes: "apparel", dollars: [20, 50], grams: [50, 90], step: 5, materials: ["synthetic leather palm"], models: 1 },
  { category: "swimming", name: "Swim Goggles", sizes: "one", dollars: [15, 40], grams: [25, 45], step: 0, materials: ["silicone strap"], models: 1 },
  { category: "swimming", name: "Training Swimsuit", sizes: "apparel", dollars: [35, 80], grams: [80, 130], step: 8, materials: ["chlorine-resistant polyester"], models: 2 },
  { category: "tennis", name: "Tennis Racket", sizes: "grip", dollars: [90, 240], grams: [270, 310], step: 3, materials: ["graphite"], models: 1 },
  { category: "tennis", name: "Tennis Shoe", sizes: "shoe", dollars: [80, 160], grams: [330, 390], step: 10, materials: ["mesh upper and rubber sole"], models: 1 },
  { category: "climbing", name: "Climbing Shoe", sizes: "shoe", dollars: [90, 180], grams: [400, 480], step: 12, materials: ["suede upper and rubber sole"], models: 2 },
  { category: "climbing", name: "Climbing Harness", sizes: "apparel", dollars: [50, 110], grams: [330, 410], step: 12, materials: ["nylon webbing"], models: 1 },
  { category: "climbing", name: "Chalk Bag", sizes: "one", dollars: [15, 35], grams: [80, 120], step: 0, materials: ["cotton canvas"], models: 1 },
];
const LABELS = ["home", "work", "cabin", "studio"];
const STREETS = ["Street", "Road", "Lane", "Avenue", "Way"];
const SKU_SIZE = (size: string) => (size === "one size" ? "OS" : size);

function makeCatalog(rng: Rng) {
  const brands = new Set<string>();
  while (brands.size < 4) brands.add(word(rng, 2));
  const brandList = [...brands];
  const products: SportProduct[] = [];
  const variants: SportVariant[] = [];
  const names = new Set<string>();
  for (const kind of KINDS) {
    for (let m = 0; m < kind.models; m++) {
      let name = "";
      do name = `${word(rng, 2)} ${kind.name}`;
      while (names.has(name));
      names.add(name);
      const code = `SP-${101 + products.length}`;
      const material = pick(rng, kind.materials);
      const brand = pick(rng, brandList);
      products.push({ code, name, brand, category: kind.category, material, description: `A ${kind.name.toLowerCase()} for ${kind.category}, made of ${material}.` });
      const all: readonly string[] = SIZE_SETS[kind.sizes];
      const span = Math.min(3, all.length);
      const from = int(rng, 0, all.length - span);
      const sizes = all.slice(from, from + span);
      const colours = shuffle(rng, SPORTS_COLOURS).slice(0, int(rng, 2, 3));
      const baseCents = int(rng, kind.dollars[0], kind.dollars[1]) * 100 - 1;
      const baseGrams = int(rng, kind.grams[0], kind.grams[1]);
      const premium = [0, pick(rng, [0, 500, 1000]), pick(rng, [500, 1000, 1500])];
      const mine: SportVariant[] = [];
      colours.forEach((colour, ci) =>
        sizes.forEach((size) =>
          mine.push({
            sku: `${code}-${COLOUR_CODE[colour]}-${SKU_SIZE(size)}`,
            productCode: code,
            size,
            colour,
            weightGrams: baseGrams + all.indexOf(size) * kind.step + int(rng, 0, 4),
            priceCents: baseCents + (premium[ci] ?? 0),
            stock: rng() < 0.02 ? 0 : int(rng, 2, 14),
          }),
        ),
      );
      // Out of stock on purpose: about a third of the products have a variant nobody can order.
      if (rng() < 0.33) pick(rng, mine).stock = 0;
      variants.push(...mine);
    }
  }
  return { products, variants };
}

/**
 * Out of stock on purpose, where a search can trip: in a few size-and-colour
 * groups, every variant cheaper than an in-stock one (B) that is no heavier
 * than B's weight rounded up to 10 g is out of stock, while a cheaper variant
 * over that weight is in stock. The cheapest thing that fits a weight cap is
 * then sold out, and the cheapest in stock is too heavy.
 */
function stockTraps(rng: Rng, variants: SportVariant[]): void {
  const groups = new Map<string, SportVariant[]>();
  for (const v of variants) if (v.size !== "one size") groups.set(`${v.size}|${v.colour}`, [...(groups.get(`${v.size}|${v.colour}`) ?? []), v]);
  let made = 0;
  for (const key of shuffle(rng, [...groups.keys()].sort())) {
    if (made >= SPORTS_SIZES.stockTraps) break;
    const vs = [...(groups.get(key) as SportVariant[])].sort((a, b) => a.priceCents - b.priceCents || a.sku.localeCompare(b.sku));
    for (const best of vs) {
      const cap = Math.ceil(best.weightGrams / 10) * 10;
      const cheaper = vs.filter((v) => v.priceCents < best.priceCents);
      const light = cheaper.filter((v) => v.weightGrams <= cap);
      const heavy = cheaper.filter((v) => v.weightGrams > cap);
      if (!light.length || !heavy.length || vs.some((v) => v !== best && v.priceCents === best.priceCents)) continue;
      for (const v of light) v.stock = 0;
      if (best.stock === 0) best.stock = int(rng, 2, 14);
      const h = pick(rng, heavy);
      if (h.stock === 0) h.stock = int(rng, 2, 14);
      made++;
      break;
    }
  }
}

function makeCustomers(rng: Rng) {
  const customers: SportCustomer[] = [];
  const addresses: SportAddress[] = [];
  const pairs = shuffle(rng, FIRST_NAMES.flatMap((f) => LAST_NAMES.map((l) => [f, l] as const))).slice(0, SPORTS_SIZES.customers);
  for (const [first, last] of pairs) {
    const email = `${first}.${last}@example.org`.toLowerCase();
    customers.push({ email, name: `${first} ${last}` });
    const n = pick(rng, [1, 2, 2, 3, 3]);
    const labels = shuffle(rng, LABELS);
    shuffle(rng, CITY_LIST).slice(0, n).forEach((city, i) =>
      addresses.push({
        code: `AD-${1001 + addresses.length}`,
        customerEmail: email,
        label: labels[i] as string,
        line1: `${int(rng, 2, 240)} ${word(rng, 2)} ${pick(rng, STREETS)}`,
        city,
        postcode: String(int(rng, 10000, 99999)),
        isDefault: i === 0,
      }),
    );
  }
  return { customers, addresses };
}

type Draft = Omit<SportOrder, "orderNo" | "subtotalCents" | "shippingCents" | "totalCents"> & { picks: { sku: string; qty: number; unitPriceCents: number }[] };

export function sportsRows(seed: number): SportsRows {
  const rng = substream(seed, "sports");
  // One shuffle, one window per category: no two categories share a return window.
  const windows = shuffle(rng, WINDOWS);
  const categories: SportCategory[] = CATEGORIES.map((c, i) => ({ key: c.key, name: c.name, returnWindowDays: windows[i] as number }));
  const shipping: SportShippingPolicy = { feeCents: pick(rng, [495, 595, 695, 795]), freeFromCents: pick(rng, [7500, 10000, 12500]) };
  const { products, variants } = makeCatalog(rng);
  stockTraps(rng, variants);
  const { customers, addresses } = makeCustomers(rng);
  const variantsOf = new Map(products.map((p) => [p.code, variants.filter((v) => v.productCode === p.code)]));
  const trackingSeen = new Set<string>();
  const tracking = () => {
    let t = "";
    do t = `TS${int(rng, 100000000, 999999999)}`;
    while (trackingSeen.has(t));
    trackingSeen.add(t);
    return t;
  };
  const drafts: Draft[] = [];
  const order = (customer: SportCustomer, status: SportOrderStatus, placedOn: string, avoid: Set<string> = new Set()) => {
    const mine = addresses.filter((a) => a.customerEmail === customer.email);
    const address = rng() < 0.5 ? (mine[0] as SportAddress) : pick(rng, mine);
    const chosen = shuffle(rng, products.filter((p) => !avoid.has(p.code))).slice(0, pick(rng, [1, 1, 2, 2, 3]));
    const picks = chosen.map((p) => {
      const v = pick(rng, variantsOf.get(p.code) as SportVariant[]);
      return { sku: v.sku, qty: pick(rng, [1, 1, 1, 2, 2, 3]), unitPriceCents: v.priceCents };
    });
    const shippedOn = status === "shipped" || status === "delivered" ? addDays(placedOn, int(rng, 1, 2)) : null;
    const deliveredOn = status === "delivered" && shippedOn ? addDays(shippedOn, int(rng, 2, 5)) : null;
    const cancelledOn = status === "cancelled" ? addDays(placedOn, int(rng, 0, 1)) : null;
    drafts.push({ customerEmail: customer.email, addressCode: address.code, status, placedOn, shippedOn, deliveredOn, cancelledOn, trackingNo: shippedOn ? tracking() : null, picks });
    return chosen.map((p) => p.code);
  };
  const history = (c: SportCustomer, n: number) => {
    for (let i = 0; i < n; i++) order(c, rng() < 0.08 ? "cancelled" : "delivered", addDays(SPORTS_HISTORY_FROM, int(rng, 0, 145)));
  };
  const recent = (back: [number, number]) => addDays(SPORTS_TODAY, -int(rng, back[0], back[1]));
  shuffle(rng, customers).forEach((c, i) => {
    if (i < SPORTS_SIZES.busyCustomers) {
      // Several orders on the way: one shipped, two still processing with no product in common.
      history(c, int(rng, 1, 2));
      order(c, "shipped", recent([4, 6]));
      const first = new Set(order(c, "processing", recent([1, 2])));
      order(c, "processing", recent([0, 0]), first);
    } else if (i < SPORTS_SIZES.busyCustomers + SPORTS_SIZES.notDeliveredLatest) {
      // The latest order is not a delivered one.
      history(c, int(rng, 2, 3));
      if (rng() < 0.6) order(c, "shipped", recent([3, 6]));
      else order(c, "cancelled", recent([5, 12]));
    } else {
      history(c, int(rng, 1, 3));
      const r = rng();
      if (r < 0.3) order(c, "shipped", recent([3, 6]));
      else if (r < 0.5) order(c, "processing", recent([0, 2]));
    }
  });
  drafts.sort((x, y) => x.placedOn.localeCompare(y.placedOn));
  const orders: SportOrder[] = [];
  const lines: SportOrderLine[] = [];
  drafts.forEach((d, i) => {
    const orderNo = `ORD-${10001 + i}`;
    const { picks, ...rest } = d;
    orders.push({ orderNo, ...rest, ...sportsOrderTotals(shipping, picks) });
    for (const p of picks) lines.push({ orderNo, ...p });
  });
  const returns = makeReturns(rng, { categories, products, variants, orders, lines });
  return { categories, shipping, products, variants, customers, addresses, orders, lines, returns };
}

/** Returns already made: part or all of a delivered line, requested within its window and by SPORTS_TODAY. */
function makeReturns(rng: Rng, r: Pick<SportsRows, "categories" | "products" | "variants" | "orders" | "lines">): SportReturn[] {
  const order = new Map(r.orders.map((o) => [o.orderNo, o]));
  const window = new Map(r.products.map((p) => [p.code, (r.categories.find((c) => c.key === p.category) as SportCategory).returnWindowDays]));
  const productOf = new Map(r.variants.map((v) => [v.sku, v.productCode]));
  const out: Omit<SportReturn, "returnNo">[] = [];
  for (const line of shuffle(rng, r.lines.filter((l) => order.get(l.orderNo)?.status === "delivered"))) {
    if (out.length >= SPORTS_SIZES.seededReturns) break;
    const deliveredOn = (order.get(line.orderNo) as SportOrder).deliveredOn as string;
    const last = [sportsReturnDeadline(deliveredOn, window.get(productOf.get(line.sku) as string) as number), SPORTS_TODAY].sort()[0] as string;
    const requestedOn = addDays(deliveredOn, int(rng, 1, 5));
    if (requestedOn > last) continue;
    const qty = int(rng, 1, line.qty);
    out.push({ orderNo: line.orderNo, sku: line.sku, qty, reason: pick(rng, SPORTS_RETURN_REASONS), requestedOn, refundCents: qty * line.unitPriceCents });
  }
  return out.sort((x, y) => x.requestedOn.localeCompare(y.requestedOn) || x.orderNo.localeCompare(y.orderNo)).map((x, i) => ({ returnNo: `RET-${5001 + i}`, ...x }));
}
