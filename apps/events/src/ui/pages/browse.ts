import type { EventFreeRoom, EventOffice, EventRoom } from "@benchme/scenarios";
import { esc } from "@benchme/site-kit";
import type { EventView, OfficeView } from "../../db/rows.js";
import { equipmentBoxes, eventTable, field, hours, inline, officeOptions, qs, roomFacts, tag } from "./common.js";

export type RoomSearch = { office?: string; date?: string; startTime?: string; endTime?: string; people?: string; equipment?: string[]; accessible?: string };

export function home(p: string, offices: OfficeView[], f: RoomSearch = {}): string {
  const rows = offices
    .map((o) => `<tr><td><a href="${p}/offices/${esc(o.code)}">${esc(o.name)}</a> <code>${esc(o.code)}</code></td><td>${esc(o.address)}</td><td>${hours(o)}</td><td>${o.rooms.length}</td></tr>`)
    .join("");
  return `<h1>Find a free room</h1><form class="card" method="get" action="${p}/free-rooms"><label>Office</label><select name="office">${officeOptions(offices, f.office)}</select>
${field("Date (YYYY-MM-DD)", "date", f.date, 'placeholder="2027-09-14" required')}${field("Start (HH:MM, 24-hour)", "startTime", f.startTime, 'placeholder="15:00" required')}${field("End (HH:MM, 24-hour)", "endTime", f.endTime, 'placeholder="16:30" required')}
${field("People (the organiser included)", "people", f.people ?? "2", 'type="number" min="1" required')}<label>Must have</label><div>${equipmentBoxes(f.equipment)}</div>
<label><input type="checkbox" name="accessible" value="true" ${inline}${f.accessible === "true" ? " checked" : ""}> Step-free access</label><button>Find rooms</button></form>
<h2>Offices</h2><table><tr><th>Office</th><th>Address</th><th>Open</th><th>Rooms</th></tr>${rows}</table>
<p class="muted">Events are held on dates in 2027, from and to times on the quarter hour, while the office is open. A room holds the organiser, every invited guest and every place open to registration. Sign in to book a room or register for an event.</p>`;
}

export function freeRooms(p: string, office: EventOffice, f: Required<Pick<RoomSearch, "date" | "startTime" | "endTime" | "people">> & RoomSearch, rooms: EventFreeRoom[]): string {
  const book = (r: EventFreeRoom) => `${p}/events/new?${qs({ roomCode: r.roomCode, date: f.date, startTime: f.startTime, endTime: f.endTime })}`;
  const rows = rooms
    .map((r) => `<tr><td><a href="${p}/rooms/${esc(r.roomCode)}?date=${esc(f.date)}">${esc(r.roomName)}</a> <code>${esc(r.roomCode)}</code></td><td>${r.capacity}</td><td>${r.floor}</td><td>${r.equipment.map(tag).join(" ")}</td><td>${r.accessible ? "yes" : "no"}</td><td><a href="${book(r)}">Book</a></td></tr>`)
    .join("");
  const wanted = [`${f.people} people`, ...(f.equipment ?? []), ...(f.accessible === "true" ? ["step-free"] : [])].join(", ");
  return `<h1>Free rooms at the ${esc(office.name)}</h1><p class="muted">${esc(f.date)}, ${esc(f.startTime)}–${esc(f.endTime)}, for ${esc(wanted)}. ${rooms.length} room(s) free for the whole time, smallest first. <a href="${p}/?${qs({ office: office.code, date: f.date, startTime: f.startTime, endTime: f.endTime, people: f.people })}">New search</a></p>
<table><tr><th>Room</th><th>Holds</th><th>Floor</th><th>Equipment</th><th>Step-free</th><th></th></tr>${rows || "<tr><td colspan=6>No room fits every requirement.</td></tr>"}</table>`;
}

const dayPicker = (action: string, date: string | undefined) =>
  `<form method="get" action="${action}">${field("Day", "date", date, `placeholder="YYYY-MM-DD" ${inline}`)} <button style="margin:0">Show the day</button></form>`;

export function officeDetail(p: string, o: OfficeView, date: string | undefined, byRoom: Map<string, EventView[]> | null): string {
  const rows = o.rooms
    .map((r) => `<tr><td><a href="${p}/rooms/${esc(r.code)}${date ? `?date=${esc(date)}` : ""}">${esc(r.name)}</a> <code>${esc(r.code)}</code></td><td>${roomFacts(r)}</td>${byRoom ? `<td>${(byRoom.get(r.code) ?? []).map((e) => `${esc(e.startTime)}–${esc(e.endTime)} <a href="${p}/events/${esc(e.code)}">${esc(e.code)}</a>`).join("<br>") || "free all day"}</td>` : ""}</tr>`)
    .join("");
  return `<h1>${esc(o.name)} <code>${esc(o.code)}</code></h1><p>${esc(o.address)} · open ${hours(o)}</p>${dayPicker(`${p}/offices/${esc(o.code)}`, date)}
<h2>Rooms</h2><table><tr><th>Room</th><th>Facts</th>${byRoom ? `<th>Taken on ${esc(date)}</th>` : ""}</tr>${rows}</table>`;
}

export function roomDetail(p: string, r: EventRoom, o: EventOffice, date: string | undefined, events: EventView[] | null): string {
  const schedule = events ? `<h2>On ${esc(date)}</h2>${eventTable(p, events, "Free all day.")}` : "";
  return `<h1>${esc(r.name)} <code>${esc(r.code)}</code></h1><p><a href="${p}/offices/${esc(o.code)}">${esc(o.name)}</a> · open ${hours(o)}</p><p>${roomFacts(r)}</p>
${dayPicker(`${p}/rooms/${esc(r.code)}`, date)}${schedule}<p><a href="${p}/events/new?${qs({ roomCode: r.code, date })}">Book this room</a></p>`;
}
