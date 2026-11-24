import { describe, expect, it } from "vitest";
import { webmcpV1 } from "../../webmcp-v1/index.js";
import { CITY_LIST } from "../../acme-v1/names.js";
import { EVENT_SIZES, eventRows } from "./generate.js";
import {
  eventCancelProblem,
  eventChangeProblem,
  eventDraftProblem,
  eventFreeRooms,
  eventGuestList,
  eventMinutes,
  eventPlacesLeft,
  eventRegisterProblem,
  eventsOverlap,
  eventWeekday,
  type EventDraft,
} from "./rules.js";
import type { EventOffice, EventRegistration, EventRoom, EventRows, OfficeEvent } from "./types.js";

const draftOf = (e: OfficeEvent): EventDraft => ({ ...e });

describe("webmcp-v1 events", () => {
  const rows = eventRows(4242);

  it("is byte-identical for the same seed, and the same rows webmcpV1.generate carries", () => {
    expect(JSON.stringify(eventRows(4242))).toBe(JSON.stringify(rows));
    expect(JSON.stringify(eventRows(4243))).not.toBe(JSON.stringify(rows));
    expect(webmcpV1.generate(4242).events).toEqual(rows);
  });

  it("has an office in every city, rooms that belong to them, unique keys, and directory organisers", () => {
    expect(rows.offices.map((o) => o.city)).toEqual([...CITY_LIST]);
    const offices = new Set(rows.offices.map((o) => o.code));
    for (const o of rows.offices) {
      const caps = rows.rooms.filter((r) => r.officeCode === o.code).map((r) => r.capacity);
      expect(caps.length).toBeGreaterThanOrEqual(EVENT_SIZES.roomsPerOffice[0]);
      expect(caps.length).toBeLessThanOrEqual(EVENT_SIZES.roomsPerOffice[1]);
      expect(new Set(caps).size).toBe(caps.length);
    }
    for (const r of rows.rooms) expect(offices.has(r.officeCode)).toBe(true);
    for (const list of [rows.rooms.map((r) => r.code), rows.rooms.map((r) => r.name), rows.people.map((p) => p.email), rows.events.map((e) => e.code), rows.registrations.map((r) => r.regNo)]) {
      expect(new Set(list).size).toBe(list.length);
    }
    const room = new Map(rows.rooms.map((r) => [r.code, r]));
    const staff = new Set(rows.people.map((p) => p.email));
    for (const e of rows.events) {
      expect(room.get(e.roomCode)?.officeCode).toBe(e.officeCode);
      expect(staff.has(e.organiserEmail)).toBe(true);
      expect(e.guestEmails).toEqual(eventGuestList(e.guestEmails, e.organiserEmail));
    }
    const events = new Set(rows.events.map((e) => e.code));
    for (const r of rows.registrations) expect(events.has(r.eventCode)).toBe(true);
  });

  it("holds every seeded event and registration to the site's rules", () => {
    for (const e of rows.events) {
      // A cancelled event holds nothing, so a later event may have taken its room.
      const against: EventRows = e.status === "scheduled" ? rows : { ...rows, events: [] };
      expect([e.code, eventDraftProblem(against, draftOf(e), e.code)]).toEqual([e.code, null]);
    }
    const event = new Map(rows.events.map((e) => [e.code, e]));
    const live = rows.registrations.filter((r) => r.status === "registered");
    for (const r of rows.registrations) {
      const e = event.get(r.eventCode) as OfficeEvent;
      expect([r.regNo, e.status, e.registration]).toEqual([r.regNo, "scheduled", "open"]);
    }
    for (const e of rows.events.filter((x) => x.registration === "open")) {
      const taken = live.filter((r) => r.eventCode === e.code);
      expect(taken.length).toBeLessThanOrEqual(e.places as number);
      expect(new Set(taken.map((r) => r.email)).size).toBe(taken.length);
    }
    const byPerson = new Map<string, EventRegistration[]>();
    for (const r of live) byPerson.set(r.email, [...(byPerson.get(r.email) ?? []), r]);
    for (const mine of byPerson.values()) {
      for (const [i, a] of mine.entries()) for (const b of mine.slice(i + 1)) expect(eventsOverlap(event.get(a.eventCode) as OfficeEvent, event.get(b.eventCode) as OfficeEvent)).toBe(false);
    }
    expect([...byPerson.values()].filter((m) => m.length >= 3).length).toBeGreaterThan(5);
    expect(rows.events.some((e) => e.status === "cancelled")).toBe(true);
    expect(rows.registrations.some((r) => r.status === "cancelled")).toBe(true);
  });

  it("books some rooms solid for a day, and fills the earliest session of every course at every office, on purpose", () => {
    const office = new Map(rows.offices.map((o) => [o.code, o]));
    let solid = 0;
    for (const r of rows.rooms) {
      const o = office.get(r.officeCode) as EventOffice;
      const days = new Set(rows.events.filter((e) => e.roomCode === r.code && e.status === "scheduled").map((e) => e.date));
      for (const date of days) {
        const held = rows.events.filter((e) => e.roomCode === r.code && e.date === date && e.status === "scheduled");
        let free = 0;
        for (let t = eventMinutes(o.opensAt); t < eventMinutes(o.closesAt); t += 15) if (!held.some((e) => eventMinutes(e.startTime) <= t && t < eventMinutes(e.endTime))) free++;
        if (free === 0) solid++;
      }
    }
    expect(solid).toBeGreaterThanOrEqual(EVENT_SIZES.solidDays / 2);
    const courses = new Map<string, OfficeEvent[]>();
    for (const e of rows.events.filter((x) => x.description.includes("one of several sessions"))) courses.set(`${e.title}@${e.officeCode}`, [...(courses.get(`${e.title}@${e.officeCode}`) ?? []), e]);
    expect(courses.size).toBeGreaterThanOrEqual(EVENT_SIZES.courses * 2);
    for (const sessions of courses.values()) {
      const first = [...sessions].sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime))[0] as OfficeEvent;
      expect([first.code, eventPlacesLeft(rows, first)]).toEqual([first.code, 0]);
    }
    const full = rows.events.filter((e) => e.registration === "open" && eventPlacesLeft(rows, e) === 0);
    expect(full.length).toBeGreaterThan(courses.size);
  });
});

describe("events rules", () => {
  const office: EventOffice = { code: "OF-A", name: "A office", city: "Velmora", address: "", opensAt: "08:00", closesAt: "18:00", openDays: ["mon", "tue", "wed", "thu", "fri"] };
  const small: EventRoom = { code: "A-R1", officeCode: "OF-A", name: "Small room", floor: 1, capacity: 4, equipment: ["whiteboard"], accessible: false };
  const big: EventRoom = { code: "A-R2", officeCode: "OF-A", name: "Big room", floor: 0, capacity: 10, equipment: ["projector", "whiteboard"], accessible: true };
  const people = [
    { email: "org@staff.example", name: "Org", officeCode: "OF-A", team: "Sales" },
    { email: "other@staff.example", name: "Other", officeCode: "OF-A", team: "Sales" },
  ];
  // 2027-04-12 is a Monday.
  const held: OfficeEvent = {
    code: "EV-1", title: "Held", description: "", date: "2027-04-12", startTime: "10:00", endTime: "11:00", officeCode: "OF-A", roomCode: "A-R2", organiserEmail: "org@staff.example",
    guestEmails: [], registration: "open", places: 2, status: "scheduled", createdAt: "",
  };
  const reg = (eventCode: string, email: string, status: EventRegistration["status"] = "registered"): EventRegistration => ({ regNo: `RG-${eventCode}-${email}`, eventCode, name: "N", email, status, createdAt: "" });
  const rows: EventRows = { offices: [office], rooms: [small, big], people, events: [held], registrations: [] };
  const draft: EventDraft = { title: "Plan", description: "d", date: "2027-04-12", startTime: "11:00", endTime: "12:30", roomCode: "A-R2", organiserEmail: "Org@staff.example", guestEmails: ["a@x.example", "b@x.example"], registration: "invite-only", places: null };

  it("knows the weekday, normalises a guest list, and treats back to back as no overlap", () => {
    expect(eventWeekday("2027-04-12")).toBe("mon");
    expect(eventWeekday("2027-04-18")).toBe("sun");
    expect(eventGuestList([" B@x.example", "a@x.example", "b@x.example", "org@staff.example"], "ORG@staff.example")).toEqual(["a@x.example", "b@x.example"]);
    expect(eventsOverlap(held, { date: "2027-04-12", startTime: "11:00", endTime: "12:00" })).toBe(false);
    expect(eventsOverlap(held, { date: "2027-04-12", startTime: "10:45", endTime: "12:00" })).toBe(true);
    expect(eventsOverlap(held, { date: "2027-04-13", startTime: "10:00", endTime: "11:00" })).toBe(false);
  });

  it("refuses each event rule on its own", () => {
    expect(eventDraftProblem(rows, draft)).toBeNull();
    const code = (d: Partial<EventDraft>, r: EventRows = rows) => eventDraftProblem(r, { ...draft, ...d })?.code;
    expect(code({ title: " " })).toBe("NO_TITLE");
    expect(code({ roomCode: "A-R9" })).toBe("UNKNOWN_ROOM");
    expect(code({ date: "2027-02-30" })).toBe("BAD_DATE");
    expect(code({ date: "2028-01-03" })).toBe("OUTSIDE_WINDOW");
    expect(code({ startTime: "11:10" })).toBe("BAD_TIME");
    expect(code({ endTime: "25:00" })).toBe("BAD_TIME");
    expect(code({ startTime: "12:30", endTime: "12:30" })).toBe("END_BEFORE_START");
    expect(code({ startTime: "08:00", endTime: "16:15" })).toBe("TOO_LONG");
    expect(code({ date: "2027-04-17" })).toBe("OFFICE_CLOSED");
    expect(code({ startTime: "07:45" })).toBe("OUTSIDE_HOURS");
    expect(code({ endTime: "18:15" })).toBe("OUTSIDE_HOURS");
    expect(code({ organiserEmail: "visitor@x.example" })).toBe("UNKNOWN_ORGANISER");
    expect(code({ guestEmails: ["a@x.example", "not-an-email"] })).toBe("BAD_GUEST_EMAIL");
    expect(code({ registration: "open", places: null })).toBe("BAD_PLACES");
    expect(code({ registration: "invite-only", places: 3 })).toBe("BAD_PLACES");
    expect(code({ roomCode: "A-R1", guestEmails: ["a@x.example", "b@x.example", "c@x.example", "d@x.example"] })).toBe("OVER_CAPACITY");
    expect(code({ roomCode: "A-R1", guestEmails: ["a@x.example"], registration: "open", places: 3 })).toBe("OVER_CAPACITY");
    expect(code({ roomCode: "A-R1", guestEmails: ["a@x.example", "A@x.example", "org@staff.example"], registration: "open", places: 2 })).toBeUndefined();
    expect(code({ startTime: "10:30" })).toBe("ROOM_TAKEN");
    expect(code({ startTime: "09:00", endTime: "10:15" })).toBe("ROOM_TAKEN");
    expect(code({ startTime: "09:00", endTime: "10:00" })).toBeUndefined();
    expect(code({ startTime: "10:30" }, { ...rows, events: [{ ...held, status: "cancelled" }] })).toBeUndefined();
    expect(eventDraftProblem(rows, { ...draft, startTime: "10:30" }, "EV-1")).toBeNull();
  });

  it("changes or cancels only in the organiser's name, never a cancelled event, never below the registrations", () => {
    const withRegs = { ...rows, registrations: [reg("EV-1", "a@x.example"), reg("EV-1", "b@x.example")] };
    const next = { ...draftOf(held), startTime: "10:30", endTime: "11:30" };
    expect(eventChangeProblem(withRegs, held, "ORG@staff.example", next)).toBeNull();
    expect(eventChangeProblem(withRegs, { ...held, status: "cancelled" }, "org@staff.example", next)?.code).toBe("EVENT_CANCELLED");
    expect(eventChangeProblem(withRegs, held, "other@staff.example", next)?.code).toBe("NOT_ORGANISER");
    expect(eventChangeProblem(withRegs, held, "org@staff.example", { ...next, places: 1 })?.code).toBe("PLACES_BELOW_REGISTERED");
    expect(eventChangeProblem(withRegs, held, "org@staff.example", { ...next, registration: "invite-only", places: null })?.code).toBe("PLACES_BELOW_REGISTERED");
    expect(eventChangeProblem(withRegs, held, "org@staff.example", { ...next, roomCode: "A-R1", places: 4 })?.code).toBe("OVER_CAPACITY");
    expect(eventCancelProblem(held, "org@staff.example")).toBeNull();
    expect(eventCancelProblem(held, "other@staff.example")?.code).toBe("NOT_ORGANISER");
    expect(eventCancelProblem({ ...held, status: "cancelled" }, "org@staff.example")?.code).toBe("ALREADY_CANCELLED");
  });

  it("refuses each registration rule on its own", () => {
    const later: OfficeEvent = { ...held, code: "EV-2", startTime: "10:30", endTime: "11:30", roomCode: "A-R1", places: 3 };
    const r: EventRows = { ...rows, events: [held, later], registrations: [reg("EV-1", "a@x.example"), reg("EV-1", "c@x.example", "cancelled")] };
    const who = { name: "Bea", email: "B@x.example" };
    expect(eventRegisterProblem(r, held, who)).toBeNull();
    expect(eventPlacesLeft(r, held)).toBe(1);
    expect(eventRegisterProblem(r, held, { ...who, name: " " })?.code).toBe("NO_NAME");
    expect(eventRegisterProblem(r, held, { ...who, email: "bea" })?.code).toBe("BAD_EMAIL");
    expect(eventRegisterProblem(r, { ...held, status: "cancelled" }, who)?.code).toBe("EVENT_CANCELLED");
    expect(eventRegisterProblem(r, { ...held, registration: "invite-only", places: null }, who)?.code).toBe("INVITE_ONLY");
    expect(eventRegisterProblem(r, held, { ...who, email: "a@x.example" })?.code).toBe("ALREADY_REGISTERED");
    expect(eventRegisterProblem({ ...r, registrations: [...r.registrations, reg("EV-1", "d@x.example")] }, held, who)?.code).toBe("FULL");
    expect(eventRegisterProblem(r, later, { ...who, email: "a@x.example" })?.code).toBe("OVERLAP");
    expect(eventRegisterProblem(r, later, { ...who, email: "c@x.example" })).toBeNull();
    expect(eventRegisterProblem({ ...r, events: [{ ...held, status: "cancelled" }, later] }, later, { ...who, email: "a@x.example" })).toBeNull();
  });

  it("finds the free rooms that hold the people with the equipment, smallest first, only while the office is open", () => {
    const q = { officeCode: "OF-A", date: "2027-04-12", startTime: "11:00", endTime: "12:00", people: 3 };
    expect(eventFreeRooms(rows, q).map((x) => x.roomCode)).toEqual(["A-R1", "A-R2"]);
    expect(eventFreeRooms(rows, { ...q, people: 5 }).map((x) => x.roomCode)).toEqual(["A-R2"]);
    expect(eventFreeRooms(rows, { ...q, equipment: ["Projector"] }).map((x) => x.roomCode)).toEqual(["A-R2"]);
    expect(eventFreeRooms(rows, { ...q, accessible: true }).map((x) => x.roomCode)).toEqual(["A-R2"]);
    expect(eventFreeRooms(rows, { ...q, startTime: "10:30" }).map((x) => x.roomCode)).toEqual(["A-R1"]);
    expect(eventFreeRooms(rows, { ...q, date: "2027-04-17" })).toEqual([]);
    expect(eventFreeRooms(rows, { ...q, endTime: "18:30" })).toEqual([]);
    expect(eventFreeRooms(rows, { ...q, officeCode: "OF-Z" })).toEqual([]);
  });
});
