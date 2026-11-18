import { EVENT_EQUIPMENT, type EventOffice, type EventRoom } from "@benchme/scenarios";
import { esc } from "@benchme/site-kit";
import type { EventView } from "../../db/rows.js";

export const tag = (s: string) => `<span class="tag">${esc(s)}</span>`;
export const inline = 'style="width:auto;display:inline"';
export const field = (label: string, name: string, value: string | number | null | undefined, attrs = "") => `<label>${label}</label><input name="${name}" value="${esc(value ?? "")}" ${attrs}>`;
export const area = (label: string, name: string, value: string | undefined, hint = "") => `<label>${label}</label><textarea name="${name}" rows="3" placeholder="${esc(hint)}">${esc(value ?? "")}</textarea>`;
export const qs = (o: Record<string, string | number | undefined | null>) =>
  Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&");
export const officeOptions = (offices: EventOffice[], selected?: string) =>
  offices.map((o) => `<option value="${esc(o.code)}"${selected === o.code || selected === o.city ? " selected" : ""}>${esc(o.name)} (${esc(o.code)})</option>`).join("");
export const equipmentBoxes = (checked: string[] = []) =>
  EVENT_EQUIPMENT.map((e) => `<label style="display:inline;margin-right:1em"><input type="checkbox" name="equipment" value="${esc(e)}" ${inline}${checked.includes(e) ? " checked" : ""}> ${esc(e)}</label>`).join("");
export const roomFacts = (r: EventRoom) => `${r.capacity} people · floor ${r.floor} · ${r.equipment.length ? r.equipment.map(tag).join(" ") : "no equipment"} · ${r.accessible ? "step-free" : "stairs only"}`;
export const hours = (o: EventOffice) => `${esc(o.openDays.join(", "))}, ${esc(o.opensAt)}–${esc(o.closesAt)}`;
export const when = (e: { date: string; startTime: string; endTime: string }) => `${esc(e.date)} ${esc(e.startTime)}–${esc(e.endTime)}`;
export const placesText = (e: EventView) => (e.registration === "open" ? `open: ${e.placesLeft} of ${e.places} places left` : "invitation only");
export const eventLink = (p: string, e: { code: string; title: string }) => `<a href="${p}/events/${esc(e.code)}">${esc(e.title)}</a> <code>${esc(e.code)}</code>`;

/** A compact list of events: what a schedule, a person's page and the events page share. */
export function eventTable(p: string, items: EventView[], empty = "None."): string {
  const rows = items
    .map((e) => `<tr><td>${eventLink(p, e)}</td><td>${when(e)}</td><td><a href="${p}/rooms/${esc(e.roomCode)}?date=${esc(e.date)}">${esc(e.roomCode)}</a></td><td>${esc(e.organiserName ?? e.organiserEmail)}</td><td>${esc(placesText(e))}</td><td>${tag(e.status)}</td></tr>`)
    .join("");
  return `<table><tr><th>Event</th><th>When</th><th>Room</th><th>Organiser</th><th>Registration</th><th>Status</th></tr>${rows || `<tr><td colspan=6>${esc(empty)}</td></tr>`}</table>`;
}
