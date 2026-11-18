/**
 * Flight booking intent templates (apps/flights, "Tallowmere Flights").
 * Shaped on the travel journeys in GoogleChromeLabs/webmcp-tools'
 * react-flightsearch demo and its webmcp-evals travel suite (Apache-2.0):
 * search a route on a date for some passengers, filter by stops, carrier,
 * price and departure time, and book. Those suites grade the tool calls an
 * agent makes; these grade the answer or the site's end state instead, so an
 * agent may use the pages, REST, MCP or WebMCP. See ./index.mjs for the contract.
 *
 * Seats are what most of these turn on: the generator sells some cabins out
 * on some dates and leaves others with a seat or two
 * (packages/scenarios/src/sites/flights/generate.ts), and the search tasks are
 * built around one such cabin — its flight would meet every requirement if it
 * had a seat for each passenger. The rules every answer key is derived with
 * are @benchme/scenarios' flight rules, the same functions the site enforces.
 *
 * Claims: a booking or a cancellation changes the seats left on one route on
 * one date, so every task that depends on, or changes, seats claims each
 * route-date it touches (`flights:route:<from>-<to>:<date>`), and every task
 * that reads or writes one contact's bookings claims that contact. A price
 * quote depends on fares only.
 */
import { addDays, flightSeatsLeft, flightTotalCents, searchFlights, shuffle } from "../../../packages/scenarios/dist/index.js";
import { int, usd } from "../kit.mjs";

const APP = "flights";
const BOOKINGS = "/api/v1/bookings";
const PAGES_AND_TOOLS = ["pages", "tools"];
/** New travellers the booking tasks book for: names no seeded passenger has, at a domain no seeded email uses. */
const NEW_FIRST = ["Aurelio", "Brisa", "Cosmin", "Dagny", "Eluned", "Florin", "Greer", "Hollis"];
const NEW_LAST = ["Abernathy", "Bracknell", "Cottrell", "Dunmore", "Elsworth", "Fenwick"];
/** No seeded booking departs after April 2027, so May and June have every seat free. */
const QUIET_FROM = "2027-05-03";

/** The seed rows of the flight site, indexed once per corpus (kit.mjs indexes the other sites). */
const indexes = new WeakMap();
function fx(ctx) {
  const cached = indexes.get(ctx.rows);
  if (cached) return cached;
  const r = ctx.rows.flights;
  const x = {
    rows: r,
    airport: new Map(r.airports.map((a) => [a.code, a])),
    carrier: new Map(r.carriers.map((c) => [c.code, c])),
    flight: new Map(r.flights.map((f) => [f.flightNo, f])),
    cabin: (flightNo, cabin) => r.cabins.find((c) => c.flightNo === flightNo && c.cabin === cabin),
    cabinsOf: (flightNo) => r.cabins.filter((c) => c.flightNo === flightNo),
  };
  indexes.set(ctx.rows, x);
  return x;
}

const routeClaim = (f, date) => `flights:route:${f.origin}-${f.destination}:${date}`;
const cityOf = (x, code) => x.airport.get(code).city;
const routeText = (x, f) => `from ${cityOf(x, f.origin)} to ${cityOf(x, f.destination)}`;
const pax = (n) => `${n} passenger${n === 1 ? "" : "s"}`;
const dollars = (cents) => `$${cents / 100}`;
const bagsText = (n) => `${n} checked bag${n === 1 ? "" : "s"}`;
const andList = (items) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);
const hour = (h) => `${String(h).padStart(2, "0")}:00`;
const travellerOf = (i) => {
  const last = NEW_LAST[i % NEW_LAST.length];
  const first = NEW_FIRST[Math.floor(i / NEW_LAST.length) % NEW_FIRST.length];
  const companion = NEW_FIRST[(Math.floor(i / NEW_LAST.length) + 3) % NEW_FIRST.length];
  return { name: `${first} ${last}`, email: `${first}.${last}@travel.example`.toLowerCase(), party: [`${first} ${last}`, `${companion} ${last}`, `${NEW_FIRST[(Math.floor(i / NEW_LAST.length) + 5) % NEW_FIRST.length]} ${last}`] };
};
const searchPath = (q) =>
  `/api/v1/search?${new URLSearchParams({
    origin: q.origin,
    destination: q.destination,
    date: q.date,
    passengers: String(q.passengers),
    cabin: q.cabin,
    ...(q.maxStops !== undefined ? { maxStops: String(q.maxStops) } : {}),
    ...(q.carriers?.length ? { carriers: q.carriers.join(",") } : {}),
    ...(q.maxPriceCents !== undefined ? { maxPrice: String(q.maxPriceCents / 100) } : {}),
    ...(q.departAfter ? { departAfter: q.departAfter } : {}),
    ...(q.departBefore ? { departBefore: q.departBefore } : {}),
  })}`;
const outbound = async (api, q) => (await api.get(APP, searchPath(q))).outbound;
const book = (api, body) => api.post(APP, BOOKINGS, body);
const withAll = (base, filters) => Object.assign({ ...base }, ...filters.map((c) => c.q));

/**
 * Every filter a flight meets, each as a query fragment and the words an
 * intent says it with: nonstop (when it is), a departure window of whole hours
 * around its departure (3 to 5 hours wide), and its carrier with one other.
 * Departures are never on the hour, so a window's ends never tie.
 */
function filterOptions(x, f) {
  const nonstop = f.stops === 0 ? [{ kind: "nonstop", q: { maxStops: 0 }, text: "is nonstop" }] : [];
  const h = Number(f.departs.slice(0, 2));
  const window = [];
  for (let a = Math.max(0, h - 3); a <= h; a++) {
    for (let b = h + 1; b <= Math.min(23, h + 4); b++) {
      if (b - a >= 3 && b - a <= 5) window.push({ kind: "window", q: { departAfter: hour(a), departBefore: hour(b) }, text: `departs between ${hour(a)} and ${hour(b)}` });
    }
  }
  const own = x.carrier.get(f.carrierCode);
  const carriers = x.rows.carriers
    .filter((c) => c.code !== own.code)
    .map((other) => {
      const pair = [own, other].sort((p, q) => p.code.localeCompare(q.code));
      return { kind: "carriers", q: { carriers: pair.map((c) => c.code) }, text: `is flown by ${pair.map((c) => `${c.name} (${c.code})`).join(" or ")}` };
    });
  return { nonstop, window, carriers };
}
/** One filter of each kind the flight meets, drawn at random. */
const filtersFor = (x, f, rng) => Object.values(filterOptions(x, f)).filter((options) => options.length).map((options) => options[int(rng, 0, options.length - 1)]);
const capFilter = (cents) => ({ kind: "cap", q: { maxPriceCents: cents }, text: `costs no more than ${dollars(cents)} per passenger` });
/** Every way to take one option from each of the lists. */
const product = (lists) => lists.reduce((acc, list) => acc.flatMap((set) => list.map((o) => [...set, o])), [[]]);
const subsets = (items, size) => (size === 0 ? [[]] : items.flatMap((it, i) => subsets(items.slice(i + 1), size - 1).map((s) => [it, ...s])));

/**
 * Departures with too few seats for a party: every (flight, date, cabin) a
 * seeded booking holds that has fewer than three seats left, with the party
 * size that would not fit (more than the seats left, at most three).
 */
function shortOfSeats(ctx) {
  const x = fx(ctx);
  const seen = new Set();
  const out = [];
  for (const b of x.rows.bookings) {
    const key = `${b.flightNo}|${b.date}|${b.cabin}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const cabin = x.cabin(b.flightNo, b.cabin);
    const left = flightSeatsLeft(cabin, x.rows.bookings, b.date);
    if (left > 2) continue;
    out.push({ flight: x.flight.get(b.flightNo), cabin, date: b.date, left, i: out.length });
  }
  return out;
}
/** A party one or two larger than the seats left, at most three: 1–2 for a sold-out cabin, 2–3 for one seat, 3 for two. */
const partyAbove = (left, rng) => int(rng, left + 1, Math.min(3, left + 2));
const baseOf = (x, f, cabin, date, passengers) => ({ origin: cityOf(x, f.origin), destination: cityOf(x, f.destination), date, passengers, cabin: cabin.cabin });

export const flightsTemplates = [
  {
    key: "flight-only-match",
    app: APP,
    oracle: "json",
    surfaces: PAGES_AND_TOOLS,
    count: 3,
    about:
      "Which flight on a route and date has seats in a cabin for a party and meets two or three filters (nonstop, a departure window, one of two carriers, a fare cap). Exactly one does (`searchFlights`), and each filter matters: without any one of them, two or more would. One more flight meets every filter, but its cabin has fewer seats left than the party (sold out, or one or two left). The miss names that flight.",
    candidates: shortOfSeats,
    claims: (s) => [routeClaim(s.flight, s.date)],
    build({ flight, cabin, date, left }, ctx, rng) {
      const x = fx(ctx);
      const passengers = partyAbove(left, rng);
      const base = baseOf(x, flight, cabin, date, passengers);
      const caps = [...new Set(x.rows.flights.filter((g) => g.origin === flight.origin && g.destination === flight.destination).map((g) => x.cabin(g.flightNo, cabin.cabin)?.priceCents).filter((p) => p >= cabin.priceCents).map((p) => Math.ceil(p / 1000) * 1000))].sort((p, q) => p - q);
      const kinds = Object.values({ ...filterOptions(x, flight), cap: caps.map(capFilter) }).filter((options) => options.length);
      for (const size of [3, 2]) {
        for (const set of shuffle(rng, subsets(kinds, size).flatMap(product))) {
          const matches = searchFlights(x.rows, withAll(base, set));
          if (matches.length !== 1) continue;
          if (set.some((c) => searchFlights(x.rows, withAll(base, set.filter((d) => d !== c))).length < 2)) continue;
          const q = withAll(base, set);
          return {
            intent: `On the flight booking site, which flight ${routeText(x, flight)} on ${date} has ${cabin.cabin} seats for ${pax(passengers)}, ${andList(set.map((c) => c.text))}? Answer as JSON: {"flight": "<the flight number>"}.`,
            summary: `The one flight ${routeText(x, flight)} that day with ${cabin.cabin} seats for the party that meets every filter.`,
            oracle: { kind: "json", expect: { flight: matches[0].flightNo } },
            note: `${flight.origin}→${flight.destination} ${date}, ${cabin.cabin} × ${passengers}, ${set.map((c) => c.text).join("; ")} → ${matches[0].flightNo}; ${flight.flightNo} meets every filter but has ${left} ${cabin.cabin} seat(s) left`,
            answer: async (api) => ({ flight: api.only(await outbound(api, q)).flightNo }),
            miss: async () => ({ flight: flight.flightNo }),
          };
        }
      }
      return null;
    },
  },
  {
    key: "flight-no-match",
    app: APP,
    oracle: "json",
    surfaces: PAGES_AND_TOOLS,
    count: 3,
    about:
      "Whether any flight on a route and date has seats in a cabin for a party, meets one filter (nonstop, a departure window, or one of two carriers) and costs no more than a fare cap — none does — and which flight comes closest: the cheapest that has the seats and meets the filter, at any fare (no tie for cheapest). The cap is the highest whole $10 below that fare, and the cap alone can be met. One flight meets the filter and the cap, but its cabin has fewer seats left than the party. The miss says one exists and names that flight.",
    candidates: shortOfSeats,
    claims: (s) => [routeClaim(s.flight, s.date)],
    build({ flight, cabin, date, left }, ctx, rng) {
      const x = fx(ctx);
      const passengers = partyAbove(left, rng);
      const base = baseOf(x, flight, cabin, date, passengers);
      for (const filter of shuffle(rng, filtersFor(x, flight, rng))) {
        const [closest, next] = searchFlights(x.rows, withAll(base, [filter]));
        if (!closest || (next && next.priceCents === closest.priceCents)) continue;
        // The highest whole-$10 cap below the closest fare: no flight with the seats meets both, the short one does.
        const cap = capFilter(Math.floor((closest.priceCents - 1) / 1000) * 1000);
        if (cap.q.maxPriceCents < cabin.priceCents || searchFlights(x.rows, withAll(base, [cap])).length === 0) continue;
        const asked = `${cabin.cabin} seats for ${pax(passengers)}`;
        return {
          intent: `On the flight booking site, is there a flight ${routeText(x, flight)} on ${date} with ${asked} that ${filter.text} and ${cap.text}? Also name the flight that comes closest: the cheapest flight ${routeText(x, flight)} that day with ${asked} that ${filter.text}, at any fare. Answer as JSON: {"exists": <true or false>, "closest": "<the flight number>"}.`,
          summary: `No flight ${routeText(x, flight)} that day meets every requirement; the closest is the cheapest that meets the filter at any fare.`,
          oracle: { kind: "json", expect: { exists: false, closest: closest.flightNo } },
          note: `${flight.origin}→${flight.destination} ${date}, ${cabin.cabin} × ${passengers}, ${filter.text}, ≤ ${dollars(cap.q.maxPriceCents)} → none; closest ${closest.flightNo} at ${usd(closest.priceCents)}; ${flight.flightNo} would fit but has ${left} seat(s) left`,
          answer: async (api) => ({
            exists: (await outbound(api, withAll(base, [filter, cap]))).length > 0,
            closest: (await outbound(api, withAll(base, [filter])))[0]?.flightNo ?? "",
          }),
          miss: async () => ({ exists: true, closest: flight.flightNo }),
        };
      }
      return null;
    },
  },
  {
    key: "flight-quote",
    app: APP,
    oracle: "json",
    surfaces: PAGES_AND_TOOLS,
    count: 3,
    about:
      "What a named booking costs in total: two to four passengers in one cabin of a named flight, each with one or more checked bags. passengers × the cabin's fare + passengers × bags × the carrier's bag fee (`flightTotalCents`), ±0.01. Fares do not change by date. The miss charges the bags once for the whole booking instead of for each passenger.",
    candidates: (ctx) => fx(ctx).rows.cabins,
    claims: (cabin) => [`flights:fare:${cabin.flightNo}`],
    build(cabin, ctx, rng) {
      const x = fx(ctx);
      const flight = x.flight.get(cabin.flightNo);
      const carrier = x.carrier.get(flight.carrierCode);
      const passengers = int(rng, 2, 4);
      const bags = int(rng, 1, carrier.maxBags);
      const date = addDays(QUIET_FROM, int(rng, 0, 50));
      const total = flightTotalCents(carrier, cabin, passengers, bags) / 100;
      return {
        intent: `On the flight booking site, what would it cost in total to book ${pax(passengers)} in ${cabin.cabin} on flight ${flight.flightNo} ${routeText(x, flight)} on ${date}, each passenger with ${bagsText(bags)}? Answer as JSON: {"total": <dollars>}.`,
        summary: `${passengers} ${cabin.cabin} fares on ${flight.flightNo}, plus the carrier's bag fee for every bag of every passenger.`,
        oracle: { kind: "json", expect: { total: { value: total, tolerance: 0.01 } } },
        note: `${flight.flightNo} ${cabin.cabin} ${usd(cabin.priceCents)} × ${passengers} + ${carrier.code} bag fee ${usd(carrier.bagFeeCents)} × ${bags} × ${passengers} → $${total.toFixed(2)}`,
        answer: async (api) => {
          const f = await api.get(APP, `/api/v1/flights/${flight.flightNo}`);
          const fare = f.cabins.find((c) => c.cabin === cabin.cabin).priceCents;
          return { total: (passengers * fare + passengers * bags * f.carrier.bagFeeCents) / 100 };
        },
        miss: async (api) => {
          const f = await api.get(APP, `/api/v1/flights/${flight.flightNo}`);
          return { total: (passengers * f.cabins.find((c) => c.cabin === cabin.cabin).priceCents + bags * f.carrier.bagFeeCents) / 100 };
        },
      };
    },
  },
  {
    key: "flight-book-round-trip",
    app: APP,
    oracle: "state",
    surfaces: PAGES_AND_TOOLS,
    count: 3,
    about:
      "Book a round trip on two named flights for a new traveller and a companion (names and an email no seeded booking has): out on one date and back on a later one, in one cabin both flights sell, with checked bags for each passenger. A round trip is two bookings. Two checks per leg read the contact's bookings: exactly one confirmed booking of that flight on that date, in the cabin, with two passengers, the bags asked and each passenger's name. The miss books the outbound flight only.",
    candidates: (ctx) => {
      const x = fx(ctx);
      return x.rows.flights.flatMap((out, i) => {
        const backs = x.rows.flights.filter((g) => g.origin === out.destination && g.destination === out.origin);
        const back = backs[i % backs.length];
        const common = x.cabinsOf(out.flightNo).map((c) => c.cabin).filter((c) => x.cabin(back.flightNo, c));
        const date = addDays(QUIET_FROM, (i * 3) % 45);
        return [{ out, back, cabin: common[i % common.length], date, returnDate: addDays(date, 3 + (i % 6)), traveller: travellerOf(i) }];
      });
    },
    claims: (s) => [routeClaim(s.out, s.date), routeClaim(s.back, s.returnDate), `flights:contact:${s.traveller.email}`],
    build({ out, back, cabin, date, returnDate, traveller }, ctx, rng) {
      const x = fx(ctx);
      const maxBags = Math.min(x.carrier.get(out.carrierCode).maxBags, x.carrier.get(back.carrierCode).maxBags);
      const bags = int(rng, 1, maxBags);
      const party = traveller.party.slice(0, 2);
      const bodyFor = (f, d) => ({ flightNo: f.flightNo, date: d, cabin, passengers: party, bags, contactEmail: traveller.email });
      const path = `${BOOKINGS}?contactEmail=${encodeURIComponent(traveller.email)}`;
      const legChecks = (leg, f, d) =>
        party.map((name, n) => ({
          name: `${leg}-passenger-${n + 1}`,
          app: APP,
          path,
          where: { flightNo: f.flightNo, date: d, status: "confirmed" },
          count: { min: 1, max: 1 },
          expect: { cabin, passengerCount: party.length, bags, passengers: { name } },
        }));
      return {
        intent: `On the flight booking site, book a round trip ${routeText(x, out)} for ${andList(party)}, with ${traveller.email} as the contact email: out on flight ${out.flightNo} on ${date} and back on flight ${back.flightNo} on ${returnDate}, both in ${cabin}, with ${bagsText(bags)} for each passenger.`,
        summary: `${traveller.email} has one confirmed ${cabin} booking of ${out.flightNo} on ${date} and one of ${back.flightNo} on ${returnDate}, each for both passengers with the bags asked.`,
        oracle: { kind: "state", checks: [...legChecks("outbound", out, date), ...legChecks("return", back, returnDate)] },
        note: `${traveller.email}: ${out.flightNo} ${date} + ${back.flightNo} ${returnDate}, ${cabin}, ${party.join(" & ")}, ${bags} bag(s) each`,
        solve: async (api) => {
          await book(api, bodyFor(out, date));
          await book(api, bodyFor(back, returnDate));
        },
        miss: (api) => book(api, bodyFor(out, date)),
      };
    },
  },
  {
    key: "flight-book-cheapest",
    app: APP,
    oracle: "state",
    surfaces: PAGES_AND_TOOLS,
    count: 3,
    about:
      "Book, for a new traveller and their party, the cheapest flight on a route and date that has seats in a cabin for all of them, sometimes with one filter (nonstop, a departure window, or one of two carriers): `searchFlights`' first offer, strictly cheaper than the next. A cheaper flight that meets the filter has fewer seats left in that cabin than the party. The check: exactly one confirmed booking for the contact, of that flight on that date, in that cabin, for the whole party. The miss books the cheapest flight that ignores the filter, or the second-cheapest when there is no filter.",
    candidates: (ctx) => shortOfSeats(ctx).map((s) => ({ ...s, traveller: travellerOf(s.i + 11) })),
    claims: (s) => [routeClaim(s.flight, s.date), `flights:contact:${s.traveller.email}`],
    build({ flight, cabin, date, left, traveller }, ctx, rng) {
      const x = fx(ctx);
      const passengers = partyAbove(left, rng);
      const base = baseOf(x, flight, cabin, date, passengers);
      const party = traveller.party.slice(0, passengers);
      // A filter when one works (its miss is the cheapest flight that ignores it), else none.
      for (const filter of [...shuffle(rng, filtersFor(x, flight, rng)), null]) {
        const q = withAll(base, filter ? [filter] : []);
        const [best, next] = searchFlights(x.rows, q);
        if (!best || !next || next.priceCents === best.priceCents || cabin.priceCents >= best.priceCents) continue;
        const loose = filter ? searchFlights(x.rows, base)[0] : null;
        const wrong = loose && loose.flightNo !== best.flightNo ? loose : next;
        const bodyFor = (o) => ({ flightNo: o.flightNo, date, cabin: cabin.cabin, passengers: party, bags: 0, contactEmail: traveller.email });
        return {
          intent: `On the flight booking site, book the cheapest flight ${routeText(x, flight)} on ${date}${filter ? ` that ${filter.text}` : ""} with ${cabin.cabin} seats for ${party.length === 1 ? party[0] : `all of ${andList(party)}`}, with ${traveller.email} as the contact email. No checked bags.`,
          summary: `${traveller.email} has one confirmed ${cabin.cabin} booking for the whole party on the cheapest flight that day that has the seats${filter ? " and meets the filter" : ""}.`,
          oracle: {
            kind: "state",
            checks: [
              {
                name: "booked-cheapest",
                app: APP,
                path: `${BOOKINGS}?contactEmail=${encodeURIComponent(traveller.email)}`,
                where: { status: "confirmed" },
                count: { min: 1, max: 1 },
                expect: { flightNo: best.flightNo, date, cabin: cabin.cabin, passengerCount: passengers },
              },
            ],
          },
          note: `${flight.origin}→${flight.destination} ${date}, ${cabin.cabin} × ${passengers}${filter ? `, ${filter.text}` : ""} → ${best.flightNo} at ${usd(best.priceCents)}; ${flight.flightNo} at ${usd(cabin.priceCents)} has ${left} seat(s) left; miss ${wrong.flightNo}`,
          solve: async (api) => book(api, bodyFor((await outbound(api, q))[0])),
          miss: (api) => book(api, bodyFor(wrong)),
        };
      }
      return null;
    },
  },
  {
    key: "flight-cancel-return",
    app: APP,
    oracle: "state",
    surfaces: PAGES_AND_TOOLS,
    count: 3,
    about:
      "Cancel the return flight of a seeded traveller's round trip (two confirmed bookings with the same party, out and back on the same route) and leave the outbound flight and the traveller's other confirmed bookings alone. Asked of a contact with no other booking on either leg's route and date. One check per confirmed booking of the contact: `cancelled` for the return flight, `confirmed` for the rest. The miss cancels both legs.",
    candidates: (ctx) => {
      const x = fx(ctx);
      const byContact = new Map();
      for (const b of x.rows.bookings) byContact.set(b.contactEmail, [...(byContact.get(b.contactEmail) ?? []), b]);
      const routeOf = (b) => x.flight.get(b.flightNo);
      const names = (b) => b.passengers.map((p) => p.name).join("|");
      return [...byContact.values()].flatMap((all) => {
        const live = all.filter((b) => b.status === "confirmed");
        const alone = (b) => all.filter((o) => routeOf(o).origin === routeOf(b).origin && routeOf(o).destination === routeOf(b).destination && o.date === b.date).length === 1;
        return live.flatMap((out) =>
          live
            .filter((back) => routeOf(back).origin === routeOf(out).destination && routeOf(back).destination === routeOf(out).origin && back.date > out.date && names(back) === names(out) && alone(out) && alone(back))
            .map((back) => ({ out, back, live })),
        );
      });
    },
    claims: ({ out, back }, ctx) => {
      const x = fx(ctx);
      return [`flights:contact:${out.contactEmail}`, routeClaim(x.flight.get(out.flightNo), out.date), routeClaim(x.flight.get(back.flightNo), back.date)];
    },
    build({ out, back, live }, ctx) {
      const x = fx(ctx);
      const f = x.flight.get(out.flightNo);
      const lead = out.passengers[0].name;
      const status = (b) => (b.bookingNo === back.bookingNo ? "cancelled" : "confirmed");
      const cancel = (api, no) => api.post(APP, `${BOOKINGS}/${no}/cancel`, {});
      const backFlight = x.flight.get(back.flightNo);
      return {
        intent: `On the flight booking site, ${lead} (contact email ${out.contactEmail}) booked a round trip ${routeText(x, f)}, out on ${out.date} and back on ${back.date}. Cancel only the return flight, and leave the outbound flight and their other bookings as they are.`,
        summary: `${out.contactEmail}'s return flight on ${back.date} is cancelled; the outbound flight and their other confirmed bookings are still confirmed.`,
        oracle: { kind: "state", checks: live.map((b) => ({ name: `${b.bookingNo}-${status(b)}`, app: APP, path: `${BOOKINGS}/${b.bookingNo}`, expect: { status: status(b) } })) },
        note: `${out.contactEmail}: ${back.bookingNo} (${back.flightNo}, ${back.date}) → cancelled; ${live.filter((b) => b !== back).map((b) => b.bookingNo).join(", ")} stay confirmed`,
        solve: async (api) => {
          const mine = await api.list(APP, `${BOOKINGS}?contactEmail=${encodeURIComponent(out.contactEmail)}&status=confirmed`);
          await cancel(api, api.only(mine.filter((b) => b.origin === backFlight.origin && b.destination === backFlight.destination && b.date === back.date)).bookingNo);
        },
        miss: async (api) => {
          await cancel(api, out.bookingNo);
          await cancel(api, back.bookingNo);
        },
      };
    },
  },
];
