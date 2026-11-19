import type { SportAddress } from "@benchme/scenarios";
import { esc, money } from "@benchme/site-kit";
import { STATUSES } from "../api/inputs.js";
import type { CustomerDetail, CustomerSummary } from "../db/orders-repo.js";
import type { OrderView } from "../db/rows.js";
import { field, inline, options, tag } from "./catalog-pages.js";

type F = Record<string, string | undefined>;
/** How many line rows the order form offers. */
export const FORM_LINES = 4;
const enc = encodeURIComponent;
const addressText = (a: Pick<SportAddress, "label" | "line1" | "city" | "postcode">) => `${esc(a.label)}: ${esc(a.line1)}, ${esc(a.postcode)} ${esc(a.city)}`;
const items = (o: OrderView) => o.lines.map((l) => `${l.qty} × ${esc(l.productName)} (${esc(l.size)}, ${esc(l.colour)})`).join("<br>");

export function customersList(p: string, customers: CustomerSummary[], query?: string): string {
  const rows = customers
    .map((c) => `<tr><td><a href="${p}/customers/${enc(c.email)}">${esc(c.name)}</a></td><td>${esc(c.email)}</td><td>${c.addresses}</td><td><a href="${p}/orders?customerEmail=${enc(c.email)}">${c.orders}</a></td></tr>`)
    .join("");
  return `<h1>Customers</h1><form method="get" action="${p}/customers" style="margin-bottom:1rem"><input name="query" placeholder="name or email" value="${esc(query ?? "")}" style="width:18rem;display:inline"> <button style="margin:0">Find</button></form>
<table><tr><th>Name</th><th>Email</th><th>Saved addresses</th><th>Orders</th></tr>${rows || "<tr><td colspan=4>None.</td></tr>"}</table>`;
}

export function customerDetail(p: string, c: CustomerDetail, orders: OrderView[]): string {
  const addresses = c.addresses.map((a) => `<tr><td><code>${esc(a.code)}</code></td><td>${esc(a.label)}${a.isDefault ? " (default)" : ""}</td><td>${esc(a.line1)}</td><td>${esc(a.postcode)}</td><td>${esc(a.city)}</td></tr>`).join("");
  return `<h1>${esc(c.name)}</h1><p>${esc(c.email)} · <a href="${p}/orders/new?customerEmail=${enc(c.email)}">New order for this customer</a></p>
<h2>Saved addresses</h2><table><tr><th>Code</th><th>Label</th><th>Street</th><th>Postcode</th><th>City</th></tr>${addresses}</table>
<h2>Orders</h2>${ordersTable(p, orders)}`;
}

function ordersTable(p: string, orders: OrderView[]): string {
  const rows = orders
    .map((o) => `<tr><td><a href="${p}/orders/${esc(o.orderNo)}">${esc(o.orderNo)}</a></td><td>${esc(o.customerName)}<br><span class="muted">${esc(o.customerEmail)}</span></td><td>${esc(o.placedOn)}</td><td>${tag(o.status)}</td><td>${esc(o.deliveredOn ?? "")}</td><td>${esc(o.address.city)}</td><td>${items(o)}</td><td>${money(o.totalCents)}</td></tr>`)
    .join("");
  return `<table><tr><th>Order</th><th>Customer</th><th>Placed</th><th>Status</th><th>Delivered</th><th>Ships to</th><th>Items</th><th>Total</th></tr>${rows || "<tr><td colspan=8>None.</td></tr>"}</table>`;
}

/** The orders page's own filters: the only query keys its Next link carries on, so a key the request made up never reaches the page. */
const ORDER_FILTERS: readonly string[] = ["customerEmail", "status", "placedFrom", "placedTo"];

export function ordersList(p: string, orders: OrderView[], nextCursor: string | null, f: F): string {
  const keep = Object.entries(f).filter(([k, v]) => v && ORDER_FILTERS.includes(k)).map(([k, v]) => `&${enc(k)}=${enc(String(v))}`).join("");
  const next = nextCursor ? `<nav class="pager"><a href="${p}/orders?cursor=${esc(nextCursor)}${keep}">Next page →</a></nav>` : "";
  const status = STATUSES.map((s) => ({ value: s, label: s }));
  return `<h1>Orders</h1><form method="get" action="${p}/orders" style="margin-bottom:1rem"><input name="customerEmail" placeholder="customer email" value="${esc(f.customerEmail ?? "")}" style="width:16rem;display:inline">
<select name="status" ${inline}>${options(status, f.status, "any status")}</select> placed from <input name="placedFrom" placeholder="YYYY-MM-DD" value="${esc(f.placedFrom ?? "")}" style="width:8rem;display:inline">
to <input name="placedTo" placeholder="YYYY-MM-DD" value="${esc(f.placedTo ?? "")}" style="width:8rem;display:inline"> <button style="margin:0">Find</button></form>${ordersTable(p, orders)}${next}`;
}

export function orderForm(p: string, f: F, customer: CustomerDetail | null): string {
  const ship = customer
    ? `<label>Ship to</label><select name="addressCode">${options(customer.addresses.map((a) => ({ value: a.code, label: `${a.code} — ${a.label}: ${a.line1}, ${a.city}${a.isDefault ? " (default)" : ""}` })), f.addressCode)}</select>`
    : field("Ship to (saved address code, AD-…)", "addressCode", f.addressCode, "required");
  const rows = Array.from({ length: FORM_LINES }, (_, i) => {
    const n = i + 1;
    return `<div>${field(`Line ${n}: SKU`, `sku${n}`, f[`sku${n}`], n === 1 ? "required" : "")}${field("Quantity", `qty${n}`, f[`qty${n}`] ?? (n === 1 ? "1" : ""), 'type="number" min="1" max="10"')}</div>`;
  }).join("");
  const who = customer ? `<p>For <a href="${p}/customers/${enc(customer.email)}">${esc(customer.name)}</a> (${esc(customer.email)}).</p>` : "";
  return `<h1>New order</h1>${who}<form method="get" action="${p}/orders/new" style="margin-bottom:1rem"><input name="customerEmail" placeholder="customer email" value="${esc(f.customerEmail ?? "")}" style="width:16rem;display:inline">
${f.sku1 ? `<input type="hidden" name="sku" value="${esc(f.sku1)}">` : ""}<button style="margin:0">Load their addresses</button></form>
<form class="card" method="post" action="${p}/orders">${field("Customer email", "customerEmail", f.customerEmail, 'type="email" required')}${ship}${rows}<button>Place order</button></form>
<p class="muted">Units are reserved from stock when the order is placed; an out-of-stock line refuses the order. ${addressHint(customer)}</p>`;
}

const addressHint = (c: CustomerDetail | null) => (c ? `Saved addresses: ${c.addresses.map(addressText).join("; ")}.` : "Enter the customer's email and load their addresses to pick one.");
