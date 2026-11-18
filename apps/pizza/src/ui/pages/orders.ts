import { PIZZA_STATUSES } from "@benchme/scenarios";
import { esc, money } from "@benchme/site-kit";
import type { Builder, OrderLineView, OrderView } from "../../db/pizza-repo.js";
import { pizzaFields, select, tag } from "./common.js";

const toppingNames = (b: Builder, keys: readonly string[]) => keys.map((k) => b.toppings.find((t) => t.key === k)?.name ?? k).join(", ") || "none";
const statusText = (s: string) => s.replace(/_/g, " ");

export function ordersList(p: string, orders: OrderView[], nextCursor: string | null, f: Record<string, string | undefined>): string {
  const rows = orders
    .map((o) => `<tr><td><a href="${p}/orders/${esc(o.orderNo)}">${esc(o.orderNo)}</a></td><td>${esc(o.customerName)}<br><span class="muted">${esc(o.customerEmail)}</span></td><td><a href="${p}/branches/${esc(o.branchCode)}">${esc(o.branchCode)}</a></td><td>${esc(o.slotDate)} ${esc(o.slotTime)}</td><td>${esc(o.fulfilment)}</td><td>${o.pizzaCount}</td><td>${money(o.totalCents)}</td><td>${tag(statusText(o.status))}</td></tr>`)
    .join("");
  const keep = Object.entries(f).filter(([, v]) => v).map(([k, v]) => `&${k}=${encodeURIComponent(String(v))}`).join("");
  const next = nextCursor ? `<nav class="pager"><a href="${p}/orders?cursor=${esc(nextCursor)}${keep}">Next page →</a></nav>` : "";
  const statuses = [{ value: "", label: "any status" }, ...PIZZA_STATUSES.map((s) => ({ value: s, label: statusText(s) }))];
  return `<h1>Orders</h1><form method="get" action="${p}/orders" style="margin-bottom:1rem"><input name="customerEmail" placeholder="customer email" value="${esc(f.customerEmail ?? "")}" style="width:16rem;display:inline">
<input name="branch" placeholder="branch code" value="${esc(f.branch ?? "")}" style="width:8rem;display:inline"> <span style="display:inline-block;width:12rem">${select("", "status", statuses, f.status ?? "")}</span> <button style="margin:0">Find</button></form>
<table><tr><th>No</th><th>Customer</th><th>Branch</th><th>Slot</th><th>How</th><th>Pizzas</th><th>Total</th><th>Status</th></tr>${rows || "<tr><td colspan=8>None.</td></tr>"}</table>${next}`;
}

function lineRow(b: Builder, i: OrderLineView): string {
  return `<tr><td>${i.line}</td><td>${i.pizzaCode ? `<code>${esc(i.pizzaCode)}</code>` : "built"}</td><td>${esc(i.size)}</td><td>${esc(i.crust)}</td><td>${esc(i.sauce)}</td><td>${esc(i.cheese)}</td><td>${esc(toppingNames(b, i.toppings))}</td><td>${i.quantity}</td><td>${money(i.unitCents)}</td><td>${money(i.lineCents)}</td></tr>`;
}

function changeForm(p: string, b: Builder, o: OrderView, i: OrderLineView): string {
  return `<form class="card" method="post" action="${p}/orders/${esc(o.orderNo)}/lines/${i.line}"><strong>Change line ${i.line}</strong>
${pizzaFields(b, { ...i, quantity: String(i.quantity) })}<button>Save line ${i.line}</button></form>`;
}

export function orderDetail(p: string, b: Builder, o: OrderView, branchName: string, canWrite: boolean): string {
  const open = o.status === "received";
  const actions = !open
    ? `<p class="muted">Only a received order can be changed or cancelled.</p>`
    : canWrite
      ? `${o.lines.map((i) => changeForm(p, b, o, i)).join("")}<form class="card" method="post" action="${p}/orders/${esc(o.orderNo)}/cancel"><button>Cancel this order</button></form>`
      : `<p class="muted">Sign in to change or cancel.</p>`;
  return `<h1>Order ${esc(o.orderNo)}</h1><p>${tag(statusText(o.status))} · <a href="${p}/branches/${esc(o.branchCode)}">${esc(branchName)}</a> · ${esc(o.slotDate)} ${esc(o.slotTime)} · ${esc(o.fulfilment)}${o.address ? ` to ${esc(o.address)}` : ""}</p>
<p>${esc(o.customerName)} (${esc(o.customerEmail)})</p>
<table><tr><th>Line</th><th>Menu pizza</th><th>Size</th><th>Crust</th><th>Sauce</th><th>Cheese</th><th>Toppings</th><th>Qty</th><th>Each</th><th>Line</th></tr>${o.lines.map((i) => lineRow(b, i)).join("")}</table>
<table style="max-width:24rem;margin-top:1rem"><tr><th>Subtotal</th><td>${money(o.subtotalCents)}</td></tr><tr><th>Delivery</th><td>${money(o.deliveryFeeCents)}</td></tr><tr><th>Total</th><td>${money(o.totalCents)}</td></tr></table>
<h2>Change or cancel</h2>${actions}`;
}
