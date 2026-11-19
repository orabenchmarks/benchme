import type { FlightAirport } from "@benchme/scenarios";
import { esc, money } from "@benchme/site-kit";
import type { BookingView } from "../db/flights-repo.js";
import { placeText, tag } from "./pages.js";

export type BookingsFilter = { contactEmail?: string | undefined; flightNo?: string | undefined; date?: string | undefined; status?: string | undefined };

export function bookingsList(p: string, items: BookingView[], nextCursor: string | null, f: BookingsFilter, airports: Map<string, FlightAirport>): string {
  const rows = items
    .map((b) => `<tr><td><a href="${p}/bookings/${esc(b.bookingNo)}">${esc(b.bookingNo)}</a></td><td>${esc(b.contactEmail)}</td><td><a href="${p}/flights/${esc(b.flightNo)}">${esc(b.flightNo)}</a></td><td>${placeText(b.origin, airports)} to ${placeText(b.destination, airports)}</td><td>${esc(b.date)}</td><td>${esc(b.cabin)}</td><td>${b.passengers.map((x) => esc(x.name)).join("<br>")}</td><td>${tag(b.status)}</td></tr>`)
    .join("");
  const keep = Object.entries(f).filter(([, v]) => v).map(([k, v]) => `&${k}=${encodeURIComponent(String(v))}`).join("");
  const next = nextCursor ? `<nav class="pager"><a href="${p}/bookings?cursor=${esc(nextCursor)}${keep}">Next page →</a></nav>` : "";
  const input = (name: string, ph: string, width: string) => `<input name="${name}" placeholder="${ph}" value="${esc((f as Record<string, string | undefined>)[name] ?? "")}" style="width:${width};display:inline">`;
  return `<h1>Bookings</h1><form method="get" action="${p}/bookings" style="margin-bottom:1rem">${input("contactEmail", "contact email", "16rem")} ${input("flightNo", "flight", "6rem")} ${input("date", "date YYYY-MM-DD", "10rem")} <button style="margin:0">Find</button></form>
<table><tr><th>No</th><th>Contact</th><th>Flight</th><th>Route</th><th>Date</th><th>Cabin</th><th>Passengers</th><th>Status</th></tr>${rows || "<tr><td colspan=8>None.</td></tr>"}</table>${next}`;
}

export function bookingDetail(p: string, b: BookingView, airports: Map<string, FlightAirport>, canWrite: boolean): string {
  const cancel =
    b.status === "confirmed"
      ? canWrite
        ? `<form class="card" method="post" action="${p}/bookings/${esc(b.bookingNo)}/cancel"><button>Cancel this booking</button></form>`
        : `<p class="muted">Sign in to cancel.</p>`
      : "";
  return `<h1>Booking ${esc(b.bookingNo)}</h1><p>${tag(b.status)} · flight <a href="${p}/flights/${esc(b.flightNo)}">${esc(b.flightNo)}</a> · ${placeText(b.origin, airports)} to ${placeText(b.destination, airports)}</p>
<table><tr><th>Departure</th><td>${esc(b.date)}, departs ${esc(b.departs)}, arrives ${esc(b.arrives)}</td></tr><tr><th>Cabin</th><td>${esc(b.cabin)}</td></tr>
<tr><th>Passengers</th><td>${b.passengers.map((x) => esc(x.name)).join("<br>")}</td></tr><tr><th>Checked bags per passenger</th><td>${b.bags}</td></tr>
<tr><th>Contact email</th><td>${esc(b.contactEmail)}</td></tr><tr><th>Total</th><td>${money(b.totalCents)}</td></tr>${b.cancelledAt ? `<tr><th>Cancelled</th><td>${esc(b.cancelledAt)}</td></tr>` : ""}</table>${cancel}`;
}
