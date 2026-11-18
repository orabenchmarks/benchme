import { esc } from "@benchme/site-kit";
import type { RegistrationView } from "../../db/rows.js";
import { tag, when } from "./common.js";

const whenOf = (r: RegistrationView) => when({ date: r.eventDate, startTime: r.startTime, endTime: r.endTime });

export function registrationsList(p: string, items: RegistrationView[], nextCursor: string | null, f: Record<string, string | undefined>): string {
  const rows = items
    .map((r) => `<tr><td><a href="${p}/registrations/${esc(r.regNo)}">${esc(r.regNo)}</a></td><td>${esc(r.name)}<br><span class="muted">${esc(r.email)}</span></td><td><a href="${p}/events/${esc(r.eventCode)}">${esc(r.eventTitle)}</a> <code>${esc(r.eventCode)}</code></td><td>${whenOf(r)}</td><td>${tag(r.status)}</td></tr>`)
    .join("");
  const keep = Object.entries(f).filter(([, v]) => v).map(([k, v]) => `&${k}=${encodeURIComponent(String(v))}`).join("");
  const next = nextCursor ? `<nav class="pager"><a href="${p}/registrations?cursor=${esc(nextCursor)}${keep}">Next page →</a></nav>` : "";
  return `<h1>Registrations</h1><form method="get" action="${p}/registrations" style="margin-bottom:1rem"><input name="email" placeholder="email" value="${esc(f.email ?? "")}" style="width:16rem;display:inline">
<input name="event" placeholder="event code" value="${esc(f.event ?? "")}" style="width:8rem;display:inline"> <button style="margin:0">Find</button></form>
<table><tr><th>No</th><th>Person</th><th>Event</th><th>When</th><th>Status</th></tr>${rows || "<tr><td colspan=5>None.</td></tr>"}</table>${next}`;
}

export function registrationDetail(p: string, r: RegistrationView, canWrite: boolean): string {
  const cancel = r.status === "registered" ? (canWrite ? `<form class="card" method="post" action="${p}/registrations/${esc(r.regNo)}/cancel"><button>Cancel this registration</button></form>` : `<p class="muted">Sign in to cancel.</p>`) : "";
  return `<h1>Registration ${esc(r.regNo)}</h1><p>${tag(r.status)}</p><table><tr><th>Person</th><td>${esc(r.name)} (<a href="${p}/people/${encodeURIComponent(r.email)}">${esc(r.email)}</a>)</td></tr>
<tr><th>Event</th><td><a href="${p}/events/${esc(r.eventCode)}">${esc(r.eventTitle)}</a> <code>${esc(r.eventCode)}</code></td></tr><tr><th>When</th><td>${whenOf(r)}</td></tr></table>${cancel}`;
}
