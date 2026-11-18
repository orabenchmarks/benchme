import type { EventOffice, EventPerson } from "@benchme/scenarios";
import { esc } from "@benchme/site-kit";
import type { EventView, RegistrationView } from "../../db/rows.js";
import { eventTable, inline, officeOptions, tag, when } from "./common.js";

export function peopleList(p: string, offices: EventOffice[], people: EventPerson[], f: Record<string, string | undefined>): string {
  const office = new Map(offices.map((o) => [o.code, o]));
  const rows = people
    .map((x) => `<tr><td><a href="${p}/people/${encodeURIComponent(x.email)}">${esc(x.name)}</a></td><td>${esc(x.email)}</td><td>${esc(office.get(x.officeCode)?.name ?? x.officeCode)}</td><td>${esc(x.team)}</td></tr>`)
    .join("");
  return `<h1>People</h1><form method="get" action="${p}/people" style="margin-bottom:1rem"><select name="office" ${inline}><option value="">any office</option>${officeOptions(offices, f.office)}</select>
<input name="team" placeholder="team" value="${esc(f.team ?? "")}" style="width:9rem;display:inline"> <input name="name" placeholder="name contains" value="${esc(f.name ?? "")}" style="width:12rem;display:inline"> <button style="margin:0">Find</button></form>
<table><tr><th>Name</th><th>Email</th><th>Office</th><th>Team</th></tr>${rows || "<tr><td colspan=4>Nobody matches.</td></tr>"}</table><p class="muted">The staff directory. Only staff can organise an event; anyone can be invited or register.</p>`;
}

export type Schedule = { organising: EventView[]; invited: EventView[]; registrations: RegistrationView[] };

export function personPage(p: string, email: string, person: EventPerson | null, office: EventOffice | undefined, s: Schedule): string {
  const regs = s.registrations
    .map((r) => `<tr><td><a href="${p}/registrations/${esc(r.regNo)}">${esc(r.regNo)}</a></td><td><a href="${p}/events/${esc(r.eventCode)}">${esc(r.eventTitle)}</a> <code>${esc(r.eventCode)}</code></td><td>${when({ date: r.eventDate, startTime: r.startTime, endTime: r.endTime })}</td><td>${tag(r.status)}</td></tr>`)
    .join("");
  const who = person ? `<p>${esc(person.email)} · ${esc(office?.name ?? person.officeCode)} · ${esc(person.team)}</p>` : `<p>${esc(email)} is not in the staff directory.</p>`;
  return `<h1>${esc(person?.name ?? email)}</h1>${who}<h2>Organising</h2>${eventTable(p, s.organising)}<h2>Invited to</h2>${eventTable(p, s.invited)}
<h2>Registrations</h2><table><tr><th>No</th><th>Event</th><th>When</th><th>Status</th></tr>${regs || "<tr><td colspan=4>None.</td></tr>"}</table>`;
}
