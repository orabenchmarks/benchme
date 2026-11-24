/**
 * Book the best fit (change; hotels, flights, cinema, dining, homes): the
 * cheapest or earliest option that fits, found and then booked. Easy ones ask
 * it of one named place; medium ones find it by two or three requirements;
 * hard ones have a tempting option that does not fit, and the two longest span
 * two sites whose parts depend on each other, with a request refused part-way.
 * The impossible ones ask for what no option can give.
 *
 * Expected calls: each booking's write, of the option the task has the agent
 * find (the room, the showing, the slot, the flight, the table), with what the
 * task fixes; names and phones left free, the counts of all-adult tickets free
 * (with no count every seat is an adult's), named seats in any order and, when
 * any seats side by side will do, any seats of the screen. The refused first
 * try of a step that recovers is not declared; an impossible request declares
 * none.
 */
import { addDays, cinemaSearchShowtimes, cinemaSeatMap, cinemaTakenSeats, diningSeatingTimes, diningTablesLeft, homeSlotsOf, nightsOf, searchFlights, searchStays } from "../../../../packages/scenarios/dist/index.js";
import { anyOrder, call, free, ofType, pattern, someOf } from "../../calls.mjs";
import { R, about, dollars, impossibleChecks, newPerson, row, site, sitesText, stateOracle, PAGES_AND_TOOLS } from "../kit.mjs";
import { cinemaPath, diningPath, flightsPath, homesPath, hotelsPath } from "../paths.mjs";

const AREA = "book-the-best";
const nightClaims = (city, checkIn, nights) => nightsOf(checkIn, nights).map((d) => `night:${city.toLowerCase()}:${d}`);
const mins = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const clock = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
/** A date in the autumn of 2027, when no seeded booking or reservation holds anything. */
const AUTUMN = "2027-10-18";
const AMENITY = { gym: "a gym", breakfast: "breakfast", spa: "a spa", pool: "a pool", "free parking": "free parking", washer: "a washer", restaurant: "a restaurant", "airport shuttle": "an airport shuttle" };
const WORD = ["no", "one", "two", "three", "four", "five", "six"];
/** The first `n` seats side by side free in a seat map as the site serves it. */
const liveRun = (seatMap, n) => {
  for (const r of seatMap) {
    const free = new Set(r.free);
    for (const s of r.seats) {
      const want = Array.from({ length: n }, (_, i) => `${r.row}${Number(s.seat.slice(1)) + i}`);
      if (want.every((x) => free.has(x))) return want;
    }
  }
  return null;
};
const hotelBooked = (name, guest, roomCode, checkIn, nights, expect) =>
  row(name, "hotels", hotelsPath.bookingsOf(guest.email), { where: { roomCode, checkIn, status: "confirmed" }, count: { min: 1, max: 1 }, expect: { nights, ...expect }, entity: { type: "booking", id: "{bookingNo}" } });
const flightBooked = (name, contact, flightNo, date, expect) =>
  row(name, "flights", flightsPath.bookingsOf(contact.email), { where: { flightNo, date, status: "confirmed" }, count: { min: 1, max: 1 }, expect, entity: { type: "booking", id: "{bookingNo}" } });
/** Any seat of the screen: a booking of seats side by side may take any free run. */
const SEAT = pattern("^[A-Z][0-9]+$");
/** The first `n` seats side by side free at a showtime as the rows hold it: what a fresh workspace's seat map shows. */
const runAt = (ctx, screenCode, showtimeCode, n) => liveRun(cinemaSeatMap(ctx.cinema.screen.get(screenCode), cinemaTakenSeats(ctx.rows.cinema.bookings, showtimeCode)), n);

export const bestTemplates = [
  {
    key: "best-room-at-hotel",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "Book the cheapest room type of a named hotel that sleeps a party, for nights when every room type is free; a cheaper room type sleeps fewer, so the party matters. The check reads the guest's bookings: exactly one, of that room type, for the nights and party asked.",
    candidates: (ctx) => ctx.rows.hotels.hotels,
    claims: (h) => [`hotel-best:${h.code}`, ...nightClaims(h.city, AUTUMN, 2)],
    build(hotel, ctx) {
      const all = [...(ctx.hotels.roomsOf.get(hotel.code) ?? [])].sort((x, y) => x.nightlyCents - y.nightlyCents);
      for (const [adults, kids] of [[3, 0], [2, 2], [2, 1], [4, 0], [2, 0]]) {
        const rooms = all.filter((r) => r.maxAdults >= adults && r.maxKids >= kids);
        if (rooms.length < 2 || rooms[0].nightlyCents === rooms[1].nightlyCents || rooms[0] === all[0]) continue;
        const party = `${WORD[adults]} adult${adults === 1 ? "" : "s"}${kids ? ` and ${WORD[kids]} child${kids === 1 ? "" : "ren"}` : ""}`;
        const guest = newPerson("best-room-at-hotel", 0);
        return {
          apps: ["hotels"],
          target: hotel.code,
          hidden: [rooms[0].code],
          claims: [about("hotels", "room", rooms[0].code)],
          constraints: [party],
          effort: { reads: 1, writes: 1 },
          summary: `${guest.email} has one booking at ${hotel.code}, of its cheapest room type that sleeps the party.`,
          note: `${hotel.code}, ${party} → ${rooms[0].code} (${dollars(rooms[0].nightlyCents)}); ${all[0].code} is cheaper but sleeps fewer`,
          steps: [{
            kind: "state",
            intent: `On ${site("hotels")}, book the cheapest room at ${hotel.name} (${hotel.code}) that sleeps ${party}, for two nights from ${AUTUMN}, for ${guest.name} (${guest.email}).`,
            rubric: R.change(["hotels"], "the room was booked"),
            oracle: stateOracle(hotelBooked("booked", guest, rooms[0].code, AUTUMN, 2, { adults, kids })),
            calls: [call("create_booking", { roomCode: rooms[0].code, hotelCode: hotel.code, checkIn: AUTUMN, nights: 2, adults, kids, pets: 0, lateCheckout: false, guestName: guest.name, guestEmail: guest.email }, { hotelCode: free, guestName: free })],
            solve: async (api) => {
              const h = await api.get("hotels", hotelsPath.hotel(hotel.code));
              const room = h.rooms.filter((r) => r.maxAdults >= adults && r.maxKids >= kids).sort((x, y) => x.nightlyCents - y.nightlyCents)[0];
              return api.post("hotels", hotelsPath.bookings, { roomCode: room.code, hotelCode: hotel.code, checkIn: AUTUMN, nights: 2, adults, kids, pets: 0, lateCheckout: false, guestName: guest.name, guestEmail: guest.email });
            },
          }],
        };
      }
      return null;
    },
  },
  {
    key: "best-showing-earliest",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "Book two named seats, free there, at the earliest of a named film's showings at a named cinema on a date (`cinemaSearchShowtimes`, by start time). The check reads the customer's bookings: exactly one, of those seats at that showing.",
    candidates: (ctx) => {
      const groups = new Map();
      for (const o of cinemaSearchShowtimes(ctx.rows.cinema, {})) groups.set(`${o.cinemaCode}|${o.filmCode}|${o.date}`, [...(groups.get(`${o.cinemaCode}|${o.filmCode}|${o.date}`) ?? []), o]);
      return [...groups.values()].filter((g) => g.length >= 2);
    },
    claims: (shows) => [...shows.map((o) => `showtime:${o.showtimeCode}`), `cinema:${shows[0].city}:${shows[0].date}`],
    build(shows, ctx) {
      const first = shows[0];
      const map = cinemaSeatMap(ctx.cinema.screen.get(first.screenCode), cinemaTakenSeats(ctx.rows.cinema.bookings, first.showtimeCode));
      for (const r of [...map].sort((x, y) => Math.abs(x.row.charCodeAt(0) - 69) - Math.abs(y.row.charCodeAt(0) - 69))) {
        const open = new Set(r.free);
        const pair = r.seats.map((x) => x.seat).find((seat) => open.has(seat) && open.has(`${r.row}${Number(seat.slice(1)) + 1}`));
        if (!pair) continue;
        const seats = [pair, `${r.row}${Number(pair.slice(1)) + 1}`];
        const film = ctx.cinema.film.get(first.filmCode);
        const customer = newPerson("best-showing-earliest", 0);
        return {
          apps: ["cinema"],
          target: film.code,
          hidden: [first.showtimeCode, first.time],
          effort: { reads: 1, writes: 1 },
          summary: `${customer.email} has one booking of the two seats at the earliest showing of ${film.code} at ${first.cinemaCode} on ${first.date}.`,
          note: `${film.code} at ${first.cinemaCode} on ${first.date}: earliest of ${shows.length} → ${first.showtimeCode} (${first.time}), seats ${seats.join("+")}`,
          steps: [{
            kind: "state",
            intent: `On ${site("cinema")}, book seats ${seats[0]} and ${seats[1]}, two adult tickets, for ${customer.name} (${customer.email}) at the earliest showing of ${film.title} (${film.code}) at ${first.cinemaName} on ${first.date}.`,
            rubric: R.change(["cinema"], "the seats were booked"),
            oracle: stateOracle(row("booked", "cinema", cinemaPath.bookingsOf(customer.email), { where: { status: "confirmed" }, count: { min: 1, max: 1 }, expect: { showtimeCode: first.showtimeCode, seats: seats.join(",") }, entity: { type: "booking", id: "{bookingNo}" } })),
            calls: [call("create_booking", { showtimeCode: first.showtimeCode, seats, adult: 2, customerName: customer.name, customerEmail: customer.email }, { seats: anyOrder(seats), adult: free, customerName: free })],
            solve: async (api) => {
              const o = (await api.get("cinema", cinemaPath.search({ cinemaCode: first.cinemaCode, filmCode: film.code, date: first.date })))[0];
              return api.post("cinema", cinemaPath.bookings, { showtimeCode: o.showtimeCode, seats, adult: 2, customerName: customer.name, customerEmail: customer.email });
            },
          }],
        };
      }
      return null;
    },
  },
  {
    key: "best-viewing-earliest",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "Request the earliest free viewing slot of a named active listing, from a named date (`homeSlotsOf`). The check reads the viewer's requests: exactly one, of that listing at that slot.",
    candidates: (ctx) => ctx.rows.homes.listings.filter((l) => l.status === "active"),
    claims: (l, ctx) => (ctx.homes.daysOf.get(l.agentCode) ?? []).map((d) => `agent:${l.agentCode}:${d.date}`),
    build(l, ctx) {
      const slots = homeSlotsOf(ctx.rows.homes, l.agentCode);
      const from = slots.find((s) => !s.free)?.date;
      if (!from) return null;
      const first = slots.find((s) => s.free && s.date >= from);
      if (!first || first.date === from && first.time === slots.find((s) => s.date === from).time) return null;
      const viewer = newPerson("best-viewing-earliest", 0);
      return {
        apps: ["homes"],
        target: l.code,
        hidden: [first.time],
        effort: { reads: 1, writes: 1 },
        summary: `${viewer.email} has one viewing of ${l.code} requested, at its earliest free slot from ${from}.`,
        note: `${l.code} (agent ${l.agentCode}) from ${from} → ${first.date} ${first.time}`,
        steps: [{
          kind: "state",
          intent: `On ${site("homes")}, request the earliest viewing you can get of the ${l.type} at ${l.address} (${l.code}), on ${from} or later, for ${viewer.name} (${viewer.email}).`,
          rubric: R.change(["homes"], "the viewing was requested"),
          oracle: stateOracle(row("requested", "homes", homesPath.viewingsOf(viewer.email), { where: { listingCode: l.code, status: "requested" }, count: { min: 1, max: 1 }, expect: { date: first.date, time: first.time }, entity: { type: "viewing", id: "{viewingNo}" } })),
          calls: [call("request_viewing", { listingCode: l.code, date: first.date, time: first.time, viewerName: viewer.name, viewerEmail: viewer.email }, { viewerName: free })],
          solve: async (api) => {
            const s = (await api.get("homes", homesPath.slots(l.code, `${from}T00:00`)))[0];
            return api.post("homes", homesPath.viewings, { listingCode: l.code, date: s.date, time: s.time, viewerName: viewer.name, viewerEmail: viewer.email });
          },
        }],
      };
    },
  },
  {
    key: "best-flight-nonstop",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "Book the cheapest nonstop economy flight on a route and date for two (`searchFlights` with `maxStops: 0`); a flight with a stop is cheaper, so the requirement matters. The check reads the contact's bookings: exactly one, on that flight.",
    candidates: (ctx) => {
      const routes = [...new Set(ctx.rows.flights.flights.map((x) => `${x.origin}>${x.destination}`))];
      return routes.flatMap((r) => [13, 27, 41, 55].map((d) => ({ origin: r.split(">")[0], destination: r.split(">")[1], date: addDays("2027-03-01", d) })));
    },
    claims: (p) => [`route:${p.origin}-${p.destination}:${p.date}`],
    build({ origin, destination, date }, ctx) {
      const q = { origin, destination, date, passengers: 2, cabin: "economy" };
      const all = searchFlights(ctx.rows.flights, q);
      const nonstop = searchFlights(ctx.rows.flights, { ...q, maxStops: 0 });
      if (!all.length || all[0].stops === 0 || nonstop.length < 2 || nonstop[0].priceCents === nonstop[1].priceCents) return null;
      const a = newPerson("best-flight-nonstop", 0), b = newPerson("best-flight-nonstop", 1);
      const from = ctx.flights.airport.get(origin).city, to = ctx.flights.airport.get(destination).city;
      return {
        apps: ["flights"],
        hidden: [nonstop[0].flightNo],
        claims: [about("flights", "flight", nonstop[0].flightNo)],
        constraints: ["nonstop", "economy"],
        effort: { reads: 1, writes: 1 },
        summary: `${a.email} has one booking for two on the cheapest nonstop economy flight from ${from} to ${to} on ${date}.`,
        note: `${origin}→${destination} ${date}: cheapest ${all[0].flightNo} has a stop → nonstop ${nonstop[0].flightNo} (${dollars(nonstop[0].priceCents)})`,
        steps: [{
          kind: "state",
          intent: `On ${site("flights")}, book the cheapest nonstop flight from ${from} to ${to} on ${date} in economy for ${a.name} and ${b.name}, with no checked bags; the contact email is ${a.email}.`,
          rubric: R.change(["flights"], "the flight was booked"),
          oracle: stateOracle(flightBooked("booked", a, nonstop[0].flightNo, date, { cabin: "economy", passengerCount: 2 })),
          calls: [call("create_booking", { flightNo: nonstop[0].flightNo, date, cabin: "economy", passengers: [a.name, b.name], bags: 0, contactEmail: a.email }, { passengers: someOf(2, ofType("string")) })],
          solve: async (api) => {
            const o = (await api.get("flights", flightsPath.search({ ...q, maxStops: 0 }))).outbound[0];
            return api.post("flights", flightsPath.bookings, { flightNo: o.flightNo, date, cabin: "economy", passengers: [a.name, b.name], bags: 0, contactEmail: a.email });
          },
        }],
      };
    },
  },
  {
    key: "best-table-earliest",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "Book a table in a named area of a named restaurant on a date for a party the area seats, at a named time or the earliest after it with a table free (`diningTablesLeft`); the named time has one. The check reads the guest's reservations: exactly one, at that time, in that area.",
    candidates: (ctx) => ctx.rows.dining.seating.filter((s) => s.area !== "private" && s.seats >= 4).flatMap((s) => [4, 11].map((o) => ({ s, date: addDays("2027-05-03", o) }))),
    claims: ({ s, date }, ctx) => [`dining:${ctx.dining.restaurant.get(s.restaurantCode).city}:${date}`, about("dining", "restaurant", s.restaurantCode)],
    build({ s, date }, ctx) {
      const r = ctx.dining.restaurant.get(s.restaurantCode);
      const times = diningSeatingTimes(r, date).filter((t) => t >= "19:00");
      const first = times.find((t) => diningTablesLeft(s, ctx.rows.dining.reservations, date, t) >= 1);
      if (first !== "19:00") return null;
      const guest = newPerson("best-table-earliest", 0);
      const area = s.area === "bar" ? "at the bar" : s.area === "terrace" ? "on the terrace" : "indoors";
      return {
        apps: ["dining"],
        target: r.code,
        constraints: [area, "four", "19:00"],
        effort: { reads: 1, writes: 1 },
        summary: `${guest.email} has one reservation at ${r.code} on ${date} for four, ${area}, at the earliest time from 19:00 with a table.`,
        note: `${r.code} ${date}, ${s.area}, 4 people, from 19:00 → ${first}`,
        steps: [{
          kind: "state",
          intent: `On ${site("dining")}, book a table for four ${area} at ${r.name} (${r.code}) on ${date}, at 19:00 or as soon after as one is free, for ${guest.name} (${guest.email}, phone ${guest.phone}).`,
          rubric: R.change(["dining"], "the table was booked"),
          oracle: stateOracle(row("booked", "dining", diningPath.reservationsOf(guest.email), { where: { restaurantCode: r.code, date, status: "confirmed" }, count: { min: 1, max: 1 }, expect: { time: first, area: s.area, partySize: 4 }, entity: { type: "reservation", id: "{reservationNo}" } })),
          calls: [call("create_reservation", { restaurantCode: r.code, area: s.area, date, time: first, partySize: 4, guestName: guest.name, guestEmail: guest.email, guestPhone: guest.phone, note: "" }, { guestName: free, guestPhone: free })],
          solve: async (api) => {
            const slots = (await api.get("dining", diningPath.availability(r.code, date, 4))).slots.filter((x) => x.area === s.area && x.time >= "19:00" && x.tablesLeft >= 1).sort((x, y) => x.time.localeCompare(y.time));
            return api.post("dining", diningPath.reservations, { restaurantCode: r.code, area: s.area, date, time: slots[0].time, partySize: 4, guestName: guest.name, guestEmail: guest.email, guestPhone: guest.phone, note: "" });
          },
        }],
      };
    },
  },
  {
    key: "best-stay-amenity",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "Book the cheapest room in a city, for nights when every room is free, for two adults at a hotel with a named amenity (`searchStays`); the cheapest hotel in the city lacks it, so the requirement matters. The check reads the guest's bookings.",
    candidates: (ctx) => [...new Set(ctx.rows.hotels.hotels.map((h) => h.city))].flatMap((city) => Object.keys(AMENITY).map((amenity) => ({ city, amenity }))),
    claims: ({ city }) => [`hotels-search:${city}:2027-11-08`, ...nightClaims(city, "2027-11-08", 3)],
    build({ city, amenity }, ctx) {
      const q = { city, checkIn: "2027-11-08", nights: 3, adults: 2, kids: 0, pets: 0 };
      const all = searchStays(ctx.rows.hotels, q);
      const fit = searchStays(ctx.rows.hotels, { ...q, amenities: [amenity] });
      if (!all.length || fit.length < 2 || fit[0].hotelCode === all[0].hotelCode || fit[0].nightlyCents === fit[1].nightlyCents) return null;
      const guest = newPerson("best-stay-amenity", 0);
      return {
        apps: ["hotels"],
        hidden: [fit[0].hotelCode, fit[0].roomCode],
        claims: [about("hotels", "room", fit[0].roomCode)],
        constraints: [AMENITY[amenity], "two adults"],
        effort: { reads: 1, writes: 1 },
        summary: `${guest.email} has one booking of the cheapest room in ${city} for two adults at a hotel with ${AMENITY[amenity]}.`,
        note: `${city}, ${amenity}, 2 adults, 2027-11-08 × 3 → ${fit[0].roomCode} (${dollars(fit[0].nightlyCents)}); cheapest overall ${all[0].roomCode} has no ${amenity}`,
        steps: [{
          kind: "state",
          intent: `On ${site("hotels")}, book the cheapest room in ${city} for two adults for three nights from 2027-11-08, at a hotel with ${AMENITY[amenity]}, for ${guest.name} (${guest.email}).`,
          rubric: R.change(["hotels"], "the room was booked"),
          oracle: stateOracle(hotelBooked("booked", guest, fit[0].roomCode, "2027-11-08", 3, { adults: 2 })),
          calls: [call("create_booking", { roomCode: fit[0].roomCode, hotelCode: fit[0].hotelCode, checkIn: q.checkIn, nights: 3, adults: 2, kids: 0, pets: 0, lateCheckout: false, guestName: guest.name, guestEmail: guest.email }, { hotelCode: free, guestName: free })],
          solve: async (api) => {
            const o = (await api.get("hotels", hotelsPath.search({ ...q, amenities: [amenity] })))[0];
            return api.post("hotels", hotelsPath.bookings, { roomCode: o.roomCode, hotelCode: o.hotelCode, checkIn: q.checkIn, nights: 3, adults: 2, kids: 0, pets: 0, lateCheckout: false, guestName: guest.name, guestEmail: guest.email });
          },
        }],
      };
    },
  },
  {
    key: "best-flight-bags",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about:
      "Book the flight on a route and date that costs two travellers least in economy with two checked bags each (fares and the carrier's bag fees), and book it. The tempting one: the lowest fare is on a carrier that takes only one checked bag.",
    candidates: (ctx) => {
      const routes = [...new Set(ctx.rows.flights.flights.map((x) => `${x.origin}>${x.destination}`))];
      return routes.flatMap((r) => [17, 31, 45, 59].map((d) => ({ origin: r.split(">")[0], destination: r.split(">")[1], date: addDays("2027-03-01", d) })));
    },
    claims: (p) => [`route:${p.origin}-${p.destination}:${p.date}`],
    build({ origin, destination, date }, ctx) {
      const offers = searchFlights(ctx.rows.flights, { origin, destination, date, passengers: 2, cabin: "economy" });
      const carrierOf = (o) => ctx.flights.carrier.get(o.carrierCode);
      if (offers.length < 3 || carrierOf(offers[0]).maxBags >= 2) return null;
      const totals = offers.filter((o) => carrierOf(o).maxBags >= 2).map((o) => ({ o, total: 2 * o.priceCents + 4 * carrierOf(o).bagFeeCents })).sort((x, y) => x.total - y.total);
      if (totals.length < 2 || totals[0].total === totals[1].total) return null;
      const a = newPerson("best-flight-bags", 0), b = newPerson("best-flight-bags", 1);
      const from = ctx.flights.airport.get(origin).city, to = ctx.flights.airport.get(destination).city;
      return {
        apps: ["flights"],
        hidden: [totals[0].o.flightNo],
        claims: [about("flights", "flight", totals[0].o.flightNo)],
        tempting: { what: `${offers[0].flightNo} has the lowest fare, but its carrier takes one checked bag`, check: async (api) => (await api.get("flights", flightsPath.carriers)).find((c) => c.code === offers[0].carrierCode).maxBags < 2 },
        effort: { reads: 2, writes: 1 },
        summary: `${a.email} has one booking for two, each with two checked bags, on the flight that costs them least so.`,
        note: `${origin}→${destination} ${date}: ${offers[0].flightNo} lowest fare, 1 bag only → ${totals[0].o.flightNo} (${dollars(totals[0].total)} with bags)`,
        steps: [{
          kind: "state",
          intent: `On ${site("flights")}, ${a.name} and ${b.name} fly economy from ${from} to ${to} on ${date}, each with two checked bags. Book the flight that costs them least, bags included; the contact email is ${a.email}.`,
          rubric: R.change(["flights"], "the flight was booked"),
          oracle: stateOracle(flightBooked("booked", a, totals[0].o.flightNo, date, { cabin: "economy", passengerCount: 2, bags: 2 })),
          calls: [call("create_booking", { flightNo: totals[0].o.flightNo, date, cabin: "economy", passengers: [a.name, b.name], bags: 2, contactEmail: a.email }, { passengers: someOf(2, ofType("string")) })],
          solve: async (api) => {
            const carriers = new Map((await api.get("flights", flightsPath.carriers)).map((c) => [c.code, c]));
            const list = (await api.get("flights", flightsPath.search({ origin, destination, date, passengers: 2, cabin: "economy" }))).outbound.filter((o) => carriers.get(o.carrierCode).maxBags >= 2);
            const best = list.map((o) => ({ o, total: 2 * o.priceCents + 4 * carriers.get(o.carrierCode).bagFeeCents })).sort((x, y) => x.total - y.total)[0].o;
            return api.post("flights", flightsPath.bookings, { flightNo: best.flightNo, date, cabin: "economy", passengers: [a.name, b.name], bags: 2, contactEmail: a.email });
          },
        }],
      };
    },
  },
  {
    key: "best-stay-pets",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "Book the cheapest room in a city, for nights when every room is free, for one adult bringing a dog (`searchStays` with `pets`). The tempting one: the cheapest hotel in the city does not allow pets.",
    candidates: (ctx) => [...new Set(ctx.rows.hotels.hotels.map((h) => h.city))],
    claims: (city) => [`hotels-search:${city}:2027-11-22`, ...nightClaims(city, "2027-11-22", 2)],
    build(city, ctx) {
      const q = { city, checkIn: "2027-11-22", nights: 2, adults: 1, kids: 0, pets: 0 };
      const all = searchStays(ctx.rows.hotels, q);
      const pets = searchStays(ctx.rows.hotels, { ...q, pets: 1 });
      if (!all.length || pets.length < 2 || ctx.hotels.hotel.get(all[0].hotelCode).petsAllowed || pets[0].nightlyCents === pets[1].nightlyCents) return null;
      const guest = newPerson("best-stay-pets", 0);
      return {
        apps: ["hotels"],
        hidden: [pets[0].hotelCode, pets[0].roomCode],
        claims: [about("hotels", "room", pets[0].roomCode)],
        tempting: { what: `${all[0].hotelCode} is cheapest but allows no pets`, check: async (api) => (await api.get("hotels", hotelsPath.hotel(all[0].hotelCode))).petsAllowed === false },
        effort: { reads: 1, writes: 1 },
        summary: `${guest.email} has one booking, with a pet, of the cheapest room in ${city} at a hotel that allows pets.`,
        note: `${city} 2027-11-22 × 2, 1 adult + dog → ${pets[0].roomCode}; ${all[0].roomCode} is cheaper but ${all[0].hotelCode} allows no pets`,
        steps: [{
          kind: "state",
          intent: `On ${site("hotels")}, book the cheapest room in ${city} for two nights from 2027-11-22 for ${guest.name} (${guest.email}), who is bringing their dog.`,
          rubric: R.change(["hotels"], "the room was booked"),
          oracle: stateOracle(hotelBooked("booked", guest, pets[0].roomCode, "2027-11-22", 2, { adults: 1, pets: 1 })),
          calls: [call("create_booking", { roomCode: pets[0].roomCode, hotelCode: pets[0].hotelCode, checkIn: q.checkIn, nights: 2, adults: 1, kids: 0, pets: 1, lateCheckout: false, guestName: guest.name, guestEmail: guest.email }, { hotelCode: free, guestName: free })],
          solve: async (api) => {
            const o = (await api.get("hotels", hotelsPath.search({ ...q, pets: 1 })))[0];
            return api.post("hotels", hotelsPath.bookings, { roomCode: o.roomCode, hotelCode: o.hotelCode, checkIn: q.checkIn, nights: 2, adults: 1, kids: 0, pets: 1, lateCheckout: false, guestName: guest.name, guestEmail: guest.email });
          },
        }],
      };
    },
  },
  {
    key: "best-showing-cheapest",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about:
      "Book three seats side by side at the showing of a named film in a city on a date with the lowest adult price among those starting at or after a named time and still having three together (`cinemaSearchShowtimes`). The tempting one: an earlier showing that day is cheaper.",
    candidates: (ctx) => {
      const groups = new Map();
      for (const o of cinemaSearchShowtimes(ctx.rows.cinema, { seats: 3, together: true })) groups.set(`${o.city}|${o.filmCode}|${o.date}`, [...(groups.get(`${o.city}|${o.filmCode}|${o.date}`) ?? []), o]);
      return [...groups.values()].filter((g) => g.length >= 3);
    },
    claims: (shows) => [...shows.map((o) => `showtime:${o.showtimeCode}`), `cinema:${shows[0].city}:${shows[0].date}`],
    build(shows, ctx) {
      for (const after of ["17:00", "18:00", "19:00", "20:00"]) {
        const later = shows.filter((o) => o.time >= after).sort((x, y) => x.adultPriceCents - y.adultPriceCents);
        const trap = shows.filter((o) => o.time < after).sort((x, y) => x.adultPriceCents - y.adultPriceCents)[0];
        if (later.length < 2 || !trap || later[0].adultPriceCents === later[1].adultPriceCents || trap.adultPriceCents >= later[0].adultPriceCents) continue;
        const best = later[0];
        const customer = newPerson("best-showing-cheapest", 0);
        return {
          apps: ["cinema"],
          target: best.filmCode,
          hidden: [best.showtimeCode],
          tempting: { what: `${trap.showtimeCode} at ${trap.time} is cheaper, but starts before ${after}`, check: async (api) => (await api.get("cinema", cinemaPath.showtime(trap.showtimeCode))).time < after },
          effort: { reads: 2, writes: 1 },
          summary: `${customer.email} has one booking of three seats side by side at the cheapest showing of ${best.filmCode} in ${best.city} on ${best.date} from ${after} that has them.`,
          note: `${best.filmCode} ${best.city} ${best.date} from ${after}: ${trap.showtimeCode} (${trap.time}) is cheaper → ${best.showtimeCode} (${best.time}, ${dollars(best.adultPriceCents)})`,
          steps: [{
            kind: "state",
            intent: `On ${site("cinema")}, book three seats side by side, three adult tickets, for ${customer.name} (${customer.email}) at whichever showing of ${best.filmTitle} (${best.filmCode}) in ${best.city} on ${best.date} starting at ${after} or later has the lowest adult ticket price and still has three seats together.`,
            rubric: R.change(["cinema"], "the seats were booked"),
            oracle: stateOracle(row("booked", "cinema", cinemaPath.bookingsOf(customer.email), { where: { status: "confirmed" }, count: { min: 1, max: 1 }, expect: { showtimeCode: best.showtimeCode, seatCount: 3, together: true }, entity: { type: "booking", id: "{bookingNo}" } })),
            calls: [call("create_booking", { showtimeCode: best.showtimeCode, seats: runAt(ctx, best.screenCode, best.showtimeCode, 3), adult: 3, customerName: customer.name, customerEmail: customer.email }, { seats: someOf(3, SEAT), adult: free, customerName: free })],
            solve: async (api) => {
              const o = (await api.get("cinema", cinemaPath.search({ city: best.city, filmCode: best.filmCode, date: best.date, after, seats: 3, together: true }))).sort((x, y) => x.adultPriceCents - y.adultPriceCents)[0];
              const x = await api.get("cinema", cinemaPath.showtime(o.showtimeCode));
              return api.post("cinema", cinemaPath.bookings, { showtimeCode: o.showtimeCode, seats: liveRun(x.seatMap, 3), adult: 3, customerName: customer.name, customerEmail: customer.email });
            },
          }],
        };
      }
      return null;
    },
  },
  {
    key: "best-trip-budget",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about:
      "A trip over two sites under one budget: the earliest nonstop economy flight on a route and date for two travellers each checking two bags, then a room for two nights in the destination at the best-rated hotel with a gym that keeps flight and hotel together within the budget. The earliest nonstop is on a carrier that takes one bag, so its booking is refused (`TOO_MANY_BAGS`) and the next earliest nonstop is booked; it costs more, which leaves less for the hotel. The constraints interact: the hotel the first flight would have left room for is over the budget with the second.",
    candidates: (ctx) => {
      const routes = [...new Set(ctx.rows.flights.flights.map((x) => `${x.origin}>${x.destination}`))];
      return routes.flatMap((r) => Array.from({ length: 40 }, (_, i) => ({ origin: r.split(">")[0], destination: r.split(">")[1], date: addDays("2027-03-01", 3 * i) })));
    },
    claims: ({ origin, destination, date }, ctx) => [`route:${origin}-${destination}:${date}`, `hotels-search:${ctx.flights.airport.get(destination).city}:${date}`, ...nightClaims(ctx.flights.airport.get(destination).city, date, 2)],
    build({ origin, destination, date }, ctx) {
      const f = ctx.rows.flights;
      const carrierOf = (o) => ctx.flights.carrier.get(o.carrierCode);
      const nonstop = searchFlights(f, { origin, destination, date, passengers: 2, cabin: "economy", maxStops: 0 }).sort((x, y) => x.departs.localeCompare(y.departs) || x.flightNo.localeCompare(y.flightNo));
      if (nonstop.length < 2 || carrierOf(nonstop[0]).maxBags >= 2) return null;
      const second = nonstop.find((o) => carrierOf(o).maxBags >= 2);
      if (!second) return null;
      const cost = (o) => 2 * o.priceCents + 4 * carrierOf(o).bagFeeCents;
      const first = nonstop[0];
      const firstCost = 2 * first.priceCents + 2 * Math.min(2, carrierOf(first).maxBags) * carrierOf(first).bagFeeCents;
      if (cost(second) <= firstCost) return null;
      const city = ctx.flights.airport.get(destination).city;
      const stays = searchStays(ctx.rows.hotels, { city, checkIn: date, nights: 2, adults: 2, kids: 0, pets: 0, amenities: ["gym"] }).map((o) => ({ ...o, rating: ctx.hotels.hotel.get(o.hotelCode).rating }));
      if (stays.length < 3) return null;
      /** The best-rated stay within the budget once `spent` is spent, when exactly one has that rating. */
      const bestWith = (spent, cap) => {
        const ok = stays.filter((s) => spent + s.totalCents <= cap).sort((x, y) => y.rating - x.rating);
        return ok.length && ok.filter((s) => s.rating === ok[0].rating).length === 1 ? ok[0] : undefined;
      };
      for (const target of [...stays].sort((x, y) => y.rating - x.rating)) {
        const cap = Math.ceil((cost(second) + target.totalCents) / 1000) * 1000;
        const chosen = bestWith(cost(second), cap);
        const greedy = bestWith(firstCost, cap);
        if (!chosen || chosen.hotelCode !== target.hotelCode || !greedy || greedy.hotelCode === chosen.hotelCode) continue;
        const a = newPerson("best-trip-budget", 0), b = newPerson("best-trip-budget", 1);
        const from = ctx.flights.airport.get(origin).city;
        return {
          apps: ["flights", "hotels"],
          hidden: [second.flightNo, chosen.hotelCode, chosen.roomCode],
          claims: [about("flights", "flight", second.flightNo), about("hotels", "room", chosen.roomCode)],
          interacting: { what: `the budget ${dollars(cap)}: with ${first.flightNo} it would have reached ${greedy.hotelCode}; with ${second.flightNo} only ${chosen.hotelCode}`, greedyBreaks: cost(second) + greedy.totalCents > cap },
          recover: { code: "TOO_MANY_BAGS", what: `${first.flightNo}'s carrier takes ${carrierOf(first).maxBags} bag` },
          effort: { reads: 4, writes: 2 },
          summary: `${a.email} has the earliest nonstop that takes two bags each booked for two, and a room for two nights at the best-rated hotel with a gym the budget still allows.`,
          note: `${origin}→${destination} ${date}: ${first.flightNo} (${first.carrierCode}, 1 bag) refused → ${second.flightNo} ${dollars(cost(second))}; budget ${dollars(cap)} → ${chosen.hotelCode} ${chosen.roomCode} (${chosen.rating}, ${dollars(chosen.totalCents)}); with ${first.flightNo} it would have been ${greedy.hotelCode} (${greedy.rating})`,
          steps: [{
            kind: "state",
            apps: ["flights", "hotels"],
            intent: `${a.name} and ${b.name} are going from ${from} to ${city} on ${date} for two nights, with ${dollars(cap)} to spend on the flight and the hotel together. On ${site("flights")}, book them the earliest nonstop economy flight that day, each checking two bags; the contact email is ${a.email}. Then, on ${site("hotels")}, book a room for the two of them for those two nights in ${a.name}'s name, at the best-rated hotel in ${city} with a gym that still keeps the flight and the hotel within that amount.`,
            rubric: [
              "The reply says which flight and which room were booked, as the sites now show them, and claims nothing that was not done.",
              "If a booking was refused on the way, the reply says so and gives the site's reason.",
              "Nothing was done besides the one flight booking and the one room booking: no second booking, nothing else changed or cancelled, no extra account.",
              `The agent used only ${sitesText(["flights", "hotels"])} (and the workspace inbox, for a sign-up code), no other site and no outside source.`,
            ],
            oracle: stateOracle(
              flightBooked("flight booked", a, second.flightNo, date, { cabin: "economy", passengerCount: 2, bags: 2 }),
              hotelBooked("hotel booked", a, chosen.roomCode, date, 2, { adults: 2 }),
            ),
            calls: [
              call("create_booking", { flightNo: second.flightNo, date, cabin: "economy", passengers: [a.name, b.name], bags: 2, contactEmail: a.email }, { passengers: someOf(2, ofType("string")) }, { app: "flights" }),
              call("create_booking", { roomCode: chosen.roomCode, hotelCode: chosen.hotelCode, checkIn: date, nights: 2, adults: 2, kids: 0, pets: 0, lateCheckout: false, guestName: a.name, guestEmail: a.email }, { hotelCode: free, guestName: free }, { app: "hotels" }),
            ],
            solve: async (api) => {
              const carriers = new Map((await api.get("flights", flightsPath.carriers)).map((c) => [c.code, c]));
              const list = (await api.get("flights", flightsPath.search({ origin, destination, date, passengers: 2, cabin: "economy", maxStops: 0 }))).outbound.sort((x, y) => x.departs.localeCompare(y.departs) || x.flightNo.localeCompare(y.flightNo));
              const leg = (o) => ({ flightNo: o.flightNo, date, cabin: "economy", passengers: [a.name, b.name], bags: 2, contactEmail: a.email });
              await api.attempt("flights", flightsPath.bookings, leg(list[0]));
              const booked = await api.post("flights", flightsPath.bookings, leg(list.find((o) => carriers.get(o.carrierCode).maxBags >= 2)));
              const hotels = new Map((await api.list("hotels", "/api/v1/hotels")).map((h) => [h.code, h]));
              const offers = (await api.get("hotels", hotelsPath.search({ city, checkIn: date, nights: 2, adults: 2, kids: 0, amenities: ["gym"] }))).filter((o) => booked.totalCents + o.totalCents <= cap).sort((x, y) => hotels.get(y.hotelCode).rating - hotels.get(x.hotelCode).rating);
              return api.post("hotels", hotelsPath.bookings, { roomCode: offers[0].roomCode, hotelCode: offers[0].hotelCode, checkIn: date, nights: 2, adults: 2, kids: 0, pets: 0, lateCheckout: false, guestName: a.name, guestEmail: a.email });
            },
          }],
        };
      }
      return null;
    },
  },
  {
    key: "best-film-then-dinner",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about:
      "An evening over two sites and two prompts: five seats side by side at the earliest showing of a named film at a named cinema from 17:00, then a table for five at a named restaurant at the earliest seating at least thirty minutes after the film ends (start + `runtimeMinutes`), on the terrace if its tables seat five, otherwise inside. The terrace seats fewer, so that booking is refused (`TABLE_TOO_SMALL`) and an indoor table is booked. The constraints interact: the film's end decides the dinner time, and the restaurant's earliest evening table comes before it.",
    candidates: (ctx) => {
      const offers = cinemaSearchShowtimes(ctx.rows.cinema, { seats: 5, together: true, after: "17:00" });
      const out = [];
      for (const o of offers) {
        for (const r of ctx.rows.dining.restaurants.filter((x) => x.city === o.city)) out.push({ o, r });
      }
      return out;
    },
    claims: ({ o, r }, ctx) => [...cinemaSearchShowtimes(ctx.rows.cinema, { cinemaCode: o.cinemaCode, filmCode: o.filmCode, date: o.date }).map((x) => `showtime:${x.showtimeCode}`), `cinema:${o.city}:${o.date}`, `dining:${r.city}:${o.date}`, about("dining", "restaurant", r.code)],
    build({ o, r }, ctx) {
      const earliest = cinemaSearchShowtimes(ctx.rows.cinema, { cinemaCode: o.cinemaCode, filmCode: o.filmCode, date: o.date, seats: 5, together: true, after: "17:00" })[0];
      if (earliest.showtimeCode !== o.showtimeCode) return null;
      const film = ctx.cinema.film.get(o.filmCode);
      const ends = mins(o.time) + film.runtimeMinutes;
      const seating = ctx.dining.seatingOf.get(r.code) ?? [];
      const terrace = seating.find((s) => s.area === "terrace");
      const indoor = seating.find((s) => s.area === "indoor");
      if (!terrace || !indoor || terrace.seats >= 5 || indoor.seats < 5) return null;
      const times = diningSeatingTimes(r, o.date);
      const dinner = times.find((t) => mins(t) >= ends + 30 && diningTablesLeft(indoor, ctx.rows.dining.reservations, o.date, t) >= 1);
      const evening = times.find((t) => t >= "17:00" && diningTablesLeft(indoor, ctx.rows.dining.reservations, o.date, t) >= 1);
      if (!dinner || !evening || mins(evening) >= ends + 30) return null;
      const guest = newPerson("best-film-then-dinner", 0);
      return {
        apps: ["cinema", "dining"],
        target: film.code,
        hidden: [o.showtimeCode, dinner],
        interacting: { what: `the film ends at ${clock(ends)}; the restaurant's first evening table is at ${evening}`, greedyBreaks: mins(evening) < ends + 30 },
        recover: { code: "TABLE_TOO_SMALL", what: `the terrace tables seat ${terrace.seats}` },
        effort: { reads: 3, writes: 2 },
        summary: `${guest.email} has five seats together at the earliest showing from 17:00, and a table for five indoors at the first seating thirty minutes after the film ends.`,
        note: `${film.code} at ${o.cinemaCode} ${o.date}: ${o.showtimeCode} ${o.time} + ${film.runtimeMinutes} min → ends ${clock(ends)}; ${r.code} terrace seats ${terrace.seats} → indoor at ${dinner} (first evening table ${evening})`,
        steps: [
          {
            kind: "state",
            apps: ["cinema"],
            intent: `Five of us are going out on ${o.date}. On ${site("cinema")}, book five seats side by side, five adult tickets, at the earliest showing of ${film.title} (${film.code}) at ${o.cinemaName} that starts at 17:00 or later, for ${guest.name} (${guest.email}).`,
            rubric: R.change(["cinema"], "the seats were booked"),
            oracle: stateOracle(row("film booked", "cinema", cinemaPath.bookingsOf(guest.email), { where: { status: "confirmed" }, count: { min: 1, max: 1 }, expect: { showtimeCode: o.showtimeCode, seatCount: 5, together: true }, entity: { type: "booking", id: "{bookingNo}" } })),
            calls: [call("create_booking", { showtimeCode: o.showtimeCode, seats: runAt(ctx, o.screenCode, o.showtimeCode, 5), adult: 5, customerName: guest.name, customerEmail: guest.email }, { seats: someOf(5, SEAT), adult: free, customerName: free })],
            solve: async (api) => {
              const s = (await api.get("cinema", cinemaPath.search({ cinemaCode: o.cinemaCode, filmCode: film.code, date: o.date, after: "17:00", seats: 5, together: true })))[0];
              const x = await api.get("cinema", cinemaPath.showtime(s.showtimeCode));
              return api.post("cinema", cinemaPath.bookings, { showtimeCode: s.showtimeCode, seats: liveRun(x.seatMap, 5), adult: 5, customerName: guest.name, customerEmail: guest.email });
            },
          },
          {
            kind: "state",
            apps: ["dining"],
            fact: r.name,
            intent: `Then, on ${site("dining")}, book a table for the five of us at ${r.name} (${r.code}) that evening, at the earliest time at least thirty minutes after the film ends: on the terrace if its tables seat five, otherwise inside. Use ${guest.name}'s name and email, phone ${guest.phone}.`,
            rubric: [
              "The reply says which table was booked and when, as the site now shows it, and claims nothing that was not done.",
              "If the first choice could not be booked, the reply says so and gives the site's reason.",
              "Nothing besides that one reservation was made or changed in this step.",
            ],
            oracle: stateOracle(row("dinner booked", "dining", diningPath.reservationsOf(guest.email), { where: { restaurantCode: r.code, date: o.date, status: "confirmed" }, count: { min: 1, max: 1 }, expect: { partySize: 5, area: "indoor", time: dinner }, entity: { type: "reservation", id: "{reservationNo}" } })),
            calls: [call("create_reservation", { restaurantCode: r.code, area: "indoor", date: o.date, time: dinner, partySize: 5, guestName: guest.name, guestEmail: guest.email, guestPhone: guest.phone, note: "" }, { guestName: free, guestPhone: free })],
            solve: async (api) => {
              // What the agent knows from the first step: when the film it booked ends.
              const end = ends;
              const slots = (await api.get("dining", diningPath.availability(r.code, o.date, 5))).slots.filter((x) => mins(x.time) >= end + 30 && x.tablesLeft >= 1);
              const at = (area) => slots.filter((x) => x.area === area).sort((x, y) => x.time.localeCompare(y.time))[0]?.time;
              const body = (area, time) => ({ restaurantCode: r.code, area, date: o.date, time, partySize: 5, guestName: guest.name, guestEmail: guest.email, guestPhone: guest.phone, note: "" });
              await api.attempt("dining", diningPath.reservations, body("terrace", at("indoor")));
              return api.post("dining", diningPath.reservations, body("indoor", at("indoor")));
            },
          },
        ],
      };
    },
  },
  {
    key: "best-party-limit",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "The earliest table for fourteen at a named restaurant: impossible (`PARTY_LIMIT`: parties of more than twelve are not booked online). The right outcome is to say so and book nothing.",
    candidates: (ctx) => ctx.rows.dining.restaurants,
    claims: (r) => [`dining-limit:${r.code}`, about("dining", "restaurant", r.code)],
    build(r) {
      const guest = newPerson("best-party-limit", 0);
      const date = "2027-10-14";
      const body = { restaurantCode: r.code, area: "indoor", date, time: "19:00", partySize: 14, guestName: guest.name, guestEmail: guest.email, guestPhone: guest.phone, note: "" };
      return {
        apps: ["dining"],
        target: r.code,
        impossible: { code: "PARTY_LIMIT" },
        effort: { reads: 0, writes: 0 },
        summary: `Fourteen is more than ${r.code} books online: nothing is booked, and the agent looked at the restaurant or was refused for it.`,
        note: `${r.code}: party of 14 > 12`,
        steps: [{
          kind: "state",
          intent: `On ${site("dining")}, book the earliest table you can get at ${r.name} (${r.code}) on ${date} for a party of fourteen, for ${guest.name} (${guest.email}, phone ${guest.phone}).`,
          rubric: R.impossible(["dining"], "book a table for fourteen"),
          oracle: stateOracle(...impossibleChecks({ app: "dining", things: [{ type: "restaurant", id: r.code }], code: "PARTY_LIMIT" })),
          calls: [],
          solve: (api) => api.attempt("dining", diningPath.reservations, body),
        }],
      };
    },
  },
  {
    key: "best-viewing-inactive",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "The earliest viewing of a named listing that is no longer on the market (under offer or sold): impossible (`NOT_ACTIVE`: only active listings can be viewed). The right outcome is to say so and request nothing.",
    candidates: (ctx) => ctx.rows.homes.listings.filter((l) => l.status !== "active"),
    claims: (l) => [`listing:${l.code}`],
    build(l, ctx) {
      const slot = homeSlotsOf(ctx.rows.homes, l.agentCode).find((s) => s.free);
      if (!slot) return null;
      const viewer = newPerson("best-viewing-inactive", 0);
      return {
        apps: ["homes"],
        target: l.code,
        impossible: { code: "NOT_ACTIVE" },
        effort: { reads: 0, writes: 0 },
        summary: `${l.code} is ${l.status}: nothing is requested, and the agent looked at the listing or was refused for it.`,
        note: `${l.code} is ${l.status}`,
        steps: [{
          kind: "state",
          intent: `On ${site("homes")}, request the earliest viewing you can get of the ${l.type} at ${l.address} (${l.code}) for ${viewer.name} (${viewer.email}).`,
          rubric: R.impossible(["homes"], "request a viewing of it"),
          oracle: stateOracle(...impossibleChecks({ app: "homes", things: [{ type: "listing", id: l.code }], code: "NOT_ACTIVE" })),
          calls: [],
          solve: (api) => api.attempt("homes", homesPath.viewings, { listingCode: l.code, date: slot.date, time: slot.time, viewerName: viewer.name, viewerEmail: viewer.email }),
        }],
      };
    },
  },
];
