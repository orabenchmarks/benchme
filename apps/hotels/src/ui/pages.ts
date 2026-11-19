import { AMENITIES, type Hotel, type StayOffer } from "@benchme/scenarios";
import { esc, money } from "@benchme/site-kit";
import type { BookingRow, HotelDetail } from "../db/hotels-repo.js";

const tag = (s: string) => `<span class="tag">${esc(s)}</span>`;
const inline = 'style="width:auto;display:inline"';
export type StayParams = { checkIn?: string; nights?: string; adults?: string; kids?: string; pets?: string };
const stayQs = (s: StayParams) => Object.entries(s).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");
const field = (label: string, name: string, value: string | undefined, attrs = "") => `<label>${label}</label><input name="${name}" value="${esc(value ?? "")}" ${attrs}>`;

function stayFields(s: StayParams): string {
  return `${field("Check-in (YYYY-MM-DD)", "checkIn", s.checkIn, 'placeholder="2027-04-12" required')}${field("Nights", "nights", s.nights ?? "1", 'type="number" min="1" max="14" required')}
${field("Adults", "adults", s.adults ?? "1", 'type="number" min="1"')}${field("Children", "kids", s.kids ?? "0", 'type="number" min="0"')}${field("Pets", "pets", s.pets ?? "0", 'type="number" min="0"')}`;
}

export function home(p: string, cities: { city: string; hotels: number }[], f: Record<string, string | undefined> = {}): string {
  const options = cities.map((c) => `<option${f.city === c.city ? " selected" : ""}>${esc(c.city)}</option>`).join("");
  const boxes = AMENITIES.map((a) => `<label style="display:inline;margin-right:1em"><input type="checkbox" name="amenities" value="${esc(a)}" ${inline}> ${esc(a)}</label>`).join("");
  return `<h1>Find a stay</h1><form class="card" method="get" action="${p}/search"><label>City</label><select name="city">${options}</select>
${stayFields(f)}${field("Most per night ($)", "maxPrice", f.maxPrice, 'type="number" min="1"')}<label>Must have</label><div>${boxes}</div><button>Search</button></form>
<h2>Cities</h2><table><tr><th>City</th><th>Hotels</th></tr>${cities.map((c) => `<tr><td><a href="${p}/hotels?city=${encodeURIComponent(c.city)}">${esc(c.city)}</a></td><td>${c.hotels}</td></tr>`).join("")}</table>
<p class="muted">Bookings are taken for check-in dates in 2027, 1 to 14 nights. Prices are per room per night. Sign in to book.</p>`;
}

export function searchResults(p: string, q: { city: string; nights: number }, stay: StayParams, offers: StayOffer[]): string {
  const rows = offers
    .map((o) => `<tr><td><a href="${p}/hotels/${esc(o.hotelCode)}?${stayQs(stay)}">${esc(o.hotelName)}</a> <code>${esc(o.hotelCode)}</code></td><td>${esc(o.roomName)} <code>${esc(o.roomCode)}</code></td><td>${money(o.nightlyCents)}</td><td>${money(o.totalCents)}</td><td>${o.roomsLeft}</td></tr>`)
    .join("");
  return `<h1>Stays in ${esc(q.city)}</h1><p class="muted">${offers.length} hotel(s) with a room that fits and is free all ${q.nights} night(s). Each hotel's cheapest such room; the total includes the pet fee when pets come. <a href="${p}/">New search</a></p>
<table><tr><th>Hotel</th><th>Room</th><th>Per night</th><th>Total</th><th>Rooms left</th></tr>${rows || "<tr><td colspan=5>No hotel matches every requirement.</td></tr>"}</table>`;
}

export function hotelsList(p: string, hotels: Hotel[], city?: string): string {
  const rows = hotels
    .map((h) => `<tr><td><a href="${p}/hotels/${esc(h.code)}">${esc(h.name)}</a></td><td><code>${esc(h.code)}</code></td><td>${esc(h.city)}</td><td>${h.rating.toFixed(1)}</td><td>${h.amenities.map(tag).join(" ")}</td><td>${h.petsAllowed ? "yes" : "no"}</td></tr>`)
    .join("");
  return `<h1>Hotels${city ? ` in ${esc(city)}` : ""}</h1><table><tr><th>Hotel</th><th>Code</th><th>City</th><th>Rating</th><th>Amenities</th><th>Pets</th></tr>${rows}</table>`;
}

export function hotelDetail(p: string, h: HotelDetail, stay: StayParams, left: Map<string, number> | null, canWrite: boolean): string {
  const rooms = h.rooms
    .map((r) => `<tr><td>${esc(r.name)}</td><td><code>${esc(r.code)}</code></td><td>${r.maxAdults} adults, ${r.maxKids} children</td><td>${money(r.nightlyCents)}</td><td>${r.rooms}</td>${left ? `<td>${left.get(r.code) ?? 0}</td>` : ""}</tr>`)
    .join("");
  const pets = h.petsAllowed ? `Pets are welcome for ${money(h.petFeeCents ?? 0)} per stay.` : "No pets.";
  const late = h.lateCheckoutUntil ? `Late checkout until ${esc(h.lateCheckoutUntil)} for ${money(h.lateCheckoutFeeCents ?? 0)}.` : "No late checkout.";
  const book = canWrite
    ? `<h2>Book a room</h2><form class="card" method="post" action="${p}/bookings"><input type="hidden" name="hotelCode" value="${esc(h.code)}">
<label>Room</label><select name="roomCode">${h.rooms.map((r) => `<option value="${esc(r.code)}">${esc(r.name)} — ${money(r.nightlyCents)}</option>`).join("")}</select>${stayFields(stay)}
${h.lateCheckoutUntil ? `<label><input type="checkbox" name="lateCheckout" value="1" ${inline}> Late checkout (${money(h.lateCheckoutFeeCents ?? 0)})</label>` : ""}
${field("Guest name", "guestName", "", "required")}${field("Guest email", "guestEmail", "", 'type="email" required')}<button>Book</button></form>`
    : `<p class="muted">Sign in to book.</p>`;
  return `<h1>${esc(h.name)} <code>${esc(h.code)}</code></h1><p>${esc(h.city)} · rating ${h.rating.toFixed(1)} · ${h.amenities.map(tag).join(" ")}</p><p>${esc(h.description)} ${pets} ${late}</p>
<h2>Rooms</h2><form method="get" action="${p}/hotels/${esc(h.code)}">${field("Check-in", "checkIn", stay.checkIn, inline)} ${field("Nights", "nights", stay.nights, `type="number" min="1" max="14" ${inline}`)} <button style="margin:0">Check availability</button></form>
<table><tr><th>Room</th><th>Code</th><th>Sleeps</th><th>Per night</th><th>Rooms</th>${left ? `<th>Free ${esc(stay.checkIn)}, ${esc(stay.nights)} night(s)</th>` : ""}</tr>${rooms}</table>${book}`;
}

export function bookingsList(p: string, items: BookingRow[], nextCursor: string | null, f: Record<string, string | undefined>): string {
  const rows = items
    .map((b) => `<tr><td><a href="${p}/bookings/${esc(b.bookingNo)}">${esc(b.bookingNo)}</a></td><td>${esc(b.guestName)}<br><span class="muted">${esc(b.guestEmail)}</span></td><td><a href="${p}/hotels/${esc(b.hotelCode)}">${esc(b.hotelCode)}</a></td><td>${esc(b.roomCode)}</td><td>${esc(b.checkIn)}</td><td>${b.nights}</td><td>${tag(b.status)}</td></tr>`)
    .join("");
  const keep = Object.entries(f).filter(([, v]) => v).map(([k, v]) => `&${k}=${encodeURIComponent(String(v))}`).join("");
  const next = nextCursor ? `<nav class="pager"><a href="${p}/bookings?cursor=${esc(nextCursor)}${keep}">Next page →</a></nav>` : "";
  return `<h1>Bookings</h1><form method="get" action="${p}/bookings" style="margin-bottom:1rem"><input name="guestEmail" placeholder="guest email" value="${esc(f.guestEmail ?? "")}" style="width:16rem;display:inline">
<input name="hotel" placeholder="hotel code" value="${esc(f.hotel ?? "")}" style="width:8rem;display:inline"> <button style="margin:0">Find</button></form>
<table><tr><th>No</th><th>Guest</th><th>Hotel</th><th>Room</th><th>Check-in</th><th>Nights</th><th>Status</th></tr>${rows || "<tr><td colspan=7>None.</td></tr>"}</table>${next}`;
}

export function bookingDetail(p: string, b: BookingRow, hotelName: string, canWrite: boolean): string {
  const cancel = b.status === "confirmed" ? (canWrite ? `<form class="card" method="post" action="${p}/bookings/${esc(b.bookingNo)}/cancel"><button>Cancel this booking</button></form>` : `<p class="muted">Sign in to cancel.</p>`) : "";
  return `<h1>Booking ${esc(b.bookingNo)}</h1><p>${tag(b.status)} · <a href="${p}/hotels/${esc(b.hotelCode)}">${esc(hotelName)}</a> · ${esc(b.roomCode)}</p>
<table><tr><th>Guest</th><td>${esc(b.guestName)} (${esc(b.guestEmail)})</td></tr><tr><th>Stay</th><td>${esc(b.checkIn)} to ${esc(b.checkOut)}, ${b.nights} night(s)</td></tr>
<tr><th>Party</th><td>${b.adults} adults, ${b.kids} children, ${b.pets} pets</td></tr><tr><th>Late checkout</th><td>${b.lateCheckout ? "yes" : "no"}</td></tr><tr><th>Total</th><td>${money(b.totalCents)}</td></tr></table>${cancel}`;
}
