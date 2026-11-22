/**
 * Book it (change; all nine sites): a named booking or order made for a new
 * customer. Easy ones name everything; medium ones leave one choice to a site
 * rule (the party decides the area, the people decide the size) or to two or
 * three requirements; hard ones have a tempting option that does not fit, or
 * run over three prompts. The impossible ones ask for what is sold out.
 */
import {
  addDays, cinemaFreeRuns, cinemaSearchShowtimes, cinemaSeatMap, cinemaTakenSeats, diningAreaLabel, diningSeatingTimes, diningTablesLeft, eventPlacesLeft,
  eventRegisterProblem, flightSeatsLeft, homeSlotsOf, nightsOf, pizzaOutOfStock, pizzaPlaceOrder, pizzaSizeFor, pizzaSlotLeft, pizzaSlots,
  clinicFreeSlots,
} from "../../../../packages/scenarios/dist/index.js";
import { R, about, dollars, impossibleChecks, jsonOracle, money, newPerson, row, seen, site, stateOracle, PAGES_AND_TOOLS } from "../kit.mjs";
import { cinemaPath, clinicPath, diningPath, eventsPath, flightsPath, homesPath, hotelsPath, pizzaPath, sportsPath } from "../paths.mjs";

const AREA = "book-it";
const nightClaims = (city, checkIn, nights) => nightsOf(checkIn, nights).map((d) => `night:${city.toLowerCase()}:${d}`);
const CABIN = { economy: "economy", premium: "premium economy", business: "business" };
const partyText = (adults, kids) => `${adults} adult${adults === 1 ? "" : "s"}${kids ? ` and ${kids} child${kids === 1 ? "" : "ren"}` : ""}`;
/** The first `n` seats side by side free in a showtime's seat map, or null. */
const runOf = (screen, taken, n) => {
  for (const run of cinemaFreeRuns(screen, taken)) if (run.length >= n) return run.slice(0, n);
  return null;
};
const liveRun = (seatMap, n) => {
  for (const r of seatMap) {
    const free = new Set(r.free);
    for (const s of r.seats) {
      const num = Number(s.seat.slice(1));
      const want = Array.from({ length: n }, (_, i) => `${r.row}${num + i}`);
      if (want.every((x) => free.has(x))) return want;
    }
  }
  return null;
};
const counts = (adult, child = 0, senior = 0, student = 0) => ({ adult, child, senior, student });
const visitText = (type) => (type === "in-person" ? "an in-person" : "a video");
const WORD = ["no", "one", "two", "three", "four", "five", "six"];
/** "two adult tickets and one child ticket". */
const mixText = (c) => {
  const parts = ["adult", "child", "senior", "student"].filter((t) => c[t] > 0).map((t) => `${WORD[c[t]] ?? c[t]} ${t} ticket${c[t] === 1 ? "" : "s"}`);
  return parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
};

export const bookTemplates = [
  {
    key: "book-room",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "Book a named room type for a new guest on dates when it is free, for a party it sleeps. The check reads the guest's bookings: exactly one, confirmed, of that room from that date, for the nights and party asked.",
    candidates: (ctx) => ctx.rows.hotels.rooms.filter((r) => r.maxAdults >= 2),
    claims: (room, ctx) => [`room:${room.code}`, about("hotels", "room", room.code), ...nightClaims(ctx.hotels.hotel.get(room.hotelCode).city, "2027-10-04", 3)],
    build(room, ctx) {
      const hotel = ctx.hotels.hotel.get(room.hotelCode);
      const guest = newPerson("book-room", 0);
      const body = { roomCode: room.code, hotelCode: hotel.code, checkIn: "2027-10-04", nights: 3, adults: 2, kids: 0, pets: 0, lateCheckout: false, guestName: guest.name, guestEmail: guest.email };
      return {
        apps: ["hotels"],
        target: room.code,
        effort: { reads: 0, writes: 1 },
        summary: `${guest.email} has one confirmed booking of ${room.code} from 2027-10-04 for three nights, for two adults.`,
        note: `${guest.email} → ${room.code}, 2027-10-04 × 3, 2 adults`,
        steps: [{
          kind: "state",
          intent: `On ${site("hotels")}, book the ${room.name} (${room.code}) at ${hotel.name} for ${guest.name} (${guest.email}): three nights from 2027-10-04, for two adults.`,
          rubric: R.change(["hotels"], "the room was booked"),
          oracle: stateOracle(row("booked", "hotels", hotelsPath.bookingsOf(guest.email), { where: { roomCode: room.code, checkIn: "2027-10-04", status: "confirmed" }, count: { min: 1, max: 1 }, expect: { nights: 3, adults: 2, kids: 0 }, entity: { type: "booking", id: "{bookingNo}" } })),
          solve: (api) => api.post("hotels", hotelsPath.bookings, body),
        }],
      };
    },
  },
  {
    key: "book-viewing",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "Request a viewing of a named active listing in a named free slot for a new viewer. The check reads the viewer's requests: exactly one, of that listing, at that date and time.",
    candidates: (ctx) => ctx.rows.homes.listings.filter((l) => l.status === "active").flatMap((l) => homeSlotsOf(ctx.rows.homes, l.agentCode).filter((s) => s.free).slice(0, 1).map((slot) => ({ l, slot }))),
    claims: ({ l, slot }) => [`agent:${l.agentCode}:${slot.date}`],
    build({ l, slot }) {
      const viewer = newPerson("book-viewing", 0);
      const body = { listingCode: l.code, date: slot.date, time: slot.time, viewerName: viewer.name, viewerEmail: viewer.email };
      return {
        apps: ["homes"],
        target: l.code,
        effort: { reads: 0, writes: 1 },
        summary: `${viewer.email} has one viewing of ${l.code} requested, at ${slot.date} ${slot.time}.`,
        note: `${viewer.email} → ${l.code} at ${slot.date} ${slot.time}`,
        steps: [{
          kind: "state",
          intent: `On ${site("homes")}, request a viewing of the ${l.type} at ${l.address} (${l.code}) for ${viewer.name} (${viewer.email}) on ${slot.date} at ${slot.time}.`,
          rubric: R.change(["homes"], "the viewing was requested"),
          oracle: stateOracle(row("requested", "homes", homesPath.viewingsOf(viewer.email), { where: { listingCode: l.code, status: "requested" }, count: { min: 1, max: 1 }, expect: { date: slot.date, time: slot.time }, entity: { type: "viewing", id: "{viewingNo}" } })),
          solve: (api) => api.post("homes", homesPath.viewings, body),
        }],
      };
    },
  },
  {
    key: "book-appointment",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "Book a new patient, on a plan the doctor is in network for, into a named free slot of a doctor who takes new patients, for a visit type the doctor offers. The check reads the patient's appointments: exactly one, booked, with that doctor at that time.",
    candidates: (ctx) => ctx.rows.clinic.doctors.filter((d) => d.acceptingNewPatients && d.networkPlans.length).flatMap((d) => [16, 30, 44].map((o) => ({ d, date: addDays("2027-08-02", o) }))),
    claims: ({ d, date }) => [`doctor:${d.code}:${date}`],
    build({ d, date }, ctx) {
      const free = clinicFreeSlots(d, ctx.rows.clinic.appointments, date);
      if (!free.length) return null;
      const patient = newPerson("book-appointment", 0);
      const plan = ctx.clinic.plan.get(d.networkPlans[0]);
      const visitType = d.visitTypes[0];
      const body = { doctorCode: d.code, date, time: free[0], visitType, planCode: plan.code, patientName: patient.name, patientEmail: patient.email };
      return {
        apps: ["clinic"],
        target: d.code,
        effort: { reads: 0, writes: 1 },
        summary: `${patient.email} has one appointment booked with ${d.code} at ${date} ${free[0]}, ${visitText(visitType)} visit on ${plan.code}.`,
        note: `${patient.email} → ${d.code} ${date} ${free[0]}, ${visitType}, ${plan.code}`,
        steps: [{
          kind: "state",
          intent: `On ${site("clinic")}, book ${patient.name} (${patient.email}), a new patient on the ${plan.name} plan, for ${visitText(visitType)} visit with ${d.name} (${d.code}) on ${date} at ${free[0]}.`,
          rubric: R.change(["clinic"], "the appointment was booked"),
          oracle: stateOracle(row("booked", "clinic", clinicPath.appointmentsOf(patient.email), { where: { doctorCode: d.code, status: "booked" }, count: { min: 1, max: 1 }, expect: { date, time: free[0], visitType, planCode: plan.code }, entity: { type: "appointment", id: "{appointmentNo}" } })),
          solve: (api) => api.post("clinic", clinicPath.appointments, body),
        }],
      };
    },
  },
  {
    key: "book-registration",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "Register a new person for a named open event that has places left. The check reads the person's registrations: exactly one, active, for that event.",
    candidates: (ctx) => ctx.rows.events.events.filter((e) => e.registration === "open" && e.status === "scheduled" && (eventPlacesLeft(ctx.rows.events, e) ?? 0) >= 2),
    claims: (e) => [`event:${e.code}`],
    build(e, ctx) {
      const who = newPerson("book-registration", 0);
      if (eventRegisterProblem(ctx.rows.events, e, who)) return null;
      return {
        apps: ["events"],
        target: e.code,
        effort: { reads: 0, writes: 1 },
        summary: `${who.email} is registered for ${e.code}.`,
        note: `${who.email} → ${e.code} "${e.title}" ${e.date}`,
        steps: [{
          kind: "state",
          intent: `On ${site("events")}, register ${who.name} (${who.email}) for "${e.title}" (${e.code}) on ${e.date}.`,
          rubric: R.change(["events"], "the registration was made"),
          oracle: stateOracle(row("registered", "events", eventsPath.registrationsOf(who.email), { where: { eventCode: e.code, status: "registered" }, count: { min: 1, max: 1 }, expect: { email: who.email }, entity: { type: "registration", id: "{regNo}" } })),
          solve: (api) => api.post("events", eventsPath.register(e.code), { name: who.name, email: who.email }),
        }],
      };
    },
  },
  {
    key: "book-flight",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "Book two new passengers in a named cabin of a named flight on a date it has seats, with no checked bags. The check reads the contact's bookings: exactly one, confirmed, on that flight and date, in that cabin, for two.",
    candidates: (ctx) => ctx.rows.flights.cabins.filter((c) => c.cabin === "economy").flatMap((c) => [69, 83].map((o) => ({ c, date: addDays("2027-03-01", o) }))),
    claims: ({ c, date }, ctx) => {
      const f = ctx.flights.flight.get(c.flightNo);
      return [`route:${f.origin}-${f.destination}:${date}`, about("flights", "flight", c.flightNo)];
    },
    build({ c, date }, ctx) {
      if (flightSeatsLeft(c, ctx.rows.flights.bookings, date) < 4) return null;
      const a = newPerson("book-flight", 0), b = newPerson("book-flight", 1);
      const body = { flightNo: c.flightNo, date, cabin: c.cabin, passengers: [a.name, b.name], bags: 0, contactEmail: a.email };
      return {
        apps: ["flights"],
        target: c.flightNo,
        effort: { reads: 0, writes: 1 },
        summary: `${a.email} has one confirmed economy booking on ${c.flightNo} on ${date} for two.`,
        note: `${a.email} → ${c.flightNo} ${date} economy × 2`,
        steps: [{
          kind: "state",
          intent: `On ${site("flights")}, book economy seats on flight ${c.flightNo} on ${date} for ${a.name} and ${b.name}, with no checked bags; the contact email is ${a.email}.`,
          rubric: R.change(["flights"], "the flight was booked"),
          oracle: stateOracle(row("booked", "flights", flightsPath.bookingsOf(a.email), { where: { flightNo: c.flightNo, date, status: "confirmed" }, count: { min: 1, max: 1 }, expect: { cabin: "economy", passengerCount: 2, bags: 0 }, entity: { type: "booking", id: "{bookingNo}" } })),
          solve: (api) => api.post("flights", flightsPath.bookings, body),
        }],
      };
    },
  },
  {
    key: "book-table-party",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "Book a table at a named restaurant, date and time for a party only one of its seating areas seats: the party size, a site rule, decides the area (`TABLE_TOO_SMALL` elsewhere). The check reads the guest's reservations: exactly one, in that area.",
    candidates: (ctx) => ctx.rows.dining.restaurants.flatMap((r) => [7, 21].map((o) => ({ r, date: addDays("2027-10-04", o) }))),
    claims: ({ r, date }) => [`dining:${r.city}:${date}`, about("dining", "restaurant", r.code)],
    build({ r, date }, ctx) {
      const seating = ctx.dining.seatingOf.get(r.code) ?? [];
      const times = diningSeatingTimes(r, date);
      const time = times.find((t) => t >= "19:00");
      if (!time || seating.length < 2) return null;
      const biggest = Math.max(...seating.map((s) => s.seats));
      const fitting = seating.filter((s) => s.seats >= biggest);
      if (fitting.length !== 1) return null;
      const party = Math.min(biggest, 12);
      const others = seating.filter((s) => s.seats < party);
      if (!others.length || diningTablesLeft(fitting[0], ctx.rows.dining.reservations, date, time) < 1) return null;
      const usual = [...others].sort((x, y) => y.tables - x.tables)[0];
      const guest = newPerson("book-table-party", 0);
      const body = { restaurantCode: r.code, area: fitting[0].area, date, time, partySize: party, guestName: guest.name, guestEmail: guest.email, guestPhone: guest.phone, note: "" };
      return {
        apps: ["dining"],
        target: r.code,
        rule: { what: `only the ${fitting[0].area} tables seat ${party}`, naive: usual.area, actual: fitting[0].area },
        effort: { reads: 1, writes: 1 },
        summary: `${guest.email} has one reservation at ${r.code} on ${date} at ${time} for ${party}, in the one area whose tables seat that many.`,
        note: `${r.code} ${date} ${time}, party ${party} → ${fitting[0].area} (tables seat ${fitting[0].seats}; ${usual.area} seats ${usual.seats})`,
        steps: [{
          kind: "state",
          intent: `On ${site("dining")}, book a table for ${party} at ${r.name} (${r.code}) on ${date} at ${time} for ${guest.name} (${guest.email}, phone ${guest.phone}).`,
          rubric: R.change(["dining"], "the table was booked"),
          oracle: stateOracle(row("booked", "dining", diningPath.reservationsOf(guest.email), { where: { restaurantCode: r.code, date, time, status: "confirmed" }, count: { min: 1, max: 1 }, expect: { partySize: party, area: fitting[0].area }, entity: { type: "reservation", id: "{reservationNo}" } })),
          solve: async (api) => {
            const x = await api.get("dining", diningPath.restaurant(r.code));
            return api.post("dining", diningPath.reservations, { ...body, area: x.seating.find((s) => s.seats >= party).area });
          },
        }],
      };
    },
  },
  {
    key: "book-pizza-serves",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "Order a named menu pizza big enough for a number of people, for pickup at a named branch and slot: the size is the smallest that serves them (`pizzaSizeFor`), a site rule the agent has to read. The check reads the customer's orders: exactly one, received, of that pizza in that size.",
    candidates: (ctx) => ctx.rows.pizza.branches.flatMap((b) => ctx.rows.pizza.pizzas.slice(0, 6).map((p) => ({ b, p }))),
    claims: ({ b }) => [`pizza:${b.code}:2027-09-17`],
    build({ b, p }, ctx, rng) {
      const rows = ctx.rows.pizza;
      if (pizzaOutOfStock(rows.stockouts, b.code, p.toppings).length) return null;
      const people = [3, 5, 6][Math.floor(rng() * 3)];
      const size = pizzaSizeFor(rows.sizes, people);
      if (!size || size.key === "medium") return null;
      const customer = newPerson("book-pizza-serves", 0);
      const body = { branchCode: b.code, fulfilment: "pickup", lines: [{ pizzaCode: p.code, size: size.key, quantity: 1 }], slotDate: "2027-09-17", slotTime: "18:30", customerName: customer.name, customerEmail: customer.email };
      if ("problem" in pizzaPlaceOrder(rows, body)) return null;
      return {
        apps: ["pizza"],
        target: p.code,
        rule: { what: `the smallest size that serves ${people}`, naive: "medium", actual: size.key },
        effort: { reads: 1, writes: 1 },
        summary: `${customer.email} has one order at ${b.code} for 2027-09-17 18:30: one ${p.code} in the smallest size that serves ${people}.`,
        note: `${p.code} for ${people} people → ${size.key} (serves ${size.serves})`,
        steps: [{
          kind: "state",
          intent: `On ${site("pizza")}, order one ${p.name} (${p.code}) big enough for ${people} people, for pickup from the ${b.name} branch (${b.code}) at 18:30 on 2027-09-17, for ${customer.name} (${customer.email}).`,
          rubric: R.change(["pizza"], "the order was placed"),
          oracle: stateOracle(row("ordered", "pizza", pizzaPath.ordersOf(customer.email), { where: { branchCode: b.code, slotDate: "2027-09-17", status: "received" }, count: { min: 1, max: 1 }, expect: { slotTime: "18:30", lineCount: 1, lines: { pizzaCode: p.code, size: size.key, quantity: 1 } }, entity: { type: "order", id: "{orderNo}" } })),
          solve: async (api) => {
            const sizes = (await api.get("pizza", pizzaPath.builder)).sizes.filter((s) => s.serves >= people).sort((x, y) => x.serves - y.serves);
            return api.post("pizza", pizzaPath.orders, { ...body, lines: [{ pizzaCode: p.code, size: sizes[0].key, quantity: 1 }] });
          },
        }],
      };
    },
  },
  {
    key: "book-seats-row",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "Book a number of seats side by side in a named row of a named showtime, for a ticket mix with a non-adult ticket: the row has exactly one such run free. The check reads the customer's bookings: exactly one, of those seats, with that mix.",
    candidates: (ctx) => ctx.rows.cinema.showtimes,
    claims: (s) => [`showtime:${s.code}`],
    build(s, ctx) {
      const rows = ctx.rows.cinema;
      const screen = ctx.cinema.screen.get(s.screenCode);
      const film = ctx.cinema.film.get(s.filmCode);
      const cinema = ctx.cinema.cinema.get(s.cinemaCode);
      const taken = cinemaTakenSeats(rows.bookings, s.code);
      const n = 3;
      for (const r of cinemaSeatMap(screen, taken)) {
        const runs = cinemaFreeRuns(screen, taken).filter((run) => run[0].startsWith(r.row) && run.length >= n);
        if (runs.length !== 1 || runs[0].length !== n) continue;
        const seats = runs[0];
        const mix = ["15", "18"].includes(film.rating) ? counts(2, 0, 0, 1) : counts(2, 1);
        const customer = newPerson("book-seats-row", 0);
        const body = { showtimeCode: s.code, seats, adult: mix.adult, child: mix.child, senior: mix.senior, student: mix.student, customerName: customer.name, customerEmail: customer.email };
        return {
          apps: ["cinema"],
          target: s.code,
          hidden: [seats.join(",")],
          constraints: [`row ${r.row}`, "side by side", mixText(mix)],
          effort: { reads: 1, writes: 1 },
          summary: `${customer.email} has one booking for ${s.code}: three seats side by side in row ${r.row}, with the mix asked.`,
          note: `${s.code} row ${r.row}: the one run of 3 free → ${seats.join(", ")}`,
          steps: [{
            kind: "state",
            intent: `On ${site("cinema")}, book three seats side by side in row ${r.row} for the ${s.time} showing of ${film.title} at ${cinema.name} on ${s.date} (${s.code}), as ${mixText(mix)}, for ${customer.name} (${customer.email}).`,
            rubric: R.change(["cinema"], "the seats were booked"),
            oracle: stateOracle(row("booked", "cinema", cinemaPath.bookingsOf(customer.email), { where: { showtimeCode: s.code, status: "confirmed" }, count: { min: 1, max: 1 }, expect: { seats: seats.join(","), together: true, ticketCounts: mix }, entity: { type: "booking", id: "{bookingNo}" } })),
            solve: async (api) => {
              const x = await api.get("cinema", cinemaPath.showtime(s.code));
              return api.post("cinema", cinemaPath.bookings, { ...body, seats: liveRun(x.seatMap.filter((m) => m.row === r.row), n) });
            },
          }],
        };
      }
      return null;
    },
  },
  {
    key: "book-sports-order",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "Order one of a named product for a store customer, in a named size and in the only colour of that size in stock, to the customer's address with a named label (not their default). The check reads the customer's processing orders: exactly one, of that variant, to that address.",
    candidates: (ctx) => {
      const groups = new Map();
      for (const v of ctx.rows.sports.variants) groups.set(`${v.productCode}|${v.size}`, [...(groups.get(`${v.productCode}|${v.size}`) ?? []), v]);
      const picks = [...groups.values()].filter((vs) => vs.length >= 2 && vs.filter((v) => v.stock > 0).length === 1).map((vs) => vs.find((v) => v.stock > 0));
      return ctx.rows.sports.customers.flatMap((c) => picks.map((v) => ({ c, v })));
    },
    claims: ({ c, v }) => [`person:sports:${c.email}`, `variant:${v.sku}`],
    build({ c, v }, ctx) {
      if ((ctx.sports.ordersOf.get(c.email) ?? []).some((o) => o.status === "processing")) return null;
      const address = (ctx.sports.addressesOf.get(c.email) ?? []).find((a) => !a.isDefault);
      if (!address) return null;
      const product = ctx.sports.product.get(v.productCode);
      return {
        apps: ["sports"],
        target: product.code,
        hidden: [v.sku, v.colour],
        constraints: [`size ${v.size}`, "in stock", `${address.label} address`],
        effort: { reads: 2, writes: 1 },
        summary: `${c.email} has one processing order: one of the only colour of ${product.code} in stock in size ${v.size}, to their ${address.label} address.`,
        note: `${c.email}: ${product.code} size ${v.size}, the only colour in stock → ${v.sku} (${v.colour}), to ${address.code} (${address.label})`,
        steps: [{
          kind: "state",
          intent: `On ${site("sports")}, place an order for ${c.name} (${c.email}): one ${product.name} (${product.code}) in size ${v.size}, in whichever colour is in stock in that size, sent to their ${address.label} address.`,
          rubric: R.change(["sports"], "the order was placed"),
          oracle: stateOracle(row("ordered", "sports", sportsPath.ordersOf(c.email), { where: { status: "processing" }, count: { min: 1, max: 1 }, expect: { addressCode: address.code, lineCount: 1, lines: { sku: v.sku, qty: 1 } }, entity: { type: "order", id: "{orderNo}" } })),
          solve: async (api) => {
            const live = (await api.get("sports", sportsPath.product(product.code))).variants.find((x) => x.size === v.size && x.stock > 0);
            const to = (await api.get("sports", sportsPath.customer(c.email))).addresses.find((a) => a.label === address.label);
            return api.post("sports", sportsPath.orders, { customerEmail: c.email, addressCode: to.code, lines: [{ sku: live.sku, qty: 1 }] });
          },
        }],
      };
    },
  },
  {
    key: "book-earliest-together",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about:
      "Book seats side by side for a new customer at the earliest showing of a named film at a named cinema that still has that many free side by side (`cinemaSearchShowtimes` with `together`). The tempting one: an earlier showing has as many seats free, but none side by side.",
    candidates: (ctx) => {
      const offers = cinemaSearchShowtimes(ctx.rows.cinema, {});
      const pairs = new Map();
      for (const o of offers) pairs.set(`${o.cinemaCode}:${o.filmCode}`, [...(pairs.get(`${o.cinemaCode}:${o.filmCode}`) ?? []), o]);
      return [...pairs.values()].flatMap((shows) => [2, 3, 4].flatMap((n) => {
        const k = shows.findIndex((o) => o.bestRun >= n);
        const trap = shows.findIndex((o) => o.freeSeats >= n);
        return k > 0 && trap >= 0 && trap < k ? [{ shows: shows.slice(0, k + 1), n, target: shows[k], trap: shows[trap] }] : [];
      }));
    },
    claims: (s) => s.shows.map((o) => `showtime:${o.showtimeCode}`),
    build({ n, target, trap }, ctx) {
      const film = ctx.cinema.film.get(target.filmCode);
      const mix = ["15", "18"].includes(film.rating) ? counts(n) : counts(n - 1, 1);
      const customer = newPerson("book-earliest-together", 0);
      return {
        apps: ["cinema"],
        target: target.filmCode,
        hidden: [target.showtimeCode],
        tempting: { what: `${trap.showtimeCode} is earlier with ${trap.freeSeats} seats free, none ${n} side by side`, check: async (api) => (await api.get("cinema", cinemaPath.showtime(trap.showtimeCode))).bestRun < n },
        effort: { reads: 2, writes: 1 },
        summary: `${customer.email} has one booking of ${n} seats side by side at the earliest showing of ${target.filmCode} at ${target.cinemaCode} that had them.`,
        note: `${target.filmCode} at ${target.cinemaCode}, ${n} together → ${target.showtimeCode}; ${trap.showtimeCode} is earlier but has at most ${trap.bestRun} side by side`,
        steps: [{
          kind: "state",
          intent: `On ${site("cinema")}, book ${n} seats side by side (in one row, next to each other), as ${mixText(mix)}, for ${customer.name} (${customer.email}) at the earliest showing of ${film.title} (${film.code}) at ${target.cinemaName} that still has ${n} free seats side by side.`,
          rubric: R.change(["cinema"], "the seats were booked"),
          oracle: stateOracle(row("booked earliest together", "cinema", cinemaPath.bookingsOf(customer.email), { where: { status: "confirmed" }, count: { min: 1, max: 1 }, expect: { showtimeCode: target.showtimeCode, seatCount: n, together: true }, entity: { type: "booking", id: "{bookingNo}" } })),
          solve: async (api) => {
            const o = (await api.get("cinema", cinemaPath.search({ cinemaCode: target.cinemaCode, filmCode: target.filmCode, seats: n, together: true })))[0];
            const x = await api.get("cinema", cinemaPath.showtime(o.showtimeCode));
            return api.post("cinema", cinemaPath.bookings, { showtimeCode: o.showtimeCode, seats: liveRun(x.seatMap, n), ...mix, customerName: customer.name, customerEmail: customer.email });
          },
        }],
      };
    },
  },
  {
    key: "book-slot-after",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about:
      "Order several of one menu pizza for pickup at a named branch on a busy day, in the earliest slot at or after a named time with room for all of them (`pizzaSlots`). The tempting one: the named time's slot has not room enough.",
    candidates: (ctx) => {
      const rows = ctx.rows.pizza;
      const out = [];
      for (const b of rows.branches) {
        const days = [...new Set(rows.orders.filter((o) => o.branchCode === b.code).map((o) => o.slotDate))];
        for (const date of days) for (const time of ["18:00", "18:30", "19:00", "19:30"]) if (pizzaSlotLeft(b, rows.orders, date, time) < 3) out.push({ b, date, time });
      }
      return out;
    },
    claims: ({ b, date }) => [`pizza:${b.code}:${date}`],
    build({ b, date, time }, ctx) {
      const rows = ctx.rows.pizza;
      const n = 3;
      const p = rows.pizzas.find((x) => !pizzaOutOfStock(rows.stockouts, b.code, x.toppings).length);
      const slot = pizzaSlots(rows, { branchCode: b.code, date, pizzas: n, from: time })[0];
      if (!p || !slot || slot.time === time) return null;
      const customer = newPerson("book-slot-after", 0);
      const body = { branchCode: b.code, fulfilment: "pickup", lines: [{ pizzaCode: p.code, size: "medium", quantity: n }], slotDate: date, customerName: customer.name, customerEmail: customer.email };
      if ("problem" in pizzaPlaceOrder(rows, { ...body, slotTime: slot.time })) return null;
      return {
        apps: ["pizza"],
        target: b.code,
        hidden: [slot.time],
        tempting: { what: `the ${time} slot has room for fewer than ${n}`, check: async (api) => (await api.get("pizza", pizzaPath.slots(b.code, date, n, time)))[0].time !== time },
        effort: { reads: 1, writes: 1 },
        summary: `${customer.email} has one order of three ${p.code} at ${b.code} on ${date}, in the earliest slot from ${time} with room for them.`,
        note: `${b.code} ${date}: ${time} has room for fewer than 3 → ${slot.time}`,
        steps: [{
          kind: "state",
          intent: `On ${site("pizza")}, order three medium ${p.name} pizzas (${p.code}) for pickup from the ${b.name} branch (${b.code}) on ${date}, for ${customer.name} (${customer.email}), in the earliest pickup slot at or after ${time} that can take all three.`,
          rubric: R.change(["pizza"], "the order was placed"),
          oracle: stateOracle(row("ordered", "pizza", pizzaPath.ordersOf(customer.email), { where: { branchCode: b.code, slotDate: date, status: "received" }, count: { min: 1, max: 1 }, expect: { slotTime: slot.time, lines: { pizzaCode: p.code, quantity: n } }, entity: { type: "order", id: "{orderNo}" } })),
          solve: async (api) => {
            const first = (await api.get("pizza", pizzaPath.slots(b.code, date, n, time)))[0];
            return api.post("pizza", pizzaPath.orders, { ...body, slotTime: first.time });
          },
        }],
      };
    },
  },
  {
    key: "book-trip-steps",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "A trip booked over three prompts: a named outbound flight, then a named return flight on a later date, then what the two bookings cost together. The checks read the contact's bookings; the last answer is the two totals added up.",
    candidates: (ctx) => ctx.rows.flights.flights.filter((f) => f.stops === 0).flatMap((out) => ctx.rows.flights.flights.filter((back) => back.stops === 0 && back.origin === out.destination && back.destination === out.origin).slice(0, 1).map((back) => ({ out, back }))),
    claims: ({ out, back }) => [`route:${out.origin}-${out.destination}:2027-05-24`, `route:${back.origin}-${back.destination}:2027-05-28`, about("flights", "flight", out.flightNo), about("flights", "flight", back.flightNo)],
    build({ out, back }, ctx) {
      const eo = (ctx.flights.cabinsOf.get(out.flightNo) ?? []).find((c) => c.cabin === "economy");
      const eb = (ctx.flights.cabinsOf.get(back.flightNo) ?? []).find((c) => c.cabin === "economy");
      if (!eo || !eb || flightSeatsLeft(eo, ctx.rows.flights.bookings, "2027-05-24") < 2 || flightSeatsLeft(eb, ctx.rows.flights.bookings, "2027-05-28") < 2) return null;
      const a = newPerson("book-trip-steps", 0);
      const from = ctx.flights.airport.get(out.origin).city, to = ctx.flights.airport.get(out.destination).city;
      const leg = (f, date) => ({ flightNo: f.flightNo, date, cabin: "economy", passengers: [a.name], bags: 0, contactEmail: a.email });
      const check = (name, f, date) => row(name, "flights", flightsPath.bookingsOf(a.email), { where: { flightNo: f.flightNo, date, status: "confirmed" }, count: { min: 1, max: 1 }, expect: { cabin: "economy", passengerCount: 1 }, entity: { type: "booking", id: "{bookingNo}" } });
      const total = eo.priceCents + eb.priceCents;
      return {
        apps: ["flights"],
        target: out.flightNo,
        effort: { reads: 1, writes: 2 },
        summary: `${a.email} has an economy booking on ${out.flightNo} on 2027-05-24 and on ${back.flightNo} on 2027-05-28, and is told what they cost together.`,
        note: `${out.flightNo} ${from}→${to} 2027-05-24, ${back.flightNo} back 2027-05-28; together ${dollars(total)}`,
        steps: [
          {
            kind: "state",
            intent: `On ${site("flights")}, book ${a.name} (${a.email}) an economy seat on flight ${out.flightNo} from ${from} to ${to} on 2027-05-24, with no checked bag.`,
            rubric: R.change(["flights"], "the outbound flight was booked"),
            oracle: stateOracle(check("outbound booked", out, "2027-05-24")),
            solve: (api) => api.post("flights", flightsPath.bookings, leg(out, "2027-05-24")),
          },
          {
            kind: "state",
            fact: back.flightNo,
            intent: `Now the way back: book the same traveller an economy seat on flight ${back.flightNo} on 2027-05-28, again with no checked bag.`,
            rubric: R.stepChange("the return flight was booked"),
            oracle: stateOracle(check("return booked", back, "2027-05-28")),
            solve: (api) => api.post("flights", flightsPath.bookings, leg(back, "2027-05-28")),
          },
          {
            kind: "json",
            fact: "both bookings",
            intent: `What do both bookings cost together? Answer as JSON: {"total": <dollars>}.`,
            rubric: R.stepAnswer("what the two bookings cost together"),
            oracle: jsonOracle({ total: money(total) }),
            answer: async (api) => ({ total: (await api.list("flights", flightsPath.bookingsOf(a.email))).filter((b) => b.status === "confirmed").reduce((n, b) => n + b.totalCents, 0) / 100 }),
          },
        ],
      };
    },
  },
  {
    key: "book-session-earliest",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about:
      "Register a new person for the earliest session of a course at an office that still has places left. The tempting one: the earliest session there is full (the generator fills it on purpose).",
    candidates: (ctx) => {
      const rows = ctx.rows.events;
      const byCourse = new Map();
      for (const e of rows.events.filter((x) => x.registration === "open" && x.status === "scheduled")) byCourse.set(`${e.officeCode}:${e.title}`, [...(byCourse.get(`${e.officeCode}:${e.title}`) ?? []), e]);
      return [...byCourse.values()].map((s) => s.sort((x, y) => `${x.date} ${x.startTime}`.localeCompare(`${y.date} ${y.startTime}`))).flatMap((sessions) => {
        const answer = sessions.find((e) => (eventPlacesLeft(rows, e) ?? 0) > 0);
        return answer && answer !== sessions[0] && eventPlacesLeft(rows, sessions[0]) === 0 ? [{ sessions, answer }] : [];
      });
    },
    claims: ({ sessions }) => sessions.map((e) => `event:${e.code}`),
    build({ sessions, answer }, ctx) {
      const office = ctx.events.office.get(answer.officeCode);
      const who = newPerson("book-session-earliest", 0);
      if (eventRegisterProblem(ctx.rows.events, answer, who)) return null;
      return {
        apps: ["events"],
        hidden: [answer.code],
        tempting: { what: `${sessions[0].code} is earlier but full`, check: async (api) => (await api.get("events", eventsPath.event(sessions[0].code))).placesLeft === 0 },
        effort: { reads: 1, writes: 1 },
        summary: `${who.email} is registered for the earliest session of "${answer.title}" at ${office.code} that had places.`,
        note: `"${answer.title}" at ${office.code}: ${sessions[0].code} is full → ${answer.code}`,
        steps: [{
          kind: "state",
          intent: `On ${site("events")}, register ${who.name} (${who.email}) for "${answer.title}" at the ${office.name}: the earliest session there that still has places.`,
          rubric: R.change(["events"], "the registration was made"),
          oracle: stateOracle(row("registered", "events", eventsPath.registrationsOf(who.email), { where: { status: "registered" }, count: { min: 1, max: 1 }, expect: { eventCode: answer.code }, entity: { type: "registration", id: "{regNo}" } })),
          solve: async (api) => {
            const live = (await api.list("events", eventsPath.eventsWhere({ office: office.code, q: answer.title, status: "scheduled", hasPlaces: "true", limit: 200 }))).filter((e) => e.title === answer.title);
            return api.post("events", eventsPath.register(live[0].code), { name: who.name, email: who.email });
          },
        }],
      };
    },
  },
  {
    key: "book-showtime-sold-out",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "Two seats at a named showing with no seat left: impossible (`SOLD_OUT`). The right outcome is to say so and book nothing.",
    candidates: (ctx) => ctx.rows.cinema.showtimes.filter((s) => cinemaSeatMap(ctx.cinema.screen.get(s.screenCode), cinemaTakenSeats(ctx.rows.cinema.bookings, s.code)).every((r) => r.free.length === 0)),
    claims: (s) => [`showtime:${s.code}`],
    build(s, ctx) {
      const film = ctx.cinema.film.get(s.filmCode);
      const cinema = ctx.cinema.cinema.get(s.cinemaCode);
      const guest = newPerson("book-showtime-sold-out", 0);
      const body = { showtimeCode: s.code, seats: ["A1", "A2"], adult: 2, customerName: guest.name, customerEmail: guest.email };
      return {
        apps: ["cinema"],
        target: s.code,
        impossible: { code: "SOLD_OUT" },
        effort: { reads: 0, writes: 0 },
        summary: `${s.code} is sold out: nothing is booked, and the agent looked at the showing or was refused for it.`,
        note: `${s.code}: every seat booked`,
        steps: [{
          kind: "state",
          intent: `On ${site("cinema")}, book two adult seats together for the ${s.time} showing of ${film.title} at ${cinema.name} on ${s.date} (${s.code}), for ${guest.name} (${guest.email}).`,
          rubric: R.impossible(["cinema"], "book the two seats"),
          oracle: stateOracle(...impossibleChecks({ app: "cinema", things: [{ type: "showtime", id: s.code }], code: "SOLD_OUT" })),
          solve: (api) => api.attempt("cinema", cinemaPath.bookings, body),
        }],
      };
    },
  },
  {
    key: "book-cabin-sold-out",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "Seats in a named cabin of a named flight on a date it has none left: impossible (`SOLD_OUT`). The right outcome is to say so and book nothing.",
    candidates: (ctx) => {
      const f = ctx.rows.flights;
      return [...new Set(f.bookings.map((b) => `${b.flightNo}|${b.date}|${b.cabin}`))].map((k) => k.split("|")).map(([flightNo, date, cabin]) => ({ c: f.cabins.find((x) => x.flightNo === flightNo && x.cabin === cabin), date })).filter(({ c, date }) => c && flightSeatsLeft(c, f.bookings, date) === 0);
    },
    claims: ({ c, date }, ctx) => {
      const f = ctx.flights.flight.get(c.flightNo);
      return [`route:${f.origin}-${f.destination}:${date}`, about("flights", "flight", c.flightNo)];
    },
    build({ c, date }) {
      const a = newPerson("book-cabin-sold-out", 0);
      const body = { flightNo: c.flightNo, date, cabin: c.cabin, passengers: [a.name], bags: 0, contactEmail: a.email };
      return {
        apps: ["flights"],
        target: c.flightNo,
        impossible: { code: "SOLD_OUT" },
        effort: { reads: 0, writes: 0 },
        summary: `${c.cabin} on ${c.flightNo} on ${date} is sold out: nothing is booked, and the agent looked at the flight or was refused for it.`,
        note: `${c.flightNo} ${c.cabin} on ${date}: no seat left`,
        steps: [{
          kind: "state",
          intent: `On ${site("flights")}, book one ${CABIN[c.cabin]} seat on flight ${c.flightNo} on ${date} for ${a.name} (${a.email}), with no checked bag.`,
          rubric: R.impossible(["flights"], "book the seat"),
          oracle: stateOracle(...impossibleChecks({ app: "flights", things: [{ type: "flight", id: c.flightNo }], code: "SOLD_OUT" })),
          solve: (api) => api.attempt("flights", flightsPath.bookings, body),
        }],
      };
    },
  },
];
