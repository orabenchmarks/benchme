import { isDate } from "../../stays.js";
import { EVENT_WEEKDAYS, type EventOffice, type EventRegistrationMode, type EventRoom, type EventRows, type EventWeekday, type OfficeEvent } from "./types.js";

/**
 * The office events site's rules, as pure functions over rows. apps/events
 * enforces them inside every write's transaction and answers every room
 * search with them, and the intent corpus derives its answer keys with them,
 * so the site and the keys cannot disagree about what is free, what fits or
 * who can register.
 */

/** The dates events can be held on. Fixed, not "from today", so a seed means the same calendar forever. */
export const EVENT_WINDOW = { first: "2027-01-01", last: "2027-12-31" } as const;
/** Start and end times fall on the quarter hour. */
export const EVENT_STEP_MINUTES = 15;
export const EVENT_MAX_MINUTES = 8 * 60;

export type EventProblem = { code: string; message: string };
export type EventDraft = {
  title: string;
  description: string;
  date: string;
  startTime: string;
  endTime: string;
  roomCode: string;
  organiserEmail: string;
  guestEmails: readonly string[];
  registration: EventRegistrationMode;
  places: number | null;
};
export type EventRoomQuery = { officeCode: string; date: string; startTime: string; endTime: string; people: number; equipment?: readonly string[]; accessible?: boolean };
/** A room that is free for the whole time asked and fits the query. */
export type EventFreeRoom = { roomCode: string; roomName: string; officeCode: string; floor: number; capacity: number; equipment: string[]; accessible: boolean };
export type EventRegistrant = { name: string; email: string };
type Slot = { date: string; startTime: string; endTime: string };

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[A-Za-z]{2,}$/;
const pad = (n: number) => String(n).padStart(2, "0");

/** "HH:MM", 24-hour, on the quarter hour. */
export function isEventTime(s: string): boolean {
  return TIME.test(s) && Number(s.slice(3, 5)) % EVENT_STEP_MINUTES === 0;
}
export function isEventEmail(s: string): boolean {
  return EMAIL.test(s.trim());
}
export const eventMinutes = (t: string): number => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
export const eventTimeOf = (minutes: number): string => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
export function eventWeekday(date: string): EventWeekday {
  return EVENT_WEEKDAYS[(new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7] as EventWeekday;
}
/** Two slots overlap when they share a date and some minute: back to back (one ends as the other starts) is not an overlap. */
export function eventsOverlap(a: Slot, b: Slot): boolean {
  return a.date === b.date && a.startTime < b.endTime && b.startTime < a.endTime;
}

/** A guest list as the site stores it: trimmed, lowercased, each email once, the organiser left out, sorted. */
export function eventGuestList(emails: readonly string[], organiserEmail: string): string[] {
  const organiser = organiserEmail.trim().toLowerCase();
  return [...new Set(emails.map((e) => e.trim().toLowerCase()).filter((e) => e && e !== organiser))].sort();
}

/** An office by its code or its city, case-insensitive. */
export function eventOfficeOf<O extends EventOffice>(offices: readonly O[], key: string): O | undefined {
  const k = key.trim().toLowerCase();
  return offices.find((o) => o.code.toLowerCase() === k || o.city.toLowerCase() === k);
}

/** The scheduled event holding the room for any part of the slot, other than `exceptCode`. Cancelled events hold nothing. */
export function eventRoomClash(rows: Pick<EventRows, "events">, roomCode: string, slot: Slot, exceptCode?: string): OfficeEvent | null {
  return rows.events.find((e) => e.roomCode === roomCode && e.status === "scheduled" && e.code !== exceptCode && eventsOverlap(e, slot)) ?? null;
}

export function eventRegisteredCount(rows: Pick<EventRows, "registrations">, eventCode: string): number {
  return rows.registrations.filter((r) => r.eventCode === eventCode && r.status === "registered").length;
}

/** Places still open to registration: the place limit less the active registrations; null for an invitation-only event. */
export function eventPlacesLeft(rows: Pick<EventRows, "registrations">, event: OfficeEvent): number | null {
  return event.places === null ? null : Math.max(0, event.places - eventRegisteredCount(rows, event.code));
}

/** Why an office cannot hold anything at that time: the date, the window, the times, the length, the open days, the hours. */
export function eventTimeProblem(office: EventOffice, slot: Slot): EventProblem | null {
  if (!isDate(slot.date)) return { code: "BAD_DATE", message: `${slot.date} is not a date (YYYY-MM-DD)` };
  if (slot.date < EVENT_WINDOW.first || slot.date > EVENT_WINDOW.last) return { code: "OUTSIDE_WINDOW", message: `events can be held from ${EVENT_WINDOW.first} to ${EVENT_WINDOW.last}` };
  if (!isEventTime(slot.startTime) || !isEventTime(slot.endTime)) return { code: "BAD_TIME", message: "start and end times are HH:MM (24-hour) on the quarter hour" };
  if (slot.endTime <= slot.startTime) return { code: "END_BEFORE_START", message: `an event must end after it starts (${slot.startTime} to ${slot.endTime})` };
  if (eventMinutes(slot.endTime) - eventMinutes(slot.startTime) > EVENT_MAX_MINUTES) return { code: "TOO_LONG", message: `an event lasts at most ${EVENT_MAX_MINUTES / 60} hours` };
  if (!office.openDays.includes(eventWeekday(slot.date))) return { code: "OFFICE_CLOSED", message: `the ${office.name} is closed on ${slot.date} (open ${office.openDays.join(", ")})` };
  if (slot.startTime < office.opensAt || slot.endTime > office.closesAt) return { code: "OUTSIDE_HOURS", message: `the ${office.name} is open from ${office.opensAt} to ${office.closesAt}` };
  return null;
}

/** Everyone the room must hold: the organiser, each invited guest, and every place open to registration. */
export function eventHeadcount(draft: Pick<EventDraft, "guestEmails" | "organiserEmail" | "places">): number {
  return 1 + eventGuestList(draft.guestEmails, draft.organiserEmail).length + (draft.places ?? 0);
}

/**
 * The rule every new or changed event is held to: a title, a room, a time the
 * office is open, a directory organiser, valid guest emails, places only on an
 * open event, a room that holds everyone, and a room free for the whole time.
 */
export function eventDraftProblem(rows: EventRows, draft: EventDraft, exceptCode?: string): EventProblem | null {
  if (!draft.title.trim()) return { code: "NO_TITLE", message: "an event needs a title" };
  const room = rows.rooms.find((r) => r.code === draft.roomCode);
  if (!room) return { code: "UNKNOWN_ROOM", message: `no room ${draft.roomCode}` };
  const office = rows.offices.find((o) => o.code === room.officeCode) as EventOffice;
  const slot = { date: draft.date, startTime: draft.startTime, endTime: draft.endTime };
  const time = eventTimeProblem(office, slot);
  if (time) return time;
  const organiser = draft.organiserEmail.trim().toLowerCase();
  if (!rows.people.some((p) => p.email === organiser)) return { code: "UNKNOWN_ORGANISER", message: `${draft.organiserEmail} is not in the staff directory; only staff can organise an event` };
  const bad = draft.guestEmails.find((e) => !isEventEmail(e));
  if (bad !== undefined) return { code: "BAD_GUEST_EMAIL", message: `"${bad}" is not an email address` };
  if (draft.registration === "open" && (draft.places === null || !Number.isInteger(draft.places) || draft.places < 1)) return { code: "BAD_PLACES", message: "an event open to registration needs at least one place" };
  if (draft.registration === "invite-only" && draft.places !== null) return { code: "BAD_PLACES", message: "an invitation-only event has no places to register for" };
  const people = eventHeadcount(draft);
  if (people > room.capacity) return { code: "OVER_CAPACITY", message: `${room.name} (${room.code}) holds ${room.capacity} people; this event needs ${people} (the organiser, the guests and the places)` };
  const clash = eventRoomClash(rows, room.code, slot, exceptCode);
  if (clash) return { code: "ROOM_TAKEN", message: `${room.name} (${room.code}) is taken from ${clash.startTime} to ${clash.endTime} on ${clash.date} by ${clash.code}` };
  return null;
}

/** Only the organiser changes an event, a cancelled one never, and never down to fewer places than people registered. */
export function eventChangeProblem(rows: EventRows, event: OfficeEvent, actingEmail: string, next: EventDraft): EventProblem | null {
  if (event.status === "cancelled") return { code: "EVENT_CANCELLED", message: `${event.code} is cancelled` };
  if (actingEmail.trim().toLowerCase() !== event.organiserEmail) return { code: "NOT_ORGANISER", message: `only the organiser of ${event.code} can change it` };
  const registered = eventRegisteredCount(rows, event.code);
  if (registered > 0 && (next.registration === "invite-only" || (next.places ?? 0) < registered)) {
    return { code: "PLACES_BELOW_REGISTERED", message: `${registered} people are registered for ${event.code}; it needs at least that many places` };
  }
  return eventDraftProblem(rows, next, event.code);
}

export function eventCancelProblem(event: OfficeEvent, actingEmail: string): EventProblem | null {
  if (event.status === "cancelled") return { code: "ALREADY_CANCELLED", message: `${event.code} is already cancelled` };
  if (actingEmail.trim().toLowerCase() !== event.organiserEmail) return { code: "NOT_ORGANISER", message: `only the organiser of ${event.code} can cancel it` };
  return null;
}

/**
 * Who can register for an event: it is scheduled and open to registration, the
 * person is not registered for it already, a place is left, and they are not
 * registered for another scheduled event at an overlapping time.
 */
export function eventRegisterProblem(rows: EventRows, event: OfficeEvent, who: EventRegistrant): EventProblem | null {
  if (!who.name.trim()) return { code: "NO_NAME", message: "a registration needs the person's name" };
  if (!isEventEmail(who.email)) return { code: "BAD_EMAIL", message: `"${who.email}" is not an email address` };
  if (event.status === "cancelled") return { code: "EVENT_CANCELLED", message: `${event.code} is cancelled` };
  if (event.registration === "invite-only") return { code: "INVITE_ONLY", message: `${event.code} is by invitation only` };
  const email = who.email.trim().toLowerCase();
  const mine = rows.registrations.filter((r) => r.email === email && r.status === "registered");
  if (mine.some((r) => r.eventCode === event.code)) return { code: "ALREADY_REGISTERED", message: `${email} is already registered for ${event.code}` };
  if ((eventPlacesLeft(rows, event) ?? 0) < 1) return { code: "FULL", message: `${event.code} is full: all ${event.places} places are taken` };
  const byCode = new Map(rows.events.map((e) => [e.code, e]));
  for (const r of mine) {
    const other = byCode.get(r.eventCode);
    if (other && other.status === "scheduled" && eventsOverlap(other, event)) {
      return { code: "OVERLAP", message: `${email} is registered for ${other.code} "${other.title}", ${other.date} ${other.startTime}–${other.endTime}, which overlaps` };
    }
  }
  return null;
}

/** Rooms in the office that hold the people, have every piece of equipment asked, are step-free when asked, and are free the whole time — smallest first. */
export function eventFreeRooms(rows: EventRows, q: EventRoomQuery): EventFreeRoom[] {
  const office = rows.offices.find((o) => o.code === q.officeCode);
  const slot = { date: q.date, startTime: q.startTime, endTime: q.endTime };
  if (!office || eventTimeProblem(office, slot)) return [];
  const wanted = (q.equipment ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean);
  return rows.rooms
    .filter((r: EventRoom) => r.officeCode === office.code && r.capacity >= q.people && wanted.every((e) => (r.equipment as string[]).includes(e)) && (!q.accessible || r.accessible))
    .filter((r) => !eventRoomClash(rows, r.code, slot))
    .sort((x, y) => x.capacity - y.capacity || x.code.localeCompare(y.code))
    .map((r) => ({ roomCode: r.code, roomName: r.name, officeCode: r.officeCode, floor: r.floor, capacity: r.capacity, equipment: [...r.equipment], accessible: r.accessible }));
}
