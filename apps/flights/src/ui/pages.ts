import { FLIGHT_CABIN_CLASSES, FLIGHT_WINDOW, type Flight, type FlightAirport, type FlightCarrier, type FlightOffer } from "@benchme/scenarios";
import { esc, money } from "@benchme/site-kit";
import type { SearchInput, TripResult } from "../api/inputs.js";

/** Pieces every page of the flight site uses. */
export const tag = (s: string) => `<span class="tag">${esc(s)}</span>`;
export const inline = 'style="width:auto;display:inline"';
export const field = (label: string, name: string, value: string | undefined, attrs = "") => `<label>${label}</label><input name="${name}" value="${esc(value ?? "")}" ${attrs}>`;
export const select = (name: string, options: [string, string][], chosen?: string) =>
  `<select name="${name}">${options.map(([v, l]) => `<option value="${esc(v)}"${v === chosen ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
export const qs = (o: Record<string, string | number | undefined>) => Object.entries(o).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");
export const duration = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
export const arrival = (f: Pick<Flight, "arrives" | "arrivesNextDay">) => `${esc(f.arrives)}${f.arrivesNextDay ? " (+1 day)" : ""}`;
export const stopsText = (f: Pick<Flight, "via">, airports: Map<string, FlightAirport>) => (f.via ? `1 stop at ${esc(airports.get(f.via)?.name ?? f.via)} (${esc(f.via)})` : "nonstop");
export const placeText = (code: string, airports: Map<string, FlightAirport>) => `${esc(airports.get(code)?.city ?? code)} (${esc(code)})`;
const cabinOptions = FLIGHT_CABIN_CLASSES.map((c): [string, string] => [c, c]);

export type SearchForm = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const many = (v: string | string[] | undefined) => (v === undefined ? [] : Array.isArray(v) ? v : v.split(","));

export function home(p: string, airports: FlightAirport[], carriers: FlightCarrier[], f: SearchForm = {}): string {
  const places = airports.filter((a) => !a.hub).map((a): [string, string] => [a.code, `${a.city} (${a.code})`]);
  const wanted = many(f.carriers);
  const boxes = carriers.map((c) => `<label style="display:inline;margin-right:1em"><input type="checkbox" name="carriers" value="${esc(c.code)}"${wanted.includes(c.code) ? " checked" : ""} ${inline}> ${esc(c.name)} (${esc(c.code)})</label>`).join("");
  return `<h1>Find a flight</h1><form class="card" method="get" action="${p}/search"><label>From</label>${select("origin", places, one(f.origin))}<label>To</label>${select("destination", places, one(f.destination))}
<label>Trip</label>${select("tripType", [["one-way", "One way"], ["round-trip", "Round trip"]], one(f.tripType))}${field("Departure date (YYYY-MM-DD)", "date", one(f.date), 'placeholder="2027-04-12" required')}
${field("Return date, for a round trip (YYYY-MM-DD)", "returnDate", one(f.returnDate))}${field("Passengers", "passengers", one(f.passengers) ?? "1", 'type="number" min="1" max="9"')}<label>Cabin</label>${select("cabin", cabinOptions, one(f.cabin))}
<h3>Filters</h3><label><input type="checkbox" name="maxStops" value="0"${one(f.maxStops) === "0" ? " checked" : ""} ${inline}> Nonstop only</label><label>Carriers</label><div>${boxes}</div>
${field("Most per passenger ($)", "maxPrice", one(f.maxPrice), 'type="number" min="1"')}${field("Departs at or after (HH:MM)", "departAfter", one(f.departAfter), 'placeholder="09:00"')}${field("Departs at or before (HH:MM)", "departBefore", one(f.departBefore), 'placeholder="17:00"')}
<button>Search</button></form>
<h2>Airports</h2><table><tr><th>Code</th><th>Airport</th><th>City</th></tr>${airports.map((a) => `<tr><td><code>${esc(a.code)}</code></td><td>${esc(a.name)}${a.hub ? ` ${tag("hub: stops only")}` : ""}</td><td>${esc(a.city)}</td></tr>`).join("")}</table>
<h2>Carriers</h2><table><tr><th>Code</th><th>Carrier</th><th>Checked bag (per bag, per passenger)</th><th>Most bags per passenger</th></tr>${carriers.map((c) => `<tr><td><code>${esc(c.code)}</code></td><td>${esc(c.name)}</td><td>${money(c.bagFeeCents)}</td><td>${c.maxBags}</td></tr>`).join("")}</table>
<p class="muted">Every flight runs daily. Seats are sold for departures from ${FLIGHT_WINDOW.first} to ${FLIGHT_WINDOW.last}. Fares are per passenger and do not change by date. A booking is one flight for 1 to 9 passengers; a round trip is two bookings. Sign in to book.</p>`;
}

function offersTable(p: string, offers: FlightOffer[], s: SearchInput, airports: Map<string, FlightAirport>): string {
  const rows = offers
    .map((o) => `<tr><td><a href="${p}/flights/${esc(o.flightNo)}?${qs({ date: o.date, cabin: o.cabin, passengers: s.passengers })}">${esc(o.flightNo)}</a></td><td>${esc(o.carrierName)}</td><td>${esc(o.departs)}</td><td>${arrival(o)}</td><td>${duration(o.durationMinutes)}</td><td>${stopsText(o, airports)}</td><td>${money(o.priceCents)}</td><td>${money(o.totalCents)}</td><td>${o.seatsLeft}</td></tr>`)
    .join("");
  return `<table><tr><th>Flight</th><th>Carrier</th><th>Departs</th><th>Arrives</th><th>Duration</th><th>Stops</th><th>Fare</th><th>Total, ${s.passengers} passenger(s)</th><th>Seats left</th></tr>${rows || "<tr><td colspan=9>No flight meets every requirement.</td></tr>"}</table>`;
}

function filtersText(s: SearchInput): string {
  const parts = [
    s.maxStops === 0 ? "nonstop only" : "",
    s.carriers.length ? `carriers ${s.carriers.join(", ")}` : "",
    s.maxPrice !== undefined ? `at most $${s.maxPrice} per passenger` : "",
    s.departAfter ? `departs at or after ${s.departAfter}` : "",
    s.departBefore ? `departs at or before ${s.departBefore}` : "",
  ].filter(Boolean);
  return parts.length ? `Filters: ${esc(parts.join("; "))}.` : "No filters.";
}

export function searchResults(p: string, s: SearchInput, trip: TripResult, airports: Map<string, FlightAirport>): string {
  const keep = { origin: s.origin, destination: s.destination, tripType: s.tripType, date: s.date, returnDate: s.returnDate, passengers: s.passengers, cabin: s.cabin };
  const back = trip.tripType === "round-trip" ? `<h2>Return, ${esc(s.destination)} to ${esc(s.origin)}, ${esc(s.returnDate ?? "")}</h2>${offersTable(p, trip.inbound, s, airports)}` : "";
  return `<h1>Flights from ${esc(s.origin)} to ${esc(s.destination)}</h1><p class="muted">${s.passengers} passenger(s), ${esc(s.cabin)}. Only flights with a ${esc(s.cabin)} seat for every passenger are listed, cheapest first. Checked bags are extra.</p>
<p>${filtersText(s)} <a href="${p}/search?${qs(keep)}">Clear filters</a> · <a href="${p}/?${qs(keep)}">Change search</a></p>
<h2>Outbound, ${esc(s.date)}</h2>${offersTable(p, trip.outbound, s, airports)}${back}`;
}
