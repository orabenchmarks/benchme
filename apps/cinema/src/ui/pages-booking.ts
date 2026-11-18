import { CINEMA_MAX_SEATS } from "@benchme/scenarios";
import { esc, money } from "@benchme/site-kit";
import type { BookingRow, ShowtimeDetail } from "../db/cinema-repo.js";
import { FORMAT_LABEL, TYPE_LABEL, type Filters } from "./pages-browse.js";

/** The seat map with its booking form, the bookings list, and one booking with its cancel action. */
const tag = (s: string) => `<span class="tag">${esc(s)}</span>`;
const field = (label: string, name: string, value: string | undefined, attrs = "") => `<label>${label}</label><input name="${name}" value="${esc(value ?? "")}" ${attrs}>`;
const SEAT_STYLE = "<style>.seat{display:inline-block;min-width:2.4em;text-align:center;margin:1px;padding:0 .2em;border:1px solid #bbb;border-radius:3px;background:#fff}.seat.taken{background:#ddd;color:#888}</style>";

function seatMap(s: ShowtimeDetail): string {
  const rows = s.seatMap
    .map((r) => {
      const seats = r.seats.map((x) => (x.free ? `<span class="seat">${esc(x.seat)}</span>` : `<span class="seat taken" title="${esc(x.seat)} taken">×</span>`)).join("");
      return `<tr><th>${esc(r.row)}</th><td>${r.premium ? "premium" : ""}</td><td>${seats}</td><td>${r.free.length ? esc(r.free.join(" ")) : "none"}</td></tr>`;
    })
    .join("");
  return `${SEAT_STYLE}<p class="muted">Row A is nearest the screen. A seat marked × is taken. Seats are side by side when they are in one row with consecutive numbers.</p>
<table><tr><th>Row</th><th></th><th>Seats</th><th>Free in this row</th></tr>${rows}</table>`;
}

function bookForm(p: string, s: ShowtimeDetail, f: Filters): string {
  const counts = ["adult", "child", "senior", "student"]
    .filter((t) => t !== "child" || s.childTickets)
    .map((t) => field(`${TYPE_LABEL[t]} tickets`, t, f[t], 'type="number" min="0" max="10"'))
    .join("");
  return `<h2>Book seats</h2><form class="card" method="post" action="${p}/bookings"><input type="hidden" name="showtimeCode" value="${esc(s.showtimeCode)}">
${field(`Seats (up to ${CINEMA_MAX_SEATS}, e.g. F4,F5,F6)`, "seats", f.seats, "required")}${counts}
<p class="muted">Seats get ticket types in seat order: adults, then children, seniors, students. Leave every count empty to book adult tickets only.</p>
${field("Name", "customerName", f.customerName, "required")}${field("Email", "customerEmail", f.customerEmail, 'type="email" required')}<button>Book</button></form>`;
}

export function showtimeDetail(p: string, s: ShowtimeDetail, canWrite: boolean, f: Filters = {}): string {
  const prices = (["adult", "child", "senior", "student"] as const)
    .map((t) => `<tr><td>${esc(TYPE_LABEL[t])}</td><td>${t === "child" && !s.childTickets ? "not sold for this film" : s.prices[t] === null ? "—" : money(s.prices[t] as number)}</td></tr>`)
    .join("");
  const book = s.freeSeats === 0 ? "<p><strong>Sold out.</strong></p>" : canWrite ? bookForm(p, s, f) : `<p class="muted">Sign in to book.</p>`;
  return `<h1>${esc(s.filmTitle)} — ${esc(s.date)} ${esc(s.time)} <code>${esc(s.showtimeCode)}</code></h1>
<p><a href="${p}/films/${esc(s.filmCode)}">${esc(s.filmTitle)}</a> (${esc(s.genre)}, rated ${esc(s.rating)}, ${s.runtimeMinutes} min, ${esc(s.language)}) · <a href="${p}/cinemas/${esc(s.cinemaCode)}">${esc(s.cinemaName)}</a>, ${esc(s.city)} · ${esc(s.screenName)} · ${esc(FORMAT_LABEL[s.format] ?? s.format)}</p>
<p>${s.freeSeats} of ${s.seatsTotal} seats free; at most ${s.bestRun} side by side in one row.</p>
<h2>Ticket prices (${esc(FORMAT_LABEL[s.format] ?? s.format)})</h2><table><tr><th>Ticket</th><th>Price</th></tr>${prices}</table>
<p>Booking fee: ${money(s.bookingFeeCents)} per ticket. Premium rows (${esc(s.premiumRows.join(", "))}): ${money(s.premiumSurchargeCents)} extra per seat.</p>
<h2>Seats</h2>${seatMap(s)}${book}`;
}

export function bookingsList(p: string, items: BookingRow[], nextCursor: string | null, f: Filters): string {
  const rows = items
    .map(
      (b) =>
        `<tr><td><a href="${p}/bookings/${esc(b.bookingNo)}">${esc(b.bookingNo)}</a></td><td>${esc(b.customerName)}<br><span class="muted">${esc(b.customerEmail)}</span></td><td><a href="${p}/showtimes/${esc(b.showtimeCode)}">${esc(b.showtimeCode)}</a></td><td><a href="${p}/films/${esc(b.filmCode)}">${esc(b.filmCode)}</a></td><td>${esc(b.date)} ${esc(b.time)}</td><td>${esc(b.seats)}</td><td>${money(b.totalCents)}</td><td>${tag(b.status)}</td></tr>`,
    )
    .join("");
  const keep = Object.entries(f).filter(([, v]) => v).map(([k, v]) => `&${k}=${encodeURIComponent(String(v))}`).join("");
  const next = nextCursor ? `<nav class="pager"><a href="${p}/bookings?cursor=${esc(nextCursor)}${keep}">Next page →</a></nav>` : "";
  return `<h1>Bookings</h1><form method="get" action="${p}/bookings" style="margin-bottom:1rem"><input name="customerEmail" placeholder="customer email" value="${esc(f.customerEmail ?? "")}" style="width:16rem;display:inline">
<input name="showtime" placeholder="showtime code" value="${esc(f.showtime ?? "")}" style="width:9rem;display:inline"> <button style="margin:0">Find</button></form>
<table><tr><th>No</th><th>Customer</th><th>Showtime</th><th>Film</th><th>Starts</th><th>Seats</th><th>Total</th><th>Status</th></tr>${rows || "<tr><td colspan=8>None.</td></tr>"}</table>${next}`;
}

export function bookingDetail(p: string, b: BookingRow, names: { film: string; cinema: string }, canWrite: boolean): string {
  const cancel = b.status === "confirmed" ? (canWrite ? `<form class="card" method="post" action="${p}/bookings/${esc(b.bookingNo)}/cancel"><button>Cancel this booking</button></form>` : `<p class="muted">Sign in to cancel.</p>`) : "";
  const tickets = b.tickets.map((t) => `<tr><td>${esc(t.seat)}</td><td>${esc(TYPE_LABEL[t.ticketType] ?? t.ticketType)}</td><td>${money(t.priceCents)}</td></tr>`).join("");
  return `<h1>Booking ${esc(b.bookingNo)}</h1><p>${tag(b.status)} · <a href="${p}/films/${esc(b.filmCode)}">${esc(names.film)}</a> · <a href="${p}/cinemas/${esc(b.cinemaCode)}">${esc(names.cinema)}</a> · <a href="${p}/showtimes/${esc(b.showtimeCode)}">${esc(b.showtimeCode)}</a></p>
<table><tr><th>Customer</th><td>${esc(b.customerName)} (${esc(b.customerEmail)})</td></tr><tr><th>Showtime</th><td>${esc(b.date)} ${esc(b.time)}, ${esc(FORMAT_LABEL[b.format] ?? b.format)}</td></tr>
<tr><th>Seats</th><td>${esc(b.seats)}${b.together ? " (side by side)" : ""}</td></tr><tr><th>Booking fees</th><td>${money(b.feesCents)}</td></tr><tr><th>Total</th><td>${money(b.totalCents)}</td></tr></table>
<h2>Tickets</h2><table><tr><th>Seat</th><th>Ticket</th><th>Price</th></tr>${tickets}</table>${cancel}`;
}
