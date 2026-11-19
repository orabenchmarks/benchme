import { isDate } from "../../stays.js";
import type { Flight, FlightAirport, FlightBooking, FlightCabin, FlightCabinClass, FlightCarrier, FlightRows } from "./types.js";

/**
 * The flight site's booking rules, as pure functions over rows. apps/flights
 * enforces them on every write and answers every search with them, and the
 * intent corpus derives its answer keys from them, so the site and the keys
 * cannot disagree about what is bookable or what a booking costs.
 */

/** The departure dates the site sells. Fixed, not "from today", so a seed means the same flights forever. */
export const FLIGHT_WINDOW = { first: "2027-03-01", last: "2027-06-30" } as const;
export const FLIGHT_CABIN_CLASSES: readonly FlightCabinClass[] = ["economy", "premium", "business"];
export const FLIGHT_MAX_PASSENGERS = 9;

export type FlightProblem = { code: string; message: string };
export type FlightBookingRequest = { date: string; cabin: string; passengers: readonly string[]; bags: number };
/**
 * One leg of a search. `origin` and `destination` are an airport code or a
 * city. `departAfter`/`departBefore` are "HH:MM", both inclusive. The cap is
 * per passenger, in the cabin asked.
 */
export type FlightQuery = {
  origin: string;
  destination: string;
  date: string;
  passengers: number;
  cabin: FlightCabinClass;
  maxStops?: number;
  carriers?: readonly string[];
  maxPriceCents?: number;
  departAfter?: string;
  departBefore?: string;
};
/** A flight on a date with enough seats left in the cabin asked. `totalCents` is the fares of every passenger, bags not included. */
export type FlightOffer = {
  flightNo: string;
  carrierCode: string;
  carrierName: string;
  origin: string;
  destination: string;
  via: string | null;
  stops: number;
  date: string;
  departs: string;
  arrives: string;
  arrivesNextDay: boolean;
  durationMinutes: number;
  cabin: FlightCabinClass;
  priceCents: number;
  totalCents: number;
  seatsLeft: number;
};

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isFlightTime(s: string): boolean {
  return TIME.test(s);
}

export function isFlightCabinClass(s: string): s is FlightCabinClass {
  return (FLIGHT_CABIN_CLASSES as readonly string[]).includes(s);
}

export function flightDateInWindow(date: string): boolean {
  return isDate(date) && date >= FLIGHT_WINDOW.first && date <= FLIGHT_WINDOW.last;
}

/** An airport answers to its code or its city, in any case. */
export function flightAirportIs(airport: FlightAirport, place: string): boolean {
  const p = place.trim().toLowerCase();
  return airport.code.toLowerCase() === p || airport.city.toLowerCase() === p;
}

/** Seats of this cabin still free on the flight's departure that date. Cancelled bookings hold none. */
export function flightSeatsLeft(cabin: FlightCabin, bookings: readonly FlightBooking[], date: string): number {
  const taken = bookings
    .filter((b) => b.flightNo === cabin.flightNo && b.cabin === cabin.cabin && b.date === date && b.status === "confirmed")
    .reduce((n, b) => n + b.passengers.length, 0);
  return Math.max(0, cabin.seats - taken);
}

/** Every passenger's fare, plus the carrier's bag fee for each bag of each passenger. */
export function flightTotalCents(carrier: Pick<FlightCarrier, "bagFeeCents">, cabin: Pick<FlightCabin, "priceCents">, passengers: number, bags: number): number {
  return passengers * cabin.priceCents + passengers * bags * carrier.bagFeeCents;
}

/** Why the booking cannot be made at all, before seats: date, cabin, passengers, bags. `cabin` is null when the flight does not sell the class asked. */
export function flightFitProblem(flight: Flight, carrier: FlightCarrier, cabin: FlightCabin | null, req: FlightBookingRequest): FlightProblem | null {
  if (!isDate(req.date)) return { code: "BAD_DATE", message: `${req.date} is not a date (YYYY-MM-DD)` };
  if (!flightDateInWindow(req.date)) return { code: "OUTSIDE_WINDOW", message: `flights are sold for departures from ${FLIGHT_WINDOW.first} to ${FLIGHT_WINDOW.last}` };
  if (!cabin || cabin.flightNo !== flight.flightNo || cabin.cabin !== req.cabin) return { code: "NO_CABIN", message: `flight ${flight.flightNo} has no ${req.cabin} cabin` };
  if (req.passengers.length < 1) return { code: "NO_PASSENGERS", message: "a booking needs at least one passenger" };
  if (req.passengers.length > FLIGHT_MAX_PASSENGERS) return { code: "TOO_MANY_PASSENGERS", message: `a booking has at most ${FLIGHT_MAX_PASSENGERS} passengers` };
  if (req.passengers.some((n) => !n.trim())) return { code: "NO_PASSENGER_NAME", message: "every passenger needs a name" };
  if (!Number.isInteger(req.bags) || req.bags < 0) return { code: "BAD_BAGS", message: "checked bags per passenger is a whole number, 0 or more" };
  if (req.bags > carrier.maxBags) return { code: "TOO_MANY_BAGS", message: `${carrier.name} takes at most ${carrier.maxBags} checked bag(s) per passenger` };
  return null;
}

/** flightFitProblem, then whether the cabin has a seat for every passenger. The rule every booking write is held to. */
export function flightBookingProblem(flight: Flight, carrier: FlightCarrier, cabin: FlightCabin | null, req: FlightBookingRequest, bookings: readonly FlightBooking[]): FlightProblem | null {
  const fit = flightFitProblem(flight, carrier, cabin, req);
  if (fit || !cabin) return fit;
  const left = flightSeatsLeft(cabin, bookings, req.date);
  if (left === 0) return { code: "SOLD_OUT", message: `${req.cabin} on ${flight.flightNo} is sold out on ${req.date}` };
  if (left < req.passengers.length) return { code: "NOT_ENOUGH_SEATS", message: `${req.cabin} on ${flight.flightNo} has ${left} seat(s) left on ${req.date}, fewer than ${req.passengers.length} passengers` };
  return null;
}

/**
 * Every flight from the origin to the destination that sells the cabin asked,
 * meets each filter, and has a seat in that cabin for every passenger on the
 * date — cheapest first, then earliest departure.
 */
export function searchFlights(rows: FlightRows, q: FlightQuery): FlightOffer[] {
  if (!flightDateInWindow(q.date)) return [];
  const airport = new Map(rows.airports.map((a) => [a.code, a]));
  const carrier = new Map(rows.carriers.map((c) => [c.code, c]));
  const wanted = (q.carriers ?? []).map((c) => c.trim().toUpperCase()).filter(Boolean);
  const at = (code: string, place: string) => {
    const a = airport.get(code);
    return !!a && flightAirportIs(a, place);
  };
  const offers: FlightOffer[] = [];
  for (const f of rows.flights) {
    if (!at(f.origin, q.origin) || !at(f.destination, q.destination)) continue;
    if (q.maxStops !== undefined && f.stops > q.maxStops) continue;
    if (wanted.length && !wanted.includes(f.carrierCode)) continue;
    if (q.departAfter && f.departs < q.departAfter) continue;
    if (q.departBefore && f.departs > q.departBefore) continue;
    const cabin = rows.cabins.find((c) => c.flightNo === f.flightNo && c.cabin === q.cabin);
    if (!cabin || (q.maxPriceCents !== undefined && cabin.priceCents > q.maxPriceCents)) continue;
    const left = flightSeatsLeft(cabin, rows.bookings, q.date);
    if (left < q.passengers) continue;
    const c = carrier.get(f.carrierCode) as FlightCarrier;
    offers.push({
      flightNo: f.flightNo,
      carrierCode: f.carrierCode,
      carrierName: c.name,
      origin: f.origin,
      destination: f.destination,
      via: f.via,
      stops: f.stops,
      date: q.date,
      departs: f.departs,
      arrives: f.arrives,
      arrivesNextDay: f.arrivesNextDay,
      durationMinutes: f.durationMinutes,
      cabin: q.cabin,
      priceCents: cabin.priceCents,
      totalCents: cabin.priceCents * q.passengers,
      seatsLeft: left,
    });
  }
  return offers.sort((x, y) => x.priceCents - y.priceCents || x.departs.localeCompare(y.departs) || x.flightNo.localeCompare(y.flightNo));
}
