/**
 * Find the one that fits (answer; all nine sites): the only option that meets
 * several requirements, or a named one's fit, read from the site. The
 * impossible ones ask for an option none of the site's meets: the right answer
 * says none does (`noneTemplates`, last in the registry).
 */
import { addDays, cinemaSearchShowtimes, clinicFindDoctors, diningSearch, diningTablesLeft, nightsOf, pizzaMenuSearch, roomsLeft, searchFlights, searchHomeListings, searchStays, shuffle } from "../../../../packages/scenarios/dist/index.js";
import { R, dollars, foundOracle, jsonOracle, money, noneOracle, site, whichAnswer, PAGES_AND_TOOLS } from "../kit.mjs";
import { cinemaPath, clinicPath, diningPath, eventsPath, flightsPath, homesPath, hotelsPath, pizzaPath, sportsPath } from "../paths.mjs";

const AREA = "find-the-fit";
const partyText = (adults, kids) => `${adults} adult${adults === 1 ? "" : "s"}${kids ? ` and ${kids} child${kids === 1 ? "" : "ren"}` : ""}`;
const fits = (room, adults, kids) => adults <= room.maxAdults && kids <= room.maxKids;
const nightClaims = (city, checkIn, nights) => nightsOf(checkIn, nights).map((d) => `night:${city.toLowerCase()}:${d}`);
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
            intent: `On ${site("hotels")}, which room type at ${hotel.name} (${hotel.code}) sleeps ${party}? ${whichAnswer(`"room": "<the room type's code>"`)}`,
            rubric: R.which(["hotels"], "the room type that sleeps the party"),
            oracle: foundOracle({ room: fitting[0].code }),
            answer: async (api) => ({ found: true, room: api.only((await api.get("hotels", hotelsPath.hotel(hotel.code))).rooms.filter((r) => fits(r, adults, kids))).code }),
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
            intent: `On ${site("homes")}, which ${l.type} for sale in ${l.city} has ${feature}, ${capText}? ${whichAnswer(`"listing": "<the listing's code>"`)}`,
            rubric: R.which(["homes"], "the listing that meets every requirement"),
            oracle: foundOracle({ listing: l.code }),
            answer: async (api) => ({ found: true, listing: api.only(await api.get("homes", homesPath.search(q))).code }),
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
          intent: `On ${site("flights")}, which nonstop flight from ${from} to ${to} on ${date} leaves before 12:00 and still has an economy seat for one passenger? ${whichAnswer(`"flight": "<the flight number>"`)}`,
          rubric: R.which(["flights"], "the flight that meets every requirement"),
          oracle: foundOracle({ flight: found[0].flightNo }),
          answer: async (api) => ({ found: true, flight: api.only((await api.get("flights", flightsPath.search(q))).outbound).flightNo }),
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
          intent: `On ${site("cinema")}, which ${film.genre} showing in ${city} on ${s.date} is in ${fmt}, starts at or after ${after}, and still has two seats free? ${whichAnswer(`"showtime": "<the showtime's code>"`)}`,
          rubric: R.which(["cinema"], "the showtime that meets every requirement"),
          oracle: foundOracle({ showtime: s.code }),
          answer: async (api) => ({ found: true, showtime: api.only(await api.get("cinema", cinemaPath.search(q))).showtimeCode }),
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
            intent: `On ${site("pizza")}, which menu pizza can the ${branch.name} branch (${branch.code}) make as a ${size} that is vegetarian, has no ${allergen} in it, and costs ${capText}? ${whichAnswer(`"pizza": "<the menu pizza's code>"`)}`,
            rubric: R.which(["pizza"], "the menu pizza that meets every requirement"),
            oracle: foundOracle({ pizza: found[0].pizzaCode }),
            answer: async (api) => ({ found: true, pizza: api.only(await api.get("pizza", pizzaPath.search(q))).pizzaCode }),
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
            intent: `On ${site("hotels")}, which hotel in ${hotel.city} has a room free for ${nights} nights from ${checkIn} for ${partyText(adults, 0)}, ${capText}, with both ${AMENITY[pair[0]]} and ${AMENITY[pair[1]]}? ${whichAnswer(`"hotel": "<the hotel's code>"`)}`,
            rubric: R.which(["hotels"], "the hotel that meets every requirement"),
            oracle: foundOracle({ hotel: matches[0].hotelCode }),
            answer: async (api) => ({ found: true, hotel: api.only(await api.get("hotels", hotelsPath.search(q))).hotelCode }),
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
            intent: `On ${site("dining")}, which restaurant in ${r.city} has ${/^[aeiou]/.test(seating.area) ? "an" : "a"} ${seating.area} table free for ${partySize} at ${time} on ${date} and offers a ${menu} menu? ${whichAnswer(`"restaurant": "<the restaurant's code>"`)}`,
            rubric: R.which(["dining"], "the restaurant that meets every requirement"),
            oracle: foundOracle({ restaurant: found[0].restaurantCode }),
            answer: async (api) => ({ found: true, restaurant: api.only(await api.get("dining", diningPath.search(q))).restaurantCode }),
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
            intent: `On ${site("clinic")}, which ${closed.specialty} doctor in ${city} is in the network of the ${plan.name} plan, is taking new patients, and still has a free appointment on ${date}? ${whichAnswer(`"doctor": "<the doctor's code>"`)}`,
            rubric: R.which(["clinic"], "the doctor who meets every requirement"),
            oracle: foundOracle({ doctor: found[0].code }),
            answer: async (api) => ({ found: true, doctor: api.only((await api.get("clinic", clinicPath.doctors(q))).filter((m) => (m.freeSlots ?? []).length > 0)).code }),
          }],
        };
      }
      return null;
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
          intent: `On ${site("sports")}, which colour of the ${product.name} (${product.code}) in size ${best.size} is the cheapest one in stock, and what does it cost? ${whichAnswer(`"colour": "<the colour>", "price": <dollars>`, "if none is in stock")}`,
          rubric: R.which(["sports"], "the cheapest colour in stock and its price", "says that none is in stock"),
          oracle: foundOracle({ colour: best.colour, price: money(best.priceCents) }),
          answer: async (api) => {
            const live = (await api.get("sports", sportsPath.product(product.code))).variants.filter((v) => v.size === best.size && v.stock > 0).sort(byPrice);
            return { found: true, colour: live[0].colour, price: live[0].priceCents / 100 };
          },
        }],
      };
    },
  },
];

/**
 * The impossible ones of the area: a "which one" question no option meets. Each has a near miss, checked live
 * (`tempting`): an option that meets every requirement but one, so the question is never empty by accident, and
 * an answer of "none" is right only because of the requirement it fails. The prompt and the criteria are the
 * words of the questions one option meets (`whichAnswer`, `R.which`). Placed last in the registry, so adding them
 * moved no other template's picks.
 */
export const findNoneTemplates = [
  {
    key: "fit-stay-none",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about:
      "Which hotel in a city has a room free for a stay that fits the party, at no more than a nightly cap, with two named amenities: none does (`searchStays`). The near miss: a hotel with both amenities and a room within the cap that fits, booked out on one of the nights. The right answer says none does.",
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
      const cap = Math.ceil(room.nightlyCents / 1000) * 1000;
      const amenities = hotel.amenities.filter((a) => a !== "wifi" && AMENITY[a]);
      for (const pair of shuffle(rng, amenities.flatMap((x, i) => amenities.slice(i + 1).map((y) => [x, y])))) {
        const q = { ...base, amenities: pair, maxNightlyCents: cap };
        if (searchStays(rows, { ...base, amenities: pair }).some((o) => o.nightlyCents <= cap)) continue;
        const capText = `at no more than ${dollars(cap)} a night`;
        return {
          apps: ["hotels"],
          constraints: [capText, AMENITY[pair[0]], AMENITY[pair[1]]],
          impossible: { none: "no hotel" },
          tempting: { what: `${hotel.code}'s ${room.code} meets every requirement but is booked out on ${checkIn}`, check: async (api) => (await api.get("hotels", hotelsPath.availability(room.code, checkIn, nights))).roomsLeft === 0 },
          effort: { reads: 1, writes: 0 },
          summary: `No ${hotel.city} hotel has a free room for the stay that fits the party, within the cap, with both amenities: the answer says none does.`,
          note: `${hotel.city} ${checkIn} × ${nights}, ${partyText(adults, 0)}, ≤ ${dollars(cap)}, ${pair.join(" + ")} → none; ${room.code} at ${hotel.code} would fit but is booked out`,
          steps: [{
            kind: "json",
            intent: `On ${site("hotels")}, which hotel in ${hotel.city} has a room free for ${nights} nights from ${checkIn} for ${partyText(adults, 0)}, ${capText}, with both ${AMENITY[pair[0]]} and ${AMENITY[pair[1]]}? ${whichAnswer(`"hotel": "<the hotel's code>"`)}`,
            rubric: R.which(["hotels"], "the hotel that meets every requirement"),
            oracle: noneOracle(),
            answer: async (api) => ({ found: (await api.get("hotels", hotelsPath.search(q))).length > 0 }),
          }],
        };
      }
      return null;
    },
  },
  {
    key: "fit-table-none",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about:
      "Which restaurant in a city has a table in a named area free for a party at a date and time and offers a named dietary menu: none does (`diningSearch`). The near miss: a restaurant there with the menu and tables in that area big enough, every one of them taken then. The right answer says none does.",
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
        if (diningSearch(rows, q).length !== 0) continue;
        return {
          apps: ["dining"],
          constraints: [`${seating.area}`, `${menu} menu`],
          impossible: { none: "no restaurant" },
          tempting: { what: `${r.code} has the menu and ${seating.area} tables but all are taken at ${time}`, check: async (api) => (await api.get("dining", diningPath.availability(r.code, date, partySize))).slots.some((x) => x.area === seating.area && x.time === time && x.tablesLeft === 0) },
          effort: { reads: 1, writes: 0 },
          summary: `No ${r.city} restaurant has a free ${seating.area} table for the party then and a ${menu} menu: the answer says none does.`,
          note: `${r.city} ${date} ${time}, ${partySize} people, ${seating.area}, ${menu} → none; ${r.code} has both but is full then`,
          steps: [{
            kind: "json",
            intent: `On ${site("dining")}, which restaurant in ${r.city} has ${/^[aeiou]/.test(seating.area) ? "an" : "a"} ${seating.area} table free for ${partySize} at ${time} on ${date} and offers a ${menu} menu? ${whichAnswer(`"restaurant": "<the restaurant's code>"`)}`,
            rubric: R.which(["dining"], "the restaurant that meets every requirement"),
            oracle: noneOracle(),
            answer: async (api) => ({ found: (await api.get("dining", diningPath.search(q))).length > 0 }),
          }],
        };
      }
      return null;
    },
  },
];
