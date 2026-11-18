import { withTx, type Pool, type PoolClient } from "@benchme/core";
import {
  flightAirportIs,
  flightBookingProblem,
  flightDateInWindow,
  flightFitProblem,
  flightSeatsLeft,
  flightTotalCents,
  searchFlights,
  FLIGHT_WINDOW,
  type Flight,
  type FlightAirport,
  type FlightBooking,
  type FlightBookingStatus,
  type FlightCabinClass,
  type FlightCarrier,
  type FlightOffer,
  type FlightQuery,
} from "@benchme/scenarios";
import { DomainError } from "@benchme/site-kit";
import { BOOKING_SELECT, toAirport, toBooking, toCabin, toCarrier, toFlight, type ARow, type BookingView, type BRow, type CabRow, type CRow, type FlightDetail, type FlightSeats, type FRow } from "./rows.js";

export type { BookingView, FlightDetail, FlightSeats } from "./rows.js";
export type FlightFilter = { origin?: string; destination?: string; carrier?: string };
export type BookingFilter = { contactEmail?: string; flightNo?: string; date?: string; status?: FlightBookingStatus; cursor?: string; limit: number };
export type NewBooking = { flightNo: string; date: string; cabin: FlightCabinClass; passengers: string[]; bags: number; contactEmail: string };

/**
 * Airports, carriers, flights, cabins and bookings. The booking rules (window,
 * cabin, passengers, bags, seats, totals) are @benchme/scenarios' flight rules
 * — the same functions the answer keys are derived with — applied here inside
 * the write's transaction.
 */
export interface FlightsRepo {
  airports(ws: string): Promise<FlightAirport[]>;
  carriers(ws: string): Promise<FlightCarrier[]>;
  listFlights(ws: string, f: FlightFilter): Promise<FlightDetail[]>;
  getFlight(ws: string, flightNo: string): Promise<FlightDetail | null>;
  seats(ws: string, flightNo: string, date: string): Promise<FlightSeats>;
  search(ws: string, q: FlightQuery): Promise<FlightOffer[]>;
  listBookings(ws: string, f: BookingFilter): Promise<{ items: BookingView[]; nextCursor: string | null }>;
  getBooking(ws: string, bookingNo: string): Promise<BookingView | null>;
  createBooking(ws: string, input: NewBooking): Promise<BookingView>;
  /** confirmed → cancelled; a cancelled booking stays cancelled. */
  cancelBooking(ws: string, bookingNo: string): Promise<BookingView>;
}

/** A cabin that is simply full is 409; anything a traveller can fix by asking for something else is 422. */
const statusOf = (code: string) => (code === "SOLD_OUT" || code === "NOT_ENOUGH_SEATS" ? 409 : 422);

export class PgFlightsRepo implements FlightsRepo {
  constructor(private readonly pool: Pool) {}

  async airports(ws: string) {
    return (await this.pool.query<ARow>("SELECT * FROM flights.airports WHERE workspace_id = $1 ORDER BY hub, city", [ws])).rows.map(toAirport);
  }

  async carriers(ws: string) {
    return (await this.pool.query<CRow>("SELECT * FROM flights.carriers WHERE workspace_id = $1 ORDER BY code", [ws])).rows.map(toCarrier);
  }

  async listFlights(ws: string, f: FlightFilter): Promise<FlightDetail[]> {
    const airports = await this.airports(ws);
    const codesOf = (place: string) => airports.filter((a) => flightAirportIs(a, place)).map((a) => a.code);
    const params: unknown[] = [ws];
    let where = "workspace_id = $1";
    const add = (sql: string, v: unknown) => {
      params.push(v);
      where += ` AND ${sql.replace("?", `$${params.length}`)}`;
    };
    if (f.origin) add("origin = ANY(?::text[])", codesOf(f.origin));
    if (f.destination) add("destination = ANY(?::text[])", codesOf(f.destination));
    if (f.carrier) add("carrier_code = ?", f.carrier.trim().toUpperCase());
    const flights = (await this.pool.query<FRow>(`SELECT * FROM flights.flights WHERE ${where} ORDER BY origin, destination, departs, flight_no`, params)).rows.map(toFlight);
    return this.detailed(ws, flights);
  }

  async getFlight(ws: string, flightNo: string): Promise<FlightDetail | null> {
    const r = await this.pool.query<FRow>("SELECT * FROM flights.flights WHERE workspace_id = $1 AND flight_no = $2", [ws, flightNo.trim().toUpperCase()]);
    return r.rows[0] ? ((await this.detailed(ws, [toFlight(r.rows[0])]))[0] ?? null) : null;
  }

  async seats(ws: string, flightNo: string, date: string): Promise<FlightSeats> {
    const f = await this.getFlight(ws, flightNo);
    if (!f) throw new DomainError("UNKNOWN_FLIGHT", `no flight ${flightNo}`, 404);
    if (!flightDateInWindow(date)) throw new DomainError("OUTSIDE_WINDOW", `flights are sold for departures from ${FLIGHT_WINDOW.first} to ${FLIGHT_WINDOW.last}`, 422);
    const held = await this.confirmedOn(this.pool, ws, [f.flightNo], date);
    return { flightNo: f.flightNo, date, cabins: f.cabins.map((c) => ({ cabin: c.cabin, priceCents: c.priceCents, seats: c.seats, seatsLeft: flightSeatsLeft(c, held, date) })) };
  }

  async search(ws: string, q: FlightQuery): Promise<FlightOffer[]> {
    const airports = await this.airports(ws);
    const from = airports.filter((a) => flightAirportIs(a, q.origin)).map((a) => a.code);
    const to = airports.filter((a) => flightAirportIs(a, q.destination)).map((a) => a.code);
    if (from.length === 0 || to.length === 0 || !flightDateInWindow(q.date)) return [];
    const flights = (await this.pool.query<FRow>("SELECT * FROM flights.flights WHERE workspace_id = $1 AND origin = ANY($2::text[]) AND destination = ANY($3::text[])", [ws, from, to])).rows.map(toFlight);
    const nos = flights.map((f) => f.flightNo);
    const cabins = (await this.pool.query<CabRow>("SELECT * FROM flights.cabins WHERE workspace_id = $1 AND flight_no = ANY($2::text[])", [ws, nos])).rows.map(toCabin);
    return searchFlights({ airports, carriers: await this.carriers(ws), flights, cabins, bookings: await this.confirmedOn(this.pool, ws, nos, q.date) }, q);
  }

  async listBookings(ws: string, f: BookingFilter) {
    const params: unknown[] = [ws, f.limit + 1];
    let where = "b.workspace_id = $1";
    const add = (sql: string, v: unknown) => {
      params.push(v);
      where += ` AND ${sql.replace("?", `$${params.length}`)}`;
    };
    if (f.contactEmail) add("lower(b.contact_email) = ?", f.contactEmail.trim().toLowerCase());
    if (f.flightNo) add("b.flight_no = ?", f.flightNo.trim().toUpperCase());
    if (f.date) add("b.flight_date = ?::date", f.date);
    if (f.status) add("b.status = ?", f.status);
    if (f.cursor) add("b.booking_no > ?", f.cursor);
    const r = await this.pool.query<BRow>(`${BOOKING_SELECT} WHERE ${where} ORDER BY b.booking_no LIMIT $2`, params);
    const items = r.rows.slice(0, f.limit).map(toBooking);
    return { items, nextCursor: r.rows.length > f.limit ? (items[items.length - 1]?.bookingNo ?? null) : null };
  }

  async getBooking(ws: string, bookingNo: string): Promise<BookingView | null> {
    const r = await this.pool.query<BRow>(`${BOOKING_SELECT} WHERE b.workspace_id = $1 AND b.booking_no = $2`, [ws, bookingNo]);
    return r.rows[0] ? toBooking(r.rows[0]) : null;
  }

  async createBooking(ws: string, input: NewBooking): Promise<BookingView> {
    const passengers = input.passengers.map((n) => n.trim());
    const contactEmail = input.contactEmail.trim().toLowerCase();
    const req = { date: input.date, cabin: input.cabin, passengers, bags: input.bags };
    const bookingNo = await withTx(this.pool, async (c) => {
      const fr = (await c.query<FRow>("SELECT * FROM flights.flights WHERE workspace_id = $1 AND flight_no = $2", [ws, input.flightNo.trim().toUpperCase()])).rows[0];
      if (!fr) throw new DomainError("UNKNOWN_FLIGHT", `no flight ${input.flightNo}`, 404);
      const flight = toFlight(fr);
      const carrier = toCarrier((await c.query<CRow>("SELECT * FROM flights.carriers WHERE workspace_id = $1 AND code = $2", [ws, flight.carrierCode])).rows[0] as CRow);
      // Locking the cabin serialises bookings of it, so two writers can never both take its last seat.
      const cr = (await c.query<CabRow>("SELECT * FROM flights.cabins WHERE workspace_id = $1 AND flight_no = $2 AND cabin = $3 FOR UPDATE", [ws, flight.flightNo, input.cabin])).rows[0];
      const cabin = cr ? toCabin(cr) : null;
      // The fit first: it vets the date before the seat query uses it, and refuses a cabin the flight does not sell.
      const fit = flightFitProblem(flight, carrier, cabin, req);
      if (fit || !cabin) throw new DomainError(fit?.code ?? "NO_CABIN", fit?.message ?? `flight ${flight.flightNo} has no ${input.cabin} cabin`, 422);
      const problem = flightBookingProblem(flight, carrier, cabin, req, await this.confirmedOn(c, ws, [flight.flightNo], input.date));
      if (problem) throw new DomainError(problem.code, problem.message, statusOf(problem.code));
      const n = await c.query<{ value: number }>(
        `INSERT INTO flights.counters (workspace_id, name, value) VALUES ($1, 'booking', 1)
         ON CONFLICT (workspace_id, name) DO UPDATE SET value = flights.counters.value + 1 RETURNING value`,
        [ws],
      );
      const no = `BK-${50000 + (n.rows[0]?.value ?? 0)}`;
      await c.query(
        `INSERT INTO flights.bookings (workspace_id, booking_no, flight_no, flight_date, cabin, passengers, bags, contact_email, status, total_cents)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'confirmed', $9)`,
        [ws, no, flight.flightNo, input.date, cabin.cabin, passengers, input.bags, contactEmail, flightTotalCents(carrier, cabin, passengers.length, input.bags)],
      );
      return no;
    });
    // Read back after the commit: getBooking uses the pool, which cannot see the open transaction.
    return (await this.getBooking(ws, bookingNo)) as BookingView;
  }

  async cancelBooking(ws: string, bookingNo: string): Promise<BookingView> {
    const r = await this.pool.query("UPDATE flights.bookings SET status = 'cancelled', cancelled_at = now() WHERE workspace_id = $1 AND booking_no = $2 AND status = 'confirmed'", [ws, bookingNo]);
    if (!r.rowCount) {
      if (!(await this.getBooking(ws, bookingNo))) throw new DomainError("UNKNOWN_BOOKING", `no booking ${bookingNo}`, 404);
      throw new DomainError("ALREADY_CANCELLED", `booking ${bookingNo} is already cancelled`, 409);
    }
    return (await this.getBooking(ws, bookingNo)) as BookingView;
  }

  /** Each flight with its carrier and its cabins (economy, premium, business). */
  private async detailed(ws: string, flights: Flight[]): Promise<FlightDetail[]> {
    if (flights.length === 0) return [];
    const carriers = new Map((await this.carriers(ws)).map((c) => [c.code, c]));
    const order = { economy: 0, premium: 1, business: 2 } as const;
    const cabins = (await this.pool.query<CabRow>("SELECT * FROM flights.cabins WHERE workspace_id = $1 AND flight_no = ANY($2::text[])", [ws, flights.map((f) => f.flightNo)])).rows.map(toCabin);
    return flights.map((f) => ({ ...f, carrier: carriers.get(f.carrierCode) as FlightCarrier, cabins: cabins.filter((c) => c.flightNo === f.flightNo).sort((a, b) => order[a.cabin] - order[b.cabin]) }));
  }

  /** Confirmed bookings of these flights departing that date: what holds their seats. */
  private async confirmedOn(c: Pool | PoolClient, ws: string, flightNos: string[], date: string): Promise<FlightBooking[]> {
    if (flightNos.length === 0) return [];
    const r = await c.query<BRow>(`${BOOKING_SELECT} WHERE b.workspace_id = $1 AND b.flight_no = ANY($2::text[]) AND b.flight_date = $3::date AND b.status = 'confirmed'`, [ws, flightNos, date]);
    return r.rows.map(toBooking);
  }
}
