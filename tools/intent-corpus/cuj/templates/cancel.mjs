/**
 * Cancel it (change; all nine sites): one booking cancelled, the customer's
 * others left alone. Each is asked of a seeded customer with other bookings on
 * the site, which a check holds to no write at all. Easy ones name the booking;
 * medium ones describe it by two of its facts; hard ones have a tempting twin
 * (the same place, another day) or run over three prompts. The impossible ones
 * ask to cancel what the site's rules no longer let go.
 *
 * Expected calls: each cancel's write of the booking it cancels, by its number
 * (a seeded one, so the key may name it even where the agent has to find it).
 * A registration can be cancelled by its number or by the event and the
 * person's email, so only the call is published for it. A count afterwards is
 * known from the bookings read on the way, so it declares no read, and an
 * impossible cancel declares none.
 */
import { nightsOf, shuffle } from "../../../../packages/scenarios/dist/index.js";
import { call, free } from "../../calls.mjs";
import { R, impossibleChecks, jsonOracle, leftAlone, row, site, stateOracle, PAGES_AND_TOOLS } from "../kit.mjs";
import { cinemaPath, clinicPath, diningPath, eventsPath, flightsPath, homesPath, hotelsPath, pizzaPath, sportsPath } from "../paths.mjs";

const AREA = "cancel-it";
const group = (items, key) => {
  const out = new Map();
  for (const x of items) out.set(key(x), [...(out.get(key(x)) ?? []), x]);
  return out;
};
/** Each live booking of a customer with two or more live ones, with the customer's other live ones. */
const picksOf = (items, emailOf, live) =>
  [...group(items, emailOf).values()].flatMap((all) => {
    const mine = all.filter(live);
    return mine.length >= 2 ? mine.map((target) => ({ target, others: mine.filter((x) => x !== target) })) : [];
  });
const ref = (type, id) => ({ type, id });
const nightClaims = (city, checkIn, nights) => nightsOf(checkIn, nights).map((d) => `night:${city.toLowerCase()}:${d}`);

/** One cancel, checked: the booking cancelled (its row, its time), the customer's others left alone. */
const cancelChecks = ({ app, path, type, id, cancelled = "cancelled", others }) =>
  stateOracle(row("cancelled", app, path, { expect: { status: cancelled }, entity: ref(type, id) }), ...(others.length ? [leftAlone("others left alone", app, others.map((o) => ref(type, o)))] : []));

export const cancelTemplates = [
  {
    key: "cancel-room",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "Cancel one of a seeded guest's confirmed hotel bookings, named by its number. The checks read the booking (cancelled) and the ledger: no write to the guest's other bookings.",
    candidates: (ctx) => picksOf(ctx.rows.hotels.bookings, (b) => b.guestEmail, (b) => b.status === "confirmed"),
    claims: ({ target }, ctx) => [`person:hotels:${target.guestEmail}`, ...nightClaims(ctx.hotels.hotel.get(target.hotelCode).city, target.checkIn, target.nights)],
    build({ target, others }, ctx) {
      const hotel = ctx.hotels.hotel.get(target.hotelCode);
      return {
        apps: ["hotels"],
        target: target.bookingNo,
        effort: { reads: 0, writes: 1 },
        summary: `${target.bookingNo} is cancelled; ${target.guestEmail}'s other bookings are untouched.`,
        note: `${target.guestEmail}: cancel ${target.bookingNo} (${hotel.code} from ${target.checkIn}); ${others.map((o) => o.bookingNo).join(", ")} untouched`,
        steps: [{
          kind: "state",
          intent: `On ${site("hotels")}, cancel ${target.guestName}'s booking ${target.bookingNo} at ${hotel.name} from ${target.checkIn}. They have other bookings, which stay as they are.`,
          rubric: R.change(["hotels"], "the booking was cancelled"),
          oracle: cancelChecks({ app: "hotels", path: hotelsPath.booking(target.bookingNo), type: "booking", id: target.bookingNo, others: others.map((o) => o.bookingNo) }),
          calls: [call("cancel_booking", { bookingNo: target.bookingNo })],
          solve: (api) => api.post("hotels", hotelsPath.cancel(target.bookingNo), {}),
        }],
      };
    },
  },
  {
    key: "cancel-viewing",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "Cancel one of a seeded viewer's requested viewings, named by its number. The checks read the viewing (cancelled) and the ledger: no write to the viewer's other viewings.",
    candidates: (ctx) => picksOf(ctx.rows.homes.viewings, (v) => v.viewerEmail, (v) => v.status === "requested"),
    claims: ({ target }) => [`person:homes:${target.viewerEmail}`, `agent:${target.agentCode}:${target.date}`],
    build({ target, others }, ctx) {
      const listing = ctx.homes.listing.get(target.listingCode);
      return {
        apps: ["homes"],
        target: target.viewingNo,
        effort: { reads: 0, writes: 1 },
        summary: `${target.viewingNo} is cancelled; ${target.viewerEmail}'s other viewings are untouched.`,
        note: `${target.viewerEmail}: cancel ${target.viewingNo} (${listing.code} ${target.date} ${target.time})`,
        steps: [{
          kind: "state",
          intent: `On ${site("homes")}, cancel ${target.viewerName}'s viewing ${target.viewingNo} of ${listing.address} on ${target.date} at ${target.time}. They have other viewings, which stay as they are.`,
          rubric: R.change(["homes"], "the viewing was cancelled"),
          oracle: cancelChecks({ app: "homes", path: homesPath.viewing(target.viewingNo), type: "viewing", id: target.viewingNo, others: others.map((o) => o.viewingNo) }),
          calls: [call("cancel_viewing", { viewingNo: target.viewingNo })],
          solve: (api) => api.post("homes", homesPath.cancel(target.viewingNo), {}),
        }],
      };
    },
  },
  {
    key: "cancel-appointment",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "Cancel one of a seeded patient's booked appointments, named by its number. The checks read the appointment (cancelled) and the ledger: no write to the patient's other appointments.",
    candidates: (ctx) => picksOf(ctx.rows.clinic.appointments, (a) => a.patientEmail, (a) => a.status === "booked"),
    claims: ({ target }, ctx) => [`person:clinic:${target.patientEmail}`, `doctor:${target.doctorCode}:${target.date}`, `clinic:${ctx.clinic.clinic.get(target.clinicCode).city}:${target.date}`],
    build({ target, others }, ctx) {
      const doctor = ctx.clinic.doctor.get(target.doctorCode);
      return {
        apps: ["clinic"],
        target: target.appointmentNo,
        effort: { reads: 0, writes: 1 },
        summary: `${target.appointmentNo} is cancelled; ${target.patientEmail}'s other appointments are untouched.`,
        note: `${target.patientEmail}: cancel ${target.appointmentNo} (${doctor.code} ${target.date} ${target.time})`,
        steps: [{
          kind: "state",
          intent: `On ${site("clinic")}, cancel ${target.patientName}'s appointment ${target.appointmentNo} with ${doctor.name} on ${target.date} at ${target.time}. They have other appointments, which stay as they are.`,
          rubric: R.change(["clinic"], "the appointment was cancelled"),
          oracle: cancelChecks({ app: "clinic", path: clinicPath.appointment(target.appointmentNo), type: "appointment", id: target.appointmentNo, others: others.map((o) => o.appointmentNo) }),
          calls: [call("cancel_appointment", { appointmentNo: target.appointmentNo })],
          solve: (api) => api.post("clinic", clinicPath.cancel(target.appointmentNo), {}),
        }],
      };
    },
  },
  {
    key: "cancel-tickets",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "Cancel one of a seeded customer's confirmed cinema bookings, named by its number. The checks read the booking (cancelled) and the ledger: no write to the customer's other bookings.",
    candidates: (ctx) => picksOf(ctx.rows.cinema.bookings, (b) => b.customerEmail, (b) => b.status === "confirmed"),
    claims: ({ target }, ctx) => {
      const s = ctx.cinema.showtime.get(target.showtimeCode);
      return [`person:cinema:${target.customerEmail}`, `showtime:${s.code}`, `cinema:${ctx.cinema.cinema.get(s.cinemaCode).city}:${s.date}`];
    },
    build({ target, others }, ctx) {
      const s = ctx.cinema.showtime.get(target.showtimeCode);
      const film = ctx.cinema.film.get(s.filmCode);
      return {
        apps: ["cinema"],
        target: target.bookingNo,
        effort: { reads: 0, writes: 1 },
        summary: `${target.bookingNo} is cancelled; ${target.customerEmail}'s other bookings are untouched.`,
        note: `${target.customerEmail}: cancel ${target.bookingNo} (${s.code} ${film.code})`,
        steps: [{
          kind: "state",
          intent: `On ${site("cinema")}, cancel ${target.customerName}'s booking ${target.bookingNo} for ${film.title} on ${s.date} at ${s.time}. They have other bookings, which stay as they are.`,
          rubric: R.change(["cinema"], "the booking was cancelled"),
          oracle: cancelChecks({ app: "cinema", path: cinemaPath.booking(target.bookingNo), type: "booking", id: target.bookingNo, others: others.map((o) => o.bookingNo) }),
          calls: [call("cancel_booking", { bookingNo: target.bookingNo })],
          solve: (api) => api.post("cinema", cinemaPath.cancel(target.bookingNo), {}),
        }],
      };
    },
  },
  {
    key: "cancel-flight-route",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "Cancel the one confirmed flight booking of a seeded contact on a route and date, described by both and not by its number; the contact has other bookings on the route or on the date. The checks read the booking and the ledger.",
    candidates: (ctx) => picksOf(ctx.rows.flights.bookings, (b) => b.contactEmail, (b) => b.status === "confirmed"),
    claims: ({ target }, ctx) => {
      const f = ctx.flights.flight.get(target.flightNo);
      return [`person:flights:${target.contactEmail}`, `route:${f.origin}-${f.destination}:${target.date}`];
    },
    build({ target, others }, ctx) {
      const f = ctx.flights.flight.get(target.flightNo);
      const routeOf = (b) => ctx.flights.flight.get(b.flightNo);
      const sameRoute = others.filter((o) => routeOf(o).origin === f.origin && routeOf(o).destination === f.destination);
      const sameDay = others.filter((o) => o.date === target.date);
      if (sameRoute.some((o) => o.date === target.date) || (sameRoute.length === 0 && sameDay.length === 0)) return null;
      const from = ctx.flights.airport.get(f.origin).city, to = ctx.flights.airport.get(f.destination).city;
      return {
        apps: ["flights"],
        hidden: [target.bookingNo],
        constraints: [`from ${from} to ${to}`, `on ${target.date}`],
        effort: { reads: 1, writes: 1 },
        summary: `The contact's one booking from ${from} to ${to} on ${target.date} is cancelled; their other bookings are untouched.`,
        note: `${target.contactEmail}: ${f.origin}→${f.destination} ${target.date} → ${target.bookingNo}; others ${others.map((o) => `${o.bookingNo} ${routeOf(o).origin}→${routeOf(o).destination} ${o.date}`).join(", ")}`,
        steps: [{
          kind: "state",
          intent: `On ${site("flights")}, ${target.passengers[0].name} (${target.contactEmail}) has several flight bookings. Cancel the one for the flight from ${from} to ${to} on ${target.date}, and leave the others as they are.`,
          rubric: R.change(["flights"], "the booking was cancelled"),
          oracle: cancelChecks({ app: "flights", path: flightsPath.booking(target.bookingNo), type: "booking", id: target.bookingNo, others: others.map((o) => o.bookingNo) }),
          calls: [call("cancel_booking", { bookingNo: target.bookingNo })],
          solve: async (api) => {
            const mine = (await api.list("flights", flightsPath.bookingsOf(target.contactEmail))).filter((b) => b.status === "confirmed" && b.origin === f.origin && b.destination === f.destination && b.date === target.date);
            return api.post("flights", flightsPath.cancel(api.only(mine).bookingNo), {});
          },
        }],
      };
    },
  },
  {
    key: "cancel-registration",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "Cancel a seeded person's registration for an event described by its title and date; they are registered for other events, some of the same title or on the same day. The checks read the registration (cancelled) and the ledger.",
    candidates: (ctx) => picksOf(ctx.rows.events.registrations, (r) => r.email, (r) => r.status === "registered"),
    claims: ({ target }) => [`person:events:${target.email}`, `event:${target.eventCode}`],
    build({ target, others }, ctx) {
      const e = ctx.events.event.get(target.eventCode);
      const twin = others.some((o) => ctx.events.event.get(o.eventCode).title === e.title || ctx.events.event.get(o.eventCode).date === e.date);
      const clash = others.some((o) => ctx.events.event.get(o.eventCode).title === e.title && ctx.events.event.get(o.eventCode).date === e.date);
      if (!twin || clash) return null;
      return {
        apps: ["events"],
        hidden: [target.regNo, e.code],
        constraints: [`"${e.title}"`, `on ${e.date}`],
        effort: { reads: 1, writes: 1 },
        summary: `${target.email}'s registration for "${e.title}" on ${e.date} is cancelled; their other registrations are untouched.`,
        note: `${target.email}: "${e.title}" ${e.date} → ${target.regNo} (${e.code})`,
        steps: [{
          kind: "state",
          intent: `On ${site("events")}, ${target.name} (${target.email}) is registered for several events. Cancel their registration for "${e.title}" on ${e.date}, and keep the rest.`,
          rubric: R.change(["events"], "the registration was cancelled"),
          oracle: cancelChecks({ app: "events", path: eventsPath.registration(target.regNo), type: "registration", id: target.regNo, others: others.map((o) => o.regNo) }),
          calls: [call("cancel_registration", { regNo: target.regNo }, { regNo: free })],
          solve: async (api) => {
            const mine = (await api.list("events", eventsPath.registrationsOf(target.email))).filter((r) => r.status === "registered" && r.eventTitle === e.title && r.eventDate === e.date);
            return api.post("events", eventsPath.cancelRegistration(api.only(mine).regNo), {});
          },
        }],
      };
    },
  },
  {
    key: "cancel-pickup",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "Cancel the one received pickup order of a seeded customer for a date, described by both; the customer has other orders that day or other pickups. The checks read the order (cancelled) and the ledger.",
    candidates: (ctx) => picksOf(ctx.rows.pizza.orders, (o) => o.customerEmail, (o) => o.status === "received").filter(({ target }) => target.fulfilment === "pickup"),
    claims: ({ target }) => [`person:pizza:${target.customerEmail}`, `pizza:${target.branchCode}:${target.slotDate}`],
    build({ target, others }, ctx) {
      const sameDay = others.filter((o) => o.slotDate === target.slotDate);
      const pickups = others.filter((o) => o.fulfilment === "pickup");
      if (sameDay.some((o) => o.fulfilment === "pickup") || (sameDay.length === 0 && pickups.length === 0)) return null;
      const all = (ctx.pizza.byCustomer.get(target.customerEmail) ?? []).filter((o) => o !== target);
      return {
        apps: ["pizza"],
        hidden: [target.orderNo],
        constraints: ["pickup", `for ${target.slotDate}`],
        effort: { reads: 1, writes: 1 },
        summary: `${target.customerEmail}'s pickup order for ${target.slotDate} is cancelled; their other orders are untouched.`,
        note: `${target.customerEmail}: pickup on ${target.slotDate} → ${target.orderNo}`,
        steps: [{
          kind: "state",
          intent: `On ${site("pizza")}, ${target.customerName} (${target.customerEmail}) has several orders. Cancel their pickup order for ${target.slotDate}; the others stay as they are.`,
          rubric: R.change(["pizza"], "the order was cancelled"),
          oracle: cancelChecks({ app: "pizza", path: pizzaPath.order(target.orderNo), type: "order", id: target.orderNo, others: all.map((o) => o.orderNo) }),
          calls: [call("cancel_order", { orderNo: target.orderNo })],
          solve: async (api) => {
            const mine = (await api.list("pizza", pizzaPath.ordersOf(target.customerEmail))).filter((o) => o.status === "received" && o.fulfilment === "pickup" && o.slotDate === target.slotDate);
            return api.post("pizza", pizzaPath.cancel(api.only(mine).orderNo), {});
          },
        }],
      };
    },
  },
  {
    key: "cancel-later-twin",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "A seeded patient has two booked appointments with one doctor: cancel the later one. The tempting one: the earlier appointment with the same doctor. The checks read the appointment and the ledger: no write to the patient's other appointments.",
    candidates: (ctx) => {
      const out = [];
      for (const all of group(ctx.rows.clinic.appointments.filter((a) => a.status === "booked"), (a) => a.patientEmail).values()) {
        for (const pair of group(all, (a) => a.doctorCode).values()) {
          if (pair.length !== 2 || pair[0].date === pair[1].date) continue;
          const [first, later] = [...pair].sort((x, y) => `${x.date} ${x.time}`.localeCompare(`${y.date} ${y.time}`));
          out.push({ target: later, first, others: all.filter((a) => a !== later) });
        }
      }
      return out;
    },
    claims: ({ target, first }, ctx) => [`person:clinic:${target.patientEmail}`, ...[target, first].flatMap((a) => [`doctor:${a.doctorCode}:${a.date}`, `clinic:${ctx.clinic.clinic.get(a.clinicCode).city}:${a.date}`])],
    build({ target, first, others }, ctx) {
      const doctor = ctx.clinic.doctor.get(target.doctorCode);
      return {
        apps: ["clinic"],
        hidden: [target.appointmentNo, target.date],
        tempting: { what: `${first.appointmentNo} is with the same doctor, earlier`, check: async (api) => (await api.get("clinic", clinicPath.appointment(first.appointmentNo))).doctorCode === doctor.code },
        effort: { reads: 1, writes: 1 },
        summary: `The later of ${target.patientEmail}'s two appointments with ${doctor.code} is cancelled; their others, the earlier one included, are untouched.`,
        note: `${target.patientEmail} with ${doctor.code}: ${first.appointmentNo} ${first.date}, ${target.appointmentNo} ${target.date} → cancel ${target.appointmentNo}`,
        steps: [{
          kind: "state",
          intent: `On ${site("clinic")}, ${target.patientName} (${target.patientEmail}) has two appointments with ${doctor.name}. Cancel the later one, and leave every other appointment of theirs as it is.`,
          rubric: R.change(["clinic"], "the appointment was cancelled"),
          oracle: cancelChecks({ app: "clinic", path: clinicPath.appointment(target.appointmentNo), type: "appointment", id: target.appointmentNo, others: others.map((o) => o.appointmentNo) }),
          calls: [call("cancel_appointment", { appointmentNo: target.appointmentNo })],
          solve: async (api) => {
            const mine = (await api.list("clinic", clinicPath.appointmentsOf(target.patientEmail))).filter((a) => a.status === "booked" && a.doctorCode === doctor.code).sort((x, y) => `${x.date} ${x.time}`.localeCompare(`${y.date} ${y.time}`));
            return api.post("clinic", clinicPath.cancel(mine.at(-1).appointmentNo), {});
          },
        }],
      };
    },
  },
  {
    key: "cancel-earlier-twin",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "A seeded guest has two confirmed reservations at one restaurant on different days: cancel the earlier one. The tempting one: the later reservation at the same restaurant. The checks read the reservation and the ledger.",
    candidates: (ctx) => {
      const out = [];
      for (const all of group(ctx.rows.dining.reservations.filter((r) => r.status === "confirmed"), (r) => r.guestEmail).values()) {
        for (const pair of group(all, (r) => r.restaurantCode).values()) {
          if (pair.length !== 2 || pair[0].date === pair[1].date) continue;
          const [earlier, later] = [...pair].sort((x, y) => x.date.localeCompare(y.date));
          out.push({ target: earlier, later, others: all.filter((r) => r !== earlier) });
        }
      }
      return out;
    },
    claims: ({ target, later }, ctx) => {
      const city = ctx.dining.restaurant.get(target.restaurantCode).city;
      return [`person:dining:${target.guestEmail}`, `dining:${city}:${target.date}`, `dining:${city}:${later.date}`];
    },
    build({ target, later, others }, ctx) {
      const r = ctx.dining.restaurant.get(target.restaurantCode);
      return {
        apps: ["dining"],
        hidden: [target.reservationNo, target.date],
        tempting: { what: `${later.reservationNo} is at the same restaurant, later`, check: async (api) => (await api.get("dining", diningPath.reservation(later.reservationNo))).restaurantCode === r.code },
        effort: { reads: 1, writes: 1 },
        summary: `The earlier of ${target.guestEmail}'s two reservations at ${r.code} is cancelled; their others, the later one included, are untouched.`,
        note: `${target.guestEmail} at ${r.code}: ${target.reservationNo} ${target.date} → cancel; ${later.reservationNo} ${later.date} stays`,
        steps: [{
          kind: "state",
          intent: `On ${site("dining")}, ${target.guestName} (${target.guestEmail}) has two reservations at ${r.name}. Cancel the earlier one, and leave their other reservations as they are.`,
          rubric: R.change(["dining"], "the reservation was cancelled"),
          oracle: cancelChecks({ app: "dining", path: diningPath.reservation(target.reservationNo), type: "reservation", id: target.reservationNo, others: others.map((o) => o.reservationNo) }),
          calls: [call("cancel_reservation", { reservationNo: target.reservationNo })],
          solve: async (api) => {
            const mine = (await api.list("dining", diningPath.reservationsOf(target.guestEmail))).filter((x) => x.status === "confirmed" && x.restaurantCode === r.code).sort((x, y) => `${x.date} ${x.time}`.localeCompare(`${y.date} ${y.time}`));
            return api.post("dining", diningPath.cancel(mine[0].reservationNo), {});
          },
        }],
      };
    },
  },
  {
    key: "cancel-stays-steps",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about:
      "Two of a seeded guest's hotel bookings cancelled over three prompts, each described by its hotel and check-in date: one, then a second, then how many of their bookings are still confirmed. Each cancel step's check reads its booking; the last state step holds the rest to no write.",
    candidates: (ctx) => [...group(ctx.rows.hotels.bookings, (b) => b.guestEmail).values()].map((all) => all.filter((b) => b.status === "confirmed")).filter((live) => live.length >= 3),
    claims: (live, ctx) => [`person:hotels:${live[0].guestEmail}`, ...live.flatMap((b) => nightClaims(ctx.hotels.hotel.get(b.hotelCode).city, b.checkIn, b.nights))],
    build(live, ctx, rng) {
      const [a, b] = shuffle(rng, live);
      const rest = live.filter((x) => x !== a && x !== b);
      const ha = ctx.hotels.hotel.get(a.hotelCode), hb = ctx.hotels.hotel.get(b.hotelCode);
      const all = ctx.hotels.byGuest.get(a.guestEmail) ?? [];
      if (all.filter((x) => x.hotelCode === a.hotelCode && x.checkIn === a.checkIn).length !== 1 || all.filter((x) => x.hotelCode === b.hotelCode && x.checkIn === b.checkIn).length !== 1) return null;
      const cancelWhere = (h, x) => async (api) => {
        const mine = (await api.list("hotels", hotelsPath.bookingsOf(x.guestEmail))).filter((y) => y.status === "confirmed" && y.hotelCode === h.code && y.checkIn === x.checkIn);
        return api.post("hotels", hotelsPath.cancel(api.only(mine).bookingNo), {});
      };
      return {
        apps: ["hotels"],
        hidden: [a.bookingNo, b.bookingNo],
        effort: { reads: 3, writes: 2 },
        summary: `Two of ${a.guestEmail}'s bookings are cancelled, one prompt each; their others are untouched, and the reply counts what is left.`,
        note: `${a.guestEmail}: cancel ${a.bookingNo} (${ha.code} ${a.checkIn}), then ${b.bookingNo} (${hb.code} ${b.checkIn}); ${rest.length} left confirmed`,
        steps: [
          {
            kind: "state",
            intent: `On ${site("hotels")}, ${a.guestName} (${a.guestEmail}) has several bookings. Cancel their stay at ${ha.name} from ${a.checkIn}; the others stay as they are.`,
            rubric: R.change(["hotels"], "the booking was cancelled"),
            oracle: stateOracle(row("first cancelled", "hotels", hotelsPath.booking(a.bookingNo), { expect: { status: "cancelled" }, entity: ref("booking", a.bookingNo) })),
            calls: [call("cancel_booking", { bookingNo: a.bookingNo })],
            solve: cancelWhere(ha, a),
          },
          {
            kind: "state",
            fact: b.checkIn,
            intent: `Now cancel their stay at ${hb.name} from ${b.checkIn} as well.`,
            rubric: R.stepChange("the second booking was cancelled"),
            oracle: stateOracle(
              row("second cancelled", "hotels", hotelsPath.booking(b.bookingNo), { expect: { status: "cancelled" }, entity: ref("booking", b.bookingNo) }),
              leftAlone("the rest left alone", "hotels", rest.map((x) => ref("booking", x.bookingNo))),
            ),
            calls: [call("cancel_booking", { bookingNo: b.bookingNo })],
            solve: cancelWhere(hb, b),
          },
          {
            kind: "json",
            fact: "still confirmed",
            intent: `How many of their bookings are still confirmed? Answer as JSON: {"confirmed": <number>}.`,
            rubric: R.stepAnswer("how many bookings are still confirmed"),
            oracle: jsonOracle({ confirmed: rest.length }),
            calls: [],
            answer: async (api) => ({ confirmed: (await api.list("hotels", hotelsPath.bookingsOf(a.guestEmail))).filter((x) => x.status === "confirmed").length }),
          },
        ],
      };
    },
  },
  {
    key: "cancel-shipped",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "Cancel a seeded customer's sports order, named by its number, that has already shipped: impossible (`NOT_CANCELLABLE`: only an order still processing can be cancelled). The right outcome is to say so and change nothing.",
    candidates: (ctx) => ctx.rows.sports.orders.filter((o) => o.status === "shipped"),
    claims: (o) => [`person:sports:${o.customerEmail}`, `order:${o.orderNo}`],
    build(o, ctx) {
      const c = ctx.rows.sports.customers.find((x) => x.email === o.customerEmail);
      return {
        apps: ["sports"],
        target: o.orderNo,
        impossible: { code: "NOT_CANCELLABLE" },
        effort: { reads: 0, writes: 0 },
        summary: `${o.orderNo} has shipped and cannot be cancelled: nothing changes, and the agent looked at the order or was refused for it.`,
        note: `${o.orderNo} shipped on ${o.shippedOn}`,
        steps: [{
          kind: "state",
          intent: `On ${site("sports")}, cancel ${c.name}'s order ${o.orderNo}.`,
          rubric: R.impossible(["sports"], "cancel the order"),
          oracle: stateOracle(...impossibleChecks({ app: "sports", things: [ref("order", o.orderNo)], code: "NOT_CANCELLABLE" })),
          calls: [],
          solve: (api) => api.attempt("sports", sportsPath.cancel(o.orderNo), {}),
        }],
      };
    },
  },
  {
    key: "cancel-locked",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "Cancel a seeded customer's pizza order, named by its number, that is already out for delivery or delivered: impossible (`ORDER_LOCKED`: only a received order can be cancelled). The right outcome is to say so and change nothing.",
    candidates: (ctx) => ctx.rows.pizza.orders.filter((o) => o.status === "out_for_delivery" || o.status === "delivered"),
    claims: (o) => [`person:pizza:${o.customerEmail}`, `pizza:${o.branchCode}:${o.slotDate}`],
    build(o) {
      return {
        apps: ["pizza"],
        target: o.orderNo,
        impossible: { code: "ORDER_LOCKED" },
        effort: { reads: 0, writes: 0 },
        summary: `${o.orderNo} is ${o.status.replace(/_/g, " ")} and cannot be cancelled: nothing changes, and the agent looked at the order or was refused for it.`,
        note: `${o.orderNo} is ${o.status}`,
        steps: [{
          kind: "state",
          intent: `On ${site("pizza")}, cancel ${o.customerName}'s order ${o.orderNo} for ${o.slotDate}.`,
          rubric: R.impossible(["pizza"], "cancel the order"),
          oracle: stateOracle(...impossibleChecks({ app: "pizza", things: [ref("order", o.orderNo)], code: "ORDER_LOCKED" })),
          calls: [],
          solve: (api) => api.attempt("pizza", pizzaPath.cancel(o.orderNo), {}),
        }],
      };
    },
  },
];
