import type { CustomerRow, LocationRow, ProductRow, StockRow } from "../db/catalog-repo.js";
import type { OrderDetail, OrderRow, TransferRow } from "../db/orders-repo.js";
import { esc, money } from "./layout.js";

export function dashboard(p: string, counts: { products: number; openOrders: number; pendingTransfers: number }): string {
  return `<h1>Dashboard</h1>
<table><tr><th>Products</th><th>Open orders</th><th>Pending transfers</th></tr>
<tr><td>${counts.products}</td><td>${counts.openOrders}</td><td>${counts.pendingTransfers}</td></tr></table>
<p class="muted">Browse <a href="${p}/products">products</a>, review <a href="${p}/orders">orders</a> or move stock with a <a href="${p}/transfers/new">transfer</a>. Sign in to place orders and create transfers.</p>`;
}

export function productsList(p: string, items: ProductRow[], nextCursor: string | null, q: { query?: string; category?: string }): string {
  const rows = items
    .map((x) => `<tr><td><a href="${p}/products/${esc(x.sku)}">${esc(x.sku)}</a></td><td>${esc(x.name)}</td><td>${esc(x.category)}</td><td>${money(x.unitPriceCents)}</td></tr>`)
    .join("");
  const next = nextCursor ? `<nav class="pager"><a href="${p}/products?cursor=${esc(nextCursor)}${q.query ? `&query=${esc(q.query)}` : ""}${q.category ? `&category=${esc(q.category)}` : ""}">Next page →</a></nav>` : "";
  return `<h1>Products</h1>
<form method="get" action="${p}/products" style="margin-bottom:1rem"><input name="query" placeholder="search name or sku" value="${esc(q.query ?? "")}" style="width:16rem;display:inline"> <input name="category" placeholder="category" value="${esc(q.category ?? "")}" style="width:10rem;display:inline"> <button style="margin:0">Filter</button></form>
<table><tr><th>SKU</th><th>Name</th><th>Category</th><th>Unit price</th></tr>${rows}</table>${next}`;
}

export function productDetail(p: string, product: ProductRow, stock: StockRow[], locations: LocationRow[]): string {
  const byLoc = new Map(stock.map((s) => [s.locationCode, s.qty]));
  const rows = locations.map((l) => `<tr><td>${esc(l.code)}</td><td>${esc(l.name)} (${esc(l.city)})</td><td>${byLoc.get(l.code) ?? 0}</td></tr>`).join("");
  const total = stock.reduce((s, x) => s + x.qty, 0);
  return `<h1>${esc(product.name)}</h1><p><code>${esc(product.sku)}</code> · ${esc(product.category)} · ${money(product.unitPriceCents)} each</p>
<h2>Stock by location (total ${total})</h2><table><tr><th>Code</th><th>Location</th><th>Qty</th></tr>${rows}</table>
<p><a href="${p}/transfers/new?sku=${esc(product.sku)}">Transfer this product</a></p>`;
}

export function ordersList(p: string, items: OrderRow[], nextCursor: string | null, status?: string): string {
  const rows = items
    .map((o) => `<tr><td><a href="${p}/orders/${esc(o.orderNo)}">${esc(o.orderNo)}</a></td><td>${esc(o.customerCode)}</td><td>${esc(o.status)}</td><td>${esc(o.placedAt.slice(0, 10))}</td></tr>`)
    .join("");
  const next = nextCursor ? `<nav class="pager"><a href="${p}/orders?cursor=${esc(nextCursor)}${status ? `&status=${esc(status)}` : ""}">Next page →</a></nav>` : "";
  return `<h1>Orders</h1><p><a href="${p}/orders">all</a> · <a href="${p}/orders?status=open">open</a> · <a href="${p}/orders?status=shipped">shipped</a> · <a href="${p}/orders?status=cancelled">cancelled</a> · <a href="${p}/orders/new">new order</a></p>
<table><tr><th>Order</th><th>Customer</th><th>Status</th><th>Placed</th></tr>${rows}</table>${next}`;
}

export function orderDetail(p: string, o: OrderDetail, canCancel: boolean): string {
  const lines = o.lines.map((l) => `<tr><td><a href="${p}/products/${esc(l.sku)}">${esc(l.sku)}</a></td><td>${l.qty}</td><td>${money(l.unitPriceCents)}</td><td>${money(l.qty * l.unitPriceCents)}</td></tr>`).join("");
  return `<h1>Order ${esc(o.orderNo)}</h1><p>Customer <a href="${p}/customers/${esc(o.customerCode)}">${esc(o.customerCode)}</a> · status <strong>${esc(o.status)}</strong> · placed ${esc(o.placedAt)}</p>
<table><tr><th>SKU</th><th>Qty</th><th>Unit</th><th>Line total</th></tr>${lines}<tr><th colspan="3">Total</th><th>${money(o.totalCents)}</th></tr></table>
${canCancel && o.status === "open" ? `<form method="post" action="${p}/orders/${esc(o.orderNo)}/cancel"><button>Cancel order</button></form>` : ""}`;
}

export function orderForm(p: string, customers: CustomerRow[]): string {
  const opts = customers.map((c) => `<option value="${esc(c.code)}">${esc(c.code)} — ${esc(c.name)}</option>`).join("");
  return `<h1>New order</h1><form class="card" method="post" action="${p}/orders">
<label>Customer</label><select name="customer">${opts}</select>
<label>Lines (one per line: <code>SKU,qty</code>)</label><textarea name="lines" rows="4" style="width:100%"></textarea>
<button>Place order</button></form>`;
}

export function transfersList(p: string, items: TransferRow[]): string {
  const rows = items.map((t) => `<tr><td>${esc(t.transferNo)}</td><td>${esc(t.sku)}</td><td>${esc(t.fromCode)} → ${esc(t.toCode)}</td><td>${t.qty}</td><td>${esc(t.status)}</td><td>${t.status === "pending" ? `<form method="post" action="${p}/transfers/${esc(t.transferNo)}/complete" style="margin:0"><button style="margin:0;padding:.2em .6em">Complete</button></form>` : ""}</td></tr>`).join("");
  return `<h1>Transfers</h1><p><a href="${p}/transfers/new">New transfer</a></p><table><tr><th>No</th><th>SKU</th><th>Route</th><th>Qty</th><th>Status</th><th></th></tr>${rows}</table>`;
}

export function transferForm(p: string, locations: LocationRow[], sku: string): string {
  const opts = locations.map((l) => `<option value="${esc(l.code)}">${esc(l.code)} — ${esc(l.name)}</option>`).join("");
  return `<h1>New transfer</h1><form class="card" method="post" action="${p}/transfers">
<label>SKU</label><input name="sku" value="${esc(sku)}" required>
<label>From</label><select name="from">${opts}</select>
<label>To</label><select name="to">${opts}</select>
<label>Quantity</label><input name="qty" type="number" min="1" required>
<button>Create transfer</button></form>`;
}

export function customersList(p: string, items: CustomerRow[]): string {
  const rows = items.map((c) => `<tr><td><a href="${p}/customers/${esc(c.code)}">${esc(c.code)}</a></td><td>${esc(c.name)}</td><td>${esc(c.tier)}</td><td>${esc(c.city)}</td></tr>`).join("");
  return `<h1>Customers</h1><table><tr><th>Code</th><th>Name</th><th>Tier</th><th>City</th></tr>${rows}</table>`;
}

export function customerDetail(p: string, c: CustomerRow, orders: OrderRow[]): string {
  const rows = orders.map((o) => `<tr><td><a href="${p}/orders/${esc(o.orderNo)}">${esc(o.orderNo)}</a></td><td>${esc(o.status)}</td><td>${esc(o.placedAt.slice(0, 10))}</td></tr>`).join("");
  return `<h1>${esc(c.name)}</h1><p><code>${esc(c.code)}</code> · ${esc(c.tier)} · ${esc(c.city)}</p><h2>Orders</h2><table><tr><th>Order</th><th>Status</th><th>Placed</th></tr>${rows}</table>`;
}

export function signupForm(p: string, error?: string): string {
  return `<h1>Create an account</h1>${error ? `<div class="flash">${esc(error)}</div>` : ""}<form class="card" method="post" action="${p}/signup">
<label>Name</label><input name="name" required><label>Email</label><input name="email" type="email" required><label>Password (8+ characters)</label><input name="password" type="password" required>
<button>Sign up</button></form><p class="muted">A verification code is sent to the workspace inbox; enter it on the next screen.</p>`;
}

export function verifyForm(p: string, email: string, error?: string): string {
  return `<h1>Verify your email</h1>${error ? `<div class="flash">${esc(error)}</div>` : ""}<p>We sent a 6-digit code to <strong>${esc(email)}</strong>. Check the workspace inbox.</p>
<form class="card" method="post" action="${p}/verify"><input type="hidden" name="email" value="${esc(email)}"><label>Code</label><input name="code" required pattern="[0-9]{6}"><button>Verify</button></form>`;
}

export function loginForm(p: string, error?: string): string {
  return `<h1>Sign in</h1>${error ? `<div class="flash">${esc(error)}</div>` : ""}<form class="card" method="post" action="${p}/login">
<label>Email</label><input name="email" type="email" required><label>Password</label><input name="password" type="password" required><button>Sign in</button></form>
<p class="muted">No account? <a href="${p}/signup">Sign up</a>.</p>`;
}

export function accountPage(p: string, user: { email: string; displayName: string; apiToken: string | null }): string {
  return `<h1>Account</h1><p>${esc(user.displayName)} · ${esc(user.email)}</p>
<h2>API token</h2><p>Use it as <code>Authorization: Bearer &lt;token&gt;</code> against <code>${esc(p)}/api/v1/…</code>.</p>
<p>${user.apiToken ? `<code>${esc(user.apiToken)}</code>` : "<em>none yet</em>"}</p>
<form method="post" action="${p}/account/token"><button>${user.apiToken ? "Rotate token" : "Create token"}</button></form>`;
}
