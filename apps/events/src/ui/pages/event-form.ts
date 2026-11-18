import { esc } from "@benchme/site-kit";
import type { EventView, OfficeView } from "../../db/rows.js";
import { area, field } from "./common.js";

/** What a create or change form holds, as the strings a form sends. */
export type EventValues = Partial<Record<"title" | "description" | "date" | "startTime" | "endTime" | "roomCode" | "organiserEmail" | "guestEmails" | "registration" | "places", string>>;

export const valuesOf = (e: EventView): EventValues => ({
  title: e.title, description: e.description, date: e.date, startTime: e.startTime, endTime: e.endTime, roomCode: e.roomCode,
  guestEmails: e.guests.map((g) => g.email).join("\n"), registration: e.registration, places: e.places === null ? "" : String(e.places),
});

function roomSelect(offices: OfficeView[], selected?: string): string {
  const groups = offices.map(
    (o) => `<optgroup label="${esc(o.name)}">${o.rooms.map((r) => `<option value="${esc(r.code)}"${selected === r.code ? " selected" : ""}>${esc(r.name)} (${esc(r.code)}) — ${r.capacity} people${r.equipment.length ? `, ${esc(r.equipment.join(", "))}` : ""}</option>`).join("")}</optgroup>`,
  );
  return `<label>Room</label><select name="roomCode" required>${groups.join("")}</select>`;
}

function fields(offices: OfficeView[], v: EventValues): string {
  const mode = (m: string, label: string) => `<option value="${m}"${(v.registration ?? "invite-only") === m ? " selected" : ""}>${label}</option>`;
  return `${field("Title", "title", v.title, "required")}${area("Description", "description", v.description)}${roomSelect(offices, v.roomCode)}
${field("Date (YYYY-MM-DD)", "date", v.date, 'placeholder="2027-09-14" required')}${field("Start (HH:MM, 24-hour)", "startTime", v.startTime, 'placeholder="15:00" required')}${field("End (HH:MM, 24-hour)", "endTime", v.endTime, 'placeholder="16:30" required')}
${area("Guests (emails, one per line or comma-separated)", "guestEmails", v.guestEmails, "someone@example.com")}
<label>Registration</label><select name="registration">${mode("invite-only", "Invitation only")}${mode("open", "Open to registration")}</select>${field("Places (open events only)", "places", v.places, 'type="number" min="1"')}`;
}

export function newEventForm(p: string, offices: OfficeView[], v: EventValues, canWrite: boolean): string {
  if (!canWrite) return `<h1>New event</h1><p class="muted">Sign in to book a room for an event.</p>`;
  return `<h1>New event</h1><form class="card" method="post" action="${p}/events">${field("Organiser email (staff directory)", "organiserEmail", v.organiserEmail, 'type="email" required')}${fields(offices, v)}<button>Book the room</button></form>
<p class="muted">The room must hold the organiser, every guest and every place, and be free for the whole time. <a href="${p}/">Find a free room</a></p>`;
}

export function changeEventForm(p: string, e: EventView, offices: OfficeView[], v: EventValues, canWrite: boolean): string {
  if (!canWrite) return `<h1>Change ${esc(e.code)}</h1><p class="muted">Sign in to change an event.</p>`;
  return `<h1>Change <a href="${p}/events/${esc(e.code)}">${esc(e.title)}</a> <code>${esc(e.code)}</code></h1><form class="card" method="post" action="${p}/events/${esc(e.code)}/change">
${field("Organiser email (only the organiser can change it)", "organiserEmail", v.organiserEmail, 'type="email" required')}${fields(offices, v)}<button>Save the changes</button></form>
<p class="muted">The guest list above replaces the current one. Places cannot go below the ${e.registeredCount} people registered.</p>`;
}
