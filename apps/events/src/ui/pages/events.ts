import type { EventOffice, EventRoom } from "@benchme/scenarios";
import { esc } from "@benchme/site-kit";
import type { EventView } from "../../db/rows.js";
import { eventTable, field, inline, officeOptions, placesText, qs, roomFacts, tag, when } from "./common.js";

const FILTERS = ["office", "date", "from", "to", "q", "organiser", "guest", "registrant", "hasPlaces"] as const;
export type EventFilters = Partial<Record<(typeof FILTERS)[number], string>>;

export function eventsList(p: string, offices: EventOffice[], items: EventView[], nextCursor: string | null, f: EventFilters): string {
  const small = (name: keyof EventFilters, placeholder: string, width = "9rem") => `<input name="${name}" placeholder="${placeholder}" value="${esc(f[name] ?? "")}" style="width:${width};display:inline">`;
  const keep = qs(Object.fromEntries(FILTERS.map((k) => [k, f[k]])));
  const next = nextCursor ? `<nav class="pager"><a href="${p}/events?${qs({ cursor: nextCursor })}${keep ? `&${keep}` : ""}">Next page →</a></nav>` : "";
  return `<h1>Events</h1><form method="get" action="${p}/events" style="margin-bottom:1rem"><select name="office" ${inline}><option value="">any office</option>${officeOptions(offices, f.office)}</select>
${small("date", "on YYYY-MM-DD")} ${small("from", "from")} ${small("to", "to")} ${small("q", "title contains", "11rem")}<br>${small("organiser", "organiser email", "14rem")} ${small("guest", "guest email", "14rem")} ${small("registrant", "registered email", "14rem")}
<label style="display:inline"><input type="checkbox" name="hasPlaces" value="true" ${inline}${f.hasPlaces === "true" ? " checked" : ""}> open, with places left</label> <button style="margin:0">Find</button></form>
${eventTable(p, items)}${next}`;
}

export function eventDetail(p: string, e: EventView, room: EventRoom | null, office: EventOffice | null, canWrite: boolean): string {
  const guests = e.guests.map((g) => `<li>${g.name ? `${esc(g.name)} · ` : ""}<a href="${p}/people/${encodeURIComponent(g.email)}">${esc(g.email)}</a></li>`).join("");
  const scheduled = e.status === "scheduled";
  const register =
    scheduled && e.registration === "open"
      ? canWrite
        ? `<h2>Register</h2><form class="card" method="post" action="${p}/events/${esc(e.code)}/register">${field("Name", "name", "", "required")}${field("Email", "email", "", 'type="email" required')}<button>Register</button></form>`
        : `<p class="muted">Sign in to register.</p>`
      : "";
  const organiser =
    scheduled && canWrite
      ? `<h2>For the organiser</h2><p><a href="${p}/events/${esc(e.code)}/change">Change this event</a></p><form class="card" method="post" action="${p}/events/${esc(e.code)}/cancel">${field("Organiser email", "organiserEmail", "", 'type="email" required')}<button>Cancel this event</button></form>`
      : "";
  const where = room ? `<a href="${p}/rooms/${esc(room.code)}?date=${esc(e.date)}">${esc(room.name)}</a> <code>${esc(room.code)}</code> (${roomFacts(room)})` : esc(e.roomCode);
  return `<h1>${esc(e.title)} <code>${esc(e.code)}</code></h1><p>${tag(e.status)} · ${tag(e.registration)}</p>
<table><tr><th>When</th><td>${when(e)}</td></tr><tr><th>Where</th><td>${where}, ${office ? `<a href="${p}/offices/${esc(office.code)}">${esc(office.name)}</a>` : esc(e.officeCode)}</td></tr>
<tr><th>Organiser</th><td>${esc(e.organiserName ?? "")} <a href="${p}/people/${encodeURIComponent(e.organiserEmail)}">${esc(e.organiserEmail)}</a></td></tr><tr><th>Description</th><td>${esc(e.description)}</td></tr>
<tr><th>Registration</th><td>${esc(placesText(e))}${e.registration === "open" ? ` · ${e.registeredCount} registered · <a href="${p}/registrations?event=${esc(e.code)}">who</a>` : ""}</td></tr>
<tr><th>Guests (${e.guestCount})</th><td>${guests ? `<ul style="margin:0">${guests}</ul>` : "none"}</td></tr></table>${register}${organiser}`;
}
