import type { PizzaSlot } from "@benchme/scenarios";
import { esc, money } from "@benchme/site-kit";
import type { BranchView, Builder } from "../../db/pizza-repo.js";
import { field, inline } from "./common.js";

export function branchDetail(p: string, b: Builder, x: BranchView, q: { date?: string; pizzas?: string }, slots: PizzaSlot[] | null): string {
  const out = x.outOfStock.map((t) => b.toppings.find((y) => y.key === t)?.name ?? t);
  const delivery = x.delivers ? `Delivers for ${money(x.deliveryFeeCents ?? 0)}; free when the pizzas come to ${money(x.freeDeliveryFromCents ?? 0)} or more.` : "Pickup only; this branch does not deliver.";
  const rows = (slots ?? []).map((s) => `<tr><td>${esc(s.time)}</td><td>${s.capacity}</td><td>${s.left === 0 ? "full" : s.left}</td></tr>`).join("");
  const table = slots
    ? `${q.pizzas ? `<p class="muted">Only the slots of ${esc(q.date ?? "")} with room for ${esc(q.pizzas)} pizzas.</p>` : ""}<table><tr><th>Slot</th><th>Pizzas per slot</th><th>Pizzas it can still make</th></tr>${rows || `<tr><td colspan=3>No slot that day has room for ${esc(q.pizzas ?? "")} pizzas.</td></tr>`}</table>`
    : `<p class="muted">Pick a date in 2027 to see its slots.</p>`;
  return `<h1>${esc(x.name)} <code>${esc(x.code)}</code></h1><p>${esc(x.address)} · ${esc(x.city)}</p><p>${delivery} The branch makes ${x.slotCapacity} pizzas per 30-minute slot.</p>
<p>Out of stock: ${out.length ? esc(out.join(", ")) : "nothing"}. A pizza with a topping the branch is out of cannot be ordered here.</p>
<h2>Slots</h2><form method="get" action="${p}/branches/${esc(x.code)}">${field("Date", "date", q.date, `placeholder="2027-05-10" ${inline}`)} ${field("Room for (pizzas)", "pizzas", q.pizzas, `type="number" min="1" ${inline}`)} <button style="margin:0">Show slots</button></form>
${table}<p><a href="${p}/build?branchCode=${esc(x.code)}">Order from this branch</a></p>`;
}
