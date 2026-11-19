import { DINING_WEEKDAYS, diningLastSeating } from "@benchme/scenarios";
import { esc, money } from "@benchme/site-kit";
import type { DayAvailability, RestaurantDetail } from "../db/dining-repo.js";
import { AREA_NAMES, field, flat, inline, price, select, tag, type Form } from "./kit.js";

/** What the visitor asked the page for (and re-fills the reservation form with). */
export type DayParams = { date?: string; time?: string; partySize?: string; area?: string; guestName?: string; guestEmail?: string; guestPhone?: string; note?: string };
export const dayParamsOf = (f: Form): DayParams => {
  const v = flat(f);
  return { date: v.date, time: v.time, partySize: v.partySize, area: v.area, guestName: v.guestName, guestEmail: v.guestEmail, guestPhone: v.guestPhone, note: v.note };
};

const cap = (s: string) => `${s[0]?.toUpperCase() ?? ""}${s.slice(1)}`;

function hoursTable(r: RestaurantDetail): string {
  const rows = DINING_WEEKDAYS.map((d) => {
    const h = r.hours[d];
    return `<tr><td>${cap(d)}</td>${h ? `<td>${esc(h.opens)}</td><td>${esc(h.closes)}</td><td>${esc(diningLastSeating(h))}</td>` : '<td colspan=3>Closed</td>'}</tr>`;
  }).join("");
  return `<h2>Opening hours</h2><table><tr><th>Day</th><th>Opens</th><th>Closes</th><th>Last seating</th></tr>${rows}</table>`;
}

function availabilityTable(a: DayAvailability): string {
  if (!a.hours) return `<p>Closed on ${esc(a.date)}${a.weekday ? ` (${cap(a.weekday)})` : ""}.</p>`;
  const areas = [...new Set(a.slots.map((s) => s.area))];
  if (areas.length === 0) return `<p>No area seats a party of ${a.partySize} on ${esc(a.date)}.</p>`;
  const rows = areas
    .map((area) => {
      const cells = a.slots.filter((s) => s.area === area).map((s) => (s.tablesLeft > 0 ? `${esc(s.time)} (${s.tablesLeft} free)` : `<s>${esc(s.time)}</s> full`));
      return `<tr><th>${esc(AREA_NAMES[area] ?? area)}</th><td>${cells.join(" · ")}</td></tr>`;
    })
    .join("");
  return `<h3>Free tables on ${esc(a.date)} (${cap(a.weekday ?? "")}) for ${a.partySize}</h3><table>${rows}</table>`;
}

function reserveForm(p: string, r: RestaurantDetail, d: DayParams): string {
  const areas = r.seating.map((s): [string, string] => [s.area, `${AREA_NAMES[s.area] ?? s.area} (tables for up to ${s.seats})`]);
  return `<h2>Reserve a table</h2><form class="card" method="post" action="${p}/reservations"><input type="hidden" name="restaurantCode" value="${esc(r.code)}">
${select("Seating area", "area", areas, d.area)}${field("Date (YYYY-MM-DD)", "date", d.date, 'placeholder="2027-05-14" required')}${field("Time (HH:MM)", "time", d.time, 'placeholder="19:30" required')}
${field("Party size", "partySize", d.partySize ?? "2", 'type="number" min="1" max="12" required')}${field("Guest name", "guestName", d.guestName, "required")}
${field("Guest email", "guestEmail", d.guestEmail, 'type="email" required')}${field("Guest phone", "guestPhone", d.guestPhone, 'type="tel" required')}
<label>Special request</label><textarea name="note" rows="2" placeholder="Allergies, an occasion, a high chair…">${esc(d.note ?? "")}</textarea><button>Reserve</button></form>`;
}

export function restaurantDetail(p: string, r: RestaurantDetail, d: DayParams, day: DayAvailability | null, canWrite: boolean): string {
  const deposit = r.depositPerGuestCents ? `A deposit of ${money(r.depositPerGuestCents)} per guest is taken when you reserve.` : "No deposit per guest.";
  const room = r.privateRoomFeeCents !== null ? ` The private room adds a fee of ${money(r.privateRoomFeeCents)} to the deposit.` : "";
  const seating = r.seating.map((s) => `<tr><td>${esc(AREA_NAMES[s.area] ?? s.area)}</td><td>${s.tables}</td><td>${s.seats}</td></tr>`).join("");
  return `<h1>${esc(r.name)} <code>${esc(r.code)}</code></h1><p>${esc(r.city)} · ${esc(r.cuisine)} · ${price(r.priceLevel)} · dietary menus: ${r.menus.map(tag).join(" ") || "none"}</p>
<p>${esc(r.description)} ${deposit}${room} Closed on ${cap(r.closedDay)}s.</p>${hoursTable(r)}
<h2>Seating</h2><table><tr><th>Area</th><th>Tables</th><th>Seats per table</th></tr>${seating}</table>
<h2>Availability</h2><form method="get" action="${p}/restaurants/${esc(r.code)}">${field("Date", "date", d.date, inline)} ${field("Party size", "partySize", d.partySize ?? "2", `type="number" min="1" max="12" ${inline}`)} <button style="margin:0">Show free tables</button></form>
${day ? availabilityTable(day) : ""}${canWrite ? reserveForm(p, r, d) : `<p class="muted">Sign in to reserve.</p>`}`;
}
