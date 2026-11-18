import { FLIGHT_WINDOW, type FlightAirport } from "@benchme/scenarios";
import { esc, money } from "@benchme/site-kit";
import type { FlightDetail, FlightSeats } from "../db/flights-repo.js";
import { arrival, duration, field, inline, placeText, select, stopsText } from "./pages.js";

/** The booking form's values, kept when a refused booking re-renders the page. */
export type BookingForm = { date?: string; cabin?: string; passengers?: string; bags?: string; contactEmail?: string };

export function flightsList(p: string, flights: FlightDetail[], airports: Map<string, FlightAirport>, f: { origin?: string; destination?: string }): string {
  const places = [["", "any"] as [string, string], ...[...airports.values()].filter((a) => !a.hub).map((a): [string, string] => [a.code, `${a.city} (${a.code})`])];
  const rows = flights
    .map((x) => `<tr><td><a href="${p}/flights/${esc(x.flightNo)}">${esc(x.flightNo)}</a></td><td>${esc(x.carrier.name)}</td><td>${placeText(x.origin, airports)}</td><td>${placeText(x.destination, airports)}</td><td>${esc(x.departs)}</td><td>${arrival(x)}</td><td>${duration(x.durationMinutes)}</td><td>${stopsText(x, airports)}</td><td>${x.cabins.map((c) => `${esc(c.cabin)} ${money(c.priceCents)}`).join("<br>")}</td></tr>`)
    .join("");
  return `<h1>Schedule</h1><form method="get" action="${p}/flights" style="margin-bottom:1rem">From ${select("origin", places, f.origin)} To ${select("destination", places, f.destination)} <button style="margin:0">Show</button></form>
<p class="muted">Every flight runs daily from ${FLIGHT_WINDOW.first} to ${FLIGHT_WINDOW.last}. This list has no seat counts: search a date, or open a flight, to see what is left.</p>
<table><tr><th>Flight</th><th>Carrier</th><th>From</th><th>To</th><th>Departs</th><th>Arrives</th><th>Duration</th><th>Stops</th><th>Fares per passenger</th></tr>${rows || "<tr><td colspan=9>None.</td></tr>"}</table>`;
}

export function flightDetail(p: string, f: FlightDetail, airports: Map<string, FlightAirport>, seats: FlightSeats | null, form: BookingForm, canWrite: boolean): string {
  const left = new Map((seats?.cabins ?? []).map((c) => [c.cabin, c.seatsLeft]));
  const rows = f.cabins
    .map((c) => `<tr><td>${esc(c.cabin)}</td><td>${money(c.priceCents)}</td><td>${c.seats}</td>${seats ? `<td>${left.get(c.cabin) ?? 0}</td>` : ""}</tr>`)
    .join("");
  const bagRule = `Checked bags: ${money(f.carrier.bagFeeCents)} per bag per passenger, at most ${f.carrier.maxBags} per passenger.`;
  const book = canWrite
    ? `<h2>Book this flight</h2><form class="card" method="post" action="${p}/bookings"><input type="hidden" name="flightNo" value="${esc(f.flightNo)}">
${field("Departure date (YYYY-MM-DD)", "date", form.date, 'placeholder="2027-04-12" required')}<label>Cabin</label>${select("cabin", f.cabins.map((c): [string, string] => [c.cabin, `${c.cabin} — ${money(c.priceCents)} per passenger`]), form.cabin)}
<label>Passenger names, one per line</label><textarea name="passengers" rows="4" required>${esc(form.passengers ?? "")}</textarea>
${field("Checked bags per passenger", "bags", form.bags ?? "0", `type="number" min="0" max="${f.carrier.maxBags}"`)}${field("Contact email", "contactEmail", form.contactEmail, 'type="email" required')}
<p class="muted">Total = passengers × fare + passengers × bags × ${money(f.carrier.bagFeeCents)}.</p><button>Book</button></form>`
    : `<p class="muted">Sign in to book.</p>`;
  return `<h1>Flight ${esc(f.flightNo)} <span class="muted">${esc(f.carrier.name)} (${esc(f.carrier.code)})</span></h1>
<p>${placeText(f.origin, airports)} to ${placeText(f.destination, airports)} · departs ${esc(f.departs)}, arrives ${arrival(f)} · ${duration(f.durationMinutes)} · ${stopsText(f, airports)}</p>
<p>Runs daily from ${FLIGHT_WINDOW.first} to ${FLIGHT_WINDOW.last}. Fares are per passenger and the same on every date. ${bagRule}</p>
<h2>Cabins</h2><form method="get" action="${p}/flights/${esc(f.flightNo)}">${field("Seats on", "date", form.date, `placeholder="2027-04-12" ${inline}`)} <button style="margin:0">Check seats</button></form>
<table><tr><th>Cabin</th><th>Fare per passenger</th><th>Seats per departure</th>${seats ? `<th>Seats left on ${esc(seats.date)}</th>` : ""}</tr>${rows}</table>${book}`;
}
