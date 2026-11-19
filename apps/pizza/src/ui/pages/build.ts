import type { PizzaDiet, PizzaQuote } from "@benchme/scenarios";
import { esc, money } from "@benchme/site-kit";
import type { BranchView, Builder, MenuView } from "../../db/pizza-repo.js";
import { dietTags, field, pizzaFields, select } from "./common.js";

/** Everything the builder form holds, as the strings a form sends. */
export type BuildValues = {
  pizzaCode: string; size: string; crust: string; sauce: string; cheese: string; toppings: string[]; quantity: string;
  branchCode: string; fulfilment: string; address: string; slotDate: string; slotTime: string; customerName: string; customerEmail: string;
};
/** What the price box shows: a full quote at a branch, one pizza's price without a branch, or why it cannot be priced. */
export type BuildPrice = { quote: PizzaQuote; diet: PizzaDiet } | { unitCents: number; diet: PizzaDiet } | { problem: string };

function priceBox(b: Builder, price: BuildPrice): string {
  if ("problem" in price) return `<div class="flash">This pizza cannot be priced: ${esc(price.problem)}</div>`;
  if ("unitCents" in price) return `<p><strong>${money(price.unitCents)}</strong> a pizza · ${dietTags(price.diet)}</p><p class="muted">Choose a branch to see the delivery fee and the total.</p>`;
  const q = price.quote;
  const line = q.lines[0];
  const out = q.outOfStock.map((t) => b.toppings.find((x) => x.key === t)?.name ?? t);
  return `<table style="max-width:28rem"><tr><th>Each</th><td>${money(line?.unitCents ?? 0)}</td></tr><tr><th>${line?.quantity ?? 0} pizza(s)</th><td>${money(q.subtotalCents)}</td></tr>
<tr><th>Delivery</th><td>${q.fulfilment === "pickup" ? "pickup, no fee" : money(q.deliveryFeeCents)}</td></tr><tr><th>Total</th><td><strong>${money(q.totalCents)}</strong></td></tr></table><p>${dietTags(price.diet)}</p>
${out.length ? `<div class="flash">The branch is out of ${esc(out.join(", "))}: this pizza cannot be ordered there.</div>` : ""}`;
}

export function builder(p: string, b: Builder, branches: BranchView[], pizza: MenuView | null, v: BuildValues, price: BuildPrice, canWrite: boolean): string {
  const branchOpts = [{ value: "", label: "choose a branch" }, ...branches.map((x) => ({ value: x.code, label: `${x.name} (${x.code})${x.delivers ? "" : " — pickup only"}` }))];
  const slotOpts = b.slotTimes.map((t) => ({ value: t, label: t }));
  const fulfilOpts = [{ value: "pickup", label: "Pickup" }, { value: "delivery", label: "Delivery" }];
  const title = pizza ? `Build from ${esc(pizza.name)} <code>${esc(pizza.code)}</code>` : "Build a pizza";
  const from = pizza ? `<p class="muted">Starts as ${esc(pizza.description)} Change anything below. <a href="${p}/build">Start from scratch</a></p>` : `<p class="muted">From scratch: pick every option. Or start from a <a href="${p}/pizzas">menu pizza</a>.</p>`;
  const order = canWrite
    ? `${field("Slot date (YYYY-MM-DD, in 2027)", "slotDate", v.slotDate, 'placeholder="2027-05-10"')}${select("Slot time", "slotTime", slotOpts, v.slotTime)}
${field("Delivery address (for delivery)", "address", v.address)}${field("Customer name", "customerName", v.customerName)}${field("Customer email", "customerEmail", v.customerEmail, 'type="email"')}
<button formmethod="get" formaction="${p}/build" formnovalidate>Show price</button> <button>Place order</button>`
    : `<button formmethod="get" formaction="${p}/build">Show price</button><p class="muted">Sign in to place an order.</p>`;
  return `<h1>${title}</h1>${from}${priceBox(b, price)}
<form class="card" method="post" action="${p}/orders"><input type="hidden" name="pizzaCode" value="${esc(v.pizzaCode)}"><input type="hidden" name="edited" value="1">
${pizzaFields(b, v)}${select("Branch", "branchCode", branchOpts, v.branchCode)}${select("Pickup or delivery", "fulfilment", fulfilOpts, v.fulfilment)}${order}</form>`;
}
