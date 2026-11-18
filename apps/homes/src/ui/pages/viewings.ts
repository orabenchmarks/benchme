import { esc } from "@benchme/site-kit";
import type { ListingDetail, ViewingRow } from "../../db/homes-repo.js";
import { qs, tag } from "./common.js";

export function viewingsList(p: string, items: ViewingRow[], nextCursor: string | null, f: Record<string, string | undefined>): string {
  const rows = items
    .map(
      (v) =>
        `<tr><td><a href="${p}/viewings/${esc(v.viewingNo)}">${esc(v.viewingNo)}</a></td><td>${esc(v.viewerName)}<br><span class="muted">${esc(v.viewerEmail)}</span></td><td><a href="${p}/listings/${esc(v.listingCode)}">${esc(v.listingCode)}</a></td><td>${esc(v.agentCode)}</td><td>${esc(v.date)}</td><td>${esc(v.time)}</td><td>${tag(v.status)}</td></tr>`,
    )
    .join("");
  const next = nextCursor ? `<nav class="pager"><a href="${p}/viewings?cursor=${esc(nextCursor)}${qs(f)}">Next page →</a></nav>` : "";
  return `<h1>Viewings</h1><form method="get" action="${p}/viewings" style="margin-bottom:1rem"><input name="email" placeholder="viewer email" value="${esc(f.email ?? "")}" style="width:16rem;display:inline">
<input name="listing" placeholder="listing code" value="${esc(f.listing ?? "")}" style="width:8rem;display:inline"> <button style="margin:0">Find</button></form>
<table><tr><th>No</th><th>Viewer</th><th>Listing</th><th>Agent</th><th>Date</th><th>Time</th><th>Status</th></tr>${rows || "<tr><td colspan=7>None.</td></tr>"}</table>${next}`;
}

export function viewingDetail(p: string, v: ViewingRow, l: ListingDetail | null, canWrite: boolean): string {
  const cancel = v.status === "requested" ? (canWrite ? `<form class="card" method="post" action="${p}/viewings/${esc(v.viewingNo)}/cancel"><button>Cancel this viewing</button></form>` : `<p class="muted">Sign in to cancel.</p>`) : "";
  const where = l ? `${esc(l.address)}, ${esc(l.neighbourhood)}, ${esc(l.city)}` : esc(v.listingCode);
  return `<h1>Viewing ${esc(v.viewingNo)}</h1><p>${tag(v.status)} · <a href="${p}/listings/${esc(v.listingCode)}">${esc(v.listingCode)}</a> · ${where}</p>
<table><tr><th>Viewer</th><td>${esc(v.viewerName)} (${esc(v.viewerEmail)})</td></tr><tr><th>Slot</th><td>${esc(v.date)} at ${esc(v.time)}, 30 minutes</td></tr>
<tr><th>Agent</th><td><a href="${p}/agents/${esc(v.agentCode)}">${esc(l?.agent.name ?? v.agentCode)}</a> <code>${esc(v.agentCode)}</code></td></tr></table>${cancel}`;
}
