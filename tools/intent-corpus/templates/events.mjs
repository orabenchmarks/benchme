/**
 * Office events intent templates (apps/events, "Fennick Events"). Shaped on
 * the events eval suite in GoogleChromeLabs/webmcp-tools' webmcp-evals
 * (Apache-2.0): create an event for a date and time at an office, with a
 * description and invited guests. That suite grades the createEvent call an
 * agent makes; these grade the answer or the site's end state, so an agent may
 * use the pages, REST, MCP or WebMCP. See ./index.mjs for the contract.
 *
 * Six kinds: create an event exactly as asked (every field and the exact guest
 * set); the only room that is free and fits (with one that would fit but is
 * taken); no room fits, name the closest; register a person for the earliest
 * session of a course with places left at one office (the earliest there is
 * full on purpose); which session of a course has the most places left; and
 * cancel one of a person's registrations. The rules every key is derived with
 * are @benchme/scenarios' events rules, the same functions the site enforces.
 *
 * Claims: a new event changes which rooms are free on its day, so every task
 * that depends on, or changes, what is free claims `events:day:<office>:<date>`.
 * A registration changes an event's places, so every task that reads or
 * changes places claims `events:event:<code>` for each event involved (a
 * cancellation: the one event it frees a place in), and a task about one
 * person's registrations claims `events:person:<email>`.
 *
 * Expected calls: a new event's `create_event` with every field the task fixes
 * (the room, the date, the times, the organiser, the registration and its
 * places, the three guests in any order; the title and the description left
 * free, like any text a person dictates); a registration's
 * `register_for_event` of the session found, for the person's email (their
 * name left free); a cancellation's `cancel_registration`, which takes the
 * registration's number or the event and the email, so it declares the tool
 * alone. Only `list_events` lists the events, so the question of a course's
 * places declares it; a free room is found by `find_free_rooms` or by the rooms
 * and the events read in turn, so those questions declare none.
 */
import { addDays, eventFreeRooms, eventMinutes, eventPlacesLeft, eventRegisterProblem, eventTimeOf, eventWeekday, shuffle } from "../../../packages/scenarios/dist/index.js";
import { anyOrder, call, free } from "../calls.mjs";
import { int, pick } from "../kit.mjs";
import { R } from "../rubrics.mjs";

const APP = "events";
const PAGES_AND_TOOLS = ["pages", "tools"];
const EVENTS = "/api/v1/events";
const REGISTRATIONS = "/api/v1/registrations";
/** No seeded event is after June 2027: from September every room is free all day. */
const QUIET_FROM = "2027-09-06";
const QUIET_DAYS = 80;
const COURSE_MARK = "one of several sessions";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };
const TITLES = ["Supplier review", "Quarter close planning", "Launch rehearsal", "Hiring debrief", "Process walkthrough", "Budget sign-off", "Warehouse safety review", "Partner onboarding"];
const PURPOSES = ["go through the open supplier issues", "agree the plan for the fourth quarter", "rehearse the launch talk", "compare notes on the candidates", "walk through the new ordering process", "sign off the budget lines", "review the incident reports", "plan the first month with the new partner"];
const PARTNERS = ["ash.morrow@partner.example", "kit.daley@partner.example", "rue.selwyn@partner.example", "jem.okafor@partner.example", "noor.lindqvist@partner.example"];

const enc = encodeURIComponent;
const dateText = (iso) => `${DAYS[eventWeekday(iso)]} ${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
const clock = (t) => {
  const [h, m] = [Number(t.slice(0, 2)), t.slice(3, 5)];
  return `${h % 12 === 0 ? 12 : h % 12}${m === "00" ? "" : `:${m}`} ${h < 12 ? "AM" : "PM"}`;
};
const lengthText = (minutes) => (minutes % 60 === 0 ? `${minutes / 60} hour${minutes === 60 ? "" : "s"}` : `${minutes} minutes`);
const listText = (items) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);
const equipText = (eq) => listText(eq.map((e) => (e === "video conferencing" ? "video conferencing" : `a ${e}`)));
const dayClaim = (officeCode, date) => `events:day:${officeCode}:${date}`;
const freeRoomsPath = (q) =>
  `/api/v1/free-rooms?${new URLSearchParams({ office: q.officeCode, date: q.date, startTime: q.startTime, endTime: q.endTime, people: String(q.people), ...(q.equipment?.length ? { equipment: q.equipment.join(",") } : {}) })}`;
const byTime = (a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime) || a.code.localeCompare(b.code);

/** The rows indexed once per context (kit.mjs knows nothing of this site). */
const cache = new WeakMap();
function index(ctx) {
  if (!cache.has(ctx)) {
    const r = ctx.rows.events;
    cache.set(ctx, {
      r,
      office: new Map(r.offices.map((o) => [o.code, o])),
      room: new Map(r.rooms.map((x) => [x.code, x])),
      event: new Map(r.events.map((e) => [e.code, e])),
      staffOf: (officeCode) => r.people.filter((p) => p.officeCode === officeCode),
      liveRegsOf: (email) => r.registrations.filter((x) => x.email === email && x.status === "registered"),
    });
  }
  return cache.get(ctx);
}

/** Every course session, grouped by (title, office), earliest first: the scheduled ones only. */
function courses(ctx) {
  const x = index(ctx);
  const groups = new Map();
  for (const e of x.r.events.filter((v) => v.description.includes(COURSE_MARK) && v.status === "scheduled")) {
    const key = `${e.title}|${e.officeCode}`;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  return [...groups.values()].map((sessions) => ({ title: sessions[0].title, office: x.office.get(sessions[0].officeCode), sessions: sessions.sort(byTime) })).sort((a, b) => `${a.title}|${a.office.code}`.localeCompare(`${b.title}|${b.office.code}`));
}

/** Room searches built around a taken room: each scheduled seeded event's own room and time. */
function aroundTaken(ctx) {
  const x = index(ctx);
  return x.r.events.filter((e) => e.status === "scheduled").map((event) => ({ event, room: x.room.get(event.roomCode), office: x.office.get(event.officeCode) }));
}

/** Requirement sets the taken room meets: a headcount it holds and one or two pieces of its equipment. */
function requirementsOf(room, rng) {
  const subsets = room.equipment.flatMap((a, i) => [[a], ...room.equipment.slice(i + 1).map((b) => [a, b])]);
  const sizes = shuffle(rng, [...new Set([room.capacity, room.capacity - 1, room.capacity - 2, Math.ceil(room.capacity * 0.75)])].filter((n) => n >= 3));
  return shuffle(rng, subsets).flatMap((equipment) => sizes.map((people) => ({ people, equipment })));
}

/** Live sessions of a course at one office, earliest first (the REST list carries placesLeft). */
async function liveSessions(api, title, officeCode) {
  const all = await api.list(APP, `${EVENTS}?office=${enc(officeCode)}&q=${enc(title)}&status=scheduled&limit=200`);
  return all.filter((e) => e.title.toLowerCase() === title.toLowerCase()).sort(byTime);
}

export const eventsTemplates = [
  {
    key: "event-create",
    app: APP,
    oracle: "state",
    surfaces: PAGES_AND_TOOLS,
    count: 3,
    about:
      "Create an event exactly as asked, for a named organiser from the staff directory: a named room, a weekday from September 2027 (every room is free), a start time in 12-hour form and a length, a quoted title and description, invitation only or open with a number of places, and three guests (two colleagues and one partner email). One check finds the organiser's event on that date at that start time (exactly one) and holds its title, description, room, end time, registration mode, places and guest count; one check per guest holds that email in its guest list. The miss creates it without the last-named guest.",
    candidates: (ctx) => {
      const x = index(ctx);
      const days = Array.from({ length: QUIET_DAYS }, (_, i) => addDays(QUIET_FROM, i)).filter((d) => !["sat", "sun"].includes(eventWeekday(d)));
      return x.r.rooms.filter((room) => room.capacity >= 8).flatMap((room, i) => [0, 1, 2].map((j) => ({ room, office: x.office.get(room.officeCode), date: days[(i * 7 + j * 23) % days.length], open: j > 0 })));
    },
    claims: (s) => [dayClaim(s.office.code, s.date)],
    build({ room, office, date, open }, ctx, rng) {
      const x = index(ctx);
      const organiser = pick(rng, x.staffOf(office.code));
      const colleagues = shuffle(rng, x.r.people.filter((p) => p.email !== organiser.email)).slice(0, 2);
      const guests = [...colleagues.map((p) => p.email), pick(rng, PARTNERS)];
      const minutes = pick(rng, [45, 60, 90, 120]);
      const starts = ["09:30", "10:00", "11:00", "13:30", "14:00", "15:00", "16:00"].filter((t) => t >= office.opensAt && eventTimeOf(eventMinutes(t) + minutes) <= office.closesAt);
      const startTime = pick(rng, starts);
      const endTime = eventTimeOf(eventMinutes(startTime) + minutes);
      const t = int(rng, 0, TITLES.length - 1);
      const title = TITLES[t];
      const description = PURPOSES[t];
      // The room holds the organiser, the three guests and every place: at least four places are left over (capacity 8 and up).
      const spare = room.capacity - 1 - guests.length;
      const places = open ? Math.min(20, 2 * int(rng, 2, Math.floor(spare / 2))) : null;
      const mode = open ? `Open it to registration with ${places} places.` : "Make it invitation only.";
      const body = { title, description, date, startTime, endTime, roomCode: room.code, organiserEmail: organiser.email, guestEmails: guests, registration: open ? "open" : "invite-only", ...(open ? { places } : {}) };
      const path = `${EVENTS}?organiser=${enc(organiser.email)}&date=${date}`;
      const where = { startTime, status: "scheduled" };
      return {
        intent: `On the office events site, create an event for ${organiser.name} (${organiser.email}) in ${room.name} (${room.code}) at the ${office.city} office on ${dateText(date)} at ${clock(startTime)} for ${lengthText(minutes)}. Title it "${title}" with the description "${description}". ${mode} Invite ${listText(guests)}.`,
        summary: `${organiser.email} has one event in ${room.code} on ${date} from ${startTime} with the title, description, end time, registration and exactly the three guests asked.`,
        rubric: R.change([APP], "the event was set up"),
        oracle: {
          kind: "state",
          checks: [
            { name: "created", app: APP, path, where, count: { min: 1, max: 1 }, expect: { title, description, roomCode: room.code, endTime, registration: body.registration, guestCount: guests.length, ...(open ? { places } : {}) } },
            ...guests.map((email) => ({ name: `guest-${email}`, app: APP, path, where, expect: { guests: { email } } })),
          ],
        },
        calls: [call("create_event", body, { title: free, description: free, guestEmails: anyOrder(guests) })],
        note: `${organiser.email} → ${room.code} ${date} ${startTime}–${endTime}, "${title}", ${open ? `open, ${places} places` : "invite-only"}, guests ${guests.join(", ")}`,
        solve: (api) => api.post(APP, EVENTS, body),
        miss: (api) => api.post(APP, EVENTS, { ...body, guestEmails: guests.slice(0, -1) }),
      };
    },
  },
  {
    key: "event-room-only",
    app: APP,
    oracle: "json",
    surfaces: PAGES_AND_TOOLS,
    count: 3,
    about:
      "Which room at an office is free for a whole time slot, holds a number of people and has one or two named pieces of equipment. Exactly one free room does (`eventFreeRooms`), and each requirement matters: without the equipment, or with fewer people, two or more would. One more room meets every requirement but a scheduled event holds it for part of the slot. The miss names that room.",
    candidates: aroundTaken,
    claims: (s) => [dayClaim(s.office.code, s.event.date)],
    build({ event, room, office }, ctx, rng) {
      const rows = ctx.rows.events;
      const slot = { officeCode: office.code, date: event.date, startTime: event.startTime, endTime: event.endTime };
      for (const req of requirementsOf(room, rng)) {
        const fits = eventFreeRooms(rows, { ...slot, ...req });
        if (fits.length !== 1) continue;
        if (eventFreeRooms(rows, { ...slot, people: req.people }).length < 2 || eventFreeRooms(rows, { ...slot, people: 1, equipment: req.equipment }).length < 2) continue;
        const q = { ...slot, ...req };
        return {
          intent: `On the office events site, which room at the ${office.city} office is free on ${dateText(event.date)} from ${event.startTime} to ${event.endTime} for the whole time, holds ${req.people} people and has ${equipText(req.equipment)}? Answer as JSON: {"room": "<the room's code, like ABC-R1>"}.`,
          summary: `The one free room at the ${office.city} office for that slot that holds the people and has the equipment.`,
          rubric: R.answer([APP], "the room that meets every requirement"),
          oracle: { kind: "json", expect: { room: fits[0].roomCode } },
          calls: [],
          note: `${office.code} ${event.date} ${event.startTime}–${event.endTime}, ${req.people} people, ${req.equipment.join(" + ")} → ${fits[0].roomCode}; ${room.code} fits too but ${event.code} holds it`,
          answer: async (api) => ({ room: api.only(await api.get(APP, freeRoomsPath(q))).roomCode }),
          miss: async () => ({ room: room.code }),
        };
      }
      return null;
    },
  },
  {
    key: "event-room-none",
    app: APP,
    oracle: "json",
    surfaces: PAGES_AND_TOOLS,
    count: 3,
    about:
      "Whether any room at an office is free for a whole time slot, holds a number of people and has one or two named pieces of equipment — none is — and which room comes closest: of the free rooms there with that equipment, the one that holds the most people (capacities differ within an office, so there is no tie). The headcount alone can be met by a free room. One room meets every requirement but a scheduled event holds it for part of the slot. The miss says one exists and names that room.",
    candidates: aroundTaken,
    claims: (s) => [dayClaim(s.office.code, s.event.date)],
    build({ event, room, office }, ctx, rng) {
      const rows = ctx.rows.events;
      const slot = { officeCode: office.code, date: event.date, startTime: event.startTime, endTime: event.endTime };
      for (const req of requirementsOf(room, rng)) {
        if (eventFreeRooms(rows, { ...slot, ...req }).length !== 0) continue;
        const equipped = eventFreeRooms(rows, { ...slot, people: 1, equipment: req.equipment });
        if (equipped.length === 0 || eventFreeRooms(rows, { ...slot, people: req.people }).length === 0) continue;
        const closest = equipped[equipped.length - 1];
        const q = { ...slot, ...req };
        const eq = equipText(req.equipment);
        return {
          intent: `On the office events site, is any room at the ${office.city} office free on ${dateText(event.date)} from ${event.startTime} to ${event.endTime} for the whole time that holds ${req.people} people and has ${eq}? Also name the room that comes closest: of the rooms there that have ${eq} and are free for that whole time, the one that holds the most people. Answer as JSON: {"exists": <true or false>, "closest": "<the room's code, like ABC-R1>"}.`,
          summary: `No free room at the ${office.city} office meets every requirement; the closest is the largest free room with the equipment.`,
          rubric: R.answer([APP], "whether any room meets every requirement, and the one that comes closest,"),
          oracle: { kind: "json", expect: { exists: false, closest: closest.roomCode } },
          calls: [],
          note: `${office.code} ${event.date} ${event.startTime}–${event.endTime}, ${req.people} people, ${req.equipment.join(" + ")} → none; closest ${closest.roomCode} (${closest.capacity}); ${room.code} would fit but ${event.code} holds it`,
          answer: async (api) => ({
            exists: (await api.get(APP, freeRoomsPath(q))).length > 0,
            closest: (await api.get(APP, freeRoomsPath({ ...q, people: 1 }))).at(-1)?.roomCode ?? "",
          }),
          miss: async () => ({ exists: true, closest: room.code }),
        };
      }
      return null;
    },
  },
  {
    key: "event-register-session",
    app: APP,
    oracle: "state",
    surfaces: PAGES_AND_TOOLS,
    count: 3,
    about:
      "Register a member of an office's staff for the earliest session of a course at that office that still has places left. The earliest session there is full (the generator fills it on purpose); the course also runs at another office, where a session earlier than the answer has places — the miss registers for that one. The person can register for both (no overlap, not registered yet). Checks on the person's registrations: exactly one active registration for the answer, and exactly one more active registration than they had.",
    candidates: (ctx) => {
      const x = index(ctx);
      const rows = ctx.rows.events;
      const all = courses(ctx);
      return all.flatMap((c) => {
        const answer = c.sessions.find((e) => eventPlacesLeft(rows, e) > 0);
        if (!answer || eventPlacesLeft(rows, c.sessions[0]) !== 0) return [];
        const elsewhere = all.filter((o) => o.title === c.title && o.office.code !== c.office.code).flatMap((o) => o.sessions).filter((e) => eventPlacesLeft(rows, e) > 0 && byTime(e, answer) < 0).sort(byTime);
        const wrong = elsewhere[0];
        if (!wrong) return [];
        // Staff of the office who never registered for the course there or for the wrong session, and could register for either.
        const touched = new Set(rows.registrations.filter((g) => c.sessions.some((e) => e.code === g.eventCode) || g.eventCode === wrong.code).map((g) => g.email));
        return x.staffOf(c.office.code).filter((p) => !touched.has(p.email) && !eventRegisterProblem(rows, answer, p) && !eventRegisterProblem(rows, wrong, p)).map((person) => ({ ...c, answer, wrong, person }));
      });
    },
    claims: (c) => [`events:person:${c.person.email}`, ...c.sessions.map((e) => `events:event:${e.code}`), `events:event:${c.wrong.code}`],
    build({ title, office, sessions, answer, wrong, person }, ctx) {
      const had = index(ctx).liveRegsOf(person.email).length;
      const path = `${REGISTRATIONS}?email=${enc(person.email)}`;
      const who = { name: person.name, email: person.email };
      return {
        intent: `On the office events site, register ${person.name} (${person.email}) for one session of "${title}" at the ${office.city} office: the earliest session there that still has places left.`,
        summary: `${person.email} is registered for the earliest ${office.city} session of "${title}" with places left, and for nothing else new.`,
        rubric: R.change([APP], "the registration was made"),
        oracle: {
          kind: "state",
          checks: [
            { name: "registered", app: APP, path, where: { eventCode: answer.code, status: "registered" }, count: { min: 1, max: 1 }, expect: { email: person.email } },
            { name: "only-one-new", app: APP, path, where: { status: "registered" }, count: { min: had + 1, max: had + 1 }, expect: { email: person.email } },
          ],
        },
        calls: [call("register_for_event", { eventCode: answer.code, ...who }, { name: free })],
        note: `${person.email}: "${title}" at ${office.code} → ${answer.code} (${answer.date} ${answer.startTime}); ${sessions[0].code} is full; ${wrong.code} at ${wrong.officeCode} (${wrong.date}) is earlier with places`,
        solve: async (api) => {
          const open = (await liveSessions(api, title, office.code)).find((e) => e.placesLeft > 0);
          await api.post(APP, `${EVENTS}/${open.code}/register`, who);
        },
        miss: (api) => api.post(APP, `${EVENTS}/${wrong.code}/register`, who),
      };
    },
  },
  {
    key: "event-most-places",
    app: APP,
    oracle: "json",
    surfaces: PAGES_AND_TOOLS,
    count: 3,
    about:
      "Of the scheduled sessions of a course at one office, which has the most places left, and how many: its place limit less its active registrations (`eventPlacesLeft`; cancelled registrations hold no place). No tie for most. The miss reads the place limit as the places left: it names the session with the highest limit and gives that limit.",
    candidates: (ctx) =>
      courses(ctx).flatMap((c) => {
        const rows = ctx.rows.events;
        const left = c.sessions.map((e) => ({ e, left: eventPlacesLeft(rows, e) })).sort((a, b) => b.left - a.left);
        const limit = [...c.sessions].sort((a, b) => b.places - a.places);
        if (left.length < 2 || left[0].left === left[1].left || limit[0].places === limit[1].places) return [];
        if (limit[0].code === left[0].e.code && limit[0].places === left[0].left) return [];
        return [{ ...c, best: left[0], widest: limit[0] }];
      }),
    claims: (c) => c.sessions.map((e) => `events:event:${e.code}`),
    build({ title, office, best, widest }) {
      return {
        intent: `On the office events site, of the scheduled sessions of "${title}" at the ${office.city} office, which one has the most places left, and how many places are left in it? Answer as JSON: {"event": "<the event's code, EV-…>", "placesLeft": <number>}.`,
        summary: `The ${office.city} session of "${title}" with the most places left, and how many.`,
        rubric: R.answer([APP], "the session with the most places left, and how many it has left,"),
        oracle: { kind: "json", expect: { event: best.e.code, placesLeft: best.left } },
        calls: [call("list_events", {})],
        note: `"${title}" at ${office.code} → ${best.e.code} with ${best.left} left; ${widest.code} has the highest limit (${widest.places})`,
        answer: async (api) => {
          const [top] = (await liveSessions(api, title, office.code)).sort((a, b) => b.placesLeft - a.placesLeft);
          return { event: top.code, placesLeft: top.placesLeft };
        },
        miss: async (api) => {
          const [top] = (await liveSessions(api, title, office.code)).sort((a, b) => b.places - a.places);
          return { event: top.code, placesLeft: top.places };
        },
      };
    },
  },
  {
    key: "event-cancel-registration",
    app: APP,
    oracle: "state",
    surfaces: PAGES_AND_TOOLS,
    count: 3,
    about:
      "Cancel one of a person's active registrations, named by the event's title and date, and leave their other active registrations alone. Asked of a person with at least two active registrations, where no other registration of theirs is for an event with the same title on the same date. One check per active registration of the person: `cancelled` for the one named, `registered` for the rest. The miss cancels all of them.",
    candidates: (ctx) => {
      const x = index(ctx);
      const emails = [...new Set(x.r.registrations.map((g) => g.email))].sort();
      return emails.flatMap((email) => {
        const live = x.liveRegsOf(email);
        if (live.length < 2) return [];
        const all = x.r.registrations.filter((g) => g.email === email).map((g) => x.event.get(g.eventCode));
        return live.filter((g) => {
          const e = x.event.get(g.eventCode);
          return all.filter((o) => o.title === e.title && o.date === e.date).length === 1;
        }).map((target) => ({ target, live, event: x.event.get(target.eventCode) }));
      });
    },
    // The solve frees one place, in the target's event; the person's other registrations are theirs alone.
    claims: ({ target }) => [`events:person:${target.email}`, `events:event:${target.eventCode}`],
    build({ target, live, event }) {
      const status = (g) => (g.regNo === target.regNo ? "cancelled" : "registered");
      const cancel = (api, no) => api.post(APP, `${REGISTRATIONS}/${no}/cancel`, {});
      return {
        intent: `On the office events site, ${target.name} (${target.email}) is registered for several events. Cancel only their registration for "${event.title}" on ${dateText(event.date)}, and leave their other registrations as they are.`,
        summary: `${target.email}'s registration for "${event.title}" on ${event.date} is cancelled; their other active registrations are still active.`,
        rubric: R.change([APP], "the registration was cancelled"),
        oracle: { kind: "state", checks: live.map((g) => ({ name: `${g.regNo}-${status(g)}`, app: APP, path: `${REGISTRATIONS}/${g.regNo}`, expect: { status: status(g) } })) },
        calls: [call("cancel_registration", { regNo: target.regNo }, { regNo: free })],
        note: `${target.email}: ${target.regNo} (${event.code}, ${event.date}) → cancelled; ${live.filter((g) => g !== target).map((g) => g.regNo).join(", ")} stay registered`,
        solve: async (api) => {
          const mine = await api.list(APP, `${REGISTRATIONS}?email=${enc(target.email)}&status=registered`);
          await cancel(api, api.only(mine.filter((g) => g.eventTitle === event.title && g.eventDate === event.date)).regNo);
        },
        miss: async (api) => {
          for (const g of live) await cancel(api, g.regNo);
        },
      };
    },
  },
];
