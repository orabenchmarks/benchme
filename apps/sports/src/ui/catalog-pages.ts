import type { SportsOffer } from "@benchme/scenarios";
import { esc, money } from "@benchme/site-kit";
import type { Policies, ProductDetail, ProductSummary } from "../db/catalog-repo.js";

export const tag = (s: string) => `<span class="tag">${esc(s)}</span>`;
export const inline = 'style="width:auto;display:inline"';
export const field = (label: string, name: string, value: string | undefined, attrs = "") => `<label>${label}</label><input name="${name}" value="${esc(value ?? "")}" ${attrs}>`;
export const options = (values: readonly { value: string; label: string }[], selected: string | undefined, blank?: string) =>
  `${blank !== undefined ? `<option value="">${esc(blank)}</option>` : ""}${values.map((o) => `<option value="${esc(o.value)}"${o.value === selected ? " selected" : ""}>${esc(o.label)}</option>`).join("")}`;
const plain = (xs: readonly string[]) => xs.map((x) => ({ value: x, label: x }));
const stockText = (n: number) => (n > 0 ? String(n) : "<strong>out of stock</strong>");
export type Facets = { sizes: string[]; colours: string[] };
type F = Record<string, string | undefined>;

export function policyNote(pol: Policies): string {
  return `Shipping is ${money(pol.shipping.feeCents)} per order, free once the order's subtotal reaches ${money(pol.shipping.freeFromCents)}. Today on this site is ${esc(pol.today)}.`;
}

export function home(p: string, pol: Policies, facets: Facets, f: F = {}): string {
  const cats = pol.categories.map((c) => ({ value: c.key, label: c.name }));
  return `<h1>Find gear</h1><form class="card" method="get" action="${p}/search">${field("Words (name, brand, material)", "query", f.query)}
<label>Category</label><select name="category">${options(cats, f.category, "any")}</select>
<label>Size</label><select name="size">${options(plain(facets.sizes), f.size, "any")}</select><label>Colour</label><select name="colour">${options(plain(facets.colours), f.colour, "any")}</select>
${field("Most per item ($)", "maxPrice", f.maxPrice, 'type="number" min="1" step="0.01"')}${field("Heaviest (grams)", "maxWeight", f.maxWeight, 'type="number" min="1"')}
<label><input type="checkbox" name="inStock" value="1" ${inline}${f.inStock ? " checked" : ""}> In stock only</label><button>Search</button></form>
<h2>Categories</h2><table><tr><th>Category</th><th>Return window</th></tr>${pol.categories.map((c) => `<tr><td><a href="${p}/products?category=${esc(c.key)}">${esc(c.name)}</a></td><td>${c.returnWindowDays} days after delivery</td></tr>`).join("")}</table>
<p class="muted">${policyNote(pol)} Sign in to place orders, cancel them, reorder or request returns.</p>`;
}

export function searchResults(p: string, offers: SportsOffer[], f: F): string {
  const rows = offers
    .map((o) => `<tr><td><code>${esc(o.sku)}</code></td><td><a href="${p}/products/${esc(o.productCode)}">${esc(o.productName)}</a></td><td>${esc(o.brand)}</td><td>${esc(o.category)}</td><td>${esc(o.size)}</td><td>${esc(o.colour)}</td><td>${o.weightGrams} g</td><td>${money(o.priceCents)}</td><td>${stockText(o.stock)}</td>
<td>${o.stock > 0 ? `<a href="${p}/orders/new?sku=${encodeURIComponent(o.sku)}">Order</a>` : ""}</td></tr>`)
    .join("");
  const said = Object.entries(f).filter(([, v]) => v).map(([k, v]) => `${esc(k)}: ${esc(v)}`).join(" · ");
  return `<h1>Search results</h1><p class="muted">${offers.length} variant(s), cheapest first${said ? ` — ${said}` : ""}. <a href="${p}/">New search</a></p>
<table><tr><th>SKU</th><th>Product</th><th>Brand</th><th>Category</th><th>Size</th><th>Colour</th><th>Weight</th><th>Price</th><th>Stock</th><th></th></tr>${rows || "<tr><td colspan=10>No variant matches every filter.</td></tr>"}</table>`;
}

export function productsList(p: string, products: ProductSummary[], pol: Policies, category?: string): string {
  const name = pol.categories.find((c) => c.key === category)?.name;
  const rows = products
    .map((x) => `<tr><td><a href="${p}/products/${esc(x.code)}">${esc(x.name)}</a></td><td><code>${esc(x.code)}</code></td><td>${esc(x.brand)}</td><td>${esc(x.category)}</td><td>from ${money(x.fromCents)}</td><td>${x.variantsInStock} of ${x.variants}</td></tr>`)
    .join("");
  const tabs = pol.categories.map((c) => (c.key === category ? `<strong>${esc(c.name)}</strong>` : `<a href="${p}/products?category=${esc(c.key)}">${esc(c.name)}</a>`)).join(" · ");
  return `<h1>Products${name ? `: ${esc(name)}` : ""}</h1><p><a href="${p}/products">All</a> · ${tabs}</p>
<table><tr><th>Product</th><th>Code</th><th>Brand</th><th>Category</th><th>Price</th><th>Variants in stock</th></tr>${rows || "<tr><td colspan=6>None.</td></tr>"}</table>`;
}

export function productDetail(p: string, x: ProductDetail, pol: Policies): string {
  const cat = pol.categories.find((c) => c.key === x.category);
  const rows = x.variants
    .map((v) => `<tr><td><code>${esc(v.sku)}</code></td><td>${esc(v.size)}</td><td>${esc(v.colour)}</td><td>${v.weightGrams} g</td><td>${money(v.priceCents)}</td><td>${stockText(v.stock)}</td><td>${v.stock > 0 ? `<a href="${p}/orders/new?sku=${encodeURIComponent(v.sku)}">Order</a>` : ""}</td></tr>`)
    .join("");
  return `<h1>${esc(x.name)} <code>${esc(x.code)}</code></h1><p>${tag(x.brand)} · <a href="${p}/products?category=${esc(x.category)}">${esc(cat?.name ?? x.category)}</a></p>
<h2>Specifications</h2><table><tr><th>Brand</th><td>${esc(x.brand)}</td></tr><tr><th>Material</th><td>${esc(x.material)}</td></tr><tr><th>Description</th><td>${esc(x.description)}</td></tr>
<tr><th>Returns</th><td>${cat ? `${cat.returnWindowDays} days after delivery` : "—"}</td></tr></table>
<h2>Variants</h2><table><tr><th>SKU</th><th>Size</th><th>Colour</th><th>Weight</th><th>Price</th><th>Stock</th><th></th></tr>${rows}</table>`;
}

export function policiesPage(p: string, pol: Policies): string {
  return `<h1>Store policies</h1><h2>Returns</h2><p>A line of a delivered order can be returned up to and including its last return day: the delivery date plus the days of its category's window. Delivered on 1 March with a 30-day window, the last day is 31 March. You can return at most the units bought, minus any already returned. Returned items are refunded at the price paid and do not go back into stock.</p>
<table><tr><th>Category</th><th>Return window</th></tr>${pol.categories.map((c) => `<tr><td><a href="${p}/products?category=${esc(c.key)}">${esc(c.name)}</a></td><td>${c.returnWindowDays} days</td></tr>`).join("")}</table>
<p>Accepted reasons: ${pol.returnReasons.map(tag).join(" ")}</p>
<h2>Shipping</h2><p>${money(pol.shipping.feeCents)} per order, free when the order's subtotal is ${money(pol.shipping.freeFromCents)} or more.</p>
<h2>Orders</h2><p>An order holds up to 8 lines of 1 to 10 units each and is placed for a customer, to one of their saved addresses. Its units are reserved from stock when it is placed. An order can be cancelled only while it is processing; once shipped it cannot. Today on this site is ${esc(pol.today)}.</p>`;
}
