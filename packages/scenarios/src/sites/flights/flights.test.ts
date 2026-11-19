import { describe, expect, it } from "vitest";
import { webmcpV1 } from "../../webmcp-v1/index.js";
import { CITY_LIST } from "../../acme-v1/names.js";
import { FLIGHT_SIZES, flightRows } from "./generate.js";
import { FLIGHT_WINDOW, flightBookingProblem, flightFitProblem, flightSeatsLeft, flightTotalCents, searchFlights } from "./rules.js";
import type { Flight, FlightBooking, FlightCabin, FlightCarrier, FlightRows } from "./types.js";

const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

describe("webmcp-v1 flights", () => {
  const rows = flightRows(4242);
  const flight = new Map(rows.flights.map((f) => [f.flightNo, f]));
  const carrier = new Map(rows.carriers.map((c) => [c.code, c]));
  const cabinOf = (b: Pick<FlightBooking, "flightNo" | "cabin">) => rows.cabins.find((c) => c.flightNo === b.flightNo && c.cabin === b.cabin) as FlightCabin;
  const departures = [...new Set(rows.bookings.map((b) => `${b.flightNo}|${b.cabin}|${b.date}`))].map((k) => {
    const [flightNo, cabin, date] = k.split("|") as [string, FlightCabin["cabin"], string];
    return { cabin: cabinOf({ flightNo, cabin }), date };
  });

  it("is byte-identical for the same seed, and the same rows webmcpV1.generate carries", () => {
    expect(JSON.stringify(flightRows(4242))).toBe(JSON.stringify(rows));
    expect(JSON.stringify(flightRows(4243))).not.toBe(JSON.stringify(rows));
    expect(webmcpV1.generate(4242).flights).toEqual(rows);
  });

  it("has an airport in every city, hubs nothing starts or ends at, and carriers with distinct codes and initials", () => {
    const cities = rows.airports.filter((a) => !a.hub);
    expect(cities.map((a) => a.city)).toEqual([...CITY_LIST]);
    expect(rows.airports.filter((a) => a.hub)).toHaveLength(FLIGHT_SIZES.hubs);
    expect(new Set(rows.airports.map((a) => a.code)).size).toBe(rows.airports.length);
    for (const a of rows.airports) expect(a.code).toMatch(/^[A-Z]{3}$/);
    expect(rows.carriers).toHaveLength(FLIGHT_SIZES.carriers);
    expect(new Set(rows.carriers.map((c) => c.code[0])).size).toBe(rows.carriers.length);
    for (const c of rows.carriers) expect(c.maxBags).toBeGreaterThanOrEqual(1);
  });

  it("flies every pair of cities both ways, with consistent times, stops and cabins", () => {
    const hub = new Set(rows.airports.filter((a) => a.hub).map((a) => a.code));
    const city = rows.airports.filter((a) => !a.hub).map((a) => a.code);
    expect(new Set(rows.flights.map((f) => f.flightNo)).size).toBe(rows.flights.length);
    for (const from of city) {
      for (const to of city.filter((c) => c !== from)) {
        const route = rows.flights.filter((f) => f.origin === from && f.destination === to);
        expect(route.length).toBeGreaterThanOrEqual(FLIGHT_SIZES.flightsPerRoute[0]);
        expect(route.length).toBeLessThanOrEqual(FLIGHT_SIZES.flightsPerRoute[1]);
        expect(route.some((f) => f.stops === 0)).toBe(true);
      }
    }
    for (const f of rows.flights) {
      expect(carrier.has(f.carrierCode)).toBe(true);
      expect(f.flightNo.startsWith(f.carrierCode)).toBe(true);
      expect(hub.has(f.origin) || hub.has(f.destination)).toBe(false);
      expect(f.stops).toBe(f.via ? 1 : 0);
      if (f.via) expect(hub.has(f.via)).toBe(true);
      const end = minutes(f.departs) + f.durationMinutes;
      expect(minutes(f.arrives)).toBe(end % 1440);
      expect(f.arrivesNextDay).toBe(end >= 1440);
      expect(f.departs.endsWith("00")).toBe(false);
      const cabins = rows.cabins.filter((c) => c.flightNo === f.flightNo);
      expect(cabins.some((c) => c.cabin === "economy")).toBe(true);
      expect(new Set(cabins.map((c) => c.cabin)).size).toBe(cabins.length);
    }
    for (const c of rows.cabins) expect(flight.has(c.flightNo)).toBe(true);
  });

  it("holds every booking to the rules, never oversells a departure, and sells some out on purpose", () => {
    expect(new Set(rows.bookings.map((b) => b.bookingNo)).size).toBe(rows.bookings.length);
    for (const b of rows.bookings) {
      const f = flight.get(b.flightNo) as Flight;
      const cabin = cabinOf(b);
      expect(cabin).toBeDefined();
      expect(b.date >= "2027-03-01" && b.date <= "2027-04-30").toBe(true);
      expect(flightFitProblem(f, carrier.get(f.carrierCode) as FlightCarrier, cabin, { ...b, passengers: b.passengers.map((p) => p.name) })).toBeNull();
      expect(b.totalCents).toBe(flightTotalCents(carrier.get(f.carrierCode) as FlightCarrier, cabin, b.passengers.length, b.bags));
    }
    const left = departures.map((d) => flightSeatsLeft(d.cabin, rows.bookings, d.date));
    for (const [i, d] of departures.entries()) {
      const taken = rows.bookings.filter((b) => b.flightNo === d.cabin.flightNo && b.cabin === d.cabin.cabin && b.date === d.date && b.status === "confirmed").reduce((n, b) => n + b.passengers.length, 0);
      expect(taken).toBeLessThanOrEqual(d.cabin.seats);
      expect(left[i]).toBe(d.cabin.seats - taken);
    }
    expect(left.filter((n) => n === 0).length).toBeGreaterThanOrEqual(FLIGHT_SIZES.soldOut / 2);
    expect(left.filter((n) => n === 1 || n === 2).length).toBeGreaterThanOrEqual(FLIGHT_SIZES.nearlyFull / 2);
    expect(rows.bookings.some((b) => b.status === "cancelled")).toBe(true);
    const perContact = new Map<string, number>();
    for (const b of rows.bookings) perContact.set(b.contactEmail, (perContact.get(b.contactEmail) ?? 0) + 1);
    expect(Math.max(...perContact.values())).toBeGreaterThanOrEqual(3);
  });

  it("seeds round trips: the same party out and back on one route", () => {
    const names = (b: FlightBooking) => b.passengers.map((p) => p.name).join("|");
    const trips = rows.bookings.filter((out) =>
      rows.bookings.some((back) => {
        const o = flight.get(out.flightNo) as Flight;
        const r = flight.get(back.flightNo) as Flight;
        return back.contactEmail === out.contactEmail && r.origin === o.destination && r.destination === o.origin && back.date > out.date && names(back) === names(out);
      }),
    );
    expect(trips.length).toBeGreaterThanOrEqual(FLIGHT_SIZES.roundTrips / 2);
  });
});

describe("flight rules", () => {
  const carrier: FlightCarrier = { code: "QX", name: "Quix Air", bagFeeCents: 3000, maxBags: 2 };
  const nonstop: Flight = { flightNo: "QX101", carrierCode: "QX", origin: "AAA", destination: "BBB", via: null, stops: 0, departs: "09:35", arrives: "11:05", arrivesNextDay: false, durationMinutes: 90 };
  const viaHub: Flight = { ...nonstop, flightNo: "QX202", via: "HHH", stops: 1, departs: "13:10", arrives: "16:40", durationMinutes: 210 };
  const other: Flight = { ...nonstop, flightNo: "ZZ303", carrierCode: "ZZ", departs: "18:20", arrives: "19:50" };
  const economy: FlightCabin = { flightNo: "QX101", cabin: "economy", priceCents: 12000, seats: 3 };
  const rows: FlightRows = {
    airports: [
      { code: "AAA", name: "Alpha Field", city: "Alpha", hub: false },
      { code: "BBB", name: "Beta Airport", city: "Beta", hub: false },
      { code: "HHH", name: "Hub Junction", city: "Hub", hub: true },
    ],
    carriers: [carrier, { code: "ZZ", name: "Zed Wings", bagFeeCents: 2500, maxBags: 1 }],
    flights: [nonstop, viaHub, other],
    cabins: [economy, { flightNo: "QX101", cabin: "business", priceCents: 30000, seats: 2 }, { flightNo: "QX202", cabin: "economy", priceCents: 9000, seats: 5 }, { flightNo: "ZZ303", cabin: "economy", priceCents: 15000, seats: 4 }],
    bookings: [],
  };
  const booking = (flightNo: string, date: string, passengers: number, status: FlightBooking["status"] = "confirmed", cabin: FlightCabin["cabin"] = "economy"): FlightBooking => ({
    bookingNo: `B-${flightNo}-${date}-${passengers}`, flightNo, date, cabin, passengers: Array.from({ length: passengers }, (_, i) => ({ name: `P${i}` })), bags: 0, contactEmail: "c@example.com", status, totalCents: 0, createdAt: "",
  });
  const req = { date: "2027-04-10", cabin: "economy", passengers: ["Ann Lee", "Bo Lee"], bags: 1 };

  it("counts a departure's seats by passengers, and ignores cancelled bookings, other dates and other cabins", () => {
    expect(flightSeatsLeft(economy, [booking("QX101", "2027-04-10", 2)], "2027-04-10")).toBe(1);
    expect(flightSeatsLeft(economy, [booking("QX101", "2027-04-10", 2, "cancelled")], "2027-04-10")).toBe(3);
    expect(flightSeatsLeft(economy, [booking("QX101", "2027-04-11", 2)], "2027-04-10")).toBe(3);
    expect(flightSeatsLeft(economy, [booking("QX101", "2027-04-10", 2, "confirmed", "business")], "2027-04-10")).toBe(3);
    expect(flightSeatsLeft(economy, [booking("QX101", "2027-04-10", 2), booking("QX101", "2027-04-10", 2)], "2027-04-10")).toBe(0);
  });

  it("refuses each rule on its own", () => {
    const business = rows.cabins[1] as FlightCabin;
    expect(flightBookingProblem(nonstop, carrier, economy, req, [])).toBeNull();
    expect(flightBookingProblem(nonstop, carrier, economy, { ...req, date: "2027-02-30" }, [])?.code).toBe("BAD_DATE");
    expect(flightBookingProblem(nonstop, carrier, economy, { ...req, date: "2027-02-28" }, [])?.code).toBe("OUTSIDE_WINDOW");
    expect(flightBookingProblem(nonstop, carrier, economy, { ...req, date: "2027-07-01" }, [])?.code).toBe("OUTSIDE_WINDOW");
    expect(flightBookingProblem(nonstop, carrier, null, { ...req, cabin: "premium" }, [])?.code).toBe("NO_CABIN");
    expect(flightBookingProblem(nonstop, carrier, business, req, [])?.code).toBe("NO_CABIN");
    expect(flightBookingProblem(nonstop, carrier, economy, { ...req, passengers: [] }, [])?.code).toBe("NO_PASSENGERS");
    expect(flightBookingProblem(nonstop, carrier, economy, { ...req, passengers: Array.from({ length: 10 }, (_, i) => `P${i}`) }, [])?.code).toBe("TOO_MANY_PASSENGERS");
    expect(flightBookingProblem(nonstop, carrier, economy, { ...req, passengers: ["Ann Lee", "  "] }, [])?.code).toBe("NO_PASSENGER_NAME");
    expect(flightBookingProblem(nonstop, carrier, economy, { ...req, bags: -1 }, [])?.code).toBe("BAD_BAGS");
    expect(flightBookingProblem(nonstop, carrier, economy, { ...req, bags: 3 }, [])?.code).toBe("TOO_MANY_BAGS");
    expect(flightBookingProblem(nonstop, carrier, economy, req, [booking("QX101", "2027-04-10", 3)])?.code).toBe("SOLD_OUT");
    expect(flightBookingProblem(nonstop, carrier, economy, req, [booking("QX101", "2027-04-10", 2)])?.code).toBe("NOT_ENOUGH_SEATS");
    expect(flightBookingProblem(nonstop, carrier, economy, { ...req, date: FLIGHT_WINDOW.last }, [booking("QX101", "2027-04-10", 3)])).toBeNull();
  });

  it("totals every passenger's fare and the bag fee for each bag of each passenger", () => {
    expect(flightTotalCents(carrier, economy, 3, 2)).toBe(3 * 12000 + 3 * 2 * 3000);
    expect(flightTotalCents(carrier, economy, 1, 0)).toBe(12000);
  });

  it("searches by city or code, cabin, stops, carriers, cap, departure window and seats, cheapest first", () => {
    const q = { origin: "alpha", destination: "BBB", date: "2027-04-10", passengers: 1, cabin: "economy" as const };
    expect(searchFlights(rows, q).map((o) => [o.flightNo, o.priceCents, o.totalCents])).toEqual([["QX202", 9000, 9000], ["QX101", 12000, 12000], ["ZZ303", 15000, 15000]]);
    expect(searchFlights(rows, { ...q, passengers: 2 }).map((o) => o.totalCents)).toEqual([18000, 24000, 30000]);
    expect(searchFlights(rows, { ...q, cabin: "business" }).map((o) => o.flightNo)).toEqual(["QX101"]);
    expect(searchFlights(rows, { ...q, maxStops: 0 }).map((o) => o.flightNo)).toEqual(["QX101", "ZZ303"]);
    expect(searchFlights(rows, { ...q, carriers: ["zz"] }).map((o) => o.flightNo)).toEqual(["ZZ303"]);
    expect(searchFlights(rows, { ...q, maxPriceCents: 12000 }).map((o) => o.flightNo)).toEqual(["QX202", "QX101"]);
    expect(searchFlights(rows, { ...q, departAfter: "09:35", departBefore: "13:10" }).map((o) => o.flightNo)).toEqual(["QX202", "QX101"]);
    expect(searchFlights(rows, { ...q, departAfter: "09:36" }).map((o) => o.flightNo)).toEqual(["QX202", "ZZ303"]);
    const full = { ...rows, bookings: [booking("QX101", "2027-04-10", 2)] };
    expect(searchFlights(full, { ...q, passengers: 2 }).map((o) => o.flightNo)).toEqual(["QX202", "ZZ303"]);
    expect(searchFlights(full, q).find((o) => o.flightNo === "QX101")?.seatsLeft).toBe(1);
    expect(searchFlights(rows, { ...q, origin: "BBB", destination: "AAA" })).toEqual([]);
    expect(searchFlights(rows, { ...q, origin: "Hub" })).toEqual([]);
    expect(searchFlights(rows, { ...q, date: "2027-07-01" })).toEqual([]);
  });
});
