import { esc, money } from "@benchme/site-kit";
import type { ReservationRow, RestaurantDetail } from "../db/dining-repo.js";
import { AREA_NAMES, field, select, tag } from "./kit.js";

export function reservationsList(p: string, items: ReservationRow[], nextCursor: string | null, f: Record<string, string | undefined>): string {
  const rows = items
    .map(
      (b) =>
        `<tr><td><a href="${p}/reservations/${esc(b.reservationNo)}">${esc(b.reservationNo)}</a></td><td>${esc(b.guestName)}<br><span class="muted">${esc(b.guestEmail)}</span></td><td><a href="${p}/restaurants/${esc(b.restaurantCode)}">${esc(b.restaurantCode)}</a></td><td>${esc(AREA_NAMES[b.area] ?? b.area)}</td><td>${esc(b.date)}</td><td>${esc(b.time)}</td><td>${b.partySize}</td><td>${tag(b.status)}</td></tr>`,
    )
    .join("");
  const keep = Object.entries(f).filter(([, v]) => v).map(([k, v]) => `&${k}=${encodeURIComponent(String(v))}`).join("");
  const next = nextCursor ? `<nav class="pager"><a href="${p}/reservations?cursor=${esc(nextCursor)}${keep}">Next page →</a></nav>` : "";
  return `<h1>Reservations</h1><form method="get" action="${p}/reservations" style="margin-bottom:1rem"><input name="guestEmail" placeholder="guest email" value="${esc(f.guestEmail ?? "")}" style="width:16rem;display:inline">
<input name="restaurant" placeholder="restaurant code" value="${esc(f.restaurant ?? "")}" style="width:9rem;display:inline"> <input name="date" placeholder="YYYY-MM-DD" value="${esc(f.date ?? "")}" style="width:9rem;display:inline"> <button style="margin:0">Find</button></form>
<table><tr><th>No</th><th>Guest</th><th>Restaurant</th><th>Area</th><th>Date</th><th>Time</th><th>Party</th><th>Status</th></tr>${rows || "<tr><td colspan=8>None.</td></tr>"}</table>${next}`;
}

function changeForm(p: string, b: ReservationRow, r: RestaurantDetail): string {
  const areas = r.seating.map((s): [string, string] => [s.area, `${AREA_NAMES[s.area] ?? s.area} (tables for up to ${s.seats})`]);
  return `<h2>Change this reservation</h2><form class="card" method="post" action="${p}/reservations/${esc(b.reservationNo)}/change">${field("Date (YYYY-MM-DD)", "date", b.date, "required")}
${field("Time (HH:MM)", "time", b.time, "required")}${field("Party size", "partySize", b.partySize, 'type="number" min="1" max="12" required')}${select("Seating area", "area", areas, b.area)}
<label>Special request</label><textarea name="note" rows="2">${esc(b.note)}</textarea><button>Save changes</button></form>`;
}

export function reservationDetail(p: string, b: ReservationRow, r: RestaurantDetail | null, canWrite: boolean): string {
  const actions =
    b.status !== "confirmed"
      ? ""
      : canWrite
        ? `${r ? changeForm(p, b, r) : ""}<form class="card" method="post" action="${p}/reservations/${esc(b.reservationNo)}/cancel" style="margin-top:1rem"><button>Cancel this reservation</button></form>`
        : `<p class="muted">Sign in to change or cancel.</p>`;
  return `<h1>Reservation ${esc(b.reservationNo)}</h1><p>${tag(b.status)} · <a href="${p}/restaurants/${esc(b.restaurantCode)}">${esc(r?.name ?? b.restaurantCode)}</a> · ${esc(AREA_NAMES[b.area] ?? b.area)}</p>
<table><tr><th>Guest</th><td>${esc(b.guestName)} (${esc(b.guestEmail)}, ${esc(b.guestPhone)})</td></tr><tr><th>When</th><td>${esc(b.date)} at ${esc(b.time)}, the table held for 2 hours</td></tr>
<tr><th>Party</th><td>${b.partySize}</td></tr><tr><th>Special request</th><td>${b.note ? esc(b.note) : '<span class="muted">none</span>'}</td></tr><tr><th>Deposit</th><td>${money(b.depositCents)}</td></tr></table>${actions}`;
}
