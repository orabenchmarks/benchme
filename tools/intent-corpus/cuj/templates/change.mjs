/**
 * Change it (change; dining, pizza, events): one existing booking changed, and
 * nothing else. Each is asked of a seeded customer with other bookings on the
 * site, which a check holds to no write at all. Easy ones name the booking and
 * the new value; medium ones leave the value to a rule (the party decides the
 * area, the people decide the size) or to two requirements; hard ones have a
 * tempting option or run over several prompts, the longest with a request the
 * site refuses part-way. The impossible ones ask for a change the site's rules
 * will not make.
 *
 * Expected calls: each change's one write, with the booking it changes and
 * every field of the change (and the organiser's email, which the events site
 * asks of every change to an event): the new time, the party and the area that
 * seats it, the size, the room. A guest added or taken off, or a topping taken
 * off, can be written two ways (the change, or the whole new list), so only
 * the booking is published for it. An attempt the site refuses on the way is
 * no call every solution makes, and an impossible change declares none. A
 * question here (a total, a floor) is answered by what the changes returned or
 * by one of two reads, so it declares none.
 */
import { diningSeatingTimes, diningTablesLeft, eventChangeProblem, eventFreeRooms, eventHeadcount, pizzaChangeLine, pizzaSizeFor, pizzaToppingsKey, shuffle } from "../../../../packages/scenarios/dist/index.js";
import { call, free } from "../../calls.mjs";
import { R, about, dollars, impossibleChecks, jsonOracle, leftAlone, money, newPerson, row, site, stateOracle, wrote, PAGES_AND_TOOLS } from "../kit.mjs";
import { diningPath, eventsPath, pizzaPath } from "../paths.mjs";

const AREA = "change-it";
const mins = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const clock = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const AREA_TEXT = { indoor: "indoor", terrace: "terrace", bar: "bar", private: "private room" };
/** "an extra large", "a terrace". */
const an = (word) => `${/^[aeiou]/i.test(word) ? "an" : "a"} ${word}`;

// ─── who has what ──────────────────────────────────────────────────────────────────────────────────────────────────

/** Each confirmed reservation of a seeded guest with two or more, with the guest's other confirmed ones. */
const reservationPicks = (ctx) =>
  [...ctx.dining.byGuest.values()].flatMap((all) => {
    const live = all.filter((r) => r.status === "confirmed");
    return live.length >= 2 ? live.map((target) => ({ target, others: live.filter((r) => r !== target) })) : [];
  });
const reservationClaims = ({ target }, ctx) => [`person:dining:${target.guestEmail}`, `dining:${ctx.dining.restaurant.get(target.restaurantCode).city}:${target.date}`];
const seatingOf = (ctx, code, area) => (ctx.dining.seatingOf.get(code) ?? []).find((s) => s.area === area);
const reservationRef = (r) => ({ type: "reservation", id: r.reservationNo });

/** Each order of a seeded customer in one status, with the customer's other orders. */
const orderPicks = (status) => (ctx) =>
  [...ctx.pizza.byCustomer.values()].flatMap((all) => (all.length >= 2 ? all.filter((o) => o.status === status).map((target) => ({ target, others: all.filter((o) => o !== target) })) : []));
const orderClaims = ({ target }) => [`person:pizza:${target.customerEmail}`, `pizza:${target.branchCode}:${target.slotDate}`];
const orderRef = (o) => ({ type: "order", id: o.orderNo });
const sizeName = (ctx, key) => ctx.rows.pizza.sizes.find((s) => s.key === key)?.name.toLowerCase() ?? key;
const pizzaName = (ctx, line) => (line.pizzaCode ? `the ${ctx.pizza.pizza.get(line.pizzaCode).name}` : "the pizza they built");

/** Each scheduled event whose organiser organises another, with the organiser's other scheduled events. */
const eventPicks = (ctx) => {
  const byOrganiser = new Map();
  for (const e of ctx.rows.events.events.filter((x) => x.status === "scheduled")) byOrganiser.set(e.organiserEmail, [...(byOrganiser.get(e.organiserEmail) ?? []), e]);
  return [...byOrganiser.values()].flatMap((mine) => (mine.length >= 2 ? mine.map((target) => ({ target, others: mine.filter((e) => e !== target) })) : []));
};
const eventClaims = ({ target }) => [`person:events:${target.organiserEmail}`, `event:${target.code}`, `events-rooms:${target.officeCode}:${target.date}`];
const eventRef = (e) => ({ type: "event", id: e.code });
const draftOf = (e, over = {}) => ({ title: e.title, description: e.description, date: e.date, startTime: e.startTime, endTime: e.endTime, roomCode: e.roomCode, organiserEmail: e.organiserEmail, guestEmails: e.guestEmails, registration: e.registration, places: e.places, ...over });
const organiserOf = (ctx, e) => ctx.events.person.get(e.organiserEmail);
const eventText = (e) => `"${e.title}" (${e.code}) on ${e.date}`;

export const changeTemplates = [
  {
    key: "change-time",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "Move one of a seeded guest's confirmed reservations, named by its number, to another seating time the same day with a table free in its area. The checks read the reservation (the new time, the rest as it was) and the ledger: no write to the guest's other reservations.",
    candidates: reservationPicks,
    claims: reservationClaims,
    build({ target, others }, ctx, rng) {
      const r = ctx.dining.restaurant.get(target.restaurantCode);
      const seating = seatingOf(ctx, r.code, target.area);
      const times = diningSeatingTimes(r, target.date).filter((t) => Math.abs(mins(t) - mins(target.time)) >= 60 && diningTablesLeft(seating, ctx.rows.dining.reservations, target.date, t, target.reservationNo) >= 1);
      if (!times.length) return null;
      const time = times[Math.floor(rng() * times.length)];
      return {
        apps: ["dining"],
        target: target.reservationNo,
        effort: { reads: 0, writes: 1 },
        summary: `${target.reservationNo} is at the new time, the rest of it as it was; ${target.guestEmail}'s other reservations are untouched.`,
        note: `${target.reservationNo} (${r.code} ${target.date}) ${target.time} → ${time}; ${others.map((o) => o.reservationNo).join(", ")} untouched`,
        steps: [{
          kind: "state",
          intent: `On ${site("dining")}, move ${target.guestName}'s reservation ${target.reservationNo} at ${r.name} on ${target.date} to ${time}. They have other reservations; those stay as they are.`,
          rubric: R.change(["dining"], "the reservation was moved"),
          oracle: stateOracle(
            row("moved", "dining", diningPath.reservation(target.reservationNo), { expect: { status: "confirmed", time, date: target.date, partySize: target.partySize, area: target.area }, entity: reservationRef(target) }),
            leftAlone("other reservations untouched", "dining", others.map(reservationRef)),
          ),
          calls: [call("change_reservation", { reservationNo: target.reservationNo, time })],
          solve: (api) => api.post("dining", diningPath.change(target.reservationNo), { time }),
        }],
      };
    },
  },
  {
    key: "change-party",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "Change the party size of one of a seeded guest's confirmed reservations, named by its number, to a size its area's tables seat. The checks read the reservation (the new party, the rest as it was) and the ledger: no write to the guest's other reservations.",
    candidates: reservationPicks,
    claims: reservationClaims,
    build({ target, others }, ctx, rng) {
      const r = ctx.dining.restaurant.get(target.restaurantCode);
      const seating = seatingOf(ctx, r.code, target.area);
      const sizes = Array.from({ length: seating.seats }, (_, i) => i + 1).filter((n) => n !== target.partySize && n >= 2 && Math.abs(n - target.partySize) >= 1);
      if (!sizes.length) return null;
      const size = sizes[Math.floor(rng() * sizes.length)];
      return {
        apps: ["dining"],
        target: target.reservationNo,
        effort: { reads: 0, writes: 1 },
        summary: `${target.reservationNo} is for the new party size, the rest of it as it was; ${target.guestEmail}'s other reservations are untouched.`,
        note: `${target.reservationNo} (${r.code} ${target.date} ${target.time}, ${target.area} seats ${seating.seats}) party ${target.partySize} → ${size}`,
        steps: [{
          kind: "state",
          intent: `On ${site("dining")}, ${target.guestName}'s reservation ${target.reservationNo} at ${r.name} on ${target.date} is now for ${size} people: change it. Their other reservations stay as they are.`,
          rubric: R.change(["dining"], "the party size was changed"),
          oracle: stateOracle(
            row("party changed", "dining", diningPath.reservation(target.reservationNo), { expect: { status: "confirmed", partySize: size, time: target.time, date: target.date, area: target.area }, entity: reservationRef(target) }),
            leftAlone("other reservations untouched", "dining", others.map(reservationRef)),
          ),
          calls: [call("change_reservation", { reservationNo: target.reservationNo, partySize: size })],
          solve: (api) => api.post("dining", diningPath.change(target.reservationNo), { partySize: size }),
        }],
      };
    },
  },
  {
    key: "change-line-size",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "Make one line of a seeded customer's received pizza order, named by the order's number and the pizza, another size its crust comes in (`pizzaChangeLine`). The checks read the order (that line in the new size, every other line as it was) and the ledger: no write to the customer's other orders.",
    candidates: orderPicks("received"),
    claims: orderClaims,
    build({ target, others }, ctx, rng) {
      for (const item of shuffle(rng, target.lines)) {
        for (const size of shuffle(rng, ctx.rows.pizza.sizes.map((s) => s.key).filter((k) => k !== item.size))) {
          const r = pizzaChangeLine(ctx.rows.pizza, target, item.line, { size });
          if ("problem" in r) continue;
          const rest = target.lines.filter((i) => i !== item);
          return {
            apps: ["pizza"],
            target: target.orderNo,
            effort: { reads: 0, writes: 1 },
            summary: `Line ${item.line} of ${target.orderNo} is the new size; its other lines and ${target.customerEmail}'s other orders are as they were.`,
            note: `${target.orderNo} line ${item.line} (${item.pizzaCode ?? "built"}) ${item.size} → ${size}`,
            steps: [{
              kind: "state",
              intent: `On ${site("pizza")}, ${target.customerName} wants ${pizzaName(ctx, item)} on their order ${target.orderNo} as ${an(sizeName(ctx, size))} instead. Change only that; they have other orders, which stay as they are.`,
              rubric: R.change(["pizza"], "the pizza's size was changed"),
              oracle: stateOracle(
                row("resized", "pizza", pizzaPath.order(target.orderNo), { expect: { status: "received", lines: { line: item.line, size, toppingsKey: pizzaToppingsKey(item.toppings), quantity: item.quantity } }, entity: orderRef(target) }),
                ...rest.map((i) => row(`line ${i.line} as it was`, "pizza", pizzaPath.order(target.orderNo), { expect: { lines: { line: i.line, size: i.size, toppingsKey: pizzaToppingsKey(i.toppings), quantity: i.quantity } } })),
                leftAlone("other orders untouched", "pizza", others.map(orderRef)),
              ),
              calls: [call("change_order_line", { orderNo: target.orderNo, line: item.line, size })],
              solve: (api) => api.post("pizza", pizzaPath.line(target.orderNo, item.line), { size }),
            }],
          };
        }
      }
      return null;
    },
  },
  {
    key: "change-event-time",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "Move one of an organiser's scheduled events, named by its code, to another time the same day, as long as before, with its room free then (`eventChangeProblem`). The checks read the event (the new time, the same day and room) and the ledger: no write to the organiser's other events.",
    candidates: eventPicks,
    claims: eventClaims,
    build({ target, others }, ctx, rng) {
      const length = mins(target.endTime) - mins(target.startTime);
      for (const shift of shuffle(rng, [-180, -120, -90, -60, 60, 90, 120, 180])) {
        const start = mins(target.startTime) + shift;
        if (start < 8 * 60 || start + length > 19 * 60) continue;
        const next = draftOf(target, { startTime: clock(start), endTime: clock(start + length) });
        if (eventChangeProblem(ctx.rows.events, target, target.organiserEmail, next)) continue;
        const who = organiserOf(ctx, target);
        return {
          apps: ["events"],
          target: target.code,
          effort: { reads: 0, writes: 1 },
          summary: `${target.code} runs at the new time, the same day and room; ${who.email}'s other events are untouched.`,
          note: `${target.code} ${target.startTime}–${target.endTime} → ${next.startTime}–${next.endTime} in ${target.roomCode}`,
          steps: [{
            kind: "state",
            intent: `On ${site("events")}, ${who.name} (${who.email}) organises ${eventText(target)}. Move it to ${next.startTime}–${next.endTime} the same day, in the same room. Their other events stay as they are.`,
            rubric: R.change(["events"], "the event was moved"),
            oracle: stateOracle(
              row("moved", "events", eventsPath.event(target.code), { expect: { status: "scheduled", date: target.date, startTime: next.startTime, endTime: next.endTime, roomCode: target.roomCode }, entity: eventRef(target) }),
              leftAlone("other events untouched", "events", others.map(eventRef)),
            ),
            calls: [call("change_event", { eventCode: target.code, organiserEmail: who.email, startTime: next.startTime, endTime: next.endTime })],
            solve: (api) => api.post("events", eventsPath.change(target.code), { organiserEmail: who.email, startTime: next.startTime, endTime: next.endTime }),
          }],
        };
      }
      return null;
    },
  },
  {
    key: "change-party-area",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about:
      "A seeded guest's confirmed reservation, named by its number, is now for a bigger party than its area's tables seat: the change only goes through in the one other area whose tables seat them and has a table free then (a rule: `TABLE_TOO_SMALL` in the old area). The checks read the reservation (the party, the new area, the same time) and the ledger: no write to the guest's other reservations.",
    candidates: reservationPicks,
    claims: reservationClaims,
    build({ target, others }, ctx) {
      const r = ctx.dining.restaurant.get(target.restaurantCode);
      const here = seatingOf(ctx, r.code, target.area);
      const all = ctx.dining.seatingOf.get(r.code) ?? [];
      for (let size = here.seats + 1; size <= 12; size++) {
        const fit = all.filter((s) => s.area !== "private" && s.seats >= size && diningTablesLeft(s, ctx.rows.dining.reservations, target.date, target.time, target.reservationNo) >= 1);
        if (fit.length !== 1) continue;
        return {
          apps: ["dining"],
          target: target.reservationNo,
          rule: { what: `the ${target.area} tables seat at most ${here.seats}`, naive: target.area, actual: fit[0].area },
          effort: { reads: 1, writes: 1 },
          summary: `${target.reservationNo} is for the bigger party, moved to the one area whose tables seat them, at the same time; the guest's other reservations are untouched.`,
          note: `${target.reservationNo} (${r.code} ${target.date} ${target.time}): party ${target.partySize} → ${size}; ${target.area} seats ${here.seats} → ${fit[0].area} (seats ${fit[0].seats})`,
          steps: [{
            kind: "state",
            intent: `On ${site("dining")}, ${target.guestName}'s reservation ${target.reservationNo} at ${r.name} on ${target.date} at ${target.time} is now for ${size} people. Change it so they are all seated at that time. Their other reservations stay as they are.`,
            rubric: R.change(["dining"], "the reservation was changed for the bigger party"),
            oracle: stateOracle(
              row("seated", "dining", diningPath.reservation(target.reservationNo), { expect: { status: "confirmed", partySize: size, area: fit[0].area, time: target.time, date: target.date }, entity: reservationRef(target) }),
              leftAlone("other reservations untouched", "dining", others.map(reservationRef)),
            ),
            calls: [call("change_reservation", { reservationNo: target.reservationNo, partySize: size, area: fit[0].area })],
            solve: async (api) => {
              const slots = (await api.get("dining", diningPath.availability(r.code, target.date, size))).slots.filter((x) => x.time === target.time && x.tablesLeft >= 1 && x.area !== "private");
              return api.post("dining", diningPath.change(target.reservationNo), { partySize: size, area: api.only(slots).area });
            },
          }],
        };
      }
      return null;
    },
  },
  {
    key: "change-event-room",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about:
      "Move one of an organiser's scheduled events, named by its code, to the one other room at its office, free at its time and holding everyone, that has a named piece of equipment and step-free access (`eventFreeRooms`). Each requirement matters. The checks read the event (the new room, the same time) and the ledger: no write to the organiser's other events.",
    candidates: eventPicks,
    claims: eventClaims,
    build({ target, others }, ctx, rng) {
      const rows = ctx.rows.events;
      const people = eventHeadcount(draftOf(target));
      const q = { officeCode: target.officeCode, date: target.date, startTime: target.startTime, endTime: target.endTime, people };
      for (const equipment of shuffle(rng, ["projector", "video conferencing", "whiteboard"])) {
        const away = (list) => list.filter((x) => x.roomCode !== target.roomCode);
        const found = away(eventFreeRooms(rows, { ...q, equipment: [equipment], accessible: true }));
        if (found.length !== 1) continue;
        if (away(eventFreeRooms(rows, { ...q, equipment: [equipment] })).length < 2 || away(eventFreeRooms(rows, { ...q, accessible: true })).length < 2) continue;
        if (eventChangeProblem(rows, target, target.organiserEmail, draftOf(target, { roomCode: found[0].roomCode }))) continue;
        const who = organiserOf(ctx, target);
        return {
          apps: ["events"],
          target: target.code,
          hidden: [found[0].roomCode],
          constraints: [equipment, "step-free access"],
          effort: { reads: 1, writes: 1 },
          summary: `${target.code} is in the one other free room at its office with the equipment and step-free access, at the same time; the organiser's other events are untouched.`,
          note: `${target.code} ${target.date} ${target.startTime}–${target.endTime}, ${people} people, ${equipment} + step-free → ${found[0].roomCode}`,
          steps: [{
            kind: "state",
            intent: `On ${site("events")}, ${who.name} (${who.email}) organises ${eventText(target)}. Move it to another room at the same office, at the same time, that has ${equipment === "whiteboard" ? "a whiteboard" : equipment === "projector" ? "a projector" : "video conferencing"} and step-free access. Their other events stay as they are.`,
            rubric: R.change(["events"], "the event was moved to another room"),
            oracle: stateOracle(
              row("moved", "events", eventsPath.event(target.code), { expect: { status: "scheduled", roomCode: found[0].roomCode, date: target.date, startTime: target.startTime, endTime: target.endTime }, entity: eventRef(target) }),
              leftAlone("other events untouched", "events", others.map(eventRef)),
            ),
            calls: [call("change_event", { eventCode: target.code, organiserEmail: who.email, roomCode: found[0].roomCode })],
            solve: async (api) => {
              const free = (await api.get("events", eventsPath.freeRooms({ ...q, equipment: [equipment], accessible: true }))).filter((x) => x.roomCode !== target.roomCode);
              return api.post("events", eventsPath.change(target.code), { organiserEmail: who.email, roomCode: api.only(free).roomCode });
            },
          }],
        };
      }
      return null;
    },
  },
  {
    key: "change-line-serves",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "Make one line of a seeded customer's received pizza order, named by the order's number and the pizza, big enough for a number of people: the smallest size that serves them (`pizzaSizeFor`), a site rule. The checks read the order (that line in that size, every other line as it was) and the ledger.",
    candidates: orderPicks("received"),
    claims: orderClaims,
    build({ target, others }, ctx, rng) {
      for (const item of shuffle(rng, target.lines.filter((i) => i.quantity === 1))) {
        for (const people of shuffle(rng, [3, 4, 5, 6])) {
          const size = pizzaSizeFor(ctx.rows.pizza.sizes, people);
          if (!size || size.key === item.size || "problem" in pizzaChangeLine(ctx.rows.pizza, target, item.line, { size: size.key })) continue;
          const rest = target.lines.filter((i) => i !== item);
          return {
            apps: ["pizza"],
            target: target.orderNo,
            rule: { what: `the smallest size that serves ${people}`, naive: item.size, actual: size.key },
            effort: { reads: 1, writes: 1 },
            summary: `Line ${item.line} of ${target.orderNo} is the smallest size that serves the people; its other lines and the customer's other orders are as they were.`,
            note: `${target.orderNo} line ${item.line}: ${item.size} → for ${people} people → ${size.key} (serves ${size.serves})`,
            steps: [{
              kind: "state",
              intent: `On ${site("pizza")}, ${target.customerName} wants ${pizzaName(ctx, item)} on their order ${target.orderNo} big enough for ${people} people. Change only that; they have other orders, which stay as they are.`,
              rubric: R.change(["pizza"], "the pizza's size was changed"),
              oracle: stateOracle(
                row("resized", "pizza", pizzaPath.order(target.orderNo), { expect: { status: "received", lines: { line: item.line, size: size.key, toppingsKey: pizzaToppingsKey(item.toppings) } }, entity: orderRef(target) }),
                ...rest.map((i) => row(`line ${i.line} as it was`, "pizza", pizzaPath.order(target.orderNo), { expect: { lines: { line: i.line, size: i.size, toppingsKey: pizzaToppingsKey(i.toppings), quantity: i.quantity } } })),
                leftAlone("other orders untouched", "pizza", others.map(orderRef)),
              ),
              calls: [call("change_order_line", { orderNo: target.orderNo, line: item.line, size: size.key })],
              solve: async (api) => {
                const fits = (await api.get("pizza", pizzaPath.builder)).sizes.filter((s) => s.serves >= people).sort((x, y) => x.serves - y.serves);
                return api.post("pizza", pizzaPath.line(target.orderNo, item.line), { size: fits[0].key });
              },
            }],
          };
        }
      }
      return null;
    },
  },
  {
    key: "change-time-tempting",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about:
      "Move a seeded guest's confirmed reservation, named by its number, to the earliest seating time at or after a named time that day with a table free in its area for the two hours. The tempting one: the named time itself has no table free.",
    candidates: reservationPicks,
    claims: reservationClaims,
    build({ target, others }, ctx) {
      const r = ctx.dining.restaurant.get(target.restaurantCode);
      const seating = seatingOf(ctx, r.code, target.area);
      const left = (t) => diningTablesLeft(seating, ctx.rows.dining.reservations, target.date, t, target.reservationNo);
      const times = diningSeatingTimes(r, target.date);
      for (const from of times.filter((t) => left(t) === 0 && t !== target.time)) {
        const answer = times.find((t) => t > from && left(t) >= 1 && t !== target.time);
        if (!answer) continue;
        return {
          apps: ["dining"],
          target: target.reservationNo,
          hidden: [answer],
          tempting: { what: `no ${target.area} table is free at ${from}`, check: async (api) => (await api.get("dining", diningPath.availability(r.code, target.date, target.partySize))).slots.some((x) => x.area === target.area && x.time === from && x.tablesLeft === 0) },
          effort: { reads: 1, writes: 1 },
          summary: `${target.reservationNo} is at the earliest time from the named one with a table free in its area; the guest's other reservations are untouched.`,
          note: `${target.reservationNo} (${r.code} ${target.date}, ${target.area}): ${from} is full → ${answer}`,
          steps: [{
            kind: "state",
            intent: `On ${site("dining")}, move ${target.guestName}'s reservation ${target.reservationNo} at ${r.name} on ${target.date} to the earliest time from ${from} onwards that day when ${an(AREA_TEXT[target.area])} table is free for them. Their other reservations stay as they are.`,
            rubric: R.change(["dining"], "the reservation was moved"),
            oracle: stateOracle(
              row("moved", "dining", diningPath.reservation(target.reservationNo), { expect: { status: "confirmed", time: answer, area: target.area, partySize: target.partySize, date: target.date }, entity: reservationRef(target) }),
              leftAlone("other reservations untouched", "dining", others.map(reservationRef)),
            ),
            calls: [call("change_reservation", { reservationNo: target.reservationNo, time: answer })],
            solve: async (api) => {
              const slots = (await api.get("dining", diningPath.availability(r.code, target.date, target.partySize))).slots.filter((x) => x.area === target.area && x.time >= from && x.tablesLeft >= 1 && x.time !== target.time);
              return api.post("dining", diningPath.change(target.reservationNo), { time: slots.sort((x, y) => x.time.localeCompare(y.time))[0].time });
            },
          }],
        };
      }
      return null;
    },
  },
  {
    key: "change-line-steps",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about:
      "One line of a seeded customer's received pizza order changed over three prompts: another size, then a topping taken off, then what the order now costs (`pizzaChangeLine`, twice). Each change step's check stands on its own change in the ledger (the second after the first) and reads what it made.",
    candidates: orderPicks("received"),
    claims: orderClaims,
    build({ target, others }, ctx, rng) {
      const rows = ctx.rows.pizza;
      for (const item of shuffle(rng, target.lines.filter((i) => i.toppings.length >= 2))) {
        for (const size of shuffle(rng, rows.sizes.map((s) => s.key).filter((k) => k !== item.size))) {
          const first = pizzaChangeLine(rows, target, item.line, { size });
          if ("problem" in first) continue;
          const topping = item.toppings[Math.floor(rng() * item.toppings.length)];
          const second = pizzaChangeLine(rows, first.order, item.line, { removeToppings: [topping] });
          if ("problem" in second) continue;
          const kept = item.toppings.filter((t) => t !== topping);
          const toppingName = ctx.rows.pizza.toppings.find((t) => t.key === topping).name.toLowerCase();
          const ref = orderRef(target);
          return {
            apps: ["pizza"],
            target: target.orderNo,
            effort: { reads: 1, writes: 2 },
            summary: `Line ${item.line} of ${target.orderNo} is resized, then has a topping taken off, and the order's new total is given.`,
            note: `${target.orderNo} line ${item.line}: ${item.size} → ${size}; − ${topping} → ${pizzaToppingsKey(kept)}; total ${dollars(target.totalCents)} → ${dollars(second.order.totalCents)}`,
            steps: [
              {
                kind: "state",
                intent: `On ${site("pizza")}, ${target.customerName} wants ${pizzaName(ctx, item)} on their order ${target.orderNo} as ${an(sizeName(ctx, size))} instead. Change only that; they have other orders, which stay as they are.`,
                rubric: R.change(["pizza"], "the pizza's size was changed"),
                oracle: stateOracle(wrote("resized", "pizza", ref, "change"), row("in the new size", "pizza", pizzaPath.order(target.orderNo), { expect: { lines: { line: item.line, size } } })),
                calls: [call("change_order_line", { orderNo: target.orderNo, line: item.line, size })],
                solve: (api) => api.post("pizza", pizzaPath.line(target.orderNo, item.line), { size }),
              },
              {
                kind: "state",
                fact: toppingName,
                intent: `Also take the ${toppingName} off that pizza.`,
                rubric: R.stepChange("the topping was taken off"),
                oracle: stateOracle(
                  wrote("topping off", "pizza", ref, "change", { after: "resized" }),
                  row("without the topping", "pizza", pizzaPath.order(target.orderNo), { expect: { status: "received", lines: { line: item.line, size, toppingsKey: pizzaToppingsKey(kept) } } }),
                  leftAlone("other orders untouched", "pizza", others.map(orderRef)),
                ),
                calls: [call("change_order_line", { orderNo: target.orderNo, line: item.line, removeToppings: [topping] }, { removeToppings: free })],
                solve: (api) => api.post("pizza", pizzaPath.line(target.orderNo, item.line), { removeToppings: [topping] }),
              },
              {
                kind: "json",
                fact: "now",
                intent: `What does the whole order come to now? Answer as JSON: {"total": <dollars>}.`,
                rubric: R.stepAnswer("the order's new total"),
                oracle: jsonOracle({ total: money(second.order.totalCents) }),
                calls: [],
                answer: async (api) => ({ total: (await api.get("pizza", pizzaPath.order(target.orderNo))).totalCents / 100 }),
              },
            ],
          };
        }
      }
      return null;
    },
  },
  {
    key: "change-event-tempting",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about:
      "Move one of an organiser's scheduled events, named by its code, to the one other room at its office with a named piece of equipment that holds everyone and is free at its time. The tempting one: another room there has the equipment and is free then, but cannot hold everyone (the organiser, the guests and any places).",
    candidates: eventPicks,
    claims: eventClaims,
    build({ target, others }, ctx, rng) {
      const rows = ctx.rows.events;
      const people = eventHeadcount(draftOf(target));
      const q = { officeCode: target.officeCode, date: target.date, startTime: target.startTime, endTime: target.endTime, people };
      for (const equipment of shuffle(rng, ["projector", "video conferencing", "whiteboard"])) {
        const free = eventFreeRooms(rows, { ...q, equipment: [equipment] }).filter((x) => x.roomCode !== target.roomCode);
        if (free.length !== 1) continue;
        const taken = eventFreeRooms(rows, { ...q, people: 1, equipment: [equipment] }).filter((x) => x.roomCode !== target.roomCode && x.capacity < people);
        if (!taken.length) continue;
        if (eventChangeProblem(rows, target, target.organiserEmail, draftOf(target, { roomCode: free[0].roomCode }))) continue;
        const who = organiserOf(ctx, target);
        const kit = equipment === "whiteboard" ? "a whiteboard" : equipment === "projector" ? "a projector" : "video conferencing";
        return {
          apps: ["events"],
          target: target.code,
          hidden: [free[0].roomCode],
          tempting: { what: `${taken[0].roomCode} has ${equipment} and is free then, but holds ${taken[0].capacity} of ${people}`, check: async (api) => (await api.get("events", eventsPath.room(taken[0].roomCode))).capacity < people },
          effort: { reads: 1, writes: 1 },
          summary: `${target.code} is in the one free room at its office with the equipment that holds everyone, at the same time; the organiser's other events are untouched.`,
          note: `${target.code} ${target.date} ${target.startTime}–${target.endTime}, ${people} people, ${equipment} → ${free[0].roomCode}; ${taken[0].roomCode} is free but holds ${taken[0].capacity}`,
          steps: [{
            kind: "state",
            intent: `On ${site("events")}, ${who.name} (${who.email}) organises ${eventText(target)}. Move it to another room at the same office with ${kit}, at the same time; everyone on it must fit. Their other events stay as they are.`,
            rubric: R.change(["events"], "the event was moved to another room"),
            oracle: stateOracle(
              row("moved", "events", eventsPath.event(target.code), { expect: { status: "scheduled", roomCode: free[0].roomCode, startTime: target.startTime, date: target.date }, entity: eventRef(target) }),
              leftAlone("other events untouched", "events", others.map(eventRef)),
            ),
            calls: [call("change_event", { eventCode: target.code, organiserEmail: who.email, roomCode: free[0].roomCode })],
            solve: async (api) => {
              const list = (await api.get("events", eventsPath.freeRooms({ ...q, equipment: [equipment] }))).filter((x) => x.roomCode !== target.roomCode);
              return api.post("events", eventsPath.change(target.code), { organiserEmail: who.email, roomCode: api.only(list).roomCode });
            },
          }],
        };
      }
      return null;
    },
  },
  {
    key: "change-event-steps",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about:
      "One of an organiser's events changed over six prompts: a guest added, the time moved, a named room asked for that can no longer hold everyone (`OVER_CAPACITY`: it would have before the guest was added) with another named room to fall back on, a guest removed, registration opened with places that still fit, and which floor the room is on. The constraints interact: the guest list decides which room holds everyone, and the room and the time decide each other. Each change step stands on its own change in the ledger, after the step before.",
    candidates: eventPicks,
    claims: eventClaims,
    build({ target, others }, ctx, rng) {
      const rows = ctx.rows.events;
      if (target.registration !== "invite-only" || target.guestEmails.length < 2) return null;
      const who = organiserOf(ctx, target);
      const added = newPerson("change-event-steps", 0);
      const guests1 = [...target.guestEmails, added.email];
      const length = mins(target.endTime) - mins(target.startTime);
      for (const shift of shuffle(rng, [60, 90, 120, -60, -90])) {
        const start = mins(target.startTime) + shift;
        if (start < 9 * 60 || start + length > 18 * 60) continue;
        const time = { startTime: clock(start), endTime: clock(start + length) };
        const d1 = draftOf(target, { guestEmails: guests1 });
        const d2 = { ...d1, ...time };
        if (eventChangeProblem(rows, target, who.email, d1) || eventChangeProblem(rows, target, who.email, d2)) continue;
        const before = eventHeadcount(draftOf(target));
        const now = eventHeadcount(d2);
        const office = rows.rooms.filter((x) => x.officeCode === target.officeCode && x.code !== target.roomCode);
        const tooSmall = office.find((x) => x.capacity >= before && x.capacity < now && !eventChangeProblem(rows, target, who.email, { ...draftOf(target), ...time, roomCode: x.code }));
        if (!tooSmall) continue;
        const places = 2;
        const removed = target.guestEmails[0];
        const guests4 = guests1.filter((g) => g !== removed);
        const roomy = office.find((x) => x.code !== tooSmall.code && x.capacity >= 1 + guests4.length + places && !eventChangeProblem(rows, target, who.email, { ...d2, roomCode: x.code }) && !eventChangeProblem(rows, target, who.email, { ...d2, roomCode: x.code, guestEmails: guests4, registration: "open", places }));
        if (!roomy) continue;
        const ref = eventRef(target);
        return {
          apps: ["events"],
          target: target.code,
          interacting: { what: `${tooSmall.code} holds ${tooSmall.capacity}: everyone before the added guest (${before}), not after (${now})`, greedyBreaks: tooSmall.capacity >= before && tooSmall.capacity < now },
          recover: { code: "OVER_CAPACITY", what: `${tooSmall.code} cannot hold everyone once the guest is added; ${roomy.code} can` },
          effort: { reads: 2, writes: 5 },
          summary: `${target.code} has the added guest, the new time, the fallback room, one guest fewer, open registration with two places, and its floor is given.`,
          note: `${target.code}: + ${added.email}; ${target.startTime} → ${time.startTime}; ${tooSmall.code} (holds ${tooSmall.capacity}) refuses ${now} → ${roomy.code} (holds ${roomy.capacity}, floor ${roomy.floor}); − ${removed}; open, 2 places`,
          steps: [
            {
              kind: "state",
              intent: `On ${site("events")}, ${who.name} (${who.email}) organises ${eventText(target)}. Add ${added.name} (${added.email}) to its guest list. Their other events stay as they are.`,
              rubric: R.change(["events"], "the guest was added"),
              oracle: stateOracle(wrote("guest added", "events", ref, "change"), row("on the guest list", "events", eventsPath.event(target.code), { expect: { guests: { email: added.email } } })),
              calls: [call("change_event", { eventCode: target.code, organiserEmail: who.email, addGuestEmails: [added.email] }, { addGuestEmails: free })],
              solve: (api) => api.post("events", eventsPath.change(target.code), { organiserEmail: who.email, addGuestEmails: [added.email] }),
            },
            {
              kind: "state",
              fact: time.startTime,
              intent: `Now move it to ${time.startTime}–${time.endTime} the same day.`,
              rubric: R.stepChange("the event was moved to the new time"),
              oracle: stateOracle(wrote("time moved", "events", ref, "change", { after: "guest added" }), row("at the new time", "events", eventsPath.event(target.code), { expect: { date: target.date, startTime: time.startTime, endTime: time.endTime } })),
              calls: [call("change_event", { eventCode: target.code, organiserEmail: who.email, ...time })],
              solve: (api) => api.post("events", eventsPath.change(target.code), { organiserEmail: who.email, ...time }),
            },
            {
              kind: "state",
              fact: tooSmall.name,
              intent: `Put it in ${tooSmall.name} (${tooSmall.code}) instead. If that room cannot take everyone, use ${roomy.name} (${roomy.code}).`,
              rubric: [
                "The reply says which room the event is in now and, if the first room could not be used, the reason the site gave.",
                "Nothing besides the room changed in this step.",
              ],
              oracle: stateOracle(wrote("room changed", "events", ref, "change", { after: "time moved" }), row("in the room that holds everyone", "events", eventsPath.event(target.code), { expect: { roomCode: roomy.code, startTime: time.startTime } })),
              calls: [call("change_event", { eventCode: target.code, organiserEmail: who.email, roomCode: roomy.code })],
              solve: async (api) => {
                await api.attempt("events", eventsPath.change(target.code), { organiserEmail: who.email, roomCode: tooSmall.code });
                return api.post("events", eventsPath.change(target.code), { organiserEmail: who.email, roomCode: roomy.code });
              },
            },
            {
              kind: "state",
              fact: removed,
              intent: `Take ${ctx.events.person.get(removed)?.name ?? "the guest"} (${removed}) off the guest list.`,
              rubric: R.stepChange("the guest was taken off"),
              oracle: stateOracle(wrote("guest removed", "events", ref, "change", { after: "room changed" }), row("one guest fewer", "events", eventsPath.event(target.code), { expect: { guestCount: guests4.length, guests: { email: added.email } } })),
              calls: [call("change_event", { eventCode: target.code, organiserEmail: who.email, removeGuestEmails: [removed] }, { removeGuestEmails: free })],
              solve: (api) => api.post("events", eventsPath.change(target.code), { organiserEmail: who.email, removeGuestEmails: [removed] }),
            },
            {
              kind: "state",
              fact: "registration",
              intent: `Open it to registration, with ${places === 2 ? "two" : places} places.`,
              rubric: R.stepChange("registration was opened"),
              oracle: stateOracle(
                wrote("registration opened", "events", ref, "change", { after: "guest removed" }),
                row("open with places", "events", eventsPath.event(target.code), { expect: { status: "scheduled", registration: "open", places, roomCode: roomy.code, guestCount: guests4.length } }),
                leftAlone("other events untouched", "events", others.map(eventRef)),
              ),
              calls: [call("change_event", { eventCode: target.code, organiserEmail: who.email, registration: "open", places })],
              solve: (api) => api.post("events", eventsPath.change(target.code), { organiserEmail: who.email, registration: "open", places }),
            },
            {
              kind: "json",
              fact: "floor",
              intent: `Which floor is the room it is in now on? Answer as JSON: {"floor": <number>}.`,
              rubric: R.stepAnswer("the room's floor"),
              oracle: jsonOracle({ floor: roomy.floor }),
              calls: [],
              answer: async (api) => ({ floor: (await api.get("events", eventsPath.room((await api.get("events", eventsPath.event(target.code))).roomCode))).floor }),
            },
          ],
        };
      }
      return null;
    },
  },
  {
    key: "change-locked",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "A size change on a seeded customer's pizza order that the kitchen is already preparing: impossible (`ORDER_LOCKED`: only a received order can be changed). The right outcome is to say so and change nothing.",
    candidates: orderPicks("preparing"),
    claims: orderClaims,
    build({ target }, ctx) {
      const item = target.lines[0];
      const size = ctx.rows.pizza.sizes.map((s) => s.key).find((k) => k !== item.size);
      return {
        apps: ["pizza"],
        target: target.orderNo,
        impossible: { code: "ORDER_LOCKED" },
        effort: { reads: 0, writes: 0 },
        summary: `${target.orderNo} is being prepared and cannot be changed: nothing changes, and the agent looked at the order or was refused for it.`,
        note: `${target.orderNo} is ${target.status}`,
        steps: [{
          kind: "state",
          intent: `On ${site("pizza")}, ${target.customerName} wants ${pizzaName(ctx, item)} on their order ${target.orderNo} as ${an(sizeName(ctx, size))} instead.`,
          rubric: R.impossible(["pizza"], "make the change"),
          oracle: stateOracle(...impossibleChecks({ app: "pizza", things: [orderRef(target)], code: "ORDER_LOCKED" })),
          calls: [],
          solve: (api) => api.attempt("pizza", pizzaPath.line(target.orderNo, item.line), { size }),
        }],
      };
    },
  },
  {
    key: "change-room-taken",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "Move one of an organiser's events to a named room at the same time, when another event holds that room then: impossible (`ROOM_TAKEN`). The right outcome is to say so and change nothing.",
    candidates: eventPicks,
    claims: eventClaims,
    build({ target }, ctx) {
      const rows = ctx.rows.events;
      for (const room of rows.rooms.filter((x) => x.officeCode === target.officeCode && x.code !== target.roomCode)) {
        const problem = eventChangeProblem(rows, target, target.organiserEmail, draftOf(target, { roomCode: room.code }));
        if (problem?.code !== "ROOM_TAKEN") continue;
        const who = organiserOf(ctx, target);
        return {
          apps: ["events"],
          target: target.code,
          impossible: { code: "ROOM_TAKEN" },
          claims: [about("events", "room", room.code)],
          effort: { reads: 0, writes: 0 },
          summary: `${room.code} is taken at ${target.code}'s time: nothing changes, and the agent looked at the event or the room, or was refused for it.`,
          note: `${target.code} ${target.date} ${target.startTime}–${target.endTime} → ${room.code}: ${problem.message}`,
          steps: [{
            kind: "state",
            intent: `On ${site("events")}, ${who.name} (${who.email}) organises ${eventText(target)}. Move it to ${room.name} (${room.code}), at the same time.`,
            rubric: R.impossible(["events"], "move the event"),
            oracle: stateOracle(...impossibleChecks({ app: "events", things: [eventRef(target), { type: "room", id: room.code }], code: "ROOM_TAKEN" })),
            calls: [],
            solve: (api) => api.attempt("events", eventsPath.change(target.code), { organiserEmail: who.email, roomCode: room.code }),
          }],
        };
      }
      return null;
    },
  },
];
