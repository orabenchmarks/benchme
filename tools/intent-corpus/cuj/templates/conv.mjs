/**
 * Carry a conversation (multistep; pizza, dining, events, hotels): a booking
 * made, then changed, then partly undone, one prompt at a time in one
 * conversation. Each later prompt carries a fact the earlier ones did not.
 * Each step's check stands on its own write in the ledger: the booking by the
 * write that made it (`entity.at: "first"`), a change by the first change of
 * that booking (`"@<check>"`) after the step before's. The longest run over
 * six prompts, with a request the site refuses part-way and a requirement
 * from an early prompt that limits a later one. The impossible ones end on a
 * change the site's rules will not make.
 */
import { addDays, diningDepositCents, diningSeatingTimes, eventDraftProblem, eventHeadcount, nightsOf, pizzaChangeLine, pizzaOutOfStock, pizzaPlaceOrder, pizzaSizeFor, pizzaToppingsKey, roomsLeft, shuffle, stayProblem } from "../../../../packages/scenarios/dist/index.js";
import { R, about, dollars, impossibleChecks, jsonOracle, money, newPerson, row, site, stateOracle, unchanged, wrote, PAGES_AND_TOOLS } from "../kit.mjs";
import { diningPath, eventsPath, hotelsPath, pizzaPath } from "../paths.mjs";

const AREA = "carry-a-conversation";
const nightClaims = (city, checkIn, nights) => nightsOf(checkIn, nights).map((d) => `night:${city.toLowerCase()}:${d}`);
const mins = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const clock = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const WORD = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight"];
/** The guest's one reservation at a restaurant on a date, placed by the write that made it. */
const reservationMade = (name, guest, code, date) => row(name, "dining", diningPath.reservationsOf(guest.email), { where: { restaurantCode: code, date }, count: { min: 1, max: 1 }, expect: { status: "confirmed" }, entity: { type: "reservation", id: "{reservationNo}", at: "first" } });
const reservationNow = (name, guest, code, date, expect) => row(name, "dining", diningPath.reservationsOf(guest.email), { where: { restaurantCode: code, date, status: "confirmed" }, expect });
const orderMade = (name, guest, branch, date) => row(name, "pizza", pizzaPath.ordersOf(guest.email), { where: { branchCode: branch, slotDate: date }, count: { min: 1, max: 1 }, expect: { status: "received" }, entity: { type: "order", id: "{orderNo}", at: "first" } });
const orderNow = (name, guest, branch, date, expect) => row(name, "pizza", pizzaPath.ordersOf(guest.email), { where: { branchCode: branch, slotDate: date, status: "received" }, expect });
const reservationOf = async (api, guest, code, date) => api.only((await api.list("dining", diningPath.reservationsOf(guest.email))).filter((x) => x.restaurantCode === code && x.date === date && x.status === "confirmed"));
const orderOf = async (api, guest, branch, date) => api.only((await api.list("pizza", pizzaPath.ordersOf(guest.email))).filter((x) => x.branchCode === branch && x.slotDate === date && x.status === "received"));
const toppingName = (ctx, key) => ctx.rows.pizza.toppings.find((t) => t.key === key).name.toLowerCase();

/** A seating plan that only one area takes: the party size decides it. */
function partyPlan(ctx, r) {
  const seating = (ctx.dining.seatingOf.get(r.code) ?? []).filter((s) => s.area !== "private");
  if (seating.length < 2) return null;
  const biggest = Math.max(...seating.map((s) => s.seats));
  const fitting = seating.filter((s) => s.seats >= biggest);
  const party = Math.min(biggest, 12);
  const smaller = seating.find((s) => s.seats < party);
  return fitting.length === 1 && smaller ? { party, area: fitting[0], smaller } : null;
}

export const convTemplates = [
  {
    key: "conv-table-deposit",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "Two prompts: a table for a party only one of a named restaurant's areas seats (the party size, a site rule, decides the area), then what deposit the restaurant took for it (`diningDepositCents`: per guest, plus the private-room fee there).",
    candidates: (ctx) => ctx.rows.dining.restaurants.filter((r) => r.depositPerGuestCents > 0),
    claims: (r) => [`dining:${r.city}:2027-11-05`, about("dining", "restaurant", r.code)],
    build(r, ctx) {
      const plan = partyPlan(ctx, r);
      if (!plan) return null;
      const time = diningSeatingTimes(r, "2027-11-05").find((t) => t >= "19:00");
      if (!time) return null;
      const guest = newPerson("conv-table-deposit", 0);
      const deposit = diningDepositCents(r, plan.area.area, plan.party);
      return {
        apps: ["dining"],
        target: r.code,
        rule: { what: `only the ${plan.area.area} tables seat ${plan.party}`, naive: plan.smaller.area, actual: plan.area.area },
        effort: { reads: 2, writes: 1 },
        summary: `${guest.email} has one reservation at ${r.code} for ${plan.party}, in the one area that seats them, and is told the deposit taken.`,
        note: `${r.code} 2027-11-05 ${time}, ${plan.party} → ${plan.area.area}; deposit ${dollars(deposit)}`,
        steps: [
          {
            kind: "state",
            intent: `On ${site("dining")}, book a table for ${plan.party} at ${r.name} (${r.code}) on 2027-11-05 at ${time} for ${guest.name} (${guest.email}, phone ${guest.phone}).`,
            rubric: R.change(["dining"], "the table was booked"),
            oracle: stateOracle(row("booked", "dining", diningPath.reservationsOf(guest.email), { where: { restaurantCode: r.code, date: "2027-11-05", status: "confirmed" }, count: { min: 1, max: 1 }, expect: { time, partySize: plan.party, area: plan.area.area }, entity: { type: "reservation", id: "{reservationNo}" } })),
            solve: async (api) => {
              const x = await api.get("dining", diningPath.restaurant(r.code));
              return api.post("dining", diningPath.reservations, { restaurantCode: r.code, area: x.seating.find((s) => s.seats >= plan.party && s.area !== "private").area, date: "2027-11-05", time, partySize: plan.party, guestName: guest.name, guestEmail: guest.email, guestPhone: guest.phone, note: "" });
            },
          },
          {
            kind: "json",
            fact: "deposit",
            intent: `What deposit did the restaurant take for that reservation? Answer as JSON: {"deposit": <dollars>}.`,
            rubric: R.stepAnswer("the deposit taken"),
            oracle: jsonOracle({ deposit: money(deposit) }),
            answer: async (api) => ({ deposit: (await reservationOf(api, guest, r.code, "2027-11-05")).depositCents / 100 }),
          },
        ],
      };
    },
  },
  {
    key: "conv-pizza-total",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "Two prompts: one named menu pizza big enough for a number of people, for pickup (the size is the smallest that serves them, `pizzaSizeFor`, a site rule), then what the order costs.",
    candidates: (ctx) => ctx.rows.pizza.branches.flatMap((b) => ctx.rows.pizza.pizzas.map((p) => ({ b, p }))),
    claims: ({ b }) => [`pizza:${b.code}:2027-10-08`],
    build({ b, p }, ctx, rng) {
      const rows = ctx.rows.pizza;
      if (pizzaOutOfStock(rows.stockouts, b.code, p.toppings).length) return null;
      const people = [3, 5, 6][Math.floor(rng() * 3)];
      const size = pizzaSizeFor(rows.sizes, people);
      if (!size || size.key === "medium") return null;
      const guest = newPerson("conv-pizza-total", 0);
      const body = { branchCode: b.code, fulfilment: "pickup", lines: [{ pizzaCode: p.code, size: size.key, quantity: 1 }], slotDate: "2027-10-08", slotTime: "18:00", customerName: guest.name, customerEmail: guest.email };
      const placed = pizzaPlaceOrder(rows, body);
      if ("problem" in placed) return null;
      return {
        apps: ["pizza"],
        target: p.code,
        rule: { what: `the smallest size that serves ${people}`, naive: "medium", actual: size.key },
        effort: { reads: 2, writes: 1 },
        summary: `${guest.email} has one pickup order of one ${p.code} in the size for ${people}, and is told what it costs.`,
        note: `${p.code} for ${people} → ${size.key}; ${dollars(placed.quote.totalCents)}`,
        steps: [
          {
            kind: "state",
            intent: `On ${site("pizza")}, order one ${p.name} (${p.code}) big enough for ${people} people, for pickup from the ${b.name} branch (${b.code}) at 18:00 on 2027-10-08, for ${guest.name} (${guest.email}).`,
            rubric: R.change(["pizza"], "the order was placed"),
            oracle: stateOracle(row("ordered", "pizza", pizzaPath.ordersOf(guest.email), { where: { branchCode: b.code, slotDate: "2027-10-08", status: "received" }, count: { min: 1, max: 1 }, expect: { slotTime: "18:00", lineCount: 1, lines: { pizzaCode: p.code, size: size.key, quantity: 1 } }, entity: { type: "order", id: "{orderNo}" } })),
            solve: async (api) => {
              const fit = (await api.get("pizza", pizzaPath.builder)).sizes.filter((s) => s.serves >= people).sort((x, y) => x.serves - y.serves)[0];
              return api.post("pizza", pizzaPath.orders, { ...body, lines: [{ pizzaCode: p.code, size: fit.key, quantity: 1 }] });
            },
          },
          {
            kind: "json",
            fact: "cost",
            intent: `What does that order cost? Answer as JSON: {"total": <dollars>}.`,
            rubric: R.stepAnswer("the order's total"),
            oracle: jsonOracle({ total: money(placed.quote.totalCents) }),
            answer: async (api) => ({ total: (await orderOf(api, guest, b.code, "2027-10-08")).totalCents / 100 }),
          },
        ],
      };
    },
  },
  {
    key: "conv-rooms-steps",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about:
      "Three prompts at one hotel: a named room type booked for a couple, then a second room for their parents (the hotel's cheapest that sleeps two), then that second room cancelled again. The first booking is held to no write after it was made.",
    candidates: (ctx) => ctx.rows.hotels.hotels,
    claims: (h, ctx) => [`hotel-best:${h.code}`, ...nightClaims(h.city, "2027-11-15", 3), ...(ctx.hotels.roomsOf.get(h.code) ?? []).map((r) => about("hotels", "room", r.code))],
    build(hotel, ctx) {
      const rooms = [...(ctx.hotels.roomsOf.get(hotel.code) ?? [])].filter((r) => r.maxAdults >= 2).sort((x, y) => x.nightlyCents - y.nightlyCents);
      if (rooms.length < 2 || rooms[0].nightlyCents === rooms[1].nightlyCents) return null;
      const ours = rooms.at(-1), theirs = rooms[0];
      if (ours === theirs) return null;
      const guest = newPerson("conv-rooms-steps", 0);
      const stay = { checkIn: "2027-11-15", nights: 3, adults: 2, kids: 0, pets: 0, lateCheckout: false, hotelCode: hotel.code, guestName: guest.name, guestEmail: guest.email };
      const bookingOf = async (api, roomCode) => api.only((await api.list("hotels", hotelsPath.bookingsOf(guest.email))).filter((b) => b.roomCode === roomCode && b.status === "confirmed"));
      return {
        apps: ["hotels"],
        target: ours.code,
        hidden: [theirs.code],
        effort: { reads: 2, writes: 3 },
        summary: `${guest.email} has ${ours.code} booked for three nights; the second room booked for the parents in the second prompt is cancelled in the third.`,
        note: `${hotel.code} 2027-11-15 × 3: ${ours.code}; + cheapest for two ${theirs.code}; then cancel ${theirs.code}`,
        steps: [
          {
            kind: "state",
            intent: `On ${site("hotels")}, book the ${ours.name} (${ours.code}) at ${hotel.name} for three nights from 2027-11-15, for two adults, in the name of ${guest.name} (${guest.email}).`,
            rubric: R.change(["hotels"], "the room was booked"),
            oracle: stateOracle(row("our room booked", "hotels", hotelsPath.bookingsOf(guest.email), { where: { roomCode: ours.code, checkIn: "2027-11-15" }, count: { min: 1, max: 1 }, expect: { status: "confirmed", nights: 3, adults: 2 }, entity: { type: "booking", id: "{bookingNo}", at: "first" } })),
            solve: (api) => api.post("hotels", hotelsPath.bookings, { ...stay, roomCode: ours.code }),
          },
          {
            kind: "state",
            fact: "parents",
            intent: `My parents are coming too: book them the cheapest room at the same hotel that sleeps two, for the same nights, in the same name.`,
            rubric: R.stepChange("a second room was booked"),
            oracle: stateOracle(row("their room booked", "hotels", hotelsPath.bookingsOf(guest.email), { where: { roomCode: theirs.code, checkIn: "2027-11-15" }, count: { min: 1, max: 1 }, expect: { nights: 3, adults: 2 }, entity: { type: "booking", id: "{bookingNo}", at: "first" } })),
            solve: async (api) => {
              const h = await api.get("hotels", hotelsPath.hotel(hotel.code));
              const cheapest = h.rooms.filter((r) => r.maxAdults >= 2).sort((x, y) => x.nightlyCents - y.nightlyCents)[0];
              return api.post("hotels", hotelsPath.bookings, { ...stay, roomCode: cheapest.code });
            },
          },
          {
            kind: "state",
            fact: "after all",
            intent: `They can't come after all. Cancel their room, and keep ours.`,
            rubric: R.stepChange("the parents' room was cancelled"),
            oracle: stateOracle(
              row("their room cancelled", "hotels", hotelsPath.bookingsOf(guest.email), { where: { roomCode: theirs.code, checkIn: "2027-11-15" }, expect: { status: "cancelled" }, entity: { type: "booking", id: "{bookingNo}" } }),
              unchanged("our room kept", { apps: ["hotels"], entity: { type: "booking", id: "@our room booked" } }, { after: "our room booked" }),
              row("our room still booked", "hotels", hotelsPath.bookingsOf(guest.email), { where: { roomCode: ours.code, checkIn: "2027-11-15", status: "confirmed" }, expect: { nights: 3 } }),
            ),
            solve: async (api) => api.post("hotels", hotelsPath.cancel((await bookingOf(api, theirs.code)).bookingNo), {}),
          },
        ],
      };
    },
  },
  {
    key: "conv-event-steps",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about:
      "Three prompts for an organiser in the staff directory: an invitation-only event made in a named free room with two guests, then two more guests added, then one of those taken off again. Each change step stands on its own change of that event, after the step before's.",
    candidates: (ctx) => ctx.rows.events.rooms.filter((r) => r.capacity >= 8),
    claims: (room) => [`events-rooms:${room.officeCode}:2027-11-10`, about("events", "room", room.code)],
    build(room, ctx, rng) {
      const rows = ctx.rows.events;
      const staff = rows.people.filter((p) => p.officeCode === room.officeCode && !ctx.accountPeople.includes(`person:events:${p.email}`));
      if (staff.length < 5) return null;
      const [organiser, g1, g2, g3, g4] = shuffle(rng, staff);
      const draft = { title: "Quarterly planning", description: "", date: "2027-11-10", startTime: "14:00", endTime: "15:00", roomCode: room.code, organiserEmail: organiser.email, guestEmails: [g1.email, g2.email], registration: "invite-only", places: null };
      if (eventDraftProblem(rows, draft) || eventDraftProblem(rows, { ...draft, guestEmails: [g1.email, g2.email, g3.email, g4.email] })) return null;
      const made = row("event made", "events", eventsPath.eventsWhere({ organiser: organiser.email, date: "2027-11-10" }), { where: { title: draft.title }, count: { min: 1, max: 1 }, expect: { roomCode: room.code, startTime: "14:00" }, entity: { type: "event", id: "{code}", at: "first" } });
      const eventRef = { type: "event", id: "@event made" };
      const codeOf = async (api) => api.only((await api.list("events", eventsPath.eventsWhere({ organiser: organiser.email, date: "2027-11-10" }))).filter((e) => e.title === draft.title)).code;
      return {
        apps: ["events"],
        target: room.code,
        effort: { reads: 2, writes: 3 },
        summary: `${organiser.email}'s new event in ${room.code} has the two first guests and the one of the added two that stayed.`,
        note: `${room.code} 2027-11-10 14:00–15:00 by ${organiser.email}: ${g1.email}, ${g2.email}; + ${g3.email}, ${g4.email}; − ${g4.email}`,
        steps: [
          {
            kind: "state",
            intent: `On ${site("events")}, ${organiser.name} (${organiser.email}) wants an invitation-only event called "${draft.title}" in ${room.name} (${room.code}) on 2027-11-10 from 14:00 to 15:00, with ${g1.name} (${g1.email}) and ${g2.name} (${g2.email}) invited. Set it up for them.`,
            rubric: R.change(["events"], "the event was set up"),
            oracle: stateOracle(made),
            solve: (api) => api.post("events", eventsPath.events, draft),
          },
          {
            kind: "state",
            fact: g3.email,
            intent: `Invite ${g3.name} (${g3.email}) and ${g4.name} (${g4.email}) to it as well.`,
            rubric: R.stepChange("the two guests were added"),
            oracle: stateOracle(wrote("guests added", "events", eventRef, "change", { after: "event made" }), row("two more invited", "events", eventsPath.eventsWhere({ organiser: organiser.email, date: "2027-11-10" }), { where: { title: draft.title }, expect: { guests: { email: g3.email } } })),
            solve: async (api) => api.post("events", eventsPath.change(await codeOf(api)), { organiserEmail: organiser.email, addGuestEmails: [g3.email, g4.email] }),
          },
          {
            kind: "state",
            fact: "after all",
            intent: `${g4.name} can't come after all: take them off the guest list, and leave the others on it.`,
            rubric: R.stepChange("the guest was taken off"),
            oracle: stateOracle(
              wrote("guest taken off", "events", eventRef, "change", { after: "guests added" }),
              row("three guests left", "events", eventsPath.eventsWhere({ organiser: organiser.email, date: "2027-11-10" }), { where: { title: draft.title, status: "scheduled" }, expect: { guestCount: 3, guests: { email: g3.email }, roomCode: room.code } }),
            ),
            solve: async (api) => api.post("events", eventsPath.change(await codeOf(api)), { organiserEmail: organiser.email, removeGuestEmails: [g4.email] }),
          },
        ],
      };
    },
  },
  {
    key: "conv-dinner-long",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about:
      "Six prompts about one reservation: a table for four indoors at 19:00 with the party needing to leave by 22:00; six people; the terrace if its tables seat six, otherwise the private room (the terrace seats fewer, so that change is refused, `TABLE_TOO_SMALL`, and the private room is taken); as late as they can still be out by 22:00 (a table is held two hours, so 20:00, not the last seating); four again; and the deposit now held (`diningDepositCents`). The constraints interact: the 22:00 from the first prompt decides the time asked for in the fourth.",
    candidates: (ctx) => ctx.rows.dining.restaurants.filter((r) => r.privateRoomFeeCents),
    claims: (r) => [`dining:${r.city}:2027-11-12`, about("dining", "restaurant", r.code)],
    build(r, ctx) {
      const seating = ctx.dining.seatingOf.get(r.code) ?? [];
      const by = (area) => seating.find((s) => s.area === area);
      const indoor = by("indoor"), terrace = by("terrace"), priv = by("private");
      if (!indoor || !terrace || !priv || indoor.seats < 6 || terrace.seats >= 6 || priv.seats < 6) return null;
      const date = "2027-11-12";
      const times = diningSeatingTimes(r, date);
      const last = times.at(-1);
      if (!times.includes("19:00") || !times.includes("20:00") || !last || mins(last) <= mins("20:00")) return null;
      const guest = newPerson("conv-dinner-long", 0);
      const deposit = diningDepositCents(r, "private", 4);
      const ref = { type: "reservation", id: "@booked" };
      const change = (body) => async (api) => api.post("dining", diningPath.change((await reservationOf(api, guest, r.code, date)).reservationNo), body);
      return {
        apps: ["dining"],
        target: r.code,
        interacting: { what: `out by 22:00 with a two-hour table: 20:00, where the last seating is ${last}`, greedyBreaks: mins(last) + 120 > mins("22:00") },
        recover: { code: "TABLE_TOO_SMALL", what: `the terrace tables seat ${terrace.seats}` },
        effort: { reads: 5, writes: 5 },
        summary: `${guest.email} has one reservation at ${r.code} on ${date}: made for four, changed to six, moved to the private room when the terrace could not seat them, pushed to 20:00, back to four; and the deposit now held is given.`,
        note: `${r.code} ${date}: 4 indoor 19:00 → 6 → terrace seats ${terrace.seats} → private → 20:00 (last seating ${last}) → 4; deposit ${dollars(deposit)}`,
        steps: [
          {
            kind: "state",
            intent: `On ${site("dining")}, book a table for four indoors at ${r.name} (${r.code}) on ${date} at 19:00 for ${guest.name} (${guest.email}, phone ${guest.phone}). We have to be out by 22:00.`,
            rubric: R.change(["dining"], "the table was booked"),
            oracle: stateOracle(reservationMade("booked", guest, r.code, date)),
            solve: (api) => api.post("dining", diningPath.reservations, { restaurantCode: r.code, area: "indoor", date, time: "19:00", partySize: 4, guestName: guest.name, guestEmail: guest.email, guestPhone: guest.phone, note: "" }),
          },
          {
            kind: "state",
            fact: "six",
            intent: `We are six now. Change the reservation.`,
            rubric: R.stepChange("the party size was changed"),
            oracle: stateOracle(wrote("made six", "dining", ref, "change", { after: "booked" })),
            solve: change({ partySize: 6 }),
          },
          {
            kind: "state",
            fact: "terrace",
            intent: `Move us to the terrace if its tables seat six; otherwise put us in the private room.`,
            rubric: ["The reply says where the table is now and, if the terrace could not be had, the reason the site gave.", "Nothing besides the area changed in this step."],
            oracle: stateOracle(wrote("moved", "dining", ref, "change", { after: "made six" }), reservationNow("in the private room", guest, r.code, date, { area: "private" })),
            solve: async (api) => {
              const no = (await reservationOf(api, guest, r.code, date)).reservationNo;
              await api.attempt("dining", diningPath.change(no), { area: "terrace" });
              return api.post("dining", diningPath.change(no), { area: "private" });
            },
          },
          {
            kind: "state",
            fact: "as late",
            intent: `Push it back as late as we can and still be out in time.`,
            rubric: R.stepChange("the reservation was moved later"),
            oracle: stateOracle(wrote("pushed back", "dining", ref, "change", { after: "moved" }), reservationNow("at the latest time that still fits", guest, r.code, date, { time: "20:00" })),
            solve: change({ time: clock(mins("22:00") - 120) }),
          },
          {
            kind: "state",
            fact: "four again",
            intent: `Two of us dropped out: make it four again, and keep the rest as it is.`,
            rubric: R.stepChange("the party size was changed back"),
            oracle: stateOracle(wrote("four again", "dining", ref, "change", { after: "pushed back" }), reservationNow("as it stands", guest, r.code, date, { partySize: 4, area: "private", time: "20:00" })),
            solve: change({ partySize: 4 }),
          },
          {
            kind: "json",
            fact: "deposit",
            intent: `What deposit does the restaurant hold for it now? Answer as JSON: {"deposit": <dollars>}.`,
            rubric: R.stepAnswer("the deposit held now"),
            oracle: jsonOracle({ deposit: money(deposit) }),
            answer: async (api) => ({ deposit: (await reservationOf(api, guest, r.code, date)).depositCents / 100 }),
          },
        ],
      };
    },
  },
  {
    key: "conv-event-long",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about:
      "Six prompts about one new event: made in a named room with two guests; two more guests; a named smaller room, with a named bigger one to fall back on (the smaller holds everyone first invited but not after the two were added, so that change is refused, `OVER_CAPACITY`); an hour later; one of the added guests off again; and how many people the room must hold now (`eventHeadcount`). The constraints interact: the guests added in one prompt decide which room the next can have.",
    candidates: (ctx) => ctx.rows.events.offices,
    claims: (o, ctx) => [`events-rooms:${o.code}:2027-11-17`, ...(ctx.events.roomsOf.get(o.code) ?? []).map((r) => about("events", "room", r.code))],
    build(office, ctx, rng) {
      const rows = ctx.rows.events;
      const rooms = (ctx.events.roomsOf.get(office.code) ?? []).sort((x, y) => x.capacity - y.capacity);
      const staff = shuffle(rng, rows.people.filter((p) => p.officeCode === office.code && !ctx.accountPeople.includes(`person:events:${p.email}`)));
      if (staff.length < 5) return null;
      const [organiser, g1, g2, g3, g4] = staff;
      const small = rooms.find((x) => x.capacity === 4);
      const first = rooms.find((x) => x.capacity >= 8);
      const big = rooms.find((x) => x.capacity >= 6 && x !== first && x !== small);
      if (!small || !first || !big) return null;
      const base = { title: "Launch review", description: "", date: "2027-11-17", startTime: "10:00", endTime: "11:00", organiserEmail: organiser.email, registration: "invite-only", places: null };
      const two = [g1.email, g2.email], four = [...two, g3.email, g4.email], three = [...two, g3.email];
      const ok = (draft) => !eventDraftProblem(rows, draft);
      if (!ok({ ...base, roomCode: first.code, guestEmails: two }) || !ok({ ...base, roomCode: first.code, guestEmails: four }) || ok({ ...base, roomCode: small.code, guestEmails: four }) || !ok({ ...base, roomCode: small.code, guestEmails: two })) return null;
      const later = { startTime: "11:00", endTime: "12:00" };
      if (!ok({ ...base, roomCode: big.code, guestEmails: four }) || !ok({ ...base, ...later, roomCode: big.code, guestEmails: four }) || !ok({ ...base, ...later, roomCode: big.code, guestEmails: three })) return null;
      const where = eventsPath.eventsWhere({ organiser: organiser.email, date: base.date });
      const codeOf = async (api) => api.only((await api.list("events", where)).filter((e) => e.title === base.title)).code;
      const change = (body) => async (api) => api.post("events", eventsPath.change(await codeOf(api)), { organiserEmail: organiser.email, ...body });
      const ref = { type: "event", id: "@event made" };
      const now = (name, expect) => row(name, "events", where, { where: { title: base.title, status: "scheduled" }, expect });
      const headcount = eventHeadcount({ guestEmails: three, organiserEmail: organiser.email, places: null });
      return {
        apps: ["events"],
        target: first.code,
        interacting: { what: `${small.code} holds ${small.capacity}: the organiser and two guests, not four`, greedyBreaks: eventHeadcount({ guestEmails: four, organiserEmail: organiser.email, places: null }) > small.capacity },
        recover: { code: "OVER_CAPACITY", what: `${small.code} cannot hold everyone once the two are added` },
        effort: { reads: 5, writes: 5 },
        summary: `${organiser.email}'s new event ends in ${big.code} at 11:00 with three guests, after the smaller room was refused; the headcount is given.`,
        note: `${office.code} ${base.date}: ${first.code} + 2 guests → +2 → ${small.code} (holds ${small.capacity}) refused → ${big.code} → 11:00 → −1; headcount ${headcount}`,
        steps: [
          {
            kind: "state",
            intent: `On ${site("events")}, ${organiser.name} (${organiser.email}) wants an invitation-only event called "${base.title}" in ${first.name} (${first.code}) on ${base.date} from 10:00 to 11:00, with ${g1.name} (${g1.email}) and ${g2.name} (${g2.email}) invited. Set it up for them.`,
            rubric: R.change(["events"], "the event was set up"),
            oracle: stateOracle(row("event made", "events", where, { where: { title: base.title }, count: { min: 1, max: 1 }, expect: { status: "scheduled" }, entity: { type: "event", id: "{code}", at: "first" } })),
            solve: (api) => api.post("events", eventsPath.events, { ...base, roomCode: first.code, guestEmails: two }),
          },
          {
            kind: "state",
            fact: g3.email,
            intent: `Invite ${g3.name} (${g3.email}) and ${g4.name} (${g4.email}) too.`,
            rubric: R.stepChange("the two guests were added"),
            oracle: stateOracle(wrote("guests added", "events", ref, "change", { after: "event made" }), now("the first added is invited", { guests: { email: g3.email } })),
            solve: change({ addGuestEmails: [g3.email, g4.email] }),
          },
          {
            kind: "state",
            fact: small.code,
            intent: `Move it to ${small.name} (${small.code}). If that room cannot take everyone, use ${big.name} (${big.code}) instead.`,
            rubric: ["The reply says which room the event is in now and, if the first room could not be used, the reason the site gave.", "Nothing besides the room changed in this step."],
            oracle: stateOracle(wrote("room changed", "events", ref, "change", { after: "guests added" }), now("in the room that holds everyone", { roomCode: big.code })),
            solve: async (api) => {
              const code = await codeOf(api);
              await api.attempt("events", eventsPath.change(code), { organiserEmail: organiser.email, roomCode: small.code });
              return api.post("events", eventsPath.change(code), { organiserEmail: organiser.email, roomCode: big.code });
            },
          },
          {
            kind: "state",
            fact: "an hour later",
            intent: `Make it an hour later, the same length.`,
            rubric: R.stepChange("the event was moved an hour later"),
            oracle: stateOracle(wrote("an hour later", "events", ref, "change", { after: "room changed" }), now("at the new time", { startTime: later.startTime, endTime: later.endTime })),
            solve: change(later),
          },
          {
            kind: "state",
            fact: "after all",
            intent: `${g4.name} can't come after all: take them off the guest list.`,
            rubric: R.stepChange("the guest was taken off"),
            oracle: stateOracle(wrote("guest taken off", "events", ref, "change", { after: "an hour later" }), now("as it stands", { guestCount: 3, roomCode: big.code, startTime: later.startTime, guests: { email: g3.email } })),
            solve: change({ removeGuestEmails: [g4.email] }),
          },
          {
            kind: "json",
            fact: "hold",
            intent: `How many people does the room have to hold for it now, the organiser included? Answer as JSON: {"people": <number>}.`,
            rubric: R.stepAnswer("how many people the room must hold"),
            oracle: jsonOracle({ people: headcount }),
            answer: async (api) => {
              const e = api.only((await api.list("events", where)).filter((x) => x.title === base.title));
              return { people: 1 + e.guestCount + (e.places ?? 0) };
            },
          },
        ],
      };
    },
  },
  {
    key: "conv-pizza-long",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about:
      "Six prompts about one pizza order with a budget: two menu pizzas for pickup and a budget for the whole order; the second one in a bigger size; a named topping added to the first, or a named other if the branch is out of it (it is, so that change is refused, `TOPPING_OUT`); two of the first pizza if the order stays within the budget, otherwise the second back to its first size (two would go over, so the second goes back); the added topping off again; and the total. The constraints interact: the budget from the first prompt decides what the fourth can do.",
    candidates: (ctx) => ctx.rows.pizza.branches.filter((b) => ctx.rows.pizza.stockouts.some((s) => s.branchCode === b.code)),
    claims: (b) => [`pizza:${b.code}:2027-10-22`],
    build(b, ctx, rng) {
      const rows = ctx.rows.pizza;
      const out = rows.stockouts.filter((s) => s.branchCode === b.code).map((s) => s.toppingKey);
      const menu = shuffle(rng, rows.pizzas.filter((p) => !pizzaOutOfStock(rows.stockouts, b.code, p.toppings).length));
      const extra = rows.toppings.find((t) => !out.includes(t.key) && t.vegetarian);
      if (menu.length < 2 || !extra) return null;
      const [p1, p2] = menu;
      const missing = rows.toppings.find((t) => out.includes(t.key) && !p1.toppings.includes(t.key));
      if (!missing || p1.toppings.includes(extra.key)) return null;
      const guest = newPerson("conv-pizza-long", 0);
      const body = { branchCode: b.code, fulfilment: "pickup", lines: [{ pizzaCode: p1.code, size: "medium", quantity: 1 }, { pizzaCode: p2.code, size: "medium", quantity: 1 }], slotDate: "2027-10-22", slotTime: "18:30", customerName: guest.name, customerEmail: guest.email };
      const placed = pizzaPlaceOrder(rows, body);
      if ("problem" in placed) return null;
      const order0 = { orderNo: "PLAN", status: "received", ...body, lines: placed.quote.lines.map((l, i) => ({ ...l, line: i + 1, pizzaCode: [p1.code, p2.code][i] })), subtotalCents: placed.quote.subtotalCents, deliveryFeeCents: 0, totalCents: placed.quote.totalCents };
      const step = (o, line, change) => {
        const r = pizzaChangeLine({ ...rows, orders: [] }, o, line, change);
        return "problem" in r ? null : r.order;
      };
      const o2 = step(order0, 2, { size: "large" });
      const refused = pizzaChangeLine({ ...rows, orders: [] }, o2 ?? order0, 1, { addToppings: [missing.key] });
      const o3 = o2 && step(o2, 1, { addToppings: [extra.key] });
      const twice = o3 && step(o3, 1, { quantity: 2 });
      const back = o3 && step(o3, 2, { size: "medium" });
      if (!o2 || !("problem" in refused) || refused.problem.code !== "TOPPING_OUT" || !o3 || !twice || !back) return null;
      const budget = Math.floor((o3.totalCents + (twice.totalCents - o3.totalCents) / 2) / 100) * 100;
      if (twice.totalCents <= budget || o3.totalCents > budget) return null;
      const o5 = step(back, 1, { removeToppings: [extra.key] });
      if (!o5) return null;
      const ref = { type: "order", id: "@ordered" };
      const change = (line, c) => async (api) => api.post("pizza", pizzaPath.line((await orderOf(api, guest, b.code, "2027-10-22")).orderNo, line), c);
      return {
        apps: ["pizza"],
        target: p1.code,
        interacting: { what: `the budget ${dollars(budget)}: two of the first pizza come to ${dollars(twice.totalCents)}`, greedyBreaks: twice.totalCents > budget },
        recover: { code: "TOPPING_OUT", what: `${b.code} is out of ${missing.key}` },
        effort: { reads: 5, writes: 5 },
        summary: `${guest.email}'s pickup order at ${b.code} ends with both pizzas medium, one each, the first without the added topping; the refused topping and the budget are handled, and the total is given.`,
        note: `${b.code} 2027-10-22 18:30: ${p1.code} M + ${p2.code} M; ${p2.code} → L; + ${missing.key} refused → + ${extra.key}; ×2 would be ${dollars(twice.totalCents)} > ${dollars(budget)} → ${p2.code} back to M; − ${extra.key}; total ${dollars(o5.totalCents)}`,
        steps: [
          {
            kind: "state",
            intent: `On ${site("pizza")}, order a medium ${p1.name} (${p1.code}) and a medium ${p2.name} (${p2.code}) for pickup from the ${b.name} branch (${b.code}) at 18:30 on 2027-10-22, for ${guest.name} (${guest.email}). We have ${dollars(budget)} for the whole order.`,
            rubric: R.change(["pizza"], "the order was placed"),
            oracle: stateOracle(orderMade("ordered", guest, b.code, "2027-10-22")),
            solve: (api) => api.post("pizza", pizzaPath.orders, body),
          },
          {
            kind: "state",
            fact: "second pizza",
            intent: `Make the second pizza a large.`,
            rubric: R.stepChange("the second pizza was made a large"),
            oracle: stateOracle(wrote("second made large", "pizza", ref, "change", { after: "ordered" })),
            solve: change(2, { size: "large" }),
          },
          {
            kind: "state",
            fact: toppingName(ctx, missing.key),
            intent: `Add ${toppingName(ctx, missing.key)} to the first pizza; if they are out of it, add ${toppingName(ctx, extra.key)} instead.`,
            rubric: ["The reply says which topping went on and, if the first one could not be added, the reason the site gave.", "Nothing besides that topping changed in this step."],
            oracle: stateOracle(wrote("topping added", "pizza", ref, "change", { after: "second made large" })),
            solve: async (api) => {
              const no = (await orderOf(api, guest, b.code, "2027-10-22")).orderNo;
              await api.attempt("pizza", pizzaPath.line(no, 1), { addToppings: [missing.key] });
              return api.post("pizza", pizzaPath.line(no, 1), { addToppings: [extra.key] });
            },
          },
          {
            kind: "state",
            fact: "two of the first",
            intent: `Make it two of the first pizza if the order still stays within our budget; if it would not, make the second pizza a medium again instead.`,
            rubric: ["The reply says what was changed and why, as the site's prices show it.", "Only one of the two changes was made in this step."],
            oracle: stateOracle(wrote("budget kept", "pizza", ref, "change", { after: "topping added" }), orderNow("second back to medium", guest, b.code, "2027-10-22", { lines: { line: 2, size: "medium" } })),
            solve: change(2, { size: "medium" }),
          },
          {
            kind: "state",
            fact: "off again",
            intent: `Now take the ${toppingName(ctx, extra.key)} off again.`,
            rubric: R.stepChange("the topping was taken off"),
            oracle: stateOracle(
              wrote("topping off", "pizza", ref, "change", { after: "budget kept" }),
              orderNow("as it stands", guest, b.code, "2027-10-22", { lineCount: 2, lines: { line: 1, size: "medium", quantity: 1, toppingsKey: pizzaToppingsKey(p1.toppings) } }),
              orderNow("second as it stands", guest, b.code, "2027-10-22", { lines: { line: 2, size: "medium", quantity: 1 } }),
            ),
            solve: change(1, { removeToppings: [extra.key] }),
          },
          {
            kind: "json",
            fact: "total",
            intent: `What is the order's total now? Answer as JSON: {"total": <dollars>}.`,
            rubric: R.stepAnswer("the order's total now"),
            oracle: jsonOracle({ total: money(o5.totalCents) }),
            answer: async (api) => ({ total: (await orderOf(api, guest, b.code, "2027-10-22")).totalCents / 100 }),
          },
        ],
      };
    },
  },
  {
    key: "conv-party-limit",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "Two prompts: a table for four booked, then the same reservation for fourteen, impossible (`PARTY_LIMIT`: parties of more than twelve are not booked online). The second step's right outcome is to say so and change nothing; its checks count from the booking.",
    candidates: (ctx) => ctx.rows.dining.restaurants.filter((r) => (ctx.dining.seatingOf.get(r.code) ?? []).some((s) => s.area === "indoor" && s.seats >= 4)),
    claims: (r) => [`dining:${r.city}:2027-11-19`, about("dining", "restaurant", r.code)],
    build(r) {
      const date = "2027-11-19";
      const times = diningSeatingTimes(r, date);
      if (!times.includes("19:30")) return null;
      const guest = newPerson("conv-party-limit", 0);
      return {
        apps: ["dining"],
        target: r.code,
        impossible: { code: "PARTY_LIMIT", step: 1 },
        effort: { reads: 1, writes: 1 },
        summary: `${guest.email}'s reservation at ${r.code} stays for four: fourteen is more than the restaurant books online, and the agent looked or was refused for it.`,
        note: `${r.code} ${date} 19:30 for 4; then 14 > 12`,
        steps: [
          {
            kind: "state",
            intent: `On ${site("dining")}, book a table for four indoors at ${r.name} (${r.code}) on ${date} at 19:30 for ${guest.name} (${guest.email}, phone ${guest.phone}).`,
            rubric: R.change(["dining"], "the table was booked"),
            oracle: stateOracle(reservationMade("booked", guest, r.code, date)),
            solve: (api) => api.post("dining", diningPath.reservations, { restaurantCode: r.code, area: "indoor", date, time: "19:30", partySize: 4, guestName: guest.name, guestEmail: guest.email, guestPhone: guest.phone, note: "" }),
          },
          {
            kind: "state",
            fact: "fourteen",
            intent: `More people are coming: make it fourteen of us.`,
            rubric: R.stepImpossible("make it fourteen"),
            oracle: stateOracle(...impossibleChecks({ app: "dining", things: [{ type: "reservation", id: "@booked" }, { type: "restaurant", id: r.code }], code: "PARTY_LIMIT", after: "booked" }), reservationNow("still for four", guest, r.code, date, { partySize: 4 })),
            solve: async (api) => api.attempt("dining", diningPath.change((await reservationOf(api, guest, r.code, date)).reservationNo), { partySize: 14 }),
          },
        ],
      };
    },
  },
  {
    key: "conv-extra-night",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "Two prompts: a named room type booked for nights it has free, then the same room type for the night after as well, when it is booked out (`SOLD_OUT`). The second step's right outcome is to say so and book nothing; its checks count from the first booking.",
    candidates: (ctx) => {
      const { rooms, bookings } = ctx.rows.hotels;
      const out = [];
      for (const room of rooms) {
        const full = new Set(bookings.filter((b) => b.roomCode === room.code && b.status === "confirmed").flatMap((b) => nightsOf(b.checkIn, b.nights)).filter((n) => roomsLeft(room, bookings, n, 1) === 0));
        for (const night of full) out.push({ room, night });
      }
      return out;
    },
    claims: ({ room, night }, ctx) => [`room:${room.code}`, about("hotels", "room", room.code), ...nightClaims(ctx.hotels.hotel.get(room.hotelCode).city, addDays(night, -2), 3)],
    build({ room, night }, ctx) {
      const hotel = ctx.hotels.hotel.get(room.hotelCode);
      const checkIn = addDays(night, -2);
      const guest = newPerson("conv-extra-night", 0);
      const stay = { checkIn, nights: 2, adults: 1, kids: 0, pets: 0, lateCheckout: false };
      if (stayProblem(hotel, room, stay, ctx.rows.hotels.bookings)) return null;
      if (!stayProblem(hotel, room, { ...stay, checkIn: night, nights: 1 }, ctx.rows.hotels.bookings)) return null;
      return {
        apps: ["hotels"],
        target: room.code,
        impossible: { code: "SOLD_OUT", step: 1 },
        effort: { reads: 0, writes: 1 },
        summary: `${guest.email} has the two nights booked; the night after is booked out, so nothing more is booked, and the agent looked or was refused for it.`,
        note: `${room.code} ${checkIn} × 2 booked; ${night} booked out`,
        steps: [
          {
            kind: "state",
            intent: `On ${site("hotels")}, book the ${room.name} (${room.code}) at ${hotel.name} for two nights from ${checkIn}, for one adult, for ${guest.name} (${guest.email}).`,
            rubric: R.change(["hotels"], "the room was booked"),
            oracle: stateOracle(row("booked", "hotels", hotelsPath.bookingsOf(guest.email), { where: { roomCode: room.code, checkIn }, count: { min: 1, max: 1 }, expect: { status: "confirmed", nights: 2 }, entity: { type: "booking", id: "{bookingNo}", at: "first" } })),
            solve: (api) => api.post("hotels", hotelsPath.bookings, { ...stay, roomCode: room.code, hotelCode: hotel.code, guestName: guest.name, guestEmail: guest.email }),
          },
          {
            kind: "state",
            fact: night,
            intent: `I'll stay one more night: book the same room type for the night of ${night} as well.`,
            rubric: R.stepImpossible("book the extra night"),
            oracle: stateOracle(...impossibleChecks({ app: "hotels", things: [{ type: "room", id: room.code }, { type: "booking", id: "@booked" }], code: "SOLD_OUT", after: "booked" })),
            solve: (api) => api.attempt("hotels", hotelsPath.bookings, { ...stay, checkIn: night, nights: 1, roomCode: room.code, hotelCode: hotel.code, guestName: guest.name, guestEmail: guest.email }),
          },
        ],
      };
    },
  },
];
