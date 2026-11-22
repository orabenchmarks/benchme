/**
 * Find the one that fits (answer; all nine sites): the only option that meets
 * several requirements, or a named one's fit, read from the site. The
 * impossible ones ask for what the site's rules cannot give a named place.
 */
import { addDays, cinemaSearchShowtimes, clinicFindDoctors, diningSearch, diningTablesLeft, nightsOf, pizzaMenuSearch, roomsLeft, searchFlights, searchHomeListings, searchStays, shuffle } from "../../../../packages/scenarios/dist/index.js";
import { R, about, dollars, impossibleChecks, jsonOracle, money, newPerson, site, stateOracle, PAGES_AND_TOOLS } from "../kit.mjs";
import { cinemaPath, clinicPath, diningPath, eventsPath, flightsPath, homesPath, hotelsPath, pizzaPath, sportsPath } from "../paths.mjs";

const AREA = "find-the-fit";
const partyText = (adults, kids) => `${adults} adult${adults === 1 ? "" : "s"}${kids ? ` and ${kids} child${kids === 1 ? "" : "ren"}` : ""}`;
const fits = (room, adults, kids) => adults <= room.maxAdults && kids <= room.maxKids;
const nightClaims = (city, checkIn, nights) => nightsOf(checkIn, nights).map((d) => `night:${city.toLowerCase()}:${d}`);
/** A date in the autumn of 2027 on a weekday (0 = Sunday), when no seeded booking or reservation holds anything. */
const autumnOn = (weekday, k = 0) => {
  let d = "2027-09-06";
  while (new Date(`${d}T00:00:00Z`).getUTCDay() !== weekday) d = addDays(d, 1);
  return addDays(d, 7 * k);
};
const WEEKDAY = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
const AMENITY = { gym: "a gym", breakfast: "breakfast", spa: "a spa", pool: "a pool", "free parking": "free parking", washer: "a washer", restaurant: "a restaurant", "airport shuttle": "an airport shuttle" };

export const findTemplates = [
  {
    key: "fit-room-sleeps",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "Which room type of a named hotel sleeps a party: exactly one of its room types takes that many adults and children.",
    candidates: (ctx) => ctx.rows.hotels.hotels,
    claims: (h) => [`fact:hotels:${h.code}`],
    build(hotel, ctx) {
      const rooms = ctx.hotels.roomsOf.get(hotel.code) ?? [];
      for (const [adults, kids] of [[3, 0], [2, 2], [3, 1], [2, 1], [4, 2]]) {
        const fitting = rooms.filter((r) => fits(r, adults, kids));
        if (fitting.length !== 1 || rooms.length < 2) continue;
        const party = partyText(adults, kids);
        return {
          apps: ["hotels"],
          target: hotel.code,
          constraints: [party],
          effort: { reads: 1, writes: 0 },
          summary: `The one room type at ${hotel.code} that sleeps the party.`,
          note: `${hotel.code}: ${party} → ${fitting[0].code}`,
          steps: [{
            kind: "json",
            intent: `On ${site("hotels")}, which room type at ${hotel.name} (${hotel.code}) sleeps ${party}? Answer as JSON: {"room": "<the room type's code>"}.`,
            rubric: R.answer(["hotels"], "the room type that sleeps the party"),
            oracle: jsonOracle({ room: fitting[0].code }),
            answer: async (api) => ({ room: api.only((await api.get("hotels", hotelsPath.hotel(hotel.code))).rooms.filter((r) => fits(r, adults, kids))).code }),
          }],
        };
      }
      return null;
    },
  },
  {
    key: "fit-restaurant-days",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "Which day a named restaurant is closed, and whether it has a vegan menu: both on its page.",
    candidates: (ctx) => ctx.rows.dining.restaurants,
    claims: (r) => [`fact:dining:${r.code}`],
    build(r) {
      return {
        apps: ["dining"],
        target: r.code,
        effort: { reads: 1, writes: 0 },
        summary: `The day ${r.code} is closed, and whether it has a vegan menu.`,
        note: `${r.code}: closed ${r.closedDay}, vegan ${r.menus.includes("vegan")}`,
        steps: [{
          kind: "json",
          intent: `On ${site("dining")}, on which day of the week is ${r.name} (${r.code}) closed, and does it have a vegan menu? Answer as JSON: {"closedDay": "<the day, in lower case>", "vegan": <true or false>}.`,
          rubric: R.answer(["dining"], "the day the restaurant is closed and whether it has a vegan menu"),
          oracle: jsonOracle({ closedDay: r.closedDay, vegan: r.menus.includes("vegan") }),
          answer: async (api) => {
            const x = await api.get("dining", diningPath.restaurant(r.code));
            return { closedDay: x.closedDay, vegan: x.menus.includes("vegan") };
          },
        }],
      };
    },
  },
  {
    key: "fit-doctor-visits",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "Whether a named doctor sees patients by video and takes new patients: both on the doctor's page.",
    candidates: (ctx) => ctx.rows.clinic.doctors,
    claims: (d) => [`fact:clinic:${d.code}`],
    build(d) {
      return {
        apps: ["clinic"],
        target: d.code,
        effort: { reads: 1, writes: 0 },
        summary: `Whether ${d.code} offers video visits and takes new patients.`,
        note: `${d.code}: video ${d.visitTypes.includes("video")}, new patients ${d.acceptingNewPatients}`,
        steps: [{
          kind: "json",
          intent: `On ${site("clinic")}, does ${d.name} (${d.code}) offer video visits, and are they taking new patients? Answer as JSON: {"video": <true or false>, "newPatients": <true or false>}.`,
          rubric: R.answer(["clinic"], "whether the doctor offers video visits and takes new patients"),
          oracle: jsonOracle({ video: d.visitTypes.includes("video"), newPatients: d.acceptingNewPatients }),
          answer: async (api) => {
            const x = await api.get("clinic", clinicPath.doctor(d.code));
            return { video: x.visitTypes.includes("video"), newPatients: x.acceptingNewPatients };
          },
        }],
      };
    },
  },
  {
    key: "fit-room-equipment",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "Whether a named meeting room has video conferencing and step-free access: both on the room's page.",
    candidates: (ctx) => ctx.rows.events.rooms,
    claims: (r) => [`fact:events:${r.code}`],
    build(room, ctx) {
      const office = ctx.events.office.get(room.officeCode);
      return {
        apps: ["events"],
        target: room.code,
        effort: { reads: 1, writes: 0 },
        summary: `Whether room ${room.code} has video conferencing and step-free access.`,
        note: `${room.code}: video conferencing ${room.equipment.includes("video conferencing")}, step-free ${room.accessible}`,
        steps: [{
          kind: "json",
          intent: `On ${site("events")}, does the meeting room ${room.name} (${room.code}) at the ${office.name} have video conferencing, and does it have step-free access? Answer as JSON: {"videoConferencing": <true or false>, "stepFree": <true or false>}.`,
          rubric: R.answer(["events"], "whether the room has video conferencing and step-free access"),
          oracle: jsonOracle({ videoConferencing: room.equipment.includes("video conferencing"), stepFree: room.accessible }),
          answer: async (api) => {
            const x = await api.get("events", eventsPath.room(room.code));
            return { videoConferencing: x.equipment.includes("video conferencing"), stepFree: x.accessible };
          },
        }],
      };
    },
  },
  {
    key: "fit-listing",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "The only active listing in a city of one type, with a named feature, at no more than a price cap (`searchHomeListings`). Each requirement matters: drop any one and two or more listings fit.",
    candidates: (ctx) => ctx.rows.homes.listings.filter((l) => l.status === "active" && l.features.length > 0),
    claims: (l) => [`homes-search:${l.city}`],
    build(l, ctx, rng) {
      const all = ctx.rows.homes.listings;
      for (const feature of shuffle(rng, l.features)) {
        const cap = Math.ceil(l.priceCents / 1000000) * 1000000;
        const q = { city: l.city, types: [l.type], features: [feature], maxPriceCents: cap, status: "active" };
        const found = searchHomeListings(all, q);
        if (found.length !== 1 || found[0].code !== l.code) continue;
        if (searchHomeListings(all, { ...q, types: [] }).length < 2 || searchHomeListings(all, { ...q, features: [] }).length < 2 || searchHomeListings(all, { ...q, maxPriceCents: undefined }).length < 2) continue;
        const capText = `at no more than ${dollars(cap)}`;
        return {
          apps: ["homes"],
          hidden: [l.code],
          constraints: [`${l.type} for sale`, feature, capText],
          effort: { reads: 1, writes: 0 },
          summary: `The only active ${l.type} listing in ${l.city} with ${feature} within the cap.`,
          note: `${l.city}, ${l.type}, ${feature}, ≤ ${dollars(cap)} → ${l.code}`,
          steps: [{
            kind: "json",
            intent: `On ${site("homes")}, which ${l.type} for sale in ${l.city} has ${feature}, ${capText}? Answer as JSON: {"listing": "<the listing's code>"}.`,
            rubric: R.answer(["homes"], "the listing that meets every requirement"),
            oracle: jsonOracle({ listing: l.code }),
            answer: async (api) => ({ listing: api.only(await api.get("homes", homesPath.search(q))).code }),
          }],
        };
      }
      return null;
    },
  },
  {
    key: "fit-flight",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "The only nonstop flight on a route and date that leaves before noon and still has an economy seat (`searchFlights`). Without either filter, two or more would do.",
    candidates: (ctx) => {
      const f = ctx.rows.flights;
      const routes = [...new Set(f.flights.map((x) => `${x.origin}>${x.destination}`))];
      return routes.flatMap((r) => [7, 19, 33, 47, 61].map((d) => ({ origin: r.split(">")[0], destination: r.split(">")[1], date: addDays("2027-03-01", d) })));
    },
    claims: (p) => [`route:${p.origin}-${p.destination}:${p.date}`],
    build({ origin, destination, date }, ctx) {
      const rows = ctx.rows.flights;
      const q = { origin, destination, date, passengers: 1, cabin: "economy", maxStops: 0, departBefore: "12:00" };
      const found = searchFlights(rows, q);
      if (found.length !== 1 || searchFlights(rows, { ...q, maxStops: undefined }).length < 2 || searchFlights(rows, { ...q, departBefore: undefined }).length < 2) return null;
      const from = ctx.flights.airport.get(origin).city;
      const to = ctx.flights.airport.get(destination).city;
      return {
        apps: ["flights"],
        hidden: [found[0].flightNo],
        constraints: ["nonstop", "before 12:00"],
        effort: { reads: 1, writes: 0 },
        summary: `The only nonstop ${from} to ${to} flight on ${date} leaving before noon with an economy seat.`,
        note: `${origin}→${destination} ${date}, nonstop, before 12:00 → ${found[0].flightNo}`,
        steps: [{
          kind: "json",
          intent: `On ${site("flights")}, which nonstop flight from ${from} to ${to} on ${date} leaves before 12:00 and still has an economy seat for one passenger? Answer as JSON: {"flight": "<the flight number>"}.`,
          rubric: R.answer(["flights"], "the flight that meets every requirement"),
          oracle: jsonOracle({ flight: found[0].flightNo }),
          answer: async (api) => ({ flight: api.only((await api.get("flights", flightsPath.search(q))).outbound).flightNo }),
        }],
      };
    },
  },
  {
    key: "fit-showtime",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "The only showtime in a city on a date of a named genre, in a named format, starting at or after a time, with seats for a party (`cinemaSearchShowtimes`). The format and the time each matter.",
    candidates: (ctx) => ctx.rows.cinema.showtimes,
    claims: (s, ctx) => [`cinema:${ctx.cinema.cinema.get(s.cinemaCode).city}:${s.date}`],
    build(s, ctx) {
      const rows = ctx.rows.cinema;
      const film = ctx.cinema.film.get(s.filmCode);
      const city = ctx.cinema.cinema.get(s.cinemaCode).city;
      const after = `${s.time.slice(0, 2)}:00`;
      const q = { city, date: s.date, genre: film.genre, format: s.format, after, seats: 2 };
      const found = cinemaSearchShowtimes(rows, q);
      if (found.length !== 1 || found[0].showtimeCode !== s.code) return null;
      if (cinemaSearchShowtimes(rows, { ...q, format: undefined }).length < 2 && cinemaSearchShowtimes(rows, { ...q, after: undefined }).length < 2) return null;
      const fmt = s.format === "large" ? "large format" : s.format.toUpperCase();
      return {
        apps: ["cinema"],
        hidden: [s.code],
        constraints: [film.genre, fmt, `at or after ${after}`],
        effort: { reads: 1, writes: 0 },
        summary: `The only ${film.genre} showing in ${city} on ${s.date} in ${fmt} from ${after} with two seats free.`,
        note: `${city} ${s.date}, ${film.genre}, ${fmt}, ≥ ${after}, 2 seats → ${s.code}`,
        steps: [{
          kind: "json",
          intent: `On ${site("cinema")}, which ${film.genre} showing in ${city} on ${s.date} is in ${fmt}, starts at or after ${after}, and still has two seats free? Answer as JSON: {"showtime": "<the showtime's code>"}.`,
          rubric: R.answer(["cinema"], "the showtime that meets every requirement"),
          oracle: jsonOracle({ showtime: s.code }),
          answer: async (api) => ({ showtime: api.only(await api.get("cinema", cinemaPath.search(q))).showtimeCode }),
        }],
      };
    },
  },
  {
    key: "fit-pizza",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "The only menu pizza a named branch can make that is vegetarian, has none of an allergen, and costs no more than a cap in a size (`pizzaMenuSearch` with the branch). The cap and the allergen each matter.",
    candidates: (ctx) => ctx.rows.pizza.branches.flatMap((b) => ["medium", "large"].flatMap((size) => ["dairy", "gluten", "nuts"].map((allergen) => ({ branch: b, size, allergen })))),
    claims: ({ branch }) => [`pizza-menu:${branch.code}`],
    build({ branch, size, allergen }, ctx) {
      const rows = ctx.rows.pizza;
      const base = { size, branchCode: branch.code, vegetarian: true, without: [allergen] };
      const all = pizzaMenuSearch(rows, base);
      for (const cap of [...new Set(all.map((o) => Math.ceil(o.priceCents / 100) * 100))]) {
        const q = { ...base, maxPriceCents: cap };
        const found = pizzaMenuSearch(rows, q);
        if (found.length !== 1 || all.length < 2 || pizzaMenuSearch(rows, { ...q, without: [] }).length < 2) continue;
        const capText = `${dollars(cap)} or less`;
        return {
          apps: ["pizza"],
          target: branch.code,
          hidden: [found[0].pizzaCode],
          constraints: ["vegetarian", `no ${allergen}`, capText],
          effort: { reads: 1, writes: 0 },
          summary: `The only vegetarian ${size} menu pizza without ${allergen} within the cap at ${branch.code}.`,
          note: `${branch.code} ${size}, vegetarian, no ${allergen}, ≤ ${dollars(cap)} → ${found[0].pizzaCode}`,
          steps: [{
            kind: "json",
            intent: `On ${site("pizza")}, which menu pizza can the ${branch.name} branch (${branch.code}) make as a ${size} that is vegetarian, has no ${allergen} in it, and costs ${capText}? Answer as JSON: {"pizza": "<the menu pizza's code>"}.`,
            rubric: R.answer(["pizza"], "the menu pizza that meets every requirement"),
            oracle: jsonOracle({ pizza: found[0].pizzaCode }),
            answer: async (api) => ({ pizza: api.only(await api.get("pizza", pizzaPath.search(q))).pizzaCode }),
          }],
        };
      }
      return null;
    },
  },
  {
    key: "fit-stay-tempting",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about:
      "Which hotel in a city has a room free for a stay that fits the party, at no more than a nightly cap, with two named amenities: exactly one (`searchStays`). The tempting one: another hotel has both amenities and a room within the cap that fits, but that room is booked out on one of the nights.",
    candidates: (ctx) => {
      const { rooms, bookings } = ctx.rows.hotels;
      const out = [];
      for (const room of rooms) {
        const nights = new Set(bookings.filter((b) => b.roomCode === room.code && b.status === "confirmed").flatMap((b) => nightsOf(b.checkIn, b.nights)));
        for (const night of [...nights].sort()) if (roomsLeft(room, bookings, night, 1) === 0) out.push({ room, hotel: ctx.hotels.hotel.get(room.hotelCode), checkIn: night, nights: 2 });
      }
      return out;
    },
    claims: (s) => nightClaims(s.hotel.city, s.checkIn, s.nights),
    build({ room, hotel, checkIn, nights }, ctx, rng) {
      const rows = ctx.rows.hotels;
      const adults = Math.min(2, room.maxAdults);
      const base = { city: hotel.city, checkIn, nights, adults, kids: 0, pets: 0 };
      const amenities = hotel.amenities.filter((a) => a !== "wifi");
      for (const pair of shuffle(rng, amenities.flatMap((x, i) => amenities.slice(i + 1).map((y) => [x, y])))) {
        const withAmenities = searchStays(rows, { ...base, amenities: pair });
        const cap = Math.ceil(room.nightlyCents / 1000) * 1000;
        const matches = withAmenities.filter((o) => o.nightlyCents <= cap);
        if (matches.length !== 1 || matches[0].hotelCode === hotel.code) continue;
        const capText = `at no more than ${dollars(cap)} a night`;
        const q = { ...base, amenities: pair, maxNightlyCents: cap };
        return {
          apps: ["hotels"],
          hidden: [matches[0].hotelCode],
          constraints: [capText, AMENITY[pair[0]], AMENITY[pair[1]]],
          tempting: { what: `${hotel.code}'s ${room.code} fits every requirement but is booked out on ${checkIn}`, check: async (api) => (await api.get("hotels", hotelsPath.availability(room.code, checkIn, nights))).roomsLeft === 0 },
          effort: { reads: 1, writes: 0 },
          summary: `The one ${hotel.city} hotel with a free room for the stay that fits the party, within the cap, with both amenities.`,
          note: `${hotel.city} ${checkIn} × ${nights}, ${partyText(adults, 0)}, ≤ ${dollars(cap)}, ${pair.join(" + ")} → ${matches[0].hotelCode}; ${room.code} would fit but is booked out`,
          steps: [{
            kind: "json",
            intent: `On ${site("hotels")}, which hotel in ${hotel.city} has a room free for ${nights} nights from ${checkIn} for ${partyText(adults, 0)}, ${capText}, with both ${AMENITY[pair[0]]} and ${AMENITY[pair[1]]}? Answer as JSON: {"hotel": "<the hotel's code>"}.`,
            rubric: R.answer(["hotels"], "the hotel that meets every requirement"),
            oracle: jsonOracle({ hotel: matches[0].hotelCode }),
            answer: async (api) => ({ hotel: api.only(await api.get("hotels", hotelsPath.search(q))).hotelCode }),
          }],
        };
      }
      return null;
    },
  },
  {
    key: "fit-table-tempting",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about:
      "Which restaurant in a city has a table in a named area free for a party at a date and time and offers a named dietary menu: exactly one (`diningSearch`). The tempting one: another restaurant there has the menu and tables in that area big enough, but every one of them is taken then.",
    candidates: (ctx) => {
      const d = ctx.rows.dining;
      const out = [];
      for (const s of d.seating) {
        const r = ctx.dining.restaurant.get(s.restaurantCode);
        for (const res of d.reservations.filter((x) => x.restaurantCode === r.code && x.area === s.area && x.status === "confirmed")) {
          if (diningTablesLeft(s, d.reservations, res.date, res.time) === 0) out.push({ r, seating: s, date: res.date, time: res.time });
        }
      }
      return out;
    },
    claims: ({ r, date }) => [`dining:${r.city}:${date}`],
    build({ r, seating, date, time }, ctx) {
      const rows = ctx.rows.dining;
      const partySize = Math.min(seating.seats, 4);
      for (const menu of r.menus) {
        const q = { city: r.city, date, time, partySize, area: seating.area, menus: [menu] };
        const found = diningSearch(rows, q);
        if (found.length !== 1 || found[0].restaurantCode === r.code) continue;
        return {
          apps: ["dining"],
          hidden: [found[0].restaurantCode],
          constraints: [`${seating.area}`, `${menu} menu`],
          tempting: { what: `${r.code} has the menu and ${seating.area} tables but all are taken at ${time}`, check: async (api) => (await api.get("dining", diningPath.availability(r.code, date, partySize))).slots.some((x) => x.area === seating.area && x.time === time && x.tablesLeft === 0) },
          effort: { reads: 1, writes: 0 },
          summary: `The one ${r.city} restaurant with a free ${seating.area} table for the party then and a ${menu} menu.`,
          note: `${r.city} ${date} ${time}, ${partySize} people, ${seating.area}, ${menu} → ${found[0].restaurantCode}; ${r.code} has both but is full then`,
          steps: [{
            kind: "json",
            intent: `On ${site("dining")}, which restaurant in ${r.city} has ${/^[aeiou]/.test(seating.area) ? "an" : "a"} ${seating.area} table free for ${partySize} at ${time} on ${date} and offers a ${menu} menu? Answer as JSON: {"restaurant": "<the restaurant's code>"}.`,
            rubric: R.answer(["dining"], "the restaurant that meets every requirement"),
            oracle: jsonOracle({ restaurant: found[0].restaurantCode }),
            answer: async (api) => ({ restaurant: api.only(await api.get("dining", diningPath.search(q))).restaurantCode }),
          }],
        };
      }
      return null;
    },
  },
  {
    key: "fit-doctor-tempting",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about:
      "Which doctor of a specialty in a city is in a plan's network, takes new patients and has a free appointment on a date: exactly one (`clinicFindDoctors`). The tempting one: another doctor there of that specialty is in the network and free that day, but takes no new patients.",
    candidates: (ctx) => {
      const k = ctx.rows.clinic;
      const out = [];
      for (const d of k.doctors.filter((x) => !x.acceptingNewPatients)) {
        for (const offset of [9, 23, 37, 51]) {
          const date = addDays("2027-03-01", offset);
          const free = clinicFindDoctors(k, { date }).find((m) => m.code === d.code)?.freeSlots ?? [];
          if (free.length > 0) out.push({ closed: d, date });
        }
      }
      return out;
    },
    claims: ({ closed, date }, ctx) => [`clinic:${ctx.clinic.clinic.get(closed.clinicCode).city}:${date}`],
    build({ closed, date }, ctx) {
      const k = ctx.rows.clinic;
      const city = ctx.clinic.clinic.get(closed.clinicCode).city;
      const free = (matches) => matches.filter((m) => (m.freeSlots ?? []).length > 0);
      for (const planCode of closed.networkPlans) {
        const q = { city, specialty: closed.specialty, planCode, newPatients: true, date };
        const found = free(clinicFindDoctors(k, q));
        if (found.length !== 1 || !free(clinicFindDoctors(k, { ...q, newPatients: false })).some((m) => m.code === closed.code)) continue;
        const plan = ctx.clinic.plan.get(planCode);
        return {
          apps: ["clinic"],
          hidden: [found[0].code],
          constraints: [closed.specialty, plan.name, "taking new patients"],
          tempting: { what: `${closed.code} is a ${closed.specialty} in the network, free that day, but takes no new patients`, check: async (api) => (await api.get("clinic", clinicPath.doctor(closed.code))).acceptingNewPatients === false },
          effort: { reads: 1, writes: 0 },
          summary: `The one ${closed.specialty} in ${city} in the plan's network who takes new patients and has a free appointment on ${date}.`,
          note: `${city}, ${closed.specialty}, ${planCode}, new patients, ${date} → ${found[0].code}; ${closed.code} is in network and free but takes no new patients`,
          steps: [{
            kind: "json",
            intent: `On ${site("clinic")}, which ${closed.specialty} doctor in ${city} is in the network of the ${plan.name} plan, is taking new patients, and still has a free appointment on ${date}? Answer as JSON: {"doctor": "<the doctor's code>"}.`,
            rubric: R.answer(["clinic"], "the doctor who meets every requirement"),
            oracle: jsonOracle({ doctor: found[0].code }),
            answer: async (api) => ({ doctor: api.only((await api.get("clinic", clinicPath.doctors(q))).filter((m) => (m.freeSlots ?? []).length > 0)).code }),
          }],
        };
      }
      return null;
    },
  },
  {
    key: "fit-table-closed",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "A table at a named restaurant, on a date that falls on the one weekday it is closed: impossible (`CLOSED`). The right outcome is to say so and book nothing.",
    candidates: (ctx) => ctx.rows.dining.restaurants,
    claims: (r) => [`dining-closed:${r.code}`, about("dining", "restaurant", r.code)],
    build(r, ctx) {
      const date = autumnOn(WEEKDAY[r.closedDay], 2);
      const seating = (ctx.dining.seatingOf.get(r.code) ?? []).find((s) => s.seats >= 2);
      if (!seating) return null;
      const guest = newPerson("fit-table-closed", 0);
      const body = { restaurantCode: r.code, area: seating.area, date, time: "19:00", partySize: 2, guestName: guest.name, guestEmail: guest.email, guestPhone: guest.phone, note: "" };
      const thing = { type: "restaurant", id: r.code };
      return {
        apps: ["dining"],
        target: r.code,
        impossible: { code: "CLOSED" },
        effort: { reads: 0, writes: 0 },
        summary: `${r.code} is closed on the day asked: nothing is booked, and the agent looked at the restaurant or was refused for it.`,
        note: `${r.code} is closed on ${r.closedDay}s; ${date} is one`,
        steps: [{
          kind: "state",
          intent: `On ${site("dining")}, find a time in the evening of ${date} for a table for two at ${r.name} (${r.code}) and book it for ${guest.name} (${guest.email}, phone ${guest.phone}).`,
          rubric: R.impossible(["dining"], "book a table on that day"),
          oracle: stateOracle(...impossibleChecks({ app: "dining", things: [thing], code: "CLOSED" })),
          solve: (api) => api.attempt("dining", diningPath.reservations, body),
        }],
      };
    },
  },
  {
    key: "fit-room-capacity",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "One room at a named hotel for more adults than any of its room types sleeps: impossible (`TOO_MANY_GUESTS`). The right outcome is to say so and book nothing.",
    candidates: (ctx) => ctx.rows.hotels.hotels,
    claims: (h, ctx) => [`hotel-capacity:${h.code}`, ...nightClaims(h.city, "2027-10-11", 2), ...(ctx.hotels.roomsOf.get(h.code) ?? []).map((r) => about("hotels", "room", r.code))],
    build(hotel, ctx) {
      const rooms = ctx.hotels.roomsOf.get(hotel.code) ?? [];
      const most = Math.max(...rooms.map((r) => r.maxAdults));
      if (most >= 4) return null;
      const biggest = rooms.find((r) => r.maxAdults === most);
      const guest = newPerson("fit-room-capacity", 0);
      const adults = most + 1;
      const body = { roomCode: biggest.code, hotelCode: hotel.code, checkIn: "2027-10-11", nights: 2, adults, kids: 0, pets: 0, lateCheckout: false, guestName: guest.name, guestEmail: guest.email };
      const things = [{ type: "hotel", id: hotel.code }, ...rooms.map((r) => ({ type: "room", id: r.code }))];
      return {
        apps: ["hotels"],
        target: hotel.code,
        impossible: { code: "TOO_MANY_GUESTS" },
        effort: { reads: 0, writes: 0 },
        summary: `No room at ${hotel.code} sleeps that many adults: nothing is booked, and the agent looked at the hotel or was refused for it.`,
        note: `${hotel.code}'s rooms sleep at most ${most} adults; ${adults} asked`,
        steps: [{
          kind: "state",
          intent: `On ${site("hotels")}, find one room at ${hotel.name} (${hotel.code}) where ${adults} adults can stay together for 2 nights from 2027-10-11, and book it for ${guest.name} (${guest.email}).`,
          rubric: R.impossible(["hotels"], `book one room for ${adults} adults`),
          oracle: stateOracle(...impossibleChecks({ app: "hotels", things, code: "TOO_MANY_GUESTS" })),
          solve: (api) => api.attempt("hotels", hotelsPath.bookings, body),
        }],
      };
    },
  },
];

/**
 * Placed last in the registry: it reads stock that the orders of other tasks change, so it takes the variants they
 * leave alone.
 */
export const findLastTemplates = [
  {
    key: "fit-variant-tempting",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about:
      "Which colour of a named product, in a named size, is the cheapest that is in stock, and at what price: exactly one. The tempting one: a cheaper colour in that size is out of stock.",
    candidates: (ctx) => {
      const groups = new Map();
      for (const v of ctx.rows.sports.variants) groups.set(`${v.productCode}|${v.size}`, [...(groups.get(`${v.productCode}|${v.size}`) ?? []), v]);
      return [...groups.values()].filter((vs) => {
        const inStock = vs.filter((v) => v.stock > 0);
        const out = vs.filter((v) => v.stock === 0);
        return inStock.length >= 2 && out.length > 0 && Math.min(...out.map((v) => v.priceCents)) < Math.min(...inStock.map((v) => v.priceCents));
      });
    },
    claims: (vs) => vs.map((v) => `variant:${v.sku}`),
    build(vs, ctx) {
      const byPrice = (x, y) => x.priceCents - y.priceCents;
      const inStock = vs.filter((v) => v.stock > 0).sort(byPrice);
      const trap = vs.filter((v) => v.stock === 0).sort(byPrice)[0];
      const best = inStock[0];
      if (inStock[1].priceCents === best.priceCents) return null;
      const product = ctx.sports.product.get(best.productCode);
      return {
        apps: ["sports"],
        target: product.code,
        hidden: [best.sku, best.colour],
        constraints: [`size ${best.size}`, "in stock"],
        tempting: { what: `${trap.sku} is cheaper, and out of stock`, check: async (api) => (await api.get("sports", sportsPath.variant(trap.sku))).stock === 0 },
        effort: { reads: 1, writes: 0 },
        summary: `The cheapest colour of ${product.code} in size ${best.size} that is in stock, and its price.`,
        note: `${product.code} size ${best.size}: ${trap.sku} (${dollars(trap.priceCents)}) is out of stock → ${best.sku} ${best.colour}, ${dollars(best.priceCents)}`,
        steps: [{
          kind: "json",
          intent: `On ${site("sports")}, which colour of the ${product.name} (${product.code}) in size ${best.size} is the cheapest one in stock, and what does it cost? Answer as JSON: {"colour": "<the colour>", "price": <dollars>}.`,
          rubric: R.answer(["sports"], "the cheapest colour in stock and its price"),
          oracle: jsonOracle({ colour: best.colour, price: money(best.priceCents) }),
          answer: async (api) => {
            const live = (await api.get("sports", sportsPath.product(product.code))).variants.filter((v) => v.size === best.size && v.stock > 0).sort(byPrice);
            return { colour: live[0].colour, price: live[0].priceCents / 100 };
          },
        }],
      };
    },
  },
];
