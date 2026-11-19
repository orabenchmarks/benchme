import type { SportAddress } from "@benchme/scenarios";
import { esc, money } from "@benchme/site-kit";
import type { OrderView } from "../db/rows.js";
import { field, options, tag } from "./catalog-pages.js";

const row = (label: string, value: string) => `<tr><th>${label}</th><td>${value}</td></tr>`;

/** One order with its follow-up actions: cancel while processing, reorder any time, return lines of a delivered order. */
export function orderDetail(p: string, o: OrderView, canWrite: boolean, addresses: SportAddress[], reasons: string[]): string {
  const lines = o.lines
    .map((l) => `<tr><td><code>${esc(l.sku)}</code></td><td><a href="${p}/products/${esc(l.productCode)}">${esc(l.productName)}</a></td><td>${esc(l.size)}</td><td>${esc(l.colour)}</td><td>${l.qty}</td><td>${money(l.unitPriceCents)}</td><td>${l.returnedQty}</td></tr>`)
    .join("");
  const returns = o.returns.length
    ? `<h2>Returns</h2><table><tr><th>Return</th><th>SKU</th><th>Units</th><th>Reason</th><th>Requested</th><th>Refund</th></tr>${o.returns
        .map((r) => `<tr><td>${esc(r.returnNo)}</td><td><code>${esc(r.sku)}</code></td><td>${r.qty}</td><td>${esc(r.reason)}</td><td>${esc(r.requestedOn)}</td><td>${money(r.refundCents)}</td></tr>`)
        .join("")}</table>`
    : "";
  const a = o.address;
  return `<h1>Order ${esc(o.orderNo)}</h1><p>${tag(o.status)} · <a href="${p}/customers/${encodeURIComponent(o.customerEmail)}">${esc(o.customerName)}</a> (${esc(o.customerEmail)})</p>
<table>${row("Placed", esc(o.placedOn))}${row("Shipped", esc(o.shippedOn ?? "—"))}${row("Delivered", esc(o.deliveredOn ?? "—"))}${o.cancelledOn ? row("Cancelled", esc(o.cancelledOn)) : ""}
${row("Tracking number", o.trackingNo ? `<code>${esc(o.trackingNo)}</code>` : "—")}${row("Ships to", `<code>${esc(a.code)}</code> ${esc(a.label)}: ${esc(a.line1)}, ${esc(a.postcode)} ${esc(a.city)}`)}
${row("Subtotal", money(o.subtotalCents))}${row("Shipping", money(o.shippingCents))}${row("Total", money(o.totalCents))}</table>
<h2>Lines</h2><table><tr><th>SKU</th><th>Product</th><th>Size</th><th>Colour</th><th>Units</th><th>Unit price</th><th>Returned</th></tr>${lines}</table>${returns}
${canWrite ? actions(p, o, addresses, reasons) : `<p class="muted">Sign in to cancel, reorder or request a return.</p>`}`;
}

function actions(p: string, o: OrderView, addresses: SportAddress[], reasons: string[]): string {
  const no = esc(o.orderNo);
  const cancel = o.status === "processing" ? `<form class="card" method="post" action="${p}/orders/${no}/cancel"><button>Cancel this order</button></form>` : "";
  const to = addresses.map((x) => ({ value: x.code, label: `${x.code} — ${x.label}: ${x.line1}, ${x.city}` }));
  const reorder = `<h2>Reorder</h2><form class="card" method="post" action="${p}/orders/${no}/reorder"><label>Ship to</label><select name="addressCode">${options(to, o.addressCode)}</select><button>Order these items again</button></form>`;
  const lines = o.lines.map((l) => ({ value: l.sku, label: `${l.sku} — ${l.productName} (${l.size}, ${l.colour}), ${l.qty - l.returnedQty} of ${l.qty} returnable` }));
  const ret =
    o.status === "delivered"
      ? `<h2>Request a return</h2><form class="card" method="post" action="${p}/orders/${no}/returns"><label>Line</label><select name="sku">${options(lines, undefined)}</select>
${field("Units", "qty", "1", 'type="number" min="1" max="10" required')}<label>Reason</label><select name="reason">${options(reasons.map((r) => ({ value: r, label: r })), undefined)}</select><button>Request return</button></form>`
      : "";
  return `${cancel}${reorder}${ret}`;
}
