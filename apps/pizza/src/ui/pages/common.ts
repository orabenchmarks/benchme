import type { PizzaDiet, PizzaSizeKey } from "@benchme/scenarios";
import { esc, money } from "@benchme/site-kit";
import type { Builder } from "../../db/pizza-repo.js";

export type Opt = { value: string; label: string };
export const inline = 'style="width:auto;display:inline"';
export const tag = (s: string) => `<span class="tag">${esc(s)}</span>`;
export const field = (label: string, name: string, value: string | undefined, attrs = "") => `<label>${label}</label><input name="${name}" value="${esc(value ?? "")}" ${attrs}>`;
export const select = (label: string, name: string, opts: Opt[], selected: string | undefined, attrs = "") =>
  `<label>${label}</label><select name="${name}" ${attrs}>${opts.map((o) => `<option value="${esc(o.value)}"${o.value === selected ? " selected" : ""}>${esc(o.label)}</option>`).join("")}</select>`;
export const checkboxes = (name: string, opts: Opt[], checked: readonly string[]) =>
  opts.map((o) => `<label style="display:block;margin:.1rem 0"><input type="checkbox" name="${name}" value="${esc(o.value)}"${checked.includes(o.value) ? " checked" : ""} ${inline}> ${esc(o.label)}</label>`).join("");
export const qs = (o: Record<string, string | undefined>) => Object.entries(o).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");

const SHORT: Record<PizzaSizeKey, string> = { small: "S", medium: "M", large: "L", xlarge: "XL" };
export const perSize = (cents: Partial<Record<PizzaSizeKey, number>>) =>
  (Object.entries(cents) as [PizzaSizeKey, number][]).map(([k, v]) => `${SHORT[k]} ${money(v)}`).join(" · ");
export const dietTags = (d: PizzaDiet) => [d.vegan ? "vegan" : d.vegetarian ? "vegetarian" : null, ...d.allergens.map((a) => `contains ${a}`)].filter((x): x is string => !!x).map(tag).join(" ");

/** The builder's options as select/checkbox entries, each label carrying what it costs. */
export function optionsOf(b: Builder) {
  return {
    sizes: b.sizes.map((s) => ({ value: s.key, label: `${s.name} (${s.inches} in, serves ${s.serves}) — ${money(s.baseCents)}` })),
    crusts: b.crusts.map((c) => ({ value: c.key, label: `${c.name} (${c.sizes.join(", ")})${Object.values(c.surchargeCents).some((v) => v) ? ` + ${perSize(c.surchargeCents)}` : ""}` })),
    sauces: b.sauces.map((s) => ({ value: s.key, label: s.name })),
    cheeses: b.cheeses.map((c) => ({ value: c.key, label: `${c.name}${Object.values(c.surchargeCents).some((v) => v) ? ` + ${perSize(c.surchargeCents)}` : ""}` })),
    toppings: b.toppings.map((t) => ({ value: t.key, label: `${t.name} — ${perSize(t.pricesCents)}${t.vegan ? " · vegan" : t.vegetarian ? " · vegetarian" : ""}${t.allergens.length ? ` · contains ${t.allergens.join(", ")}` : ""}` })),
  };
}

/** The form fields of one pizza: size, crust, sauce, cheese, toppings, quantity. */
export function pizzaFields(b: Builder, v: { size: string; crust: string; sauce: string; cheese: string; toppings: readonly string[]; quantity: string }): string {
  const o = optionsOf(b);
  return `${select("Size", "size", o.sizes, v.size)}${select("Crust", "crust", o.crusts, v.crust)}${select("Sauce", "sauce", o.sauces, v.sauce)}${select("Cheese", "cheese", o.cheeses, v.cheese)}
<label>Toppings (at most ${b.maxToppings})</label><div>${checkboxes("toppings", o.toppings, v.toppings)}</div>${field("Quantity", "quantity", v.quantity, `type="number" min="1" max="${b.maxQuantity}"`)}`;
}
