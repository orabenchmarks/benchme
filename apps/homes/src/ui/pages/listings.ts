import { HOME_FEATURES, HOME_LISTING_STATUSES, HOME_TYPES, type HomeListing, type HomeSlot } from "@benchme/scenarios";
import { esc, money } from "@benchme/site-kit";
import type { ListingDetail } from "../../db/homes-repo.js";
import { field, inline, plural, tag } from "./common.js";

export type SearchForm = Record<string, string | string[] | undefined>;
const has = (v: string | string[] | undefined, x: string) => (Array.isArray(v) ? v : (v ?? "").split(",")).includes(x);
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const boxes = (name: string, values: readonly string[], f: SearchForm) =>
  values.map((x) => `<label style="display:inline;margin-right:1em"><input type="checkbox" name="${name}" value="${esc(x)}" ${has(f[name], x) ? "checked" : ""} ${inline}> ${esc(x)}</label>`).join("");

export function home(p: string, cities: { city: string; listings: number; active: number }[], f: SearchForm = {}): string {
  const options = [`<option value="">Any city</option>`, ...cities.map((c) => `<option${one(f.city) === c.city ? " selected" : ""}>${esc(c.city)}</option>`)].join("");
  const statuses = [`<option value="">Any status</option>`, ...HOME_LISTING_STATUSES.map((s) => `<option${one(f.status) === s ? " selected" : ""}>${s}</option>`)].join("");
  return `<h1>Find a home</h1><form class="card" method="get" action="${p}/listings"><label>City</label><select name="city">${options}</select>
<label>Type</label><div>${boxes("type", HOME_TYPES, f)}</div>
${field("Lowest asking price ($)", "minPrice", one(f.minPrice), 'type="number" min="0"')}${field("Highest asking price ($)", "maxPrice", one(f.maxPrice), 'type="number" min="1"')}
${field("Bedrooms, at least", "minBeds", one(f.minBeds), 'type="number" min="0"')}${field("Bathrooms, at least", "minBaths", one(f.minBaths), 'type="number" min="0"')}
${field("Floor area, at least (m²)", "minArea", one(f.minArea), 'type="number" min="0"')}${field("Built in or after", "minYearBuilt", one(f.minYearBuilt), 'type="number"')}
<label>Must have</label><div>${boxes("features", HOME_FEATURES, f)}</div><label>Status</label><select name="status">${statuses}</select><button>Search</button></form>
<h2>Cities</h2><table><tr><th>City</th><th>Listings</th><th>Active</th></tr>${cities.map((c) => `<tr><td><a href="${p}/listings?city=${encodeURIComponent(c.city)}">${esc(c.city)}</a></td><td>${c.listings}</td><td>${c.active}</td></tr>`).join("")}</table>
<p class="muted">Only active listings can be viewed. Viewings are 30 minutes, in the listing agent's hours. Sign in to request one.</p>`;
}

export function listingsList(p: string, listings: HomeListing[], title: string): string {
  const rows = listings
    .map(
      (l) =>
        `<tr><td><a href="${p}/listings/${esc(l.code)}">${esc(l.code)}</a></td><td>${esc(l.address)}<br><span class="muted">${esc(l.neighbourhood)}, ${esc(l.city)}</span></td><td>${esc(l.type)}</td><td>${l.beds} bd / ${l.baths} ba</td><td>${l.areaSqm} m²</td><td>${money(l.priceCents)}</td><td>${tag(l.status)}</td></tr>`,
    )
    .join("");
  return `<h1>${esc(title)}</h1><p class="muted">${plural(listings.length, "listing")}, cheapest first. <a href="${p}/">New search</a></p>
<table><tr><th>Code</th><th>Address</th><th>Type</th><th>Rooms</th><th>Area</th><th>Asking price</th><th>Status</th></tr>${rows || "<tr><td colspan=7>No listing matches every filter.</td></tr>"}</table>`;
}

function slotTable(slots: HomeSlot[]): string {
  const days = [...new Set(slots.map((s) => s.date))];
  const cell = (s: HomeSlot) => (s.free ? tag(`${s.time} free`) : `<span class="tag muted"><s>${esc(s.time)}</s> taken</span>`);
  return `<table><tr><th>Date</th><th>Slots (30 minutes)</th></tr>${days.map((d) => `<tr><td>${esc(d)}</td><td>${slots.filter((s) => s.date === d).map(cell).join(" ")}</td></tr>`).join("") || "<tr><td colspan=2>No viewing days.</td></tr>"}</table>`;
}

function requestForm(p: string, l: ListingDetail, slots: HomeSlot[], canWrite: boolean): string {
  if (l.status !== "active") return `<p class="muted">This listing is ${esc(l.status)}: only active listings can be viewed.</p>`;
  if (!canWrite) return `<p class="muted">Sign in to request a viewing.</p>`;
  const free = slots.filter((s) => s.free).map((s) => `<option value="${esc(`${s.date}T${s.time}`)}">${esc(s.date)} ${esc(s.time)}</option>`).join("");
  return `<h2>Request a viewing</h2><form class="card" method="post" action="${p}/viewings"><input type="hidden" name="listingCode" value="${esc(l.code)}">
<label>Slot</label><select name="slot">${free}</select>${field("Your name", "viewerName", "", "required")}${field("Your email", "viewerEmail", "", 'type="email" required')}<button>Request viewing</button></form>`;
}

export function listingDetail(p: string, l: ListingDetail, slots: HomeSlot[], canWrite: boolean): string {
  const facts: [string, string][] = [
    ["Asking price", money(l.priceCents)],
    ["Type", esc(l.type)],
    ["Bedrooms / bathrooms", `${l.beds} / ${l.baths}`],
    ["Floor area", `${l.areaSqm} m²`],
    ["Built", String(l.yearBuilt)],
    ["Features", l.features.map(tag).join(" ") || "none"],
    ["Service fee", l.monthlyFeeCents ? `${money(l.monthlyFeeCents)} per month` : "none"],
    ["Property tax", `${money(l.annualTaxCents)} per year`],
    ["Listed", esc(l.listedOn)],
    ["Agent", `<a href="${p}/agents/${esc(l.agent.code)}">${esc(l.agent.name)}</a> <code>${esc(l.agent.code)}</code> · ${esc(l.agent.email)}`],
  ];
  return `<h1>${esc(l.address)} <code>${esc(l.code)}</code></h1><p>${tag(l.status)} · ${esc(l.neighbourhood)}, ${esc(l.city)}</p><p>${esc(l.description)}</p>
<table>${facts.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join("")}</table>
<h2>Viewing slots with ${esc(l.agent.name)}</h2>${slotTable(slots)}${requestForm(p, l, slots, canWrite)}`;
}
