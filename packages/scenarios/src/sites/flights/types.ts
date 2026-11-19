/**
 * The flight booking site (apps/flights). Every flight runs daily through the
 * booking window; what a date changes is only how many seats each cabin has
 * left. A fare is per passenger; a booking's total adds the carrier's
 * checked-bag fee for every bag of every passenger. Rules: ./rules.ts.
 */
export type FlightCabinClass = "economy" | "premium" | "business";

/** An airport the site sells flights from and to, or a hub (`hub: true`) that one-stop flights stop at and nothing starts or ends at. */
export type FlightAirport = { code: string; name: string; city: string; hub: boolean };

export type FlightCarrier = {
  code: string;
  name: string;
  /** Charged for each checked bag of each passenger. */
  bagFeeCents: number;
  /** The most checked bags one passenger may bring. */
  maxBags: number;
};

/** A scheduled flight. Times are "HH:MM" local; every city on the site keeps one clock. */
export type Flight = {
  flightNo: string;
  carrierCode: string;
  origin: string;
  destination: string;
  /** The hub a one-stop flight stops at; null when nonstop. */
  via: string | null;
  stops: number;
  departs: string;
  arrives: string;
  arrivesNextDay: boolean;
  durationMinutes: number;
};

/** One cabin of a flight: its fare per passenger and the seats the site sells on each departure. */
export type FlightCabin = { flightNo: string; cabin: FlightCabinClass; priceCents: number; seats: number };

export type FlightBookingStatus = "confirmed" | "cancelled";
export type FlightPassenger = { name: string };

/** One flight on one date, in one cabin, for one to nine passengers. A round trip is two bookings. */
export type FlightBooking = {
  bookingNo: string;
  flightNo: string;
  /** The departure date, "YYYY-MM-DD". */
  date: string;
  cabin: FlightCabinClass;
  passengers: FlightPassenger[];
  /** Checked bags per passenger. */
  bags: number;
  contactEmail: string;
  status: FlightBookingStatus;
  totalCents: number;
  createdAt: string;
};

export type FlightRows = { airports: FlightAirport[]; carriers: FlightCarrier[]; flights: Flight[]; cabins: FlightCabin[]; bookings: FlightBooking[] };
