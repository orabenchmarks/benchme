import { DINING_AREAS, DINING_CUISINES, DINING_MENUS, type DiningOffer, type DiningRestaurant } from "@benchme/scenarios";
import { esc, money } from "@benchme/site-kit";
import { AREA_NAMES, field, inline, price, qs, select, tag } from "./kit.js";

export type SearchForm = Record<string, string | string[] | undefined>;
const any = (values: readonly string[], names: Record<string, string> = {}): [string, string][] => [["", "Any"], ...values.map((v): [string, string] => [v, names[v] ?? v])];
const str = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function home(p: string, cities: { city: string; restaurants: number }[], f: SearchForm = {}): string {
  const wanted = new Set(Array.isArray(f.menus) ? f.menus : str(f.menus)?.split(",") ?? []);
  const boxes = DINING_MENUS.map((m) => `<label style="display:inline;margin-right:1em"><input type="checkbox" name="menus" value="${esc(m)}" ${inline}${wanted.has(m) ? " checked" : ""}> ${esc(m)}</label>`).join("");
  return `<h1>Find a table</h1><form class="card" method="get" action="${p}/search">${select("City", "city", cities.map((c) => c.city), str(f.city))}
${field("Date (YYYY-MM-DD)", "date", str(f.date), 'placeholder="2027-05-14" required')}${field("Time (HH:MM, on the hour or half hour)", "time", str(f.time), 'placeholder="19:30" required')}
${field("Party size", "partySize", str(f.partySize) ?? "2", 'type="number" min="1" max="12" required')}${select("Seating area", "area", any(DINING_AREAS, AREA_NAMES), str(f.area))}
${select("Cuisine", "cuisine", any(DINING_CUISINES), str(f.cuisine))}<label>Dietary menus offered</label><div>${boxes}</div>
${select("Price level at most", "maxPriceLevel", any(["1", "2", "3", "4"], { 1: "$", 2: "$$", 3: "$$$", 4: "$$$$" }), str(f.maxPriceLevel))}<button>Search</button></form>
<h2>Cities</h2><table><tr><th>City</th><th>Restaurants</th></tr>${cities.map((c) => `<tr><td><a href="${p}/restaurants?city=${encodeURIComponent(c.city)}">${esc(c.city)}</a></td><td>${c.restaurants}</td></tr>`).join("")}</table>
<p class="muted">Reservations are taken for dates in 2027, for 1 to 12 guests. A reservation holds one table for 2 hours from a seating time on the hour or half hour, so the last seating is 2 hours before closing. Sign in to reserve.</p>`;
}

export function searchResults(p: string, q: { city: string; date: string; time: string; partySize: number }, offers: DiningOffer[]): string {
  const day = qs({ date: q.date, time: q.time, partySize: q.partySize });
  const rows = offers
    .map(
      (o) =>
        `<tr><td><a href="${p}/restaurants/${esc(o.restaurantCode)}?${day}">${esc(o.restaurantName)}</a> <code>${esc(o.restaurantCode)}</code></td><td>${esc(o.cuisine)}</td><td>${price(o.priceLevel)}</td><td>${esc(AREA_NAMES[o.area] ?? o.area)}</td><td>${o.seats}</td><td>${o.tablesLeft}</td><td>${money(o.depositCents)}</td></tr>`,
    )
    .join("");
  return `<h1>Tables in ${esc(q.city)}</h1><p class="muted">${offers.length} table option(s) for ${q.partySize} on ${esc(q.date)} at ${esc(q.time)}: one row per restaurant and seating area with a table that seats the party and is free for the 2 hours. <a href="${p}/">New search</a></p>
<table><tr><th>Restaurant</th><th>Cuisine</th><th>Price</th><th>Area</th><th>Seats per table</th><th>Tables free</th><th>Deposit</th></tr>${rows || "<tr><td colspan=7>No restaurant matches every requirement at that time.</td></tr>"}</table>`;
}

export function restaurantsList(p: string, restaurants: DiningRestaurant[], city?: string): string {
  const rows = restaurants
    .map(
      (r) =>
        `<tr><td><a href="${p}/restaurants/${esc(r.code)}">${esc(r.name)}</a></td><td><code>${esc(r.code)}</code></td><td>${esc(r.city)}</td><td>${esc(r.cuisine)}</td><td>${price(r.priceLevel)}</td><td>${r.menus.map(tag).join(" ") || '<span class="muted">none</span>'}</td><td>${esc(r.closedDay)}</td></tr>`,
    )
    .join("");
  return `<h1>Restaurants${city ? ` in ${esc(city)}` : ""}</h1><table><tr><th>Restaurant</th><th>Code</th><th>City</th><th>Cuisine</th><th>Price</th><th>Dietary menus</th><th>Closed on</th></tr>${rows}</table>`;
}
