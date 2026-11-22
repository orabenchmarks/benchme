/**
 * Act as yourself (change; all nine sites, with mail): the person asking acts
 * on their own account. Some already have one, and the prompt gives their
 * email and password; the hard ones sign up first, confirming the address with
 * the code the site mails to the workspace inbox. A check reads who was signed
 * in when the change was made (the ledger's actor), so a change made from some
 * other account does not count.
 */
import {
  addDays, cinemaSearchShowtimes, cinemaSeatMap, cinemaTakenSeats, clinicFreeSlots, diningSeatingTimes, diningTablesLeft, eventPlacesLeft, eventRegisterProblem, homeSlotsOf, nightsOf, pizzaOutOfStock, pizzaPlaceOrder, pizzaSizeFor,
  SPORTS_TODAY, sportsReturnDeadline,
} from "../../../../packages/scenarios/dist/index.js";
import { R, about, asThem, variantText, impossibleChecks, leftAlone, newPerson, passwordFor, row, site, stateOracle, verified, PAGES_AND_TOOLS } from "../kit.mjs";
import { cinemaPath, clinicPath, diningPath, eventsPath, flightsPath, homesPath, hotelsPath, pizzaPath, sportsPath } from "../paths.mjs";

const AREA = "act-as-yourself";
const mins = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const clock = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const nightClaims = (city, checkIn, nights) => nightsOf(checkIn, nights).map((d) => `night:${city.toLowerCase()}:${d}`);
/** Who already has an account on a site: [{ email, name, password }]. */
const accountsOf = (ctx, app) => ctx.accounts[app] ?? [];
const signIn = (a) => `sign in with their account (${a.email}, password ${a.password})`;
const signUp = (p) => `create an account for ${p.name} with the email ${p.email} and the password ${passwordFor(p.email)}, and confirm it with the code that is emailed`;
const liveRun = (seatMap, n, skip = []) => {
  for (const r of seatMap) {
    const free = new Set(r.free);
    for (const s of r.seats) {
      const want = Array.from({ length: n }, (_, i) => `${r.row}${Number(s.seat.slice(1)) + i}`);
      if (want.every((x) => free.has(x)) && !want.some((x) => skip.includes(x))) return want;
    }
  }
  return null;
};

export const selfTemplates = [
  {
    key: "self-cancel",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "A person with an account on the hotel site signs in with their own email and password and cancels one of their confirmed bookings, named by its number. The checks read the booking (cancelled), the ledger (the cancel was made signed in as them) and their other bookings (untouched).",
    candidates: (ctx) => accountsOf(ctx, "hotels").flatMap((a) => (ctx.hotels.byGuest.get(a.email) ?? []).filter((b) => b.status === "confirmed").map((b) => ({ a, b }))),
    claims: ({ a, b }, ctx) => [`account:hotels:${a.email}`, ...nightClaims(ctx.hotels.hotel.get(b.hotelCode).city, b.checkIn, b.nights)],
    build({ a, b }, ctx) {
      const hotel = ctx.hotels.hotel.get(b.hotelCode);
      const others = (ctx.hotels.byGuest.get(a.email) ?? []).filter((x) => x.status === "confirmed" && x !== b);
      const ref = { type: "booking", id: b.bookingNo };
      return {
        apps: ["hotels"],
        target: b.bookingNo,
        effort: { reads: 0, writes: 1 },
        summary: `${b.bookingNo} is cancelled, by ${a.email} signed in; their other bookings are untouched.`,
        note: `${a.email} signs in and cancels ${b.bookingNo} (${hotel.code} from ${b.checkIn})`,
        steps: [{
          kind: "state",
          intent: `On ${site("hotels")}, ${a.name} wants you to ${signIn(a)} and cancel their booking ${b.bookingNo} at ${hotel.name} from ${b.checkIn}.`,
          rubric: R.change(["hotels"], "the booking was cancelled", { inbox: false }),
          oracle: stateOracle(
            row("cancelled", "hotels", hotelsPath.booking(b.bookingNo), { expect: { status: "cancelled" }, entity: ref }),
            asThem("cancelled as them", "hotels", ref, "cancel", a.email),
            ...(others.length ? [leftAlone("others left alone", "hotels", others.map((x) => ({ type: "booking", id: x.bookingNo })))] : []),
          ),
          solve: async (api) => (await api.as("hotels", a)).post("hotels", hotelsPath.cancel(b.bookingNo), {}),
        }],
      };
    },
  },
  {
    key: "self-viewing",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "A person with an account on the home listings site signs in with their own email and password and requests a viewing of a named active listing at a named free slot. The checks read their viewings and the ledger (requested signed in as them).",
    candidates: (ctx) => accountsOf(ctx, "homes").flatMap((a) => ctx.rows.homes.listings.filter((l) => l.status === "active").slice(0, 12).map((l) => ({ a, l }))),
    claims: ({ a, l }, ctx) => [`account:homes:${a.email}`, ...(ctx.homes.daysOf.get(l.agentCode) ?? []).slice(-1).map((d) => `agent:${l.agentCode}:${d.date}`)],
    build({ a, l }, ctx) {
      const days = ctx.homes.daysOf.get(l.agentCode) ?? [];
      const last = days.at(-1);
      const slot = last && homeSlotsOf(ctx.rows.homes, l.agentCode).filter((s) => s.free && s.date === last.date).at(-1);
      if (!slot || (ctx.homes.byViewer.get(a.email) ?? []).some((v) => v.status === "requested" && v.date === slot.date && v.time === slot.time)) return null;
      return {
        apps: ["homes"],
        target: l.code,
        effort: { reads: 0, writes: 1 },
        summary: `${a.email}, signed in, has one viewing of ${l.code} requested at ${slot.date} ${slot.time}.`,
        note: `${a.email} → ${l.code} ${slot.date} ${slot.time}`,
        steps: [{
          kind: "state",
          intent: `On ${site("homes")}, ${a.name} wants you to ${signIn(a)} and request a viewing for them of the ${l.type} at ${l.address} (${l.code}) on ${slot.date} at ${slot.time}.`,
          rubric: R.change(["homes"], "the viewing was requested", { inbox: false }),
          oracle: stateOracle(
            row("requested", "homes", homesPath.viewingsOf(a.email), { where: { listingCode: l.code, date: slot.date, status: "requested" }, count: { min: 1, max: 1 }, expect: { time: slot.time }, entity: { type: "viewing", id: "{viewingNo}" } }),
            asThem("requested as them", "homes", { type: "viewing" }, "create", a.email, { subject: { type: "listing", id: l.code } }),
          ),
          solve: async (api) => (await api.as("homes", a)).post("homes", homesPath.viewings, { listingCode: l.code, date: slot.date, time: slot.time, viewerName: a.name, viewerEmail: a.email }),
        }],
      };
    },
  },
  {
    key: "self-refill",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "A patient with an account on the clinic site signs in with their own email and password and requests a refill of their named prescription at a named pharmacy that stocks it. The checks read the refill, the prescription and the ledger (requested signed in as them).",
    candidates: (ctx) =>
      accountsOf(ctx, "clinic").flatMap((a) =>
        ctx.rows.clinic.prescriptions
          .filter((rx) => rx.patientEmail === a.email && rx.refillsLeft >= 1 && !ctx.rows.clinic.refills.some((r) => r.rxNo === rx.rxNo && r.status === "requested"))
          .flatMap((rx) => ctx.rows.clinic.prices.filter((p) => p.medicationCode === rx.medicationCode && p.dosage.replace(/\s+/g, "").toLowerCase() === rx.dosage.replace(/\s+/g, "").toLowerCase()).slice(0, 1).map((p) => ({ a, rx, p }))),
      ),
    claims: ({ a, rx }) => [`account:clinic:${a.email}`, `rx:${rx.rxNo}`],
    build({ a, rx, p }, ctx) {
      const pharmacy = ctx.clinic.clinic.get(p.clinicCode);
      const med = ctx.clinic.medication.get(rx.medicationCode);
      return {
        apps: ["clinic"],
        target: rx.rxNo,
        effort: { reads: 0, writes: 1 },
        summary: `${rx.rxNo} has one refill requested at ${pharmacy.code}, by ${a.email} signed in.`,
        note: `${a.email}: ${rx.rxNo} → ${pharmacy.code}`,
        steps: [{
          kind: "state",
          intent: `On ${site("clinic")}, ${a.name} wants you to ${signIn(a)} and request a refill of their prescription ${rx.rxNo} (${med.name} ${rx.dosage}), to collect at the pharmacy of ${pharmacy.name} (${pharmacy.code}).`,
          rubric: R.change(["clinic"], "the refill was requested", { inbox: false }),
          oracle: stateOracle(
            row("refill requested", "clinic", clinicPath.refillsOf(rx.rxNo), { where: { status: "requested" }, count: { min: 1, max: 1 }, expect: { pharmacyCode: pharmacy.code }, entity: { type: "refill", id: "{refillNo}" } }),
            asThem("requested as them", "clinic", { type: "refill" }, "create", a.email, { subject: { type: "prescription", id: rx.rxNo } }),
          ),
          solve: async (api) => (await api.as("clinic", a)).post("clinic", clinicPath.refill(rx.rxNo), { pharmacyCode: pharmacy.code }),
        }],
      };
    },
  },
  {
    key: "self-cancel-route",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "A person with an account on the flight site signs in with their own email and password and cancels the one of their bookings described by its route and date; they have other bookings on the route or on the day. The checks read the booking, the ledger (cancelled signed in as them) and their other bookings (untouched).",
    candidates: (ctx) => accountsOf(ctx, "flights").flatMap((a) => (ctx.flights.byContact.get(a.email) ?? []).filter((b) => b.status === "confirmed").map((b) => ({ a, b }))),
    claims: ({ a, b }, ctx) => {
      const f = ctx.flights.flight.get(b.flightNo);
      return [`account:flights:${a.email}`, `route:${f.origin}-${f.destination}:${b.date}`];
    },
    build({ a, b }, ctx) {
      const f = ctx.flights.flight.get(b.flightNo);
      const others = (ctx.flights.byContact.get(a.email) ?? []).filter((x) => x.status === "confirmed" && x !== b);
      const routeOf = (x) => ctx.flights.flight.get(x.flightNo);
      const twins = others.filter((x) => (routeOf(x).origin === f.origin && routeOf(x).destination === f.destination) || x.date === b.date);
      if (!twins.length || others.some((x) => routeOf(x).origin === f.origin && routeOf(x).destination === f.destination && x.date === b.date)) return null;
      const from = ctx.flights.airport.get(f.origin).city, to = ctx.flights.airport.get(f.destination).city;
      const ref = { type: "booking", id: b.bookingNo };
      return {
        apps: ["flights"],
        hidden: [b.bookingNo],
        constraints: [`from ${from} to ${to}`, `on ${b.date}`],
        effort: { reads: 1, writes: 1 },
        summary: `${a.email}'s booking from ${from} to ${to} on ${b.date} is cancelled, by them signed in; their others are untouched.`,
        note: `${a.email}: ${f.origin}→${f.destination} ${b.date} → ${b.bookingNo}`,
        steps: [{
          kind: "state",
          intent: `On ${site("flights")}, ${a.name} wants you to ${signIn(a)} and cancel their booking for the flight from ${from} to ${to} on ${b.date}. Their other bookings stay as they are.`,
          rubric: R.change(["flights"], "the booking was cancelled", { inbox: false }),
          oracle: stateOracle(
            row("cancelled", "flights", flightsPath.booking(b.bookingNo), { expect: { status: "cancelled" }, entity: ref }),
            asThem("cancelled as them", "flights", ref, "cancel", a.email),
            leftAlone("others left alone", "flights", others.map((x) => ({ type: "booking", id: x.bookingNo }))),
          ),
          solve: async (api) => {
            const me = await api.as("flights", a);
            const mine = (await me.list("flights", flightsPath.bookingsOf(a.email))).filter((x) => x.status === "confirmed" && x.origin === f.origin && x.destination === f.destination && x.date === b.date);
            return me.post("flights", flightsPath.cancel(me.only(mine).bookingNo), {});
          },
        }],
      };
    },
  },
  {
    key: "self-pizza-serves",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "A person with an account on the pizza site signs in with their own email and password and orders, for pickup, one named menu pizza big enough for a number of people: the smallest size that serves them (`pizzaSizeFor`), a site rule. The checks read their orders and the ledger (ordered signed in as them).",
    candidates: (ctx) => accountsOf(ctx, "pizza").flatMap((a) => ctx.rows.pizza.branches.slice(0, 4).flatMap((b) => ctx.rows.pizza.pizzas.slice(0, 4).map((p) => ({ a, b, p })))),
    claims: ({ a, b }) => [`account:pizza:${a.email}`, `pizza:${b.code}:2027-09-24`],
    build({ a, b, p }, ctx, rng) {
      const rows = ctx.rows.pizza;
      if (pizzaOutOfStock(rows.stockouts, b.code, p.toppings).length) return null;
      const people = [3, 5, 6][Math.floor(rng() * 3)];
      const size = pizzaSizeFor(rows.sizes, people);
      if (!size || size.key === "medium") return null;
      const body = { branchCode: b.code, fulfilment: "pickup", lines: [{ pizzaCode: p.code, size: size.key, quantity: 1 }], slotDate: "2027-09-24", slotTime: "19:00", customerName: a.name, customerEmail: a.email };
      if ("problem" in pizzaPlaceOrder(rows, body)) return null;
      return {
        apps: ["pizza"],
        target: p.code,
        rule: { what: `the smallest size that serves ${people}`, naive: "medium", actual: size.key },
        effort: { reads: 1, writes: 1 },
        summary: `${a.email}, signed in, has one pickup order at ${b.code} for 2027-09-24 19:00 of one ${p.code} in the smallest size that serves ${people}.`,
        note: `${a.email}: ${p.code} for ${people} → ${size.key}`,
        steps: [{
          kind: "state",
          intent: `On ${site("pizza")}, ${a.name} wants you to ${signIn(a)} and order them one ${p.name} (${p.code}) big enough for ${people} people, for pickup from the ${b.name} branch (${b.code}) at 19:00 on 2027-09-24.`,
          rubric: R.change(["pizza"], "the order was placed", { inbox: false }),
          oracle: stateOracle(
            row("ordered", "pizza", pizzaPath.ordersOf(a.email), { where: { branchCode: b.code, slotDate: "2027-09-24", status: "received" }, count: { min: 1, max: 1 }, expect: { slotTime: "19:00", lineCount: 1, lines: { pizzaCode: p.code, size: size.key, quantity: 1 } }, entity: { type: "order", id: "{orderNo}" } }),
            asThem("ordered as them", "pizza", { type: "order" }, "create", a.email, { subject: { type: "branch", id: b.code } }),
          ),
          solve: async (api) => {
            const me = await api.as("pizza", a);
            const fit = (await me.get("pizza", pizzaPath.builder)).sizes.filter((s) => s.serves >= people).sort((x, y) => x.serves - y.serves)[0];
            return me.post("pizza", pizzaPath.orders, { ...body, lines: [{ pizzaCode: p.code, size: fit.key, quantity: 1 }] });
          },
        }],
      };
    },
  },
  {
    key: "self-table-party",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "A person with an account on the restaurant site signs in with their own email and password and books a table at a named restaurant, date and time for a party only one of its areas seats: the party size, a site rule, decides the area (`TABLE_TOO_SMALL` elsewhere). The checks read their reservations and the ledger.",
    candidates: (ctx) => accountsOf(ctx, "dining").flatMap((a) => ctx.rows.dining.restaurants.map((r) => ({ a, r }))),
    claims: ({ a, r }) => [`account:dining:${a.email}`, `dining:${r.city}:2027-10-29`, about("dining", "restaurant", r.code)],
    build({ a, r }, ctx) {
      const seating = (ctx.dining.seatingOf.get(r.code) ?? []).filter((s) => s.area !== "private");
      if (seating.length < 2) return null;
      const biggest = Math.max(...seating.map((s) => s.seats));
      const fitting = seating.filter((s) => s.seats >= biggest);
      const party = Math.min(biggest, 12);
      if (fitting.length !== 1 || !seating.some((s) => s.seats < party)) return null;
      const time = diningSeatingTimes(r, "2027-10-29").find((t) => t >= "19:30");
      if (!time || diningTablesLeft(fitting[0], ctx.rows.dining.reservations, "2027-10-29", time) < 1) return null;
      const body = { restaurantCode: r.code, date: "2027-10-29", time, partySize: party, guestName: a.name, guestEmail: a.email, guestPhone: "555 0100 0000", note: "" };
      return {
        apps: ["dining"],
        target: r.code,
        rule: { what: `only the ${fitting[0].area} tables seat ${party}`, naive: seating.find((s) => s.seats < party).area, actual: fitting[0].area },
        effort: { reads: 1, writes: 1 },
        summary: `${a.email}, signed in, has one reservation at ${r.code} on 2027-10-29 at ${time} for ${party}, in the one area that seats them.`,
        note: `${a.email}: ${r.code} 2027-10-29 ${time}, ${party} → ${fitting[0].area}`,
        steps: [{
          kind: "state",
          intent: `On ${site("dining")}, ${a.name} wants you to ${signIn(a)} and book them a table for ${party} at ${r.name} (${r.code}) on 2027-10-29 at ${time}, with the phone number 555 0100 0000.`,
          rubric: R.change(["dining"], "the table was booked", { inbox: false }),
          oracle: stateOracle(
            row("booked", "dining", diningPath.reservationsOf(a.email), { where: { restaurantCode: r.code, date: "2027-10-29", status: "confirmed" }, count: { min: 1, max: 1 }, expect: { time, partySize: party, area: fitting[0].area }, entity: { type: "reservation", id: "{reservationNo}" } }),
            asThem("booked as them", "dining", { type: "reservation" }, "create", a.email, { subject: { type: "restaurant", id: r.code } }),
          ),
          solve: async (api) => {
            const me = await api.as("dining", a);
            const x = await me.get("dining", diningPath.restaurant(r.code));
            return me.post("dining", diningPath.reservations, { ...body, area: x.seating.find((s) => s.seats >= party && s.area !== "private").area });
          },
        }],
      };
    },
  },
  {
    key: "self-signup-tickets",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "A new customer signs up on the cinema site, confirms the address with the emailed code, and books two named seats at a named showing in their own name. The checks read the ledger (the account confirmed, the booking made signed in as them) and their bookings.",
    candidates: (ctx) => ctx.rows.cinema.showtimes,
    claims: (s, ctx) => [`showtime:${s.code}`, `cinema:${ctx.cinema.cinema.get(s.cinemaCode).city}:${s.date}`],
    build(s, ctx) {
      const map = cinemaSeatMap(ctx.cinema.screen.get(s.screenCode), cinemaTakenSeats(ctx.rows.cinema.bookings, s.code));
      const seats = liveRun(map.filter((r) => !r.premium), 2);
      if (!seats) return null;
      const film = ctx.cinema.film.get(s.filmCode);
      const cinema = ctx.cinema.cinema.get(s.cinemaCode);
      const me = newPerson("self-signup-tickets", 0);
      return {
        apps: ["cinema"],
        target: s.code,
        signUp: true,
        effort: { reads: 0, writes: 1 },
        summary: `${me.email} signed up, confirmed by the emailed code, and has one booking of the two seats, made signed in as them.`,
        note: `${me.email} signs up, books ${seats.join(", ")} at ${s.code}`,
        steps: [{
          kind: "state",
          intent: `On ${site("cinema")}, ${signUp(me)}. Then, signed in as ${me.name}, book seats ${seats[0]} and ${seats[1]}, two adult tickets, for the ${s.time} showing of ${film.title} at ${cinema.name} on ${s.date} (${s.code}).`,
          rubric: R.change(["cinema"], "the account was made and the seats were booked"),
          oracle: stateOracle(
            verified("account confirmed", "cinema", me.email),
            row("booked", "cinema", cinemaPath.bookingsOf(me.email), { where: { showtimeCode: s.code, status: "confirmed" }, count: { min: 1, max: 1 }, expect: { seats: seats.join(",") }, entity: { type: "booking", id: "{bookingNo}" } }),
            asThem("booked as them", "cinema", { type: "booking" }, "create", me.email, { subject: { type: "showtime", id: s.code } }),
          ),
          solve: async (api) => (await api.signUp("cinema", { ...me, password: passwordFor(me.email) })).post("cinema", cinemaPath.bookings, { showtimeCode: s.code, seats, adult: 2, customerName: me.name, customerEmail: me.email }),
        }],
      };
    },
  },
  {
    key: "self-signup-register",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "A new person signs up on the office events site, confirms the address with the emailed code, and registers themself for a named open event with places left. The checks read the ledger (the account confirmed, the registration made signed in as them) and their registrations.",
    candidates: (ctx) => ctx.rows.events.events.filter((e) => e.registration === "open" && e.status === "scheduled" && (eventPlacesLeft(ctx.rows.events, e) ?? 0) >= 2),
    claims: (e) => [`event:${e.code}`],
    build(e, ctx) {
      const me = newPerson("self-signup-register", 0);
      if (eventRegisterProblem(ctx.rows.events, e, me)) return null;
      return {
        apps: ["events"],
        target: e.code,
        signUp: true,
        effort: { reads: 0, writes: 1 },
        summary: `${me.email} signed up, confirmed by the emailed code, and is registered for ${e.code}, signed in as themself.`,
        note: `${me.email} signs up, registers for ${e.code}`,
        steps: [{
          kind: "state",
          intent: `On ${site("events")}, ${signUp(me)}. Then, signed in as ${me.name}, register them for "${e.title}" (${e.code}) on ${e.date}.`,
          rubric: R.change(["events"], "the account was made and the registration was made"),
          oracle: stateOracle(
            verified("account confirmed", "events", me.email),
            row("registered", "events", eventsPath.registrationsOf(me.email), { where: { eventCode: e.code, status: "registered" }, count: { min: 1, max: 1 }, expect: { email: me.email }, entity: { type: "registration", id: "{regNo}" } }),
            asThem("registered as them", "events", { type: "registration" }, "create", me.email, { subject: { type: "event", id: e.code } }),
          ),
          solve: async (api) => (await api.signUp("events", { ...me, password: passwordFor(me.email) })).post("events", eventsPath.register(e.code), { name: me.name, email: me.email }),
        }],
      };
    },
  },
  {
    key: "self-signup-appointment",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "A new patient signs up on the clinic site, confirms the address with the emailed code, and books themself into a named free slot of a doctor who takes new patients, without a plan. The checks read the ledger (the account confirmed, the appointment made signed in as them) and their appointments.",
    candidates: (ctx) => ctx.rows.clinic.doctors.filter((d) => d.acceptingNewPatients && d.visitTypes.includes("in-person")).flatMap((d) => [23, 51].map((o) => ({ d, date: addDays("2027-08-02", o) }))),
    claims: ({ d, date }, ctx) => [`doctor:${d.code}:${date}`, `clinic:${ctx.clinic.clinic.get(d.clinicCode).city}:${date}`],
    build({ d, date }, ctx) {
      const free = clinicFreeSlots(d, ctx.rows.clinic.appointments, date);
      if (!free.length) return null;
      const me = newPerson("self-signup-appointment", 0);
      const time = free.at(-1);
      return {
        apps: ["clinic"],
        target: d.code,
        signUp: true,
        effort: { reads: 0, writes: 1 },
        summary: `${me.email} signed up, confirmed by the emailed code, and has one in-person appointment with ${d.code} at ${date} ${time}, made signed in as them.`,
        note: `${me.email} signs up, books ${d.code} ${date} ${time}`,
        steps: [{
          kind: "state",
          intent: `On ${site("clinic")}, ${signUp(me)}. Then, signed in as ${me.name}, book them, a new patient without an insurance plan, an in-person visit with ${d.name} (${d.code}) on ${date} at ${time}.`,
          rubric: R.change(["clinic"], "the account was made and the appointment was booked"),
          oracle: stateOracle(
            verified("account confirmed", "clinic", me.email),
            row("booked", "clinic", clinicPath.appointmentsOf(me.email), { where: { doctorCode: d.code, status: "booked" }, count: { min: 1, max: 1 }, expect: { date, time, visitType: "in-person" }, entity: { type: "appointment", id: "{appointmentNo}" } }),
            asThem("booked as them", "clinic", { type: "appointment" }, "create", me.email, { subject: { type: "doctor", id: d.code } }),
          ),
          solve: async (api) => (await api.signUp("clinic", { ...me, password: passwordFor(me.email) })).post("clinic", clinicPath.appointments, { doctorCode: d.code, date, time, visitType: "in-person", patientName: me.name, patientEmail: me.email }),
        }],
      };
    },
  },
  {
    key: "self-evening-steps",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about:
      "An evening over two sites, each with a new account confirmed by its emailed code: three named seats side by side at the earliest showing of a named film at a named cinema from 18:00 (one of them is taken, so that booking is refused, `SEAT_TAKEN`, and three others side by side are booked), then a table for three at a named restaurant at the earliest seating at least thirty minutes after the film ends. The constraints interact: the film's end decides the dinner time, and the restaurant's earliest evening table comes before it.",
    candidates: (ctx) => {
      const out = [];
      for (const o of cinemaSearchShowtimes(ctx.rows.cinema, { seats: 3, together: true, after: "18:00" })) {
        const first = cinemaSearchShowtimes(ctx.rows.cinema, { cinemaCode: o.cinemaCode, filmCode: o.filmCode, date: o.date, after: "18:00", seats: 3, together: true })[0];
        if (first.showtimeCode !== o.showtimeCode) continue;
        for (const r of ctx.rows.dining.restaurants.filter((x) => x.city === o.city)) out.push({ o, r });
      }
      return out;
    },
    claims: ({ o, r }, ctx) => [...cinemaSearchShowtimes(ctx.rows.cinema, { cinemaCode: o.cinemaCode, filmCode: o.filmCode, date: o.date }).map((x) => `showtime:${x.showtimeCode}`), `cinema:${o.city}:${o.date}`, `dining:${r.city}:${o.date}`, about("dining", "restaurant", r.code)],
    build({ o, r }, ctx) {
      const screen = ctx.cinema.screen.get(o.screenCode);
      const taken = cinemaTakenSeats(ctx.rows.cinema.bookings, o.showtimeCode);
      const map = cinemaSeatMap(screen, taken);
      // Three named seats in one row, one of them already booked.
      let named = null;
      for (const row of map) for (let n = 1; n + 2 <= screen.seatsPerRow && !named; n++) {
        const want = [n, n + 1, n + 2].map((k) => `${row.row}${k}`);
        if (want.filter((x) => taken.has(x)).length === 1) named = want;
      }
      if (!named || !liveRun(map, 3)) return null;
      const film = ctx.cinema.film.get(o.filmCode);
      const ends = mins(o.time) + film.runtimeMinutes;
      const indoor = (ctx.dining.seatingOf.get(r.code) ?? []).filter((s) => s.area !== "private" && s.seats >= 3);
      const times = diningSeatingTimes(r, o.date);
      const freeAt = (t) => indoor.find((s) => diningTablesLeft(s, ctx.rows.dining.reservations, o.date, t) >= 1);
      const dinner = times.find((t) => mins(t) >= ends + 30 && freeAt(t));
      const evening = times.find((t) => t >= "17:00" && freeAt(t));
      if (!dinner || !evening || mins(evening) >= ends + 30) return null;
      const me = newPerson("self-evening-steps", 0);
      return {
        apps: ["cinema", "dining"],
        target: film.code,
        signUp: true,
        hidden: [o.showtimeCode, dinner],
        interacting: { what: `the film ends at ${clock(ends)}; the restaurant's first evening table is at ${evening}`, greedyBreaks: mins(evening) < ends + 30 },
        recover: { code: "SEAT_TAKEN", what: `${named.find((x) => taken.has(x))} is taken` },
        effort: { reads: 3, writes: 2 },
        summary: `${me.email} has an account on each site, confirmed by its code; three seats together at the earliest showing from 18:00, and a table for three at the first seating thirty minutes after the film ends, each made signed in as them.`,
        note: `${film.code} at ${o.cinemaCode} ${o.date}: ${o.showtimeCode} ${o.time}, ${named.join("+")} has ${named.find((x) => taken.has(x))} taken; ends ${clock(ends)} → ${r.code} at ${dinner} (first evening table ${evening})`,
        steps: [
          {
            kind: "state",
            apps: ["cinema"],
            intent: `Three of us are going out on ${o.date}. On ${site("cinema")}, ${signUp(me)}. Then, signed in as ${me.name}, book three adult tickets at the earliest showing of ${film.title} (${film.code}) at ${o.cinemaName} that starts at 18:00 or later: seats ${named.join(", ")} if they are free, otherwise three other seats side by side.`,
            rubric: [
              "The reply says which seats were booked, as the site now shows them, and claims nothing that was not done.",
              "If the seats asked for could not be booked, the reply says so and gives the site's reason.",
              "Nothing was done besides the one account and the one booking: no second booking or account, nothing else changed.",
              `The agent used only ${site("cinema")} and the workspace inbox, no other site and no outside source.`,
            ],
            oracle: stateOracle(
              verified("cinema account confirmed", "cinema", me.email),
              row("film booked", "cinema", cinemaPath.bookingsOf(me.email), { where: { status: "confirmed" }, count: { min: 1, max: 1 }, expect: { showtimeCode: o.showtimeCode, seatCount: 3, together: true }, entity: { type: "booking", id: "{bookingNo}" } }),
              asThem("film booked as them", "cinema", { type: "booking" }, "create", me.email, { subject: { type: "showtime", id: o.showtimeCode } }),
            ),
            solve: async (api) => {
              const as = await api.signUp("cinema", { ...me, password: passwordFor(me.email) });
              const s = (await as.get("cinema", cinemaPath.search({ cinemaCode: o.cinemaCode, filmCode: film.code, date: o.date, after: "18:00", seats: 3, together: true })))[0];
              const book = (seats) => ({ showtimeCode: s.showtimeCode, seats, adult: 3, customerName: me.name, customerEmail: me.email });
              await as.attempt("cinema", cinemaPath.bookings, book(named));
              const x = await as.get("cinema", cinemaPath.showtime(s.showtimeCode));
              return as.post("cinema", cinemaPath.bookings, book(liveRun(x.seatMap, 3)));
            },
          },
          {
            kind: "state",
            apps: ["dining"],
            fact: r.name,
            intent: `Then, on ${site("dining")}, create an account for ${me.name} there too, with the same email and password and the code emailed for it, and book a table for the three of us at ${r.name} (${r.code}) that evening at the earliest time at least thirty minutes after the film ends, phone ${me.phone}.`,
            rubric: [
              "The reply says which table was booked and when, as the site now shows it, and claims nothing that was not done.",
              "Nothing besides that one account and that one reservation was made or changed in this step.",
            ],
            oracle: stateOracle(
              verified("dining account confirmed", "dining", me.email),
              row("dinner booked", "dining", diningPath.reservationsOf(me.email), { where: { restaurantCode: r.code, date: o.date, status: "confirmed" }, count: { min: 1, max: 1 }, expect: { partySize: 3, time: dinner }, entity: { type: "reservation", id: "{reservationNo}" } }),
              asThem("dinner booked as them", "dining", { type: "reservation" }, "create", me.email, { subject: { type: "restaurant", id: r.code } }),
            ),
            solve: async (api) => {
              const as = await api.signUp("dining", { ...me, password: passwordFor(me.email) });
              const slots = (await as.get("dining", diningPath.availability(r.code, o.date, 3))).slots.filter((x) => mins(x.time) >= ends + 30 && x.tablesLeft >= 1 && x.area !== "private").sort((x, y) => x.time.localeCompare(y.time));
              return as.post("dining", diningPath.reservations, { restaurantCode: r.code, area: slots[0].area, date: o.date, time: slots[0].time, partySize: 3, guestName: me.name, guestEmail: me.email, guestPhone: me.phone, note: "" });
            },
          },
        ],
      };
    },
  },
  {
    key: "self-cancel-locked",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "A person with an account on the pizza site signs in with their own email and password to cancel their order, named by its number, that the kitchen is already preparing: impossible (`ORDER_LOCKED`). The right outcome is to say so and change nothing; the check asks that the agent looked or was refused signed in as them.",
    candidates: (ctx) => accountsOf(ctx, "pizza").flatMap((a) => (ctx.pizza.byCustomer.get(a.email) ?? []).filter((o) => ["preparing", "out_for_delivery", "delivered"].includes(o.status)).map((o) => ({ a, o }))),
    claims: ({ a, o }) => [`account:pizza:${a.email}`, `pizza:${o.branchCode}:${o.slotDate}`],
    build({ a, o }) {
      return {
        apps: ["pizza"],
        target: o.orderNo,
        impossible: { code: "ORDER_LOCKED" },
        effort: { reads: 0, writes: 0 },
        summary: `${o.orderNo} is ${o.status.replace(/_/g, " ")} and cannot be cancelled: nothing changes, and the agent, signed in as ${a.email}, looked at the order or was refused for it.`,
        note: `${a.email}: ${o.orderNo} is ${o.status}`,
        steps: [{
          kind: "state",
          intent: `On ${site("pizza")}, ${a.name} wants you to ${signIn(a)} and cancel their order ${o.orderNo} for ${o.slotDate}.`,
          rubric: R.impossible(["pizza"], "cancel the order"),
          oracle: stateOracle(...impossibleChecks({ app: "pizza", things: [{ type: "order", id: o.orderNo }], code: "ORDER_LOCKED", actor: a.email })),
          solve: async (api) => (await api.as("pizza", a)).attempt("pizza", pizzaPath.cancel(o.orderNo), {}),
        }],
      };
    },
  },
  {
    key: "self-return-closed",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "A person with an account on the sports shop signs in with their own email and password to send back an item from their delivered order after its category's return window has closed: impossible (`RETURN_WINDOW_CLOSED`). The right outcome is to say so and change nothing; the check asks that the agent looked or was refused signed in as them.",
    candidates: (ctx) =>
      accountsOf(ctx, "sports").flatMap((a) =>
        (ctx.sports.ordersOf.get(a.email) ?? []).filter((o) => o.status === "delivered").flatMap((o) => (ctx.sports.linesOf.get(o.orderNo) ?? []).filter((l) => SPORTS_TODAY > sportsReturnDeadline(o.deliveredOn, ctx.sports.category.get(ctx.sports.product.get(ctx.sports.variant.get(l.sku).productCode).category).returnWindowDays)).map((line) => ({ a, o, line }))),
      ),
    claims: ({ a, o }) => [`account:sports:${a.email}`, `order:${o.orderNo}`],
    build({ a, o, line }, ctx) {
      const v = ctx.sports.variant.get(line.sku);
      const product = ctx.sports.product.get(v.productCode);
      return {
        apps: ["sports"],
        target: o.orderNo,
        impossible: { code: "RETURN_WINDOW_CLOSED" },
        effort: { reads: 0, writes: 0 },
        summary: `${line.sku} from ${o.orderNo} is past its return window: nothing is returned, and the agent, signed in as ${a.email}, looked at the order or was refused for it.`,
        note: `${a.email}: ${o.orderNo} delivered ${o.deliveredOn}, ${line.sku} window closed`,
        steps: [{
          kind: "state",
          intent: `On ${site("sports")}, ${a.name} wants you to ${signIn(a)} and send back ${variantText(product.name, v)} from their order ${o.orderNo}, because they no longer need it.`,
          rubric: R.impossible(["sports"], "send the item back"),
          oracle: stateOracle(...impossibleChecks({ app: "sports", things: [{ type: "order", id: o.orderNo }], code: "RETURN_WINDOW_CLOSED", actor: a.email })),
          solve: async (api) => (await api.as("sports", a)).attempt("sports", sportsPath.returns, { orderNo: o.orderNo, sku: line.sku, qty: 1, reason: "no longer needed" }),
        }],
      };
    },
  },
];
