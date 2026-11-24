/**
 * Plan across sites (multistep; flights, hotels, dining, cinema, events): one
 * trip or outing over two or three sites, one prompt at a time. The very hard
 * ones tie the sites together (a schedule: the night a flight lands, the hour a
 * session ends; a budget shared by tickets and a room) and have a request a
 * site refuses part-way. The impossible ones end on a request a site's rules
 * will not take.
 *
 * Expected calls: each step's booking or registration on its own site, with
 * what its prompt fixes or the plan finds (the cheapest room at a hotel with
 * the amenity, the session that had a place, the dinner after it, the hotel the
 * budget allows). A refused attempt on the way, an impossible last request and
 * every question declare none: the one flight is found by a search or in the
 * schedule, and a total or a deposit is in what the writes returned. Names and
 * phones are free; seats are any two of the row asked, and a ticket count left
 * out is the adult tickets asked.
 */
import {
  addDays, cinemaSeatMap, cinemaTakenSeats, diningDepositCents, diningSeatingTimes, diningTablesLeft, eventPlacesLeft, eventRegisterProblem, nightsOf, searchFlights, searchStays, shuffle, stayProblem,
} from "../../../../packages/scenarios/dist/index.js";
import { call, free, ofType, pattern, someOf } from "../../calls.mjs";
import { R, about, dollars, impossibleChecks, jsonOracle, money, newPerson, row, site, stateOracle, PAGES_AND_TOOLS } from "../kit.mjs";
import { cinemaPath, diningPath, eventsPath, flightsPath, hotelsPath } from "../paths.mjs";

const AREA = "plan-across-sites";
const nightClaims = (city, checkIn, nights) => nightsOf(checkIn, nights).map((d) => `night:${city.toLowerCase()}:${d}`);
const mins = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const flightBooked = (name, contact, flightNo, date, expect) =>
  row(name, "flights", flightsPath.bookingsOf(contact.email), { where: { flightNo, date, status: "confirmed" }, count: { min: 1, max: 1 }, expect, entity: { type: "booking", id: "{bookingNo}" } });
const hotelBooked = (name, guest, roomCode, checkIn, expect) =>
  row(name, "hotels", hotelsPath.bookingsOf(guest.email), { where: { roomCode, checkIn, status: "confirmed" }, count: { min: 1, max: 1 }, expect, entity: { type: "booking", id: "{bookingNo}" } });
const cabinOf = (ctx, flightNo, cabin = "economy") => (ctx.flights.cabinsOf.get(flightNo) ?? []).find((c) => c.cabin === cabin);
const cityOf = (ctx, airport) => ctx.flights.airport.get(airport).city;
const leg = (f, date, people, bags, contact) => ({ flightNo: f.flightNo, date, cabin: "economy", passengers: people.map((p) => p.name), bags, contactEmail: contact.email });
const stayBody = (room, checkIn, nights, guest, adults = 2) => ({ roomCode: room.code, hotelCode: room.hotelCode, checkIn, nights, adults, kids: 0, pets: 0, lateCheckout: false, guestName: guest.name, guestEmail: guest.email });
/** A flight booking as a correct solution makes it: the reference one's body, the passengers' names as the run writes them. */
const flying = (body) => call("create_booking", body, { passengers: someOf(body.passengers.length, ofType("string")) });
/** A room booking as a correct solution makes it: the hotel's code beside the room's free, as is the guest's name. */
const staying = (body) => call("create_booking", body, { hotelCode: free, guestName: free });
/** A table as a correct solution books it: the guest's name and phone written as the run likes. */
const reserving = (body) => call("create_reservation", body, { guestName: free, guestPhone: free });
/** A registration as a correct solution makes it: the person's name written as the run likes. */
const registering = (eventCode, person) => call("register_for_event", { eventCode, name: person.name, email: person.email }, { name: free });

export const planTemplates = [
  {
    key: "plan-flight-then-room",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about:
      "Two prompts on two sites: which nonstop flight on a route and date leaves before noon (exactly one, `searchFlights`), then the cheapest room in the destination city for two adults for two nights from that date at a hotel with a named amenity (`searchStays`), booked. Each prompt is found by its own requirements.",
    candidates: (ctx) => {
      const routes = [...new Set(ctx.rows.flights.flights.map((x) => `${x.origin}>${x.destination}`))];
      return routes.flatMap((r) => [5, 19, 47].map((d) => ({ origin: r.split(">")[0], destination: r.split(">")[1], date: addDays("2027-03-01", d) })));
    },
    claims: ({ origin, destination, date }, ctx) => [`route:${origin}-${destination}:${date}`, ...nightClaims(cityOf(ctx, destination), date, 2)],
    build({ origin, destination, date }, ctx, rng) {
      const q = { origin, destination, date, passengers: 1, cabin: "economy", maxStops: 0, departBefore: "12:00" };
      const found = searchFlights(ctx.rows.flights, q);
      if (found.length !== 1 || searchFlights(ctx.rows.flights, { ...q, departBefore: undefined }).length < 2) return null;
      const city = cityOf(ctx, destination);
      for (const amenity of shuffle(rng, ["breakfast", "gym", "pool", "spa"])) {
        const hq = { city, checkIn: date, nights: 2, adults: 2, kids: 0, pets: 0 };
        const fit = searchStays(ctx.rows.hotels, { ...hq, amenities: [amenity] });
        const all = searchStays(ctx.rows.hotels, hq);
        if (fit.length < 2 || fit[0].nightlyCents === fit[1].nightlyCents || all[0].hotelCode === fit[0].hotelCode) continue;
        const guest = newPerson("plan-flight-then-room", 0);
        const amenityText = { breakfast: "breakfast", gym: "a gym", pool: "a pool", spa: "a spa" }[amenity];
        return {
          apps: ["flights", "hotels"],
          hidden: [found[0].flightNo, fit[0].roomCode],
          claims: [about("hotels", "room", fit[0].roomCode)],
          constraints: ["nonstop", "before 12:00", amenityText],
          effort: { reads: 2, writes: 1 },
          summary: `The one nonstop morning flight is named; ${guest.email} has the cheapest room for two in ${city} at a hotel with ${amenityText} booked for two nights.`,
          note: `${origin}→${destination} ${date} nonstop before 12:00 → ${found[0].flightNo}; ${city} ${amenity} → ${fit[0].roomCode} (${dollars(fit[0].nightlyCents)})`,
          steps: [
            {
              kind: "json",
              apps: ["flights"],
              intent: `We are planning two nights in ${city}. On ${site("flights")}, which nonstop flight from ${cityOf(ctx, origin)} to ${city} on ${date} leaves before 12:00? Answer as JSON: {"flight": "<the flight number>"}.`,
              rubric: R.answer(["flights"], "the flight that meets every requirement"),
              oracle: jsonOracle({ flight: found[0].flightNo }),
              calls: [],
              answer: async (api) => ({ flight: api.only((await api.get("flights", flightsPath.search(q))).outbound).flightNo }),
            },
            {
              kind: "state",
              apps: ["hotels"],
              fact: amenityText,
              intent: `Now, on ${site("hotels")}, book the cheapest room in ${city} for two adults for two nights from ${date}, at a hotel with ${amenityText}, for ${guest.name} (${guest.email}).`,
              rubric: R.stepChange("the room was booked"),
              oracle: stateOracle(hotelBooked("room booked", guest, fit[0].roomCode, date, { nights: 2, adults: 2 })),
              calls: [staying(stayBody({ code: fit[0].roomCode, hotelCode: fit[0].hotelCode }, date, 2, guest))],
              solve: async (api) => {
                const o = (await api.get("hotels", hotelsPath.search({ ...hq, amenities: [amenity] })))[0];
                return api.post("hotels", hotelsPath.bookings, stayBody({ code: o.roomCode, hotelCode: o.hotelCode }, date, 2, guest));
              },
            },
          ],
        };
      }
      return null;
    },
  },
  {
    key: "plan-trip-steps",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "Three prompts on two sites: a named flight booked for one traveller, then a named room type at a named hotel in the destination for the nights of the trip, then what the flight and the room cost together.",
    candidates: (ctx) => ctx.rows.flights.flights.filter((f) => f.stops === 0 && !f.arrivesNextDay).flatMap((f) => [61, 75].map((d) => ({ f, date: addDays("2027-03-01", d) }))),
    claims: ({ f, date }, ctx) => [`route:${f.origin}-${f.destination}:${date}`, about("flights", "flight", f.flightNo), ...nightClaims(cityOf(ctx, f.destination), date, 3)],
    build({ f, date }, ctx, rng) {
      const cabin = cabinOf(ctx, f.flightNo);
      const city = cityOf(ctx, f.destination);
      const hotels = ctx.rows.hotels.hotels.filter((h) => h.city === city);
      if (!cabin || !hotels.length) return null;
      const hotel = hotels[Math.floor(rng() * hotels.length)];
      const room = (ctx.hotels.roomsOf.get(hotel.code) ?? []).find((r) => r.maxAdults >= 1 && !stayProblem(hotel, r, { checkIn: date, nights: 3, adults: 1, kids: 0, pets: 0, lateCheckout: false }, ctx.rows.hotels.bookings));
      if (!room) return null;
      const me = newPerson("plan-trip-steps", 0);
      const total = cabin.priceCents + room.nightlyCents * 3;
      return {
        apps: ["flights", "hotels"],
        target: f.flightNo,
        claims: [about("hotels", "room", room.code)],
        effort: { reads: 2, writes: 2 },
        summary: `${me.email} has the named flight and three nights in the named room booked, and is told what they cost together.`,
        note: `${f.flightNo} ${date} + ${room.code} × 3 → ${dollars(total)}`,
        steps: [
          {
            kind: "state",
            apps: ["flights"],
            intent: `I'm going to ${city} for three nights. On ${site("flights")}, book me one economy seat on flight ${f.flightNo} on ${date}, with no checked bag: ${me.name}, ${me.email}.`,
            rubric: R.change(["flights"], "the flight was booked"),
            oracle: stateOracle(flightBooked("flight booked", me, f.flightNo, date, { passengerCount: 1, bags: 0 })),
            calls: [flying(leg(f, date, [me], 0, me))],
            solve: (api) => api.post("flights", flightsPath.bookings, leg(f, date, [me], 0, me)),
          },
          {
            kind: "state",
            apps: ["hotels"],
            fact: room.code,
            intent: `Now, on ${site("hotels")}, book me the ${room.name} (${room.code}) at ${hotel.name} for those three nights, from the day I land, for one adult.`,
            rubric: R.stepChange("the room was booked"),
            oracle: stateOracle(hotelBooked("room booked", me, room.code, date, { nights: 3, adults: 1 })),
            calls: [staying(stayBody(room, date, 3, me, 1))],
            solve: (api) => api.post("hotels", hotelsPath.bookings, stayBody(room, date, 3, me, 1)),
          },
          {
            kind: "json",
            apps: ["flights", "hotels"],
            fact: "together",
            intent: `What do the flight and the room cost together? Answer as JSON: {"total": <dollars>}.`,
            rubric: R.stepAnswer("what the flight and the room cost together"),
            oracle: jsonOracle({ total: money(total) }),
            calls: [],
            answer: async (api) => {
              const fl = (await api.list("flights", flightsPath.bookingsOf(me.email))).find((b) => b.status === "confirmed");
              const ho = (await api.list("hotels", hotelsPath.bookingsOf(me.email))).find((b) => b.status === "confirmed");
              return { total: (fl.totalCents + ho.totalCents) / 100 };
            },
          },
        ],
      };
    },
  },
  {
    key: "plan-talk-dinner-steps",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "Three prompts on two sites: a registration for a named open event with places, then a table for two at a named restaurant in the office's city that evening at a named time after it, then the deposit the restaurant took (`diningDepositCents`).",
    candidates: (ctx) => ctx.rows.events.events.filter((e) => e.registration === "open" && e.status === "scheduled" && (eventPlacesLeft(ctx.rows.events, e) ?? 0) >= 2),
    claims: (e, ctx) => [`event:${e.code}`, `dining:${ctx.events.office.get(e.officeCode).city}:${e.date}`],
    build(e, ctx, rng) {
      const office = ctx.events.office.get(e.officeCode);
      const me = newPerson("plan-talk-dinner-steps", 0);
      if (eventRegisterProblem(ctx.rows.events, e, me)) return null;
      const options = shuffle(rng, ctx.rows.dining.restaurants.filter((r) => r.city === office.city && r.depositPerGuestCents > 0));
      for (const r of options) {
        const seating = (ctx.dining.seatingOf.get(r.code) ?? []).find((s) => s.area === "indoor" && s.seats >= 2);
        const time = diningSeatingTimes(r, e.date).find((t) => mins(t) >= mins(e.endTime) + 60);
        if (!seating || !time || diningTablesLeft(seating, ctx.rows.dining.reservations, e.date, time) < 1) continue;
        const deposit = diningDepositCents(r, "indoor", 2);
        return {
          apps: ["events", "dining"],
          target: e.code,
          claims: [about("dining", "restaurant", r.code)],
          effort: { reads: 1, writes: 2 },
          summary: `${me.email} is registered for ${e.code} and has a table for two indoors at ${r.code} that evening; the deposit is given.`,
          note: `${e.code} ${e.date} ${e.startTime}–${e.endTime}; ${r.code} at ${time}; deposit ${dollars(deposit)}`,
          steps: [
            {
              kind: "state",
              apps: ["events"],
              intent: `On ${site("events")}, register ${me.name} (${me.email}) for "${e.title}" (${e.code}) at the ${office.name} on ${e.date}.`,
              rubric: R.change(["events"], "the registration was made"),
              oracle: stateOracle(row("registered", "events", eventsPath.registrationsOf(me.email), { where: { eventCode: e.code, status: "registered" }, count: { min: 1, max: 1 }, expect: { email: me.email }, entity: { type: "registration", id: "{regNo}" } })),
              calls: [registering(e.code, me)],
              solve: (api) => api.post("events", eventsPath.register(e.code), { name: me.name, email: me.email }),
            },
            {
              kind: "state",
              apps: ["dining"],
              fact: r.name,
              intent: `Afterwards we'll have dinner: on ${site("dining")}, book a table for two indoors at ${r.name} (${r.code}) that evening at ${time}, in the same name, phone ${me.phone}.`,
              rubric: R.stepChange("the table was booked"),
              oracle: stateOracle(row("table booked", "dining", diningPath.reservationsOf(me.email), { where: { restaurantCode: r.code, date: e.date, status: "confirmed" }, count: { min: 1, max: 1 }, expect: { time, partySize: 2, area: "indoor" }, entity: { type: "reservation", id: "{reservationNo}" } })),
              calls: [reserving({ restaurantCode: r.code, area: "indoor", date: e.date, time, partySize: 2, guestName: me.name, guestEmail: me.email, guestPhone: me.phone, note: "" })],
              solve: (api) => api.post("dining", diningPath.reservations, { restaurantCode: r.code, area: "indoor", date: e.date, time, partySize: 2, guestName: me.name, guestEmail: me.email, guestPhone: me.phone, note: "" }),
            },
            {
              kind: "json",
              apps: ["dining"],
              fact: "deposit",
              intent: `What deposit did the restaurant take? Answer as JSON: {"deposit": <dollars>}.`,
              rubric: R.stepAnswer("the deposit taken"),
              oracle: jsonOracle({ deposit: money(deposit) }),
              calls: [],
              answer: async (api) => ({ deposit: api.only((await api.list("dining", diningPath.reservationsOf(me.email))).filter((x) => x.restaurantCode === r.code)).depositCents / 100 }),
            },
          ],
        };
      }
      return null;
    },
  },
  {
    key: "plan-overnight-trip",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about:
      "Four prompts on two sites: a named evening flight that lands after midnight, for two travellers with two checked bags each if the carrier takes two (it takes one, so that booking is refused, `TOO_MANY_BAGS`, and one bag each is booked); a named flight back three days later; a named room type for every night from the night they land until they fly back; and what it all costs. The constraints interact: the flight landing the next day decides the hotel's first night.",
    candidates: (ctx) =>
      ctx.rows.flights.flights
        .filter((f) => f.arrivesNextDay && f.stops === 0 && ctx.flights.carrier.get(f.carrierCode).maxBags < 2)
        .flatMap((f) => [19, 33, 47, 61].map((d) => ({ f, date: addDays("2027-03-01", d) }))),
    claims: ({ f, date }, ctx) => [`route:${f.origin}-${f.destination}:${date}`, `route:${f.destination}-${f.origin}:${addDays(date, 3)}`, about("flights", "flight", f.flightNo), ...nightClaims(cityOf(ctx, f.destination), date, 3)],
    build({ f, date }, ctx) {
      const carrier = ctx.flights.carrier.get(f.carrierCode);
      const back = searchFlights(ctx.rows.flights, { origin: f.destination, destination: f.origin, date: addDays(date, 3), passengers: 2, cabin: "economy", maxStops: 0 }).find((o) => !o.arrivesNextDay);
      const out = cabinOf(ctx, f.flightNo);
      if (!back || !out || searchFlights(ctx.rows.flights, { origin: f.origin, destination: f.destination, date, passengers: 2, cabin: "economy" }).every((o) => o.flightNo !== f.flightNo)) return null;
      const city = cityOf(ctx, f.destination);
      const landed = addDays(date, 1);
      const nights = 2;
      const room = ctx.rows.hotels.rooms.find((r) => ctx.hotels.hotel.get(r.hotelCode).city === city && r.maxAdults >= 2 && !stayProblem(ctx.hotels.hotel.get(r.hotelCode), r, { checkIn: landed, nights, adults: 2, kids: 0, pets: 0, lateCheckout: false }, ctx.rows.hotels.bookings));
      if (!room) return null;
      const hotel = ctx.hotels.hotel.get(room.hotelCode);
      const backCarrier = ctx.flights.carrier.get(back.carrierCode);
      const a = newPerson("plan-overnight-trip", 0), b = newPerson("plan-overnight-trip", 1);
      const outTotal = 2 * out.priceCents + 2 * 1 * carrier.bagFeeCents;
      const backTotal = 2 * back.priceCents + 2 * 1 * backCarrier.bagFeeCents;
      const total = outTotal + backTotal + room.nightlyCents * nights;
      return {
        apps: ["flights", "hotels"],
        target: f.flightNo,
        claims: [about("flights", "flight", back.flightNo), about("hotels", "room", room.code)],
        interacting: { what: `${f.flightNo} leaves ${date} at ${f.departs} and lands ${landed} at ${f.arrives}: the first hotel night is ${landed}, not ${date}`, greedyBreaks: landed !== date },
        recover: { code: "TOO_MANY_BAGS", what: `${carrier.code} takes ${carrier.maxBags} bag` },
        effort: { reads: 2, writes: 3 },
        summary: `${a.email} has the evening flight for two with one bag each, the flight back, and the room from the night they land until they fly back; the total is given.`,
        note: `${f.flightNo} ${date} ${f.departs}→${f.arrives}+1 (${carrier.code}, ${carrier.maxBags} bag); back ${back.flightNo} ${addDays(date, 3)}; ${room.code} from ${landed} × ${nights}; total ${dollars(total)}`,
        steps: [
          {
            kind: "state",
            apps: ["flights"],
            intent: `${a.name} and ${b.name} are flying from ${cityOf(ctx, f.origin)} to ${city} on flight ${f.flightNo} on ${date}. On ${site("flights")}, book them two economy seats, with two checked bags each if the airline takes two, otherwise one each; the contact email is ${a.email}.`,
            rubric: ["The reply says what was booked and with how many bags, as the site now shows it, and claims nothing that was not done.", "If the bags asked for could not be booked, the reply says so and gives the site's reason.", "Nothing was booked besides that one booking.", `The agent used only ${site("flights")} (and the workspace inbox, for a sign-up code), no other site and no outside source.`],
            oracle: stateOracle(flightBooked("out booked", a, f.flightNo, date, { passengerCount: 2, bags: 1 })),
            // The two bags refused on the way are not declared: a run that read the carrier's limit first need not try them.
            calls: [flying(leg(f, date, [a, b], 1, a))],
            solve: async (api) => {
              await api.attempt("flights", flightsPath.bookings, leg(f, date, [a, b], 2, a));
              return api.post("flights", flightsPath.bookings, leg(f, date, [a, b], 1, a));
            },
          },
          {
            kind: "state",
            apps: ["flights"],
            fact: back.flightNo,
            intent: `Then book the two of them on flight ${back.flightNo} back on ${addDays(date, 3)}, one checked bag each.`,
            rubric: R.stepChange("the flight back was booked"),
            oracle: stateOracle(flightBooked("back booked", a, back.flightNo, addDays(date, 3), { passengerCount: 2, bags: 1 })),
            calls: [flying(leg(back, addDays(date, 3), [a, b], 1, a))],
            solve: (api) => api.post("flights", flightsPath.bookings, leg(back, addDays(date, 3), [a, b], 1, a)),
          },
          {
            kind: "state",
            apps: ["hotels"],
            fact: room.code,
            intent: `On ${site("hotels")}, book the ${room.name} (${room.code}) at ${hotel.name} for the two of them, in ${a.name}'s name, for every night from the night they land until the day they fly back.`,
            rubric: R.stepChange("the room was booked"),
            oracle: stateOracle(hotelBooked("room booked", a, room.code, landed, { nights, adults: 2 })),
            calls: [staying(stayBody(room, landed, nights, a))],
            solve: (api) => api.post("hotels", hotelsPath.bookings, stayBody(room, landed, nights, a)),
          },
          {
            kind: "json",
            apps: ["flights", "hotels"],
            fact: "all together",
            intent: `What do the two flights and the room come to, all together? Answer as JSON: {"total": <dollars>}.`,
            rubric: R.stepAnswer("what the two flights and the room come to"),
            oracle: jsonOracle({ total: money(total) }),
            calls: [],
            answer: async (api) => {
              const fl = (await api.list("flights", flightsPath.bookingsOf(a.email))).filter((x) => x.status === "confirmed");
              const ho = (await api.list("hotels", hotelsPath.bookingsOf(a.email))).filter((x) => x.status === "confirmed");
              return { total: [...fl, ...ho].reduce((n, x) => n + x.totalCents, 0) / 100 };
            },
          },
        ],
      };
    },
  },
  {
    key: "plan-session-dinner",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about:
      "Two prompts on two sites: a registration for the earliest session of a course at an office that still has places (the earliest is full, so registering for it is refused, `FULL`, and the next is taken), then a table for two at a named restaurant in that city on the session's day at the earliest seating at least thirty minutes after it ends. The constraints interact: which session is had decides the dinner's day and time.",
    candidates: (ctx) => {
      const rows = ctx.rows.events;
      const byCourse = new Map();
      for (const e of rows.events.filter((x) => x.registration === "open" && x.status === "scheduled")) byCourse.set(`${e.officeCode}|${e.title}`, [...(byCourse.get(`${e.officeCode}|${e.title}`) ?? []), e]);
      return [...byCourse.values()].map((s) => [...s].sort((x, y) => `${x.date} ${x.startTime}`.localeCompare(`${y.date} ${y.startTime}`))).flatMap((sessions) => {
        const answer = sessions.find((e) => (eventPlacesLeft(rows, e) ?? 0) > 0);
        return answer && answer !== sessions[0] && eventPlacesLeft(rows, sessions[0]) === 0 ? [{ sessions, answer }] : [];
      });
    },
    claims: ({ sessions }) => sessions.map((e) => `event:${e.code}`),
    build({ sessions, answer }, ctx, rng) {
      const office = ctx.events.office.get(answer.officeCode);
      const me = newPerson("plan-session-dinner", 0);
      if (eventRegisterProblem(ctx.rows.events, answer, me)) return null;
      for (const r of shuffle(rng, ctx.rows.dining.restaurants.filter((x) => x.city === office.city))) {
        const indoor = (ctx.dining.seatingOf.get(r.code) ?? []).find((s) => s.area === "indoor" && s.seats >= 2);
        if (!indoor) continue;
        const times = diningSeatingTimes(r, answer.date);
        const dinner = times.find((t) => mins(t) >= mins(answer.endTime) + 30 && diningTablesLeft(indoor, ctx.rows.dining.reservations, answer.date, t) >= 1);
        const greedyTimes = diningSeatingTimes(r, sessions[0].date);
        const greedy = greedyTimes.find((t) => mins(t) >= mins(sessions[0].endTime) + 30);
        if (!dinner || (greedy && sessions[0].date === answer.date && greedy === dinner)) continue;
        return {
          apps: ["events", "dining"],
          hidden: [answer.code, dinner],
          claims: [`dining:${r.city}:${answer.date}`, about("dining", "restaurant", r.code)],
          interacting: { what: `${sessions[0].code} (full) would end at ${sessions[0].endTime} on ${sessions[0].date}; ${answer.code} ends at ${answer.endTime} on ${answer.date}`, greedyBreaks: sessions[0].date !== answer.date || greedy !== dinner },
          recover: { code: "FULL", what: `${sessions[0].code} has no place left` },
          effort: { reads: 1, writes: 2 },
          summary: `${me.email} is registered for the earliest session of "${answer.title}" at ${office.code} that had a place, and has a table for two at ${r.code} thirty minutes after it ends.`,
          note: `"${answer.title}" at ${office.code}: ${sessions[0].code} full → ${answer.code} ${answer.date} ends ${answer.endTime}; ${r.code} indoor at ${dinner}`,
          steps: [
            {
              kind: "state",
              apps: ["events"],
              intent: `On ${site("events")}, register ${me.name} (${me.email}) for "${answer.title}" at the ${office.name}: the earliest session there that they can still get a place on.`,
              rubric: ["The reply says which session they are registered for, as the site now shows it, and claims nothing that was not done.", "If a session could not be had, the reply says so and gives the site's reason.", "Nothing was done besides that one registration.", `The agent used only ${site("events")} (and the workspace inbox, for a sign-up code), no other site and no outside source.`],
              oracle: stateOracle(row("registered", "events", eventsPath.registrationsOf(me.email), { where: { status: "registered" }, count: { min: 1, max: 1 }, expect: { eventCode: answer.code }, entity: { type: "registration", id: "{regNo}" } })),
              // The full session refused on the way is not declared: a run that read its places first need not try it.
              calls: [registering(answer.code, me)],
              solve: async (api) => {
                await api.attempt("events", eventsPath.register(sessions[0].code), { name: me.name, email: me.email });
                return api.post("events", eventsPath.register(answer.code), { name: me.name, email: me.email });
              },
            },
            {
              kind: "state",
              apps: ["dining"],
              fact: r.name,
              intent: `Then, on ${site("dining")}, book a table for two indoors at ${r.name} (${r.code}) on the day of that session, at the earliest time at least thirty minutes after it ends, in the same name, phone ${me.phone}.`,
              rubric: R.stepChange("the table was booked"),
              oracle: stateOracle(row("table booked", "dining", diningPath.reservationsOf(me.email), { where: { restaurantCode: r.code, status: "confirmed" }, count: { min: 1, max: 1 }, expect: { date: answer.date, time: dinner, partySize: 2, area: "indoor" }, entity: { type: "reservation", id: "{reservationNo}" } })),
              calls: [reserving({ restaurantCode: r.code, area: "indoor", date: answer.date, time: dinner, partySize: 2, guestName: me.name, guestEmail: me.email, guestPhone: me.phone, note: "" })],
              solve: async (api) => {
                const slots = (await api.get("dining", diningPath.availability(r.code, answer.date, 2))).slots.filter((x) => x.area === "indoor" && mins(x.time) >= mins(answer.endTime) + 30 && x.tablesLeft >= 1).sort((x, y) => x.time.localeCompare(y.time));
                return api.post("dining", diningPath.reservations, { restaurantCode: r.code, area: "indoor", date: answer.date, time: slots[0].time, partySize: 2, guestName: me.name, guestEmail: me.email, guestPhone: me.phone, note: "" });
              },
            },
          ],
        };
      }
      return null;
    },
  },
  {
    key: "plan-film-hotel-budget",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about:
      "Two prompts on two sites under one budget: two named seats at a named showing, or two others side by side in the same row if one is taken (one is, so that booking is refused, `SEAT_TAKEN`); then a room for two for that night at the best-rated hotel in the city that keeps the tickets and the room within the budget. The constraints interact: the tickets decide what is left for the room, and the best-rated hotel is over it.",
    candidates: (ctx) => ctx.rows.cinema.showtimes,
    claims: (s, ctx) => [`showtime:${s.code}`, `cinema:${ctx.cinema.cinema.get(s.cinemaCode).city}:${s.date}`, ...nightClaims(ctx.cinema.cinema.get(s.cinemaCode).city, s.date, 1)],
    build(s, ctx) {
      const screen = ctx.cinema.screen.get(s.screenCode);
      const cinema = ctx.cinema.cinema.get(s.cinemaCode);
      const taken = cinemaTakenSeats(ctx.rows.cinema.bookings, s.code);
      const map = cinemaSeatMap(screen, taken);
      let named = null, fallback = null, rowOf = null;
      for (const r of map.filter((x) => !x.premium)) {
        for (let n = 1; n < screen.seatsPerRow && !named; n++) {
          const pair = [`${r.row}${n}`, `${r.row}${n + 1}`];
          if (pair.filter((x) => taken.has(x)).length !== 1) continue;
          const free = new Set(r.free);
          for (let m = 1; m < screen.seatsPerRow; m++) if (!fallback && free.has(`${r.row}${m}`) && free.has(`${r.row}${m + 1}`)) fallback = [`${r.row}${m}`, `${r.row}${m + 1}`];
          if (fallback) { named = pair; rowOf = r.row; } else fallback = null;
        }
        if (named) break;
      }
      if (!named) return null;
      const adult = ctx.rows.cinema.prices.find((p) => p.cinemaCode === cinema.code && p.format === s.format && p.ticketType === "adult");
      if (!adult) return null;
      const tickets = 2 * (adult.priceCents + cinema.bookingFeeCents);
      const stays = searchStays(ctx.rows.hotels, { city: cinema.city, checkIn: s.date, nights: 1, adults: 2, kids: 0, pets: 0 }).map((o) => ({ ...o, rating: ctx.hotels.hotel.get(o.hotelCode).rating })).sort((x, y) => y.rating - x.rating);
      if (stays.length < 3) return null;
      for (const target of stays.slice(1)) {
        const cap = Math.ceil((tickets + target.totalCents) / 1000) * 1000;
        const ok = stays.filter((x) => tickets + x.totalCents <= cap);
        if (!ok.length || ok[0].hotelCode !== target.hotelCode || ok.filter((x) => x.rating === ok[0].rating).length !== 1 || tickets + stays[0].totalCents <= cap) continue;
        const me = newPerson("plan-film-hotel-budget", 0);
        const film = ctx.cinema.film.get(s.filmCode);
        return {
          apps: ["cinema", "hotels"],
          target: s.code,
          hidden: [target.hotelCode, target.roomCode],
          claims: [about("hotels", "room", target.roomCode)],
          interacting: { what: `the budget ${dollars(cap)}: the tickets come to ${dollars(tickets)}, and the best-rated hotel, ${stays[0].hotelCode}, to ${dollars(stays[0].totalCents)}`, greedyBreaks: tickets + stays[0].totalCents > cap },
          recover: { code: "SEAT_TAKEN", what: `${named.find((x) => taken.has(x))} is taken` },
          effort: { reads: 3, writes: 2 },
          summary: `${me.email} has two seats side by side in row ${rowOf} of ${s.code} and a room for two that night at the best-rated hotel in ${cinema.city} the budget allows.`,
          note: `${s.code} row ${rowOf}: ${named.join("+")} has ${named.find((x) => taken.has(x))} taken; tickets ${dollars(tickets)}; budget ${dollars(cap)} → ${target.hotelCode} ${target.roomCode} (${target.rating}); best ${stays[0].hotelCode} is over`,
          steps: [
            {
              kind: "state",
              apps: ["cinema"],
              intent: `We have ${dollars(cap)} for a night out in ${cinema.city} on ${s.date}: the film and a hotel room. On ${site("cinema")}, book two adult tickets for the ${s.time} showing of ${film.title} at ${cinema.name} (${s.code}) for ${me.name} (${me.email}): seats ${named[0]} and ${named[1]} if they are free, otherwise two other seats side by side in row ${rowOf}.`,
              rubric: ["The reply says which seats were booked, as the site now shows them, and claims nothing that was not done.", "If the seats asked for could not be booked, the reply says so and gives the site's reason.", "Nothing was booked besides those two tickets.", `The agent used only ${site("cinema")} (and the workspace inbox, for a sign-up code), no other site and no outside source.`],
              oracle: stateOracle(row("tickets booked", "cinema", cinemaPath.bookingsOf(me.email), { where: { showtimeCode: s.code, status: "confirmed" }, count: { min: 1, max: 1 }, expect: { seatCount: 2, together: true }, entity: { type: "booking", id: "{bookingNo}" } })),
              // The pair with a taken seat, refused on the way, is not declared; the two booked are any two of the row
              // (the first pair side by side free there, for the proof), and with no counts both are adult tickets.
              calls: [call("create_booking", { showtimeCode: s.code, seats: fallback, adult: 2, customerName: me.name, customerEmail: me.email }, { seats: someOf(2, pattern(`^${rowOf}[0-9]+$`)), adult: free, customerName: free })],
              solve: async (api) => {
                const body = (seats) => ({ showtimeCode: s.code, seats, adult: 2, customerName: me.name, customerEmail: me.email });
                await api.attempt("cinema", cinemaPath.bookings, body(named));
                const x = await api.get("cinema", cinemaPath.showtime(s.code));
                const r = x.seatMap.find((m) => m.row === rowOf);
                const free = new Set(r.free);
                const first = r.seats.map((z) => z.seat).find((z) => free.has(z) && free.has(`${rowOf}${Number(z.slice(1)) + 1}`));
                return api.post("cinema", cinemaPath.bookings, body([first, `${rowOf}${Number(first.slice(1)) + 1}`]));
              },
            },
            {
              kind: "state",
              apps: ["hotels"],
              fact: "best-rated",
              intent: `Then, on ${site("hotels")}, book a room for the two of us for that night, in the same name, at the best-rated hotel in ${cinema.city} that keeps the tickets and the room within our ${dollars(cap)}.`,
              rubric: R.stepChange("the room was booked"),
              oracle: stateOracle(hotelBooked("room booked", me, target.roomCode, s.date, { nights: 1, adults: 2 })),
              calls: [staying(stayBody({ code: target.roomCode, hotelCode: target.hotelCode }, s.date, 1, me))],
              solve: async (api) => {
                // What the first step paid: two tickets in a row the fallback keeps to, so the same price whichever pair.
                const spent = tickets;
                const hotels = new Map((await api.list("hotels", "/api/v1/hotels")).map((h) => [h.code, h]));
                const offers = (await api.get("hotels", hotelsPath.search({ city: cinema.city, checkIn: s.date, nights: 1, adults: 2, kids: 0 }))).filter((o) => spent + o.totalCents <= cap).sort((x, y) => hotels.get(y.hotelCode).rating - hotels.get(x.hotelCode).rating);
                return api.post("hotels", hotelsPath.bookings, stayBody({ code: offers[0].roomCode, hotelCode: offers[0].hotelCode }, s.date, 1, me));
              },
            },
          ],
        };
      }
      return null;
    },
  },
  {
    key: "plan-no-pets",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "Two prompts on two sites: a named flight booked, then a named room type in the destination for the traveller and their dog, at a hotel that allows no pets: impossible (`NO_PETS`). The second step's right outcome is to say so and book nothing; its checks count from the flight.",
    candidates: (ctx) => ctx.rows.flights.flights.filter((f) => f.stops === 0 && !f.arrivesNextDay).flatMap((f) => [40, 54].map((d) => ({ f, date: addDays("2027-03-01", d) }))),
    claims: ({ f, date }) => [`route:${f.origin}-${f.destination}:${date}`, about("flights", "flight", f.flightNo)],
    build({ f, date }, ctx) {
      const city = cityOf(ctx, f.destination);
      const room = ctx.rows.hotels.rooms.find((r) => ctx.hotels.hotel.get(r.hotelCode).city === city && !ctx.hotels.hotel.get(r.hotelCode).petsAllowed);
      if (!room || !cabinOf(ctx, f.flightNo)) return null;
      const hotel = ctx.hotels.hotel.get(room.hotelCode);
      const me = newPerson("plan-no-pets", 0);
      return {
        apps: ["flights", "hotels"],
        target: f.flightNo,
        claims: [about("hotels", "room", room.code)],
        impossible: { code: "NO_PETS", step: 1 },
        effort: { reads: 0, writes: 1 },
        summary: `${me.email} has the flight; ${hotel.code} allows no pets, so no room is booked, and the agent looked or was refused for it.`,
        note: `${f.flightNo} ${date}; then ${room.code} with a dog: ${hotel.code} allows no pets`,
        steps: [
          {
            kind: "state",
            apps: ["flights"],
            intent: `On ${site("flights")}, book me one economy seat on flight ${f.flightNo} on ${date}, with no checked bag: ${me.name}, ${me.email}.`,
            rubric: R.change(["flights"], "the flight was booked"),
            oracle: stateOracle(flightBooked("flight booked", me, f.flightNo, date, { passengerCount: 1 })),
            calls: [flying(leg(f, date, [me], 0, me))],
            solve: (api) => api.post("flights", flightsPath.bookings, leg(f, date, [me], 0, me)),
          },
          {
            kind: "state",
            apps: ["hotels"],
            fact: "dog",
            intent: `On ${site("hotels")}, book me the ${room.name} (${room.code}) at ${hotel.name} for two nights from ${date}: one adult, and my dog comes with me.`,
            rubric: R.stepImpossible("book the room with the dog"),
            oracle: stateOracle(...impossibleChecks({ app: "hotels", things: [{ type: "room", id: room.code }, { type: "hotel", id: hotel.code }], code: "NO_PETS", after: "flight booked" })),
            calls: [],
            solve: (api) => api.attempt("hotels", hotelsPath.bookings, { ...stayBody(room, date, 2, me, 1), pets: 1 }),
          },
        ],
      };
    },
  },
  {
    key: "plan-return-outside",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "Two prompts on two sites: a named room type booked for the last nights of June, then the flight home on a date in July, impossible (`OUTSIDE_WINDOW`: flights are sold for departures to 2027-06-30). The second step's right outcome is to say so and book nothing; its checks count from the room.",
    candidates: (ctx) => ctx.rows.flights.flights.filter((f) => f.stops === 0),
    claims: (f, ctx) => [`flight-window:${f.flightNo}`, about("flights", "flight", f.flightNo), ...nightClaims(cityOf(ctx, f.origin), "2027-06-28", 3)],
    build(f, ctx) {
      const city = cityOf(ctx, f.origin);
      const room = ctx.rows.hotels.rooms.find((r) => ctx.hotels.hotel.get(r.hotelCode).city === city && !stayProblem(ctx.hotels.hotel.get(r.hotelCode), r, { checkIn: "2027-06-28", nights: 3, adults: 1, kids: 0, pets: 0, lateCheckout: false }, ctx.rows.hotels.bookings));
      if (!room) return null;
      const hotel = ctx.hotels.hotel.get(room.hotelCode);
      const me = newPerson("plan-return-outside", 0);
      return {
        apps: ["hotels", "flights"],
        target: room.code,
        claims: [about("hotels", "room", room.code)],
        impossible: { code: "OUTSIDE_WINDOW", step: 1 },
        effort: { reads: 0, writes: 1 },
        summary: `${me.email} has the room; no flight is sold for a July departure, so none is booked, and the agent looked or was refused for it.`,
        note: `${room.code} 2027-06-28 × 3; then ${f.flightNo} on 2027-07-01 is outside the window`,
        steps: [
          {
            kind: "state",
            apps: ["hotels"],
            intent: `I'm in ${city} at the end of June. On ${site("hotels")}, book me the ${room.name} (${room.code}) at ${hotel.name} for three nights from 2027-06-28, for one adult: ${me.name}, ${me.email}.`,
            rubric: R.change(["hotels"], "the room was booked"),
            oracle: stateOracle(hotelBooked("room booked", me, room.code, "2027-06-28", { nights: 3 })),
            calls: [staying(stayBody(room, "2027-06-28", 3, me, 1))],
            solve: (api) => api.post("hotels", hotelsPath.bookings, stayBody(room, "2027-06-28", 3, me, 1)),
          },
          {
            kind: "state",
            apps: ["flights"],
            fact: "2027-07-01",
            intent: `Then, on ${site("flights")}, book me one economy seat home on flight ${f.flightNo} on 2027-07-01, with no checked bag.`,
            rubric: R.stepImpossible("book the flight home"),
            oracle: stateOracle(...impossibleChecks({ app: "flights", things: [{ type: "flight", id: f.flightNo }], code: "OUTSIDE_WINDOW", after: "room booked" })),
            calls: [],
            solve: (api) => api.attempt("flights", flightsPath.bookings, leg(f, "2027-07-01", [me], 0, me)),
          },
        ],
      };
    },
  },
];

