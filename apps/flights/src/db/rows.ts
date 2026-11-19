import type { Flight, FlightAirport, FlightBooking, FlightBookingStatus, FlightCabin, FlightCabinClass, FlightCarrier } from "@benchme/scenarios";

/** The columns node-postgres hands back, and their mapping onto the scenario row shapes the API serves. */
export type ARow = { code: string; name: string; city: string; hub: boolean };
export type CRow = { code: string; name: string; bag_fee_cents: number; max_bags: number };
export type FRow = {
  flight_no: string; carrier_code: string; origin: string; destination: string; via: string | null; stops: number;
  departs: string; arrives: string; arrives_next_day: boolean; duration_minutes: number;
};
export type CabRow = { flight_no: string; cabin: FlightCabinClass; price_cents: number; seats: number };
export type BRow = {
  booking_no: string; flight_no: string; flight_date: string; cabin: FlightCabinClass; passengers: string[]; bags: number; contact_email: string;
  status: FlightBookingStatus; total_cents: number; created_at: Date; cancelled_at: Date | null;
  carrier_code: string; origin: string; destination: string; departs: string; arrives: string;
};

/** A booking as the site serves it: the row, plus its flight's route and times, and how many passengers it holds. */
export type BookingView = FlightBooking & {
  passengerCount: number;
  cancelledAt: string | null;
  carrierCode: string;
  origin: string;
  destination: string;
  departs: string;
  arrives: string;
};
/** A flight with its carrier (bag fee, bag limit) and every cabin it sells. */
export type FlightDetail = Flight & { carrier: FlightCarrier; cabins: FlightCabin[] };
/** Seats left in each cabin of one flight on one date. */
export type FlightSeats = { flightNo: string; date: string; cabins: { cabin: FlightCabinClass; priceCents: number; seats: number; seatsLeft: number }[] };

export const toAirport = (r: ARow): FlightAirport => ({ code: r.code, name: r.name, city: r.city, hub: r.hub });
export const toCarrier = (r: CRow): FlightCarrier => ({ code: r.code, name: r.name, bagFeeCents: r.bag_fee_cents, maxBags: r.max_bags });
export const toFlight = (r: FRow): Flight => ({
  flightNo: r.flight_no, carrierCode: r.carrier_code, origin: r.origin, destination: r.destination, via: r.via, stops: r.stops,
  departs: r.departs, arrives: r.arrives, arrivesNextDay: r.arrives_next_day, durationMinutes: r.duration_minutes,
});
export const toCabin = (r: CabRow): FlightCabin => ({ flightNo: r.flight_no, cabin: r.cabin, priceCents: r.price_cents, seats: r.seats });
export const toBooking = (r: BRow): BookingView => ({
  bookingNo: r.booking_no, flightNo: r.flight_no, date: r.flight_date, cabin: r.cabin, passengers: r.passengers.map((name) => ({ name })),
  passengerCount: r.passengers.length, bags: r.bags, contactEmail: r.contact_email, status: r.status, totalCents: r.total_cents,
  createdAt: r.created_at.toISOString(), cancelledAt: r.cancelled_at?.toISOString() ?? null,
  carrierCode: r.carrier_code, origin: r.origin, destination: r.destination, departs: r.departs, arrives: r.arrives,
});

// A DATE column read as text: node-postgres turns a DATE into a local-midnight Date, which shifts a day in any zone west of UTC.
export const BOOKING_SELECT = `SELECT b.booking_no, b.flight_no, to_char(b.flight_date, 'YYYY-MM-DD') AS flight_date, b.cabin, b.passengers, b.bags, b.contact_email,
  b.status, b.total_cents, b.created_at, b.cancelled_at, f.carrier_code, f.origin, f.destination, f.departs, f.arrives
  FROM flights.bookings b JOIN flights.flights f ON f.workspace_id = b.workspace_id AND f.flight_no = b.flight_no`;
