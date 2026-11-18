import { CITY_LIST, FIRST_NAMES, LAST_NAMES, word } from "../../acme-v1/names.js";
import { type Rng, int, pick, shuffle, substream } from "../../prng.js";
import { addDays } from "../../stays.js";
import { eventDraftProblem, eventGuestList, eventMinutes, eventRegisterProblem, eventTimeOf, eventTimeProblem, type EventDraft, type EventRegistrant } from "./rules.js";
import { EVENT_EQUIPMENT, type EventOffice, type EventPerson, type EventRegistration, type EventRoom, type EventRows, type OfficeEvent } from "./types.js";

/**
 * The office events site's rows: an office in each of the six cities with 4–6
 * meeting rooms, a staff directory, events between March and June 2027, and
 * registrations for the open ones. Drawn from a stream of its own
 * (`substream(seed, "events")`), so adding the site moved no other site's row.
 *
 * Some state is there on purpose: a few rooms are booked from opening to
 * closing on one day, the earliest session of every training course at every
 * office is full, some other open events are full, some events and
 * registrations are cancelled, and most people hold several registrations.
 */
export const EVENT_SIZES = { roomsPerOffice: [4, 6], people: 36, visitors: 14, events: 70, courses: 4, sessionsPerOffice: 3, solidDays: 8 } as const;

/** Seeded events fall in this span, so the rest of 2027 is free in every room. */
export const EVENT_BUSY = { from: "2027-03-01", days: 122 } as const;
const CAPACITIES = [4, 6, 8, 10, 12, 16, 20, 30];
const EQUIPMENT_ODDS: Record<(typeof EVENT_EQUIPMENT)[number], number> = { projector: 0.55, "video conferencing": 0.5, whiteboard: 0.65 };
const TEAMS = ["Finance", "Sales", "Engineering", "Operations", "Legal", "People", "Design", "Support"] as const;
const TOPICS = ["Budget", "Roadmap", "Hiring", "Vendor", "Release", "Pricing", "Inventory", "Logistics", "Quality", "Customer"] as const;
const KINDS = ["review", "planning", "sync", "workshop", "briefing", "retrospective", "check-in", "demo"] as const;
const PURPOSES = ["Agree the next steps and who owns them.", "Go through the figures for the quarter.", "Collect questions before the deadline.", "Share progress and blockers.", "Decide on the open proposals.", "Walk through the changes and their dates."] as const;
const COURSES = ["First-aid course", "Fire warden training", "Data privacy basics", "Expense tool walkthrough", "Presentation skills", "Negotiation basics"] as const;
const WEEKDAYS_ONLY = ["mon", "tue", "wed", "thu", "fri"] as const;

const stamp = (rng: Rng) => new Date(Date.UTC(2027, 0, 2 + int(rng, 0, 50), int(rng, 7, 21), int(rng, 0, 59))).toISOString();

function makeOffices(rng: Rng): EventOffice[] {
  return CITY_LIST.map((city) => ({
    code: `OF-${city.slice(0, 3).toUpperCase()}`,
    name: `${city} office`,
    city,
    address: `${int(rng, 2, 180)} ${word(rng)} Street, ${city}`,
    opensAt: pick(rng, ["07:30", "08:00", "08:30", "09:00"]),
    closesAt: pick(rng, ["17:30", "18:00", "18:30", "19:00", "20:00"]),
    openDays: rng() < 0.3 ? [...WEEKDAYS_ONLY, "sat"] : [...WEEKDAYS_ONLY],
  }));
}

/** Capacities differ within an office, so "the larger of two rooms" is never a tie. */
function makeRooms(rng: Rng, offices: EventOffice[]): EventRoom[] {
  const names = new Set<string>();
  return offices.flatMap((o) => {
    const caps = shuffle(rng, CAPACITIES).slice(0, int(rng, EVENT_SIZES.roomsPerOffice[0], EVENT_SIZES.roomsPerOffice[1])).sort((a, b) => a - b);
    return caps.map((capacity, i) => {
      let name = "";
      do name = `${word(rng, 2)} room`;
      while (names.has(name));
      names.add(name);
      return {
        code: `${o.code.slice(3)}-R${i + 1}`,
        officeCode: o.code,
        name,
        floor: int(rng, 0, 4),
        capacity,
        equipment: EVENT_EQUIPMENT.filter((e) => rng() < EQUIPMENT_ODDS[e]),
        accessible: rng() < 0.6,
      };
    });
  });
}

function makePeople(rng: Rng, offices: EventOffice[]): { people: EventPerson[]; visitors: EventRegistrant[] } {
  const names = shuffle(rng, FIRST_NAMES.flatMap((f) => LAST_NAMES.map((l) => [f, l] as const)));
  const people = names.slice(0, EVENT_SIZES.people).map(([f, l], i) => ({
    email: `${f}.${l}@staff.example`.toLowerCase(),
    name: `${f} ${l}`,
    officeCode: (offices[i % offices.length] as EventOffice).code,
    team: pick(rng, TEAMS),
  }));
  const visitors = names.slice(EVENT_SIZES.people, EVENT_SIZES.people + EVENT_SIZES.visitors).map(([f, l]) => ({ name: `${f} ${l}`, email: `${f}.${l}@visitor.example`.toLowerCase() }));
  return { people, visitors };
}

export function eventRows(seed: number): EventRows {
  const rng = substream(seed, "events");
  const offices = makeOffices(rng);
  const rooms = makeRooms(rng, offices);
  const { people, visitors } = makePeople(rng, offices);
  const rows: EventRows = { offices, rooms, people, events: [], registrations: [] };
  const officeOf = new Map(offices.map((o) => [o.code, o]));
  const staffOf = (officeCode: string) => people.filter((p) => p.officeCode === officeCode);
  const day = () => addDays(EVENT_BUSY.from, int(rng, 0, EVENT_BUSY.days - 1));

  /** Adds the event when the rules take it; returns it, or null when they refuse (a taken room, a closed day). */
  const add = (room: EventRoom, d: Omit<EventDraft, "roomCode">, status: OfficeEvent["status"] = "scheduled"): OfficeEvent | null => {
    const draft = { ...d, roomCode: room.code };
    if (eventDraftProblem(rows, draft)) return null;
    const event: OfficeEvent = {
      code: `EV-${1001 + rows.events.length}`,
      title: draft.title,
      description: draft.description,
      date: draft.date,
      startTime: draft.startTime,
      endTime: draft.endTime,
      officeCode: room.officeCode,
      roomCode: room.code,
      organiserEmail: draft.organiserEmail,
      guestEmails: eventGuestList(draft.guestEmails, draft.organiserEmail),
      registration: draft.registration,
      places: draft.places,
      status,
      createdAt: stamp(rng),
    };
    rows.events.push(event);
    return event;
  };
  const guestsFor = (room: EventRoom, organiser: EventPerson, most: number) => {
    const guests = shuffle(rng, people.filter((p) => p.email !== organiser.email)).slice(0, int(rng, 0, Math.min(most, room.capacity - 1))).map((p) => p.email);
    if (guests.length < room.capacity - 1 && rng() < 0.15) guests.push(`${word(rng, 2).toLowerCase()}@partner.example`);
    return guests;
  };
  const slotIn = (office: EventOffice, minutes: number) => {
    const open = eventMinutes(office.opensAt);
    const start = open + 30 * int(rng, 0, Math.floor((eventMinutes(office.closesAt) - open - minutes) / 30));
    return { startTime: eventTimeOf(start), endTime: eventTimeOf(start + minutes) };
  };

  // Meetings: a room, a day, a slot in the office's hours; some open to registration, a few cancelled.
  for (let i = 0; i < EVENT_SIZES.events; i++) {
    const room = pick(rng, rooms);
    const office = officeOf.get(room.officeCode) as EventOffice;
    const organiser = rng() < 0.8 ? pick(rng, staffOf(office.code)) : pick(rng, people);
    const guestEmails = guestsFor(room, organiser, 6);
    const free = room.capacity - 1 - guestEmails.length;
    const open = free >= 2 && rng() < 0.35;
    const title = `${pick(rng, TOPICS)} ${pick(rng, KINDS)}`;
    add(
      room,
      { title, description: pick(rng, PURPOSES), date: day(), ...slotIn(office, pick(rng, [30, 45, 60, 90, 120])), organiserEmail: organiser.email, guestEmails, registration: open ? "open" : "invite-only", places: open ? int(rng, 2, Math.min(free, 8)) : null },
      rng() < 0.08 ? "cancelled" : "scheduled",
    );
  }

  // Courses: one title, three open sessions at each of two or three offices. The earliest at each office fills up below.
  const earliest = new Set<string>();
  for (const title of shuffle(rng, COURSES).slice(0, EVENT_SIZES.courses)) {
    const trainer = pick(rng, people);
    for (const office of shuffle(rng, offices).slice(0, int(rng, 2, 3))) {
      const sessions: OfficeEvent[] = [];
      for (let tries = 0; sessions.length < EVENT_SIZES.sessionsPerOffice && tries < 40; tries++) {
        const places = int(rng, 3, 6);
        const fits = rooms.filter((r) => r.officeCode === office.code && r.capacity >= places + 1);
        if (fits.length === 0) break;
        const room = pick(rng, fits);
        const made = add(room, { title, description: `${title}: one of several sessions, register for one.`, date: day(), ...slotIn(office, pick(rng, [60, 90, 120])), organiserEmail: trainer.email, guestEmails: [], registration: "open", places });
        if (made) sessions.push(made);
      }
      const first = [...sessions].sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime))[0];
      if (first) earliest.add(first.code);
    }
  }

  // Booked solid on purpose: a room taken by back-to-back meetings from opening to closing on one day.
  for (let i = 0; i < EVENT_SIZES.solidDays; i++) {
    const room = pick(rng, rooms);
    const office = officeOf.get(room.officeCode) as EventOffice;
    let date = day();
    while (eventTimeProblem(office, { date, startTime: office.opensAt, endTime: eventTimeOf(eventMinutes(office.opensAt) + 60) })) date = addDays(date, 1);
    const close = eventMinutes(office.closesAt);
    for (let t = eventMinutes(office.opensAt); t < close; ) {
      const held = rows.events.filter((e) => e.roomCode === room.code && e.date === date && e.status === "scheduled");
      const over = held.find((e) => eventMinutes(e.startTime) <= t && t < eventMinutes(e.endTime));
      if (over) {
        t = eventMinutes(over.endTime);
        continue;
      }
      const next = Math.min(close, ...held.map((e) => eventMinutes(e.startTime)).filter((s) => s > t));
      const length = Math.min(pick(rng, [60, 90, 120]), next - t);
      const organiser = pick(rng, staffOf(office.code));
      const made = add(room, { title: `${pick(rng, TOPICS)} ${pick(rng, KINDS)}`, description: pick(rng, PURPOSES), date, startTime: eventTimeOf(t), endTime: eventTimeOf(t + length), organiserEmail: organiser.email, guestEmails: guestsFor(room, organiser, 4), registration: "invite-only", places: null });
      if (!made) break;
      t += length;
    }
  }

  // Registrations, held to the same rule as the site's: places left, no second registration, no overlap.
  const registrants: EventRegistrant[] = [...people.map((p) => ({ name: p.name, email: p.email })), ...visitors];
  const register = (event: OfficeEvent, who: EventRegistrant, status: EventRegistration["status"]) =>
    rows.registrations.push({ regNo: `RG-${3001 + rows.registrations.length}`, eventCode: event.code, name: who.name, email: who.email, status, createdAt: stamp(rng) });
  for (const event of rows.events.filter((e) => e.status === "scheduled" && e.registration === "open")) {
    const places = event.places as number;
    const target = earliest.has(event.code) || rng() < 0.2 ? places : int(rng, 0, places - 1);
    let taken = 0;
    for (const who of shuffle(rng, registrants)) {
      if (taken >= target) break;
      if (eventRegisterProblem(rows, event, who)) continue;
      // A cancelled registration now and then: it holds no place.
      if (rng() < 0.1) register(event, who, "cancelled");
      else {
        register(event, who, "registered");
        taken++;
      }
    }
  }
  return rows;
}
