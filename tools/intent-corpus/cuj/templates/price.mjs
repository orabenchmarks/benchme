/**
 * Price it (answer; hotels, flights, pizza, clinic, sports, cinema): the full
 * cost of a named choice, fees and extras included. The impossible ones ask
 * the price of what the site's rules will not sell.
 */
import { addDays, cinemaQuote, cinemaSeatMap, cinemaTakenSeats, pizzaOutOfStock, pizzaQuote, searchFlights, shuffle, sportsShippingCents, stayTotalCents } from "../../../../packages/scenarios/dist/index.js";
import { R, about, dollars, variantText, impossibleChecks, jsonOracle, money, newPerson, site, stateOracle, PAGES_AND_TOOLS } from "../kit.mjs";
import { cinemaPath, clinicPath, flightsPath, hotelsPath, pizzaPath, sportsPath } from "../paths.mjs";

const AREA = "price-it";
const CABIN = { economy: "economy", premium: "premium economy", business: "business" };
const fareOf = (ctx, flightNo, cabin) => (ctx.flights.cabinsOf.get(flightNo) ?? []).find((c) => c.cabin === cabin);
const people = (n) => (n === 2 ? "two" : n === 3 ? "three" : String(n));

export const priceTemplates = [
  {
    key: "price-room-night",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "What one night in a named room type costs: its nightly price, on the hotel's page.",
    candidates: (ctx) => ctx.rows.hotels.rooms,
    claims: (r) => [`price:hotels:${r.code}`],
    build(room, ctx) {
      const hotel = ctx.hotels.hotel.get(room.hotelCode);
      return {
        apps: ["hotels"],
        target: room.code,
        effort: { reads: 1, writes: 0 },
        summary: `The nightly price of ${room.code}.`,
        note: `${room.code} → ${dollars(room.nightlyCents)} a night`,
        steps: [{
          kind: "json",
          intent: `On ${site("hotels")}, what does one night in the ${room.name} (${room.code}) at ${hotel.name} cost? Answer as JSON: {"nightly": <dollars>}.`,
          rubric: R.answer(["hotels"], "the nightly price"),
          oracle: jsonOracle({ nightly: money(room.nightlyCents) }),
          answer: async (api) => ({ nightly: (await api.get("hotels", hotelsPath.hotel(hotel.code))).rooms.find((r) => r.code === room.code).nightlyCents / 100 }),
        }],
      };
    },
  },
  {
    key: "price-flight-fare",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "What one seat in a named cabin of a named flight costs: the cabin's fare per passenger.",
    candidates: (ctx) => ctx.rows.flights.cabins.filter((c) => c.cabin !== "economy"),
    claims: (c) => [`price:flights:${c.flightNo}`],
    build(cabin) {
      return {
        apps: ["flights"],
        target: cabin.flightNo,
        effort: { reads: 1, writes: 0 },
        summary: `The ${cabin.cabin} fare per passenger on ${cabin.flightNo}.`,
        note: `${cabin.flightNo} ${cabin.cabin} → ${dollars(cabin.priceCents)}`,
        steps: [{
          kind: "json",
          intent: `On ${site("flights")}, what is the ${CABIN[cabin.cabin]} fare for one passenger on flight ${cabin.flightNo}? Answer as JSON: {"fare": <dollars>}.`,
          rubric: R.answer(["flights"], "the fare"),
          oracle: jsonOracle({ fare: money(cabin.priceCents) }),
          answer: async (api) => ({ fare: (await api.get("flights", flightsPath.flight(cabin.flightNo))).cabins.find((c) => c.cabin === cabin.cabin).priceCents / 100 }),
        }],
      };
    },
  },
  {
    key: "price-medication",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "What one clinic's pharmacy charges for a named medication at one dosage: its price on the medication's page.",
    candidates: (ctx) => ctx.rows.clinic.prices,
    claims: (p) => [`price:clinic:${p.medicationCode}`],
    build(price, ctx) {
      const med = ctx.clinic.medication.get(price.medicationCode);
      const clinic = ctx.clinic.clinic.get(price.clinicCode);
      return {
        apps: ["clinic"],
        target: med.code,
        effort: { reads: 1, writes: 0 },
        summary: `What the ${clinic.code} pharmacy charges for ${med.code} ${price.dosage}.`,
        note: `${clinic.code} ${med.code} ${price.dosage} → ${dollars(price.priceCents)}`,
        steps: [{
          kind: "json",
          intent: `On ${site("clinic")}, what does the pharmacy at ${clinic.name} (${clinic.code}) charge for ${med.name} (${med.code}) ${price.dosage}? Answer as JSON: {"price": <dollars>}.`,
          rubric: R.answer(["clinic"], "the pharmacy's price"),
          oracle: jsonOracle({ price: money(price.priceCents) }),
          answer: async (api) => ({ price: (await api.get("clinic", clinicPath.medication(med.code))).prices.find((x) => x.clinicCode === clinic.code && x.dosage === price.dosage).priceCents / 100 }),
        }],
      };
    },
  },
  {
    key: "price-variant",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "What one variant of a product costs, named by its SKU: its price on the variant's page.",
    candidates: (ctx) => ctx.rows.sports.variants,
    claims: (v) => [`price:sports:${v.productCode}`],
    build(v, ctx) {
      const product = ctx.sports.product.get(v.productCode);
      return {
        apps: ["sports"],
        target: v.sku,
        effort: { reads: 1, writes: 0 },
        summary: `The price of ${v.sku}.`,
        note: `${v.sku} → ${dollars(v.priceCents)}`,
        steps: [{
          kind: "json",
          intent: `On ${site("sports")}, what does ${variantText(product.name, v)} cost? Answer as JSON: {"price": <dollars>}.`,
          rubric: R.answer(["sports"], "the price"),
          oracle: jsonOracle({ price: money(v.priceCents) }),
          answer: async (api) => ({ price: (await api.get("sports", sportsPath.variant(v.sku))).priceCents / 100 }),
        }],
      };
    },
  },
  {
    key: "price-stay-total",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "What a named stay costs in total, with a dog where the hotel allows pets and late checkout where it offers it: nights × the nightly price + the pet fee once + the late-checkout fee (`stayTotalCents`). The rule that changes the outcome is the fees: the nights alone are not the price.",
    candidates: (ctx) => ctx.rows.hotels.rooms.filter((r) => {
      const h = ctx.hotels.hotel.get(r.hotelCode);
      return h.petsAllowed && h.lateCheckoutUntil;
    }),
    claims: (r) => [`price:hotels:${r.code}`],
    build(room, ctx, rng) {
      const hotel = ctx.hotels.hotel.get(room.hotelCode);
      const nights = 2 + Math.floor(rng() * 4);
      const checkIn = addDays("2027-09-13", Math.floor(rng() * 40));
      const stay = { nights, pets: 1, lateCheckout: true };
      const total = stayTotalCents(hotel, room, stay);
      return {
        apps: ["hotels"],
        target: room.code,
        rule: { what: "the pet fee and the late-checkout fee", naive: room.nightlyCents * nights, actual: total },
        effort: { reads: 1, writes: 0 },
        summary: `The total of a named stay at ${room.code}, with the hotel's fees for a dog and late checkout.`,
        note: `${room.code} × ${nights} + pet fee ${dollars(hotel.petFeeCents)} + late checkout ${dollars(hotel.lateCheckoutFeeCents)} → ${dollars(total)}`,
        steps: [{
          kind: "json",
          intent: `On ${site("hotels")}, what would this stay at ${hotel.name} cost in total: the ${room.name} (${room.code}) for ${nights} nights from ${checkIn}, for one adult bringing a dog, with late checkout? Answer as JSON: {"total": <dollars>}.`,
          rubric: R.answer(["hotels"], "the stay's total"),
          oracle: jsonOracle({ total: money(total) }),
          answer: async (api) => {
            const h = await api.get("hotels", hotelsPath.hotel(hotel.code));
            return { total: (h.rooms.find((r) => r.code === room.code).nightlyCents * nights + h.petFeeCents + h.lateCheckoutFeeCents) / 100 };
          },
        }],
      };
    },
  },
  {
    key: "price-flight-total",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "What a named booking costs in total: passengers × the cabin's fare + passengers × bags × the carrier's bag fee. The bag fees are the rule that changes the outcome.",
    candidates: (ctx) => ctx.rows.flights.cabins.filter((c) => c.seats >= 3 && ctx.flights.carrier.get(ctx.flights.flight.get(c.flightNo).carrierCode).maxBags >= 1),
    claims: (c) => [`price:flights:${c.flightNo}`],
    build(cabin, ctx, rng) {
      const carrier = ctx.flights.carrier.get(ctx.flights.flight.get(cabin.flightNo).carrierCode);
      const passengers = 2 + Math.floor(rng() * 2);
      const bags = carrier.maxBags;
      const total = passengers * cabin.priceCents + passengers * bags * carrier.bagFeeCents;
      return {
        apps: ["flights"],
        target: cabin.flightNo,
        rule: { what: "the carrier's checked-bag fee", naive: passengers * cabin.priceCents, actual: total },
        effort: { reads: 1, writes: 0 },
        summary: `The total of a named booking on ${cabin.flightNo}: the fares and the carrier's bag fees.`,
        note: `${cabin.flightNo} ${cabin.cabin}: ${passengers} × ${dollars(cabin.priceCents)} + ${passengers} × ${bags} × ${dollars(carrier.bagFeeCents)} → ${dollars(total)}`,
        steps: [{
          kind: "json",
          intent: `On ${site("flights")}, what would it cost in total for ${people(passengers)} passengers to fly ${CABIN[cabin.cabin]} on flight ${cabin.flightNo}, each with ${bags} checked bag${bags === 1 ? "" : "s"}? Answer as JSON: {"total": <dollars>}.`,
          rubric: R.answer(["flights"], "the total for the party with their bags"),
          oracle: jsonOracle({ total: money(total) }),
          answer: async (api) => {
            const f = await api.get("flights", flightsPath.flight(cabin.flightNo));
            return { total: (passengers * f.cabins.find((c) => c.cabin === cabin.cabin).priceCents + passengers * bags * f.carrier.bagFeeCents) / 100 };
          },
        }],
      };
    },
  },
  {
    key: "price-pizza-delivery",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "What several of one menu pizza cost delivered from a named branch: the quote's total, which adds the branch's delivery fee because the order stays under its free-delivery threshold (`pizzaQuote`).",
    candidates: (ctx) => ctx.rows.pizza.branches.filter((b) => b.delivers).flatMap((b) => ctx.rows.pizza.pizzas.map((p) => ({ b, p }))),
    claims: ({ b }) => [`price:pizza:${b.code}`],
    build({ b, p }, ctx, rng) {
      const rows = ctx.rows.pizza;
      if (pizzaOutOfStock(rows.stockouts, b.code, p.toppings).length) return null;
      const size = ["medium", "large"][Math.floor(rng() * 2)];
      const lines = [{ pizzaCode: p.code, size, quantity: 2 }];
      const r = pizzaQuote(rows, { branchCode: b.code, fulfilment: "delivery", lines });
      if (!("quote" in r) || r.quote.deliveryFeeCents === 0) return null;
      const q = r.quote;
      return {
        apps: ["pizza"],
        target: p.code,
        rule: { what: "the branch's delivery fee", naive: q.subtotalCents, actual: q.totalCents },
        effort: { reads: 1, writes: 0 },
        summary: `What two ${size} ${p.name} pizzas cost delivered from ${b.code}, the delivery fee included.`,
        note: `${b.code} 2 × ${size} ${p.code}: ${dollars(q.subtotalCents)} + delivery ${dollars(q.deliveryFeeCents)} → ${dollars(q.totalCents)}`,
        steps: [{
          kind: "json",
          intent: `On ${site("pizza")}, what would two ${size} ${p.name} pizzas (${p.code}) cost delivered from the ${b.name} branch (${b.code})? Answer as JSON: {"total": <dollars>}.`,
          rubric: R.answer(["pizza"], "the order's total"),
          oracle: jsonOracle({ total: money(q.totalCents) }),
          answer: async (api) => ({ total: (await api.ask("pizza", pizzaPath.quote, { branchCode: b.code, fulfilment: "delivery", lines })).totalCents / 100 }),
        }],
      };
    },
  },
  {
    key: "price-tickets",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "What named seats in a premium row of a showtime cost for a ticket mix: each ticket's price for the showtime's format and type, plus the premium-row surcharge per seat, plus the booking fee per ticket (`cinemaQuote`). The surcharge and the fee are the rule that changes the outcome.",
    candidates: (ctx) => ctx.rows.cinema.showtimes,
    claims: (s) => [`showtime:${s.code}`],
    build(s, ctx) {
      const rows = ctx.rows.cinema;
      const screen = ctx.cinema.screen.get(s.screenCode);
      const cinema = ctx.cinema.cinema.get(s.cinemaCode);
      const film = ctx.cinema.film.get(s.filmCode);
      if (!screen.premiumRows.length) return null;
      const row = screen.premiumRows[0];
      const free = cinemaSeatMap(screen, cinemaTakenSeats(rows.bookings, s.code)).find((r) => r.row === row)?.free ?? [];
      if (free.length < 2) return null;
      const seats = free.slice(0, 2);
      const counts = ["15", "18"].includes(film.rating) ? { adult: 1, senior: 1 } : { adult: 1, child: 1 };
      const q = cinemaQuote({ cinema, screen, showtime: s, prices: rows.prices }, seats, counts);
      const base = q.tickets.reduce((n, t) => n + t.priceCents, 0) - seats.length * cinema.premiumSurchargeCents;
      const other = counts.child ? "a child" : "a senior";
      return {
        apps: ["cinema"],
        target: s.code,
        rule: { what: "the premium-row surcharge and the booking fee", naive: base, actual: q.totalCents },
        effort: { reads: 1, writes: 0 },
        summary: `What two named seats in a premium row of ${s.code} cost for an adult and ${other}, surcharge and fees included.`,
        note: `${s.code} seats ${seats.join(", ")} (premium row ${row}), adult + ${other} → ${dollars(q.totalCents)}`,
        steps: [{
          kind: "json",
          intent: `On ${site("cinema")}, what would seats ${seats.join(" and ")} for the ${s.time} showing of ${film.title} at ${cinema.name} on ${s.date} (${s.code}) cost in all, for an adult and ${other}? Answer as JSON: {"total": <dollars>}.`,
          rubric: R.answer(["cinema"], "the total for the two tickets"),
          oracle: jsonOracle({ total: money(q.totalCents) }),
          answer: async (api) => {
            const x = await api.get("cinema", cinemaPath.showtime(s.code));
            const ticket = (type) => x.prices[type] + x.premiumSurchargeCents + x.bookingFeeCents;
            return { total: (ticket("adult") + ticket(counts.child ? "child" : "senior")) / 100 };
          },
        }],
      };
    },
  },
  {
    key: "price-bags-cheapest",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about:
      "The cheapest way for a party to fly a route on a date in economy with two checked bags each: of the flights whose carrier takes two bags, the lowest total of fares and bag fees, and that total. The tempting one: the lowest fare on the route is on a carrier that takes only one checked bag.",
    candidates: (ctx) => {
      const routes = [...new Set(ctx.rows.flights.flights.map((x) => `${x.origin}>${x.destination}`))];
      return routes.flatMap((r) => [11, 25, 39, 53].map((d) => ({ origin: r.split(">")[0], destination: r.split(">")[1], date: addDays("2027-03-01", d) })));
    },
    claims: (p) => [`route:${p.origin}-${p.destination}:${p.date}`],
    build({ origin, destination, date }, ctx) {
      const offers = searchFlights(ctx.rows.flights, { origin, destination, date, passengers: 2, cabin: "economy" });
      if (offers.length < 3) return null;
      const carrierOf = (o) => ctx.flights.carrier.get(o.carrierCode);
      const cheapest = offers[0];
      if (carrierOf(cheapest).maxBags >= 2) return null;
      const totals = offers.filter((o) => carrierOf(o).maxBags >= 2).map((o) => ({ o, total: 2 * o.priceCents + 2 * 2 * carrierOf(o).bagFeeCents })).sort((a, b) => a.total - b.total);
      if (totals.length < 2 || totals[0].total === totals[1].total) return null;
      const best = totals[0];
      const from = ctx.flights.airport.get(origin).city;
      const to = ctx.flights.airport.get(destination).city;
      return {
        apps: ["flights"],
        hidden: [best.o.flightNo],
        constraints: ["economy", "two checked bags"],
        tempting: { what: `${cheapest.flightNo} has the lowest fare but its carrier takes one bag`, check: async (api) => (await api.get("flights", flightsPath.carriers)).find((c) => c.code === cheapest.carrierCode).maxBags < 2 },
        effort: { reads: 2, writes: 0 },
        summary: `The cheapest ${from} to ${to} economy flight on ${date} for two with two bags each, and what it costs.`,
        note: `${origin}→${destination} ${date}: ${cheapest.flightNo} is cheapest but its carrier takes 1 bag → ${best.o.flightNo}, ${dollars(best.total)}`,
        steps: [{
          kind: "json",
          intent: `On ${site("flights")}, two of us want to fly economy from ${from} to ${to} on ${date}, each with two checked bags. Which flight is the cheapest for that, and what will it cost us in total? Answer as JSON: {"flight": "<the flight number>", "total": <dollars>}.`,
          rubric: R.answer(["flights"], "the cheapest flight for the party with their bags, and its total"),
          oracle: jsonOracle({ flight: best.o.flightNo, total: money(best.total) }),
          answer: async (api) => {
            const carriers = new Map((await api.get("flights", flightsPath.carriers)).map((c) => [c.code, c]));
            const all = (await api.get("flights", flightsPath.search({ origin, destination, date, passengers: 2, cabin: "economy" }))).outbound;
            const ok = all.filter((o) => carriers.get(o.carrierCode).maxBags >= 2).map((o) => ({ o, total: 2 * o.priceCents + 4 * carriers.get(o.carrierCode).bagFeeCents })).sort((a, b) => a.total - b.total);
            return { flight: ok[0].o.flightNo, total: ok[0].total / 100 };
          },
        }],
      };
    },
  },
  {
    key: "price-trip-steps",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "A price asked three times over one conversation: a named booking's total, then with more bags each, then in another cabin. Each answer is the cabin's fare × passengers + the carrier's bag fee × bags × passengers.",
    candidates: (ctx) => ctx.rows.flights.flights.filter((f) => ctx.flights.carrier.get(f.carrierCode).maxBags >= 2 && (ctx.flights.cabinsOf.get(f.flightNo) ?? []).some((c) => c.cabin === "premium")),
    claims: (f) => [`price:flights:${f.flightNo}`],
    build(f, ctx) {
      const carrier = ctx.flights.carrier.get(f.carrierCode);
      const eco = fareOf(ctx, f.flightNo, "economy");
      const prem = fareOf(ctx, f.flightNo, "premium");
      if (!eco || !prem) return null;
      const total = (cabin, bags) => 2 * cabin.priceCents + 2 * bags * carrier.bagFeeCents;
      const read = (cabin, bags) => async (api) => {
        const x = await api.get("flights", flightsPath.flight(f.flightNo));
        return { total: (2 * x.cabins.find((c) => c.cabin === cabin).priceCents + 2 * bags * x.carrier.bagFeeCents) / 100 };
      };
      return {
        apps: ["flights"],
        target: f.flightNo,
        effort: { reads: 3, writes: 0 },
        summary: `Three totals for two passengers on ${f.flightNo}: economy with one bag each, then two, then premium economy with two.`,
        note: `${f.flightNo}: economy × 1 bag ${dollars(total(eco, 1))}; × 2 bags ${dollars(total(eco, 2))}; premium × 2 bags ${dollars(total(prem, 2))}`,
        steps: [
          {
            kind: "json",
            intent: `On ${site("flights")}, what would it cost for two passengers to fly economy on flight ${f.flightNo}, each with one checked bag? Answer as JSON: {"total": <dollars>}.`,
            rubric: R.answer(["flights"], "the total for two with one bag each"),
            oracle: jsonOracle({ total: money(total(eco, 1)) }),
            answer: read("economy", 1),
          },
          {
            kind: "json",
            fact: "two checked bags",
            intent: `And if we each take two checked bags instead? Answer as JSON: {"total": <dollars>}.`,
            rubric: R.stepAnswer("the new total"),
            oracle: jsonOracle({ total: money(total(eco, 2)) }),
            answer: read("economy", 2),
          },
          {
            kind: "json",
            fact: "premium economy",
            intent: `What if we fly premium economy on that flight instead, still with the two bags each? Answer as JSON: {"total": <dollars>}.`,
            rubric: R.stepAnswer("the total in that cabin"),
            oracle: jsonOracle({ total: money(total(prem, 2)) }),
            answer: read("premium", 2),
          },
        ],
      };
    },
  },
  {
    key: "price-order-steps",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about:
      "A basket priced three times over one conversation, with shipping: one item, then a second item added, then more of the second. Each answer is the lines' prices + the shop's shipping fee, which falls away once the subtotal reaches the free-shipping threshold (`sportsShippingCents`) — it does at one of the steps.",
    candidates: (ctx) => ctx.rows.sports.variants.filter((v) => v.stock >= 5).flatMap((a) => ctx.rows.sports.variants.filter((b) => b.stock >= 5 && b.productCode !== a.productCode).slice(0, 6).map((b) => ({ a, b }))),
    claims: ({ a, b }) => [`price:sports:${a.productCode}`, `price:sports:${b.productCode}`],
    build({ a, b }, ctx) {
      const policy = ctx.rows.sports.shipping;
      const total = (sub) => sub + sportsShippingCents(policy, sub);
      const s1 = a.priceCents, s2 = a.priceCents + 2 * b.priceCents, s3 = a.priceCents + 3 * b.priceCents;
      const shipped = [s1, s2, s3].map((x) => sportsShippingCents(policy, x) > 0);
      if (!shipped[0] || shipped[2]) return null;
      const pa = ctx.sports.product.get(a.productCode), pb = ctx.sports.product.get(b.productCode);
      const read = (qa, qb) => async (api) => {
        const [pol, va, vb] = [await api.get("sports", sportsPath.policies), await api.get("sports", sportsPath.variant(a.sku)), qb ? await api.get("sports", sportsPath.variant(b.sku)) : null];
        const sub = qa * va.priceCents + (vb ? qb * vb.priceCents : 0);
        return { total: (sub + (sub >= pol.shipping.freeFromCents ? 0 : pol.shipping.feeCents)) / 100 };
      };
      return {
        apps: ["sports"],
        target: a.sku,
        effort: { reads: 8, writes: 0 },
        summary: `Three basket totals with shipping: one ${a.sku}, then with two ${b.sku}, then with three; free shipping reached on the way.`,
        note: `${a.sku} ${dollars(total(s1))}; + 2 × ${b.sku} ${dollars(total(s2))}; + 3 × ${b.sku} ${dollars(total(s3))} (free shipping from ${dollars(policy.freeFromCents)})`,
        steps: [
          {
            kind: "json",
            intent: `On ${site("sports")}, what would ${variantText(pa.name, a).replace(/^the /, "one ")} cost delivered, shipping included? Answer as JSON: {"total": <dollars>}.`,
            rubric: R.answer(["sports"], "the total with shipping"),
            oracle: jsonOracle({ total: money(total(s1)) }),
            answer: read(1, 0),
          },
          {
            kind: "json",
            fact: b.sku,
            intent: `And if I add two of ${variantText(pb.name, b)} to the same order? Answer as JSON: {"total": <dollars>}.`,
            rubric: R.stepAnswer("the new total"),
            oracle: jsonOracle({ total: money(total(s2)) }),
            answer: read(1, 2),
          },
          {
            kind: "json",
            fact: "three",
            intent: `Make that three of the ${pb.name} instead of two: what is the total now? Answer as JSON: {"total": <dollars>}.`,
            rubric: R.stepAnswer("the new total"),
            oracle: jsonOracle({ total: money(total(s3)) }),
            answer: read(1, 3),
          },
        ],
      };
    },
  },
  {
    key: "price-child-rated",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "Two adult tickets and a child's for a showing of a film rated 15 or 18, booked and priced: impossible (`CHILD_NOT_ALLOWED`: child tickets are not sold for those ratings).",
    candidates: (ctx) => ctx.rows.cinema.showtimes.filter((s) => ["15", "18"].includes(ctx.cinema.film.get(s.filmCode).rating)),
    claims: (s) => [`showtime:${s.code}`],
    build(s, ctx) {
      const rows = ctx.rows.cinema;
      const screen = ctx.cinema.screen.get(s.screenCode);
      const film = ctx.cinema.film.get(s.filmCode);
      const cinema = ctx.cinema.cinema.get(s.cinemaCode);
      const free = cinemaSeatMap(screen, cinemaTakenSeats(rows.bookings, s.code)).flatMap((r) => r.free);
      if (free.length < 3) return null;
      const guest = newPerson("price-child-rated", 0);
      const body = { showtimeCode: s.code, seats: free.slice(0, 3), adult: 2, child: 1, customerName: guest.name, customerEmail: guest.email };
      return {
        apps: ["cinema"],
        target: s.code,
        impossible: { code: "CHILD_NOT_ALLOWED" },
        effort: { reads: 0, writes: 0 },
        summary: `No child ticket is sold for ${s.code}'s film: nothing is booked, and the agent looked at the showing or was refused for it.`,
        note: `${s.code}: ${film.title} is rated ${film.rating}`,
        steps: [{
          kind: "state",
          intent: `On ${site("cinema")}, book two adult tickets and one child ticket for the ${s.time} showing of ${film.title} at ${cinema.name} on ${s.date} (${s.code}), for ${guest.name} (${guest.email}), and tell me what they cost in all.`,
          rubric: R.impossible(["cinema"], "book the three tickets"),
          oracle: stateOracle(...impossibleChecks({ app: "cinema", things: [{ type: "showtime", id: s.code }, { type: "film", id: film.code }], code: "CHILD_NOT_ALLOWED" })),
          solve: (api) => api.attempt("cinema", cinemaPath.bookings, body),
        }],
      };
    },
  },
  {
    key: "price-bags-over",
    area: AREA,
    surfaces: PAGES_AND_TOOLS,
    count: 1,
    about: "A booking on a named flight with more checked bags per passenger than its carrier takes, booked and priced: impossible (`TOO_MANY_BAGS`).",
    candidates: (ctx) => ctx.rows.flights.flights.filter((f) => ctx.flights.carrier.get(f.carrierCode).maxBags < 3),
    claims: (f) => [`flight-bags:${f.flightNo}`, about("flights", "flight", f.flightNo)],
    build(f, ctx) {
      const carrier = ctx.flights.carrier.get(f.carrierCode);
      const bags = carrier.maxBags + 1;
      const date = "2027-05-20";
      const a = newPerson("price-bags-over", 0), b = newPerson("price-bags-over", 1);
      const body = { flightNo: f.flightNo, date, cabin: "economy", passengers: [a.name, b.name], bags, contactEmail: a.email };
      return {
        apps: ["flights"],
        target: f.flightNo,
        impossible: { code: "TOO_MANY_BAGS" },
        effort: { reads: 0, writes: 0 },
        summary: `${f.flightNo}'s carrier takes fewer bags than asked: nothing is booked, and the agent looked at the flight or was refused for it.`,
        note: `${f.flightNo} (${carrier.code}) takes ${carrier.maxBags} bag(s) per passenger; ${bags} asked`,
        steps: [{
          kind: "state",
          intent: `On ${site("flights")}, book economy seats on flight ${f.flightNo} on ${date} for ${a.name} and ${b.name} (contact ${a.email}), each with ${bags} checked bags, and tell me the total.`,
          rubric: R.impossible(["flights"], "book that many bags"),
          oracle: stateOracle(...impossibleChecks({ app: "flights", things: [{ type: "flight", id: f.flightNo }], code: "TOO_MANY_BAGS" })),
          solve: (api) => api.attempt("flights", flightsPath.bookings, body),
        }],
      };
    },
  },
];
