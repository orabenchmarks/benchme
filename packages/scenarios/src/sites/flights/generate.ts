import { CITY_LIST, FIRST_NAMES, LAST_NAMES, word } from "../../acme-v1/names.js";
import { type Rng, int, pick, substream } from "../../prng.js";
import { addDays } from "../../stays.js";
import { flightSeatsLeft, flightTotalCents } from "./rules.js";
import type { Flight, FlightAirport, FlightBooking, FlightCabin, FlightCabinClass, FlightCarrier, FlightRows } from "./types.js";

/**
 * The flight booking site's rows: an airport in each of the six cities, two
 * hubs that one-stop flights stop at, four carriers, flights both ways
 * between every pair of cities, their cabins, and bookings already made.
 * Drawn from a stream of its own (`substream(seed, "flights")`), so adding the
 * site moved no other row. Some cabins are sold out on some dates on purpose,
 * and some have only a seat or two left: a search has to check seats, not
 * just fares.
 */
export const FLIGHT_SIZES = { flightsPerRoute: [2, 4], hubs: 2, carriers: 4, travellers: 30, bookings: 50, roundTrips: 14, soldOut: 18, nearlyFull: 10 } as const;

/** Seeded departures fall in March and April; May and June stay empty, so a write there never meets a seeded booking. */
const BUSY_FROM = "2027-03-01";
const BUSY_DAYS = 61;
const CARRIER_SUFFIXES = ["Air", "Airways", "Wings", "Aviation"] as const;
const AIRPORT_SUFFIXES = ["International", "Airport", "Field"] as const;
const MINUTES = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55] as const;
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

type Point = { x: number; y: number };
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const round5 = (n: number) => Math.round(n / 5) * 5;
const roundTo5Dollars = (cents: number) => Math.max(500, Math.round(cents / 500) * 500);
const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** A code from the place's own letters: its first, then two more in order. */
function codeFor(rng: Rng, place: string, taken: Set<string>): string {
  const letters = place.toUpperCase().replace(/[^A-Z]/g, "");
  for (;;) {
    const i = int(rng, 1, letters.length - 2);
    const j = int(rng, i + 1, letters.length - 1);
    const code = `${letters[0]}${letters[i]}${letters[j]}`;
    if (!taken.has(code)) {
      taken.add(code);
      return code;
    }
  }
}

function makeAirports(rng: Rng): { airports: FlightAirport[]; at: Map<string, Point> } {
  const taken = new Set<string>();
  const at = new Map<string, Point>();
  const airports: FlightAirport[] = [];
  for (const city of CITY_LIST) {
    const code = codeFor(rng, city, taken);
    airports.push({ code, name: `${city} ${pick(rng, AIRPORT_SUFFIXES)}`, city, hub: false });
    at.set(code, { x: int(rng, 0, 100), y: int(rng, 0, 100) });
  }
  const names = new Set<string>(CITY_LIST);
  for (let i = 0; i < FLIGHT_SIZES.hubs; i++) {
    let city = "";
    do city = word(rng, 2);
    while (names.has(city));
    names.add(city);
    const code = codeFor(rng, city, taken);
    airports.push({ code, name: `${city} Junction`, city, hub: true });
    at.set(code, { x: int(rng, 30, 70), y: int(rng, 30, 70) });
  }
  return { airports, at };
}

function makeCarriers(rng: Rng): FlightCarrier[] {
  const out: FlightCarrier[] = [];
  const initials = new Set<string>();
  while (out.length < FLIGHT_SIZES.carriers) {
    const name = `${word(rng, 2)} ${pick(rng, CARRIER_SUFFIXES)}`;
    const code = `${name[0]}${pick(rng, [...LETTERS])}`;
    // One carrier per initial, so no two carriers' names or codes start alike.
    if (initials.has(code[0] as string)) continue;
    initials.add(code[0] as string);
    out.push({ code, name, bagFeeCents: int(rng, 5, 9) * 500, maxBags: int(rng, 1, 3) });
  }
  return out;
}

function makeFlights(rng: Rng, airports: FlightAirport[], at: Map<string, Point>, carriers: FlightCarrier[]): { flights: Flight[]; cabins: FlightCabin[] } {
  const cities = airports.filter((a) => !a.hub);
  const hubs = airports.filter((a) => a.hub);
  const factor = new Map(carriers.map((c) => [c.code, 0.85 + rng() * 0.4]));
  const numbers = new Set<string>();
  const flights: Flight[] = [];
  const cabins: FlightCabin[] = [];
  const leg = (a: string, b: string) => round5(45 + dist(at.get(a) as Point, at.get(b) as Point) * 2);
  for (const from of cities) {
    for (const to of cities) {
      if (from === to) continue;
      const count = int(rng, FLIGHT_SIZES.flightsPerRoute[0], FLIGHT_SIZES.flightsPerRoute[1]);
      for (let i = 0; i < count; i++) {
        const carrier = pick(rng, carriers);
        let flightNo = "";
        do flightNo = `${carrier.code}${int(rng, 100, 989)}`;
        while (numbers.has(flightNo));
        numbers.add(flightNo);
        const via = i > 0 && rng() < 0.45 ? pick(rng, hubs).code : null;
        const durationMinutes = via ? leg(from.code, via) + int(rng, 9, 19) * 5 + leg(via, to.code) : leg(from.code, to.code);
        const dep = int(rng, 6, 21) * 60 + pick(rng, MINUTES);
        flights.push({ flightNo, carrierCode: carrier.code, origin: from.code, destination: to.code, via, stops: via ? 1 : 0, departs: hhmm(dep), arrives: hhmm(dep + durationMinutes), arrivesNextDay: dep + durationMinutes >= 1440, durationMinutes });
        const economy = (4900 + dist(at.get(from.code) as Point, at.get(to.code) as Point) * 160) * (factor.get(carrier.code) as number) * (via ? 0.78 : 1) * (0.9 + rng() * 0.25);
        const sells: [FlightCabinClass, boolean, number, number][] = [
          ["economy", true, 1, int(rng, 5, 9)],
          ["premium", rng() < 0.45, 1.7, int(rng, 2, 4)],
          ["business", rng() < 0.6, 2.9, int(rng, 2, 4)],
        ];
        for (const [cabin, sold, mult, seats] of sells) if (sold) cabins.push({ flightNo, cabin, priceCents: roundTo5Dollars(economy * mult), seats });
      }
    }
  }
  return { flights, cabins };
}

function makeTravellers(rng: Rng): { name: string; email: string }[] {
  const out = new Map<string, { name: string; email: string }>();
  while (out.size < FLIGHT_SIZES.travellers) {
    const first = pick(rng, FIRST_NAMES);
    const last = pick(rng, LAST_NAMES);
    const email = `${first}.${last}${int(rng, 1, 9)}@example.com`.toLowerCase();
    if (!out.has(email)) out.set(email, { name: `${first} ${last}`, email });
  }
  return [...out.values()];
}

export function flightRows(seed: number): FlightRows {
  const rng = substream(seed, "flights");
  const { airports, at } = makeAirports(rng);
  const carriers = makeCarriers(rng);
  const { flights, cabins } = makeFlights(rng, airports, at, carriers);
  const travellers = makeTravellers(rng);
  const carrierOf = new Map(carriers.map((c) => [c.code, c]));
  const flightOf = new Map(flights.map((f) => [f.flightNo, f]));
  const cabinsOf = (flightNo: string) => cabins.filter((c) => c.flightNo === flightNo);
  const bookings: FlightBooking[] = [];
  const busyDate = () => addDays(BUSY_FROM, int(rng, 0, BUSY_DAYS - 1));
  const companion = () => `${pick(rng, FIRST_NAMES)} ${pick(rng, LAST_NAMES)}`;
  const partyOf = (lead: string, size: number) => [lead, ...Array.from({ length: size - 1 }, companion)];
  const book = (cabin: FlightCabin, date: string, party: string[], bags: number, contactEmail: string, status: FlightBooking["status"]) => {
    const carrier = carrierOf.get((flightOf.get(cabin.flightNo) as Flight).carrierCode) as FlightCarrier;
    bookings.push({
      bookingNo: `BK-${10001 + bookings.length}`,
      flightNo: cabin.flightNo,
      date,
      cabin: cabin.cabin,
      passengers: party.map((name) => ({ name })),
      bags,
      contactEmail,
      status,
      totalCents: flightTotalCents(carrier, cabin, party.length, bags),
      createdAt: new Date(Date.UTC(2027, 0, 2 + int(rng, 0, 50), int(rng, 7, 21), int(rng, 0, 59))).toISOString(),
    });
  };
  const bagsFor = (cabin: FlightCabin) => int(rng, 0, (carrierOf.get((flightOf.get(cabin.flightNo) as Flight).carrierCode) as FlightCarrier).maxBags);
  const pickCabin = (flightNo: string) => {
    const sold = cabinsOf(flightNo);
    const r = rng();
    return sold.find((c) => c.cabin === (r < 0.6 ? "economy" : r < 0.85 ? "business" : "premium")) ?? (sold[0] as FlightCabin);
  };

  for (let i = 0; i < FLIGHT_SIZES.bookings; i++) {
    const cabin = pickCabin(pick(rng, flights).flightNo);
    const date = busyDate();
    const who = pick(rng, travellers);
    const party = partyOf(who.name, int(rng, 1, 3));
    const status = rng() < 0.15 ? "cancelled" : "confirmed";
    if (status === "confirmed" && flightSeatsLeft(cabin, bookings, date) < party.length) continue;
    book(cabin, date, party, bagsFor(cabin), who.email, status);
  }
  // Round trips: the same party out and back, two bookings, a few days apart.
  for (let i = 0; i < FLIGHT_SIZES.roundTrips; i++) {
    const out = pick(rng, flights);
    const back = pick(rng, flights.filter((f) => f.origin === out.destination && f.destination === out.origin));
    const outCabin = pickCabin(out.flightNo);
    const backCabin = cabinsOf(back.flightNo).find((c) => c.cabin === outCabin.cabin) ?? (cabinsOf(back.flightNo)[0] as FlightCabin);
    // Out and back inside the busy span, so the quiet months stay empty.
    const date = addDays(BUSY_FROM, int(rng, 0, BUSY_DAYS - 10));
    const returnDate = addDays(date, int(rng, 2, 9));
    const who = pick(rng, travellers);
    const party = partyOf(who.name, int(rng, 1, 2));
    const bags = Math.min(bagsFor(outCabin), bagsFor(backCabin));
    if (flightSeatsLeft(outCabin, bookings, date) < party.length || flightSeatsLeft(backCabin, bookings, returnDate) < party.length) continue;
    book(outCabin, date, party, bags, who.email, "confirmed");
    book(backCabin, returnDate, party, bags, who.email, "confirmed");
  }
  // Sold out on purpose (every seat of the cabin taken that day), and nearly full (one or two seats left) — on
  // routes where at least three flights sell that cabin, so a traveller has other flights to choose from. Half the
  // time it is the route's cheapest fare in that cabin that went first.
  const sameRoute = (a: Flight, b: Flight) => a.origin === b.origin && a.destination === b.destination;
  const choice = cabins.filter((c) => {
    const f = flightOf.get(c.flightNo) as Flight;
    return cabins.filter((o) => o.cabin === c.cabin && sameRoute(flightOf.get(o.flightNo) as Flight, f)).length >= 3;
  });
  const fill = (blocks: number, leave: () => number) => {
    for (let i = 0; i < blocks; i++) {
      const drawn = pick(rng, choice);
      const rivals = choice.filter((o) => o.cabin === drawn.cabin && sameRoute(flightOf.get(o.flightNo) as Flight, flightOf.get(drawn.flightNo) as Flight));
      const cabin = rng() < 0.5 ? (rivals.sort((a, b) => a.priceCents - b.priceCents || a.flightNo.localeCompare(b.flightNo))[0] as FlightCabin) : drawn;
      const date = busyDate();
      const target = leave();
      while (flightSeatsLeft(cabin, bookings, date) > target) {
        const who = pick(rng, travellers);
        book(cabin, date, partyOf(who.name, Math.min(flightSeatsLeft(cabin, bookings, date) - target, int(rng, 1, 3))), bagsFor(cabin), who.email, "confirmed");
      }
    }
  };
  fill(FLIGHT_SIZES.soldOut, () => 0);
  fill(FLIGHT_SIZES.nearlyFull, () => int(rng, 1, 2));
  return { airports, carriers, flights, cabins, bookings };
}
