import { PIZZA_ALLERGENS, type PizzaMenuOffer } from "@benchme/scenarios";
import { esc, money } from "@benchme/site-kit";
import type { BranchView, Builder, MenuView } from "../../db/pizza-repo.js";
import { checkboxes, dietTags, field, inline, optionsOf, perSize, qs, select, tag } from "./common.js";

export type SearchForm = Record<string, string | string[] | undefined>;
const list = (v: string | string[] | undefined) => (v === undefined ? [] : Array.isArray(v) ? v : v.split(","));
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const branchOpts = (branches: BranchView[], any: string) => [{ value: "", label: any }, ...branches.map((b) => ({ value: b.code, label: `${b.name} (${b.code})` }))];
const toppingNames = (b: Builder, keys: readonly string[]) => keys.map((k) => b.toppings.find((t) => t.key === k)?.name ?? k).join(", ");

function searchForm(p: string, b: Builder, branches: BranchView[], f: SearchForm): string {
  const allergens = PIZZA_ALLERGENS.map((a) => ({ value: a, label: `no ${a}` }));
  const box = (name: string, label: string) => `<label style="display:inline;margin-right:1em"><input type="checkbox" name="${name}" value="true"${one(f[name]) === "true" ? " checked" : ""} ${inline}> ${label}</label>`;
  return `<form class="card" method="get" action="${p}/search">${select("Size", "size", optionsOf(b).sizes, one(f.size) ?? "medium")}${select("Branch (only pizzas it can make)", "branch", branchOpts(branches, "any branch"), one(f.branch))}
<label>Diet</label><div>${box("vegetarian", "vegetarian")}${box("vegan", "vegan")}</div><label>Without</label><div>${checkboxes("without", allergens, list(f.without))}</div>
${field("Most per pizza ($)", "maxPrice", one(f.maxPrice), 'type="number" min="1" step="0.01"')}<button>Find pizzas</button></form>`;
}

export function home(p: string, b: Builder, branches: BranchView[], f: SearchForm = {}): string {
  const rows = branches
    .map((x) => `<tr><td>${esc(x.city)}</td><td><a href="${p}/branches/${esc(x.code)}">${esc(x.name)}</a> <code>${esc(x.code)}</code></td><td>${x.delivers ? `${money(x.deliveryFeeCents ?? 0)}, free from ${money(x.freeDeliveryFromCents ?? 0)}` : "pickup only"}</td><td>${x.slotCapacity}</td><td>${x.outOfStock.map(tag).join(" ") || "—"}</td></tr>`)
    .join("");
  return `<h1>Find a pizza</h1>${searchForm(p, b, branches, f)}<p><a href="${p}/pizzas">The whole menu</a> · <a href="${p}/build">Build your own pizza</a></p>
<h2>Branches</h2><table><tr><th>City</th><th>Branch</th><th>Delivery</th><th>Pizzas per slot</th><th>Out of stock</th></tr>${rows}</table>
<p class="muted">Orders are taken for 30-minute slots from 12:00 to 21:30 on dates in 2027. Prices are per pizza. Sign in to order.</p>`;
}

export function searchResults(p: string, b: Builder, branches: BranchView[], f: SearchForm, offers: PizzaMenuOffer[]): string {
  const branch = one(f.branch);
  const rows = offers
    .map((o) => `<tr><td><a href="${p}/pizzas/${esc(o.pizzaCode)}">${esc(o.name)}</a> <code>${esc(o.pizzaCode)}</code></td><td>${money(o.priceCents)}</td><td>${esc(o.crust)}, ${esc(o.sauce)}, ${esc(o.cheese)}; ${esc(toppingNames(b, o.toppings))}</td><td>${dietTags(o)}</td><td><a href="${p}/build?${qs({ pizza: o.pizzaCode, size: o.size, branchCode: branch })}">Order</a></td></tr>`)
    .join("");
  return `<h1>${esc(one(f.size) ?? "")} pizzas${branch ? ` at ${esc(branch)}` : ""}</h1><p class="muted">${offers.length} menu pizza(s) meet every filter${branch ? " and can be made at that branch" : ""}, cheapest first. <a href="${p}/">New search</a></p>
<table><tr><th>Pizza</th><th>Price</th><th>Made with</th><th>Diet</th><th></th></tr>${rows || "<tr><td colspan=5>No menu pizza meets every filter.</td></tr>"}</table>${searchForm(p, b, branches, f)}`;
}

export function menuList(p: string, b: Builder, menu: MenuView[]): string {
  const rows = menu
    .map((m) => `<tr><td><a href="${p}/pizzas/${esc(m.code)}">${esc(m.name)}</a> <code>${esc(m.code)}</code></td><td>${esc(m.description)}</td><td>${perSize(m.pricesCents)}</td><td>${dietTags(m)}</td></tr>`)
    .join("");
  return `<h1>Menu</h1><table><tr><th>Pizza</th><th>Made with</th><th>Price by size</th><th>Diet</th></tr>${rows}</table>
<h2>Sizes</h2><table><tr><th>Size</th><th>Key</th><th>Inches</th><th>Serves</th><th>Plain pizza</th></tr>${b.sizes.map((s) => `<tr><td>${esc(s.name)}</td><td><code>${esc(s.key)}</code></td><td>${s.inches}</td><td>${s.serves}</td><td>${money(s.baseCents)}</td></tr>`).join("")}</table>`;
}

export function pizzaDetail(p: string, b: Builder, m: MenuView, branches: BranchView[]): string {
  const out = branches.filter((x) => m.unavailableAt.includes(x.code));
  const sizes = b.sizes.map((s) => `<tr><td>${esc(s.name)} (serves ${s.serves})</td><td>${m.pricesCents[s.key] !== undefined ? money(m.pricesCents[s.key] as number) : "—"}</td><td><a href="${p}/build?${qs({ pizza: m.code, size: s.key })}">Build from this</a></td></tr>`).join("");
  return `<h1>${esc(m.name)} <code>${esc(m.code)}</code></h1><p>${esc(m.description)}</p><p>${dietTags(m)}</p>
<table><tr><th>Crust</th><td>${esc(m.crust)}</td></tr><tr><th>Sauce</th><td>${esc(m.sauce)}</td></tr><tr><th>Cheese</th><td>${esc(m.cheese)}</td></tr><tr><th>Toppings</th><td>${esc(toppingNames(b, m.toppings))} <span class="muted">(${m.toppings.map(esc).join(", ")})</span></td></tr></table>
<h2>Price by size</h2><table><tr><th>Size</th><th>Price</th><th></th></tr>${sizes}</table>
<h2>Where it cannot be made</h2><p>${out.length ? out.map((x) => `<a href="${p}/branches/${esc(x.code)}">${esc(x.name)}</a> (out of ${esc(toppingNames(b, x.outOfStock.filter((t) => m.toppings.includes(t))))})`).join("; ") : "Every branch can make it."}</p>`;
}
