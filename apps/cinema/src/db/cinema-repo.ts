import { withTx, type Pool } from "@benchme/core";
import {
  CINEMA_ADULT_RATINGS,
  CINEMA_TICKET_TYPES,
  cinemaBookingProblem,
  cinemaNormalizeSeats,
  cinemaPriceOf,
  cinemaQuote,
  cinemaSearchShowtimes,
  cinemaSeatMap,
  cinemaTakenSeats,
  type Cinema,
  type CinemaBookingStatus,
  type CinemaFilm,
  type CinemaPrice,
  type CinemaScreen,
  type CinemaSeatRow,
  type CinemaShowtimeOffer,
  type CinemaShowtimeQuery,
  type CinemaTicketCounts,
  type CinemaTicketType,
} from "@benchme/scenarios";
import { DomainError } from "@benchme/site-kit";
import { BOOKING_FROM, loadRows, toBookingRow, toCinema, toFilm, type BRow, type BookingRow, type CRow, type FRow } from "./rows.js";

export type { BookingRow };
export type CinemaDetail = Cinema & { screens: CinemaScreen[]; prices: CinemaPrice[] };
export type FilmDetail = CinemaFilm & { showtimes: CinemaShowtimeOffer[] };
export type ShowtimeDetail = CinemaShowtimeOffer & {
  runtimeMinutes: number;
  /** False for films rated 15 or 18: child tickets are not sold. */
  childTickets: boolean;
  /** Ticket prices for this showtime's format, by type. */
  prices: Record<CinemaTicketType, number | null>;
  bookingFeeCents: number;
  premiumSurchargeCents: number;
  premiumRows: string[];
  seatMap: CinemaSeatRow[];
};
export type FilmFilter = { genre?: string | undefined; city?: string | undefined };
export type BookingFilter = { customerEmail?: string | undefined; showtime?: string | undefined; film?: string | undefined; status?: CinemaBookingStatus | undefined; cursor?: string | undefined; limit: number };
export type NewBooking = { showtimeCode: string; seats: string[]; counts: Partial<CinemaTicketCounts>; customerName: string; customerEmail: string };

/**
 * Cinemas, films, showtimes and bookings. The booking rules (seat map, at most
 * ten seats, the ticket mix, the film's rating, free seats, totals) are
 * @benchme/scenarios' cinema rules — the same functions the answer keys are
 * derived with — applied here inside the write's transaction.
 */
export interface CinemaRepo {
  listCinemas(ws: string): Promise<Cinema[]>;
  getCinema(ws: string, code: string): Promise<CinemaDetail | null>;
  listFilms(ws: string, f: FilmFilter): Promise<CinemaFilm[]>;
  getFilm(ws: string, code: string): Promise<FilmDetail | null>;
  search(ws: string, q: CinemaShowtimeQuery): Promise<CinemaShowtimeOffer[]>;
  getShowtime(ws: string, code: string): Promise<ShowtimeDetail | null>;
  listBookings(ws: string, f: BookingFilter): Promise<{ items: BookingRow[]; nextCursor: string | null }>;
  getBooking(ws: string, bookingNo: string): Promise<BookingRow | null>;
  createBooking(ws: string, input: NewBooking): Promise<BookingRow>;
  /** confirmed → cancelled; a cancelled booking stays cancelled and its seats are free again. */
  cancelBooking(ws: string, bookingNo: string): Promise<BookingRow>;
}

/** Seats someone else holds are 409; anything the customer can fix by asking differently is 422. */
const statusOf = (code: string) => (code === "SOLD_OUT" || code === "SEAT_TAKEN" ? 409 : 422);

export class PgCinemaRepo implements CinemaRepo {
  constructor(private readonly pool: Pool) {}

  async listCinemas(ws: string): Promise<Cinema[]> {
    return (await this.pool.query<CRow>("SELECT * FROM cinema.cinemas WHERE workspace_id = $1 ORDER BY code", [ws])).rows.map(toCinema);
  }

  async getCinema(ws: string, code: string): Promise<CinemaDetail | null> {
    const rows = await loadRows(this.pool, ws, { codes: [] });
    const cinema = rows.cinemas.find((c) => c.code === code);
    if (!cinema) return null;
    return { ...cinema, screens: rows.screens.filter((s) => s.cinemaCode === code), prices: rows.prices.filter((p) => p.cinemaCode === code) };
  }

  async listFilms(ws: string, f: FilmFilter): Promise<CinemaFilm[]> {
    const params: unknown[] = [ws];
    let where = "f.workspace_id = $1";
    if (f.genre) {
      params.push(f.genre.trim().toLowerCase());
      where += ` AND f.genre = $${params.length}`;
    }
    if (f.city) {
      params.push(f.city.trim().toLowerCase());
      where += ` AND EXISTS (SELECT 1 FROM cinema.showtimes s JOIN cinema.cinemas c ON c.workspace_id = s.workspace_id AND c.code = s.cinema_code
        WHERE s.workspace_id = f.workspace_id AND s.film_code = f.code AND lower(c.city) = $${params.length})`;
    }
    return (await this.pool.query<FRow>(`SELECT f.* FROM cinema.films f WHERE ${where} ORDER BY f.code`, params)).rows.map(toFilm);
  }

  async getFilm(ws: string, code: string): Promise<FilmDetail | null> {
    const f = (await this.pool.query<FRow>("SELECT * FROM cinema.films WHERE workspace_id = $1 AND code = $2", [ws, code])).rows[0];
    return f ? { ...toFilm(f), showtimes: await this.search(ws, { filmCode: code }) } : null;
  }

  async search(ws: string, q: CinemaShowtimeQuery): Promise<CinemaShowtimeOffer[]> {
    return cinemaSearchShowtimes(await loadRows(this.pool, ws, { date: q.date, cinemaCode: q.cinemaCode, filmCode: q.filmCode }), q);
  }

  async getShowtime(ws: string, code: string): Promise<ShowtimeDetail | null> {
    const rows = await loadRows(this.pool, ws, { codes: [code] });
    const [offer] = cinemaSearchShowtimes(rows, {});
    const s = rows.showtimes[0];
    if (!offer || !s) return null;
    const cinema = rows.cinemas.find((c) => c.code === s.cinemaCode) as Cinema;
    const screen = rows.screens.find((x) => x.code === s.screenCode) as CinemaScreen;
    const film = rows.films.find((f) => f.code === s.filmCode) as CinemaFilm;
    const prices = Object.fromEntries(CINEMA_TICKET_TYPES.map((t) => [t, cinemaPriceOf(rows.prices, cinema.code, s.format, t)])) as Record<CinemaTicketType, number | null>;
    return {
      ...offer, runtimeMinutes: film.runtimeMinutes, childTickets: !CINEMA_ADULT_RATINGS.includes(film.rating), prices, bookingFeeCents: cinema.bookingFeeCents, premiumSurchargeCents: cinema.premiumSurchargeCents,
      premiumRows: screen.premiumRows, seatMap: cinemaSeatMap(screen, cinemaTakenSeats(rows.bookings, s.code)),
    };
  }

  async listBookings(ws: string, f: BookingFilter) {
    const params: unknown[] = [ws, f.limit + 1];
    let where = "b.workspace_id = $1";
    const add = (sql: string, v: unknown) => {
      params.push(v);
      where += ` AND ${sql.replace("?", `$${params.length}`)}`;
    };
    if (f.customerEmail) add("lower(b.customer_email) = ?", f.customerEmail.trim().toLowerCase());
    if (f.showtime) add("b.showtime_code = ?", f.showtime);
    if (f.film) add("s.film_code = ?", f.film);
    if (f.status) add("b.status = ?", f.status);
    if (f.cursor) add("b.booking_no > ?", f.cursor);
    const r = await this.pool.query<BRow>(`${BOOKING_FROM} WHERE ${where} ORDER BY b.booking_no LIMIT $2`, params);
    const items = r.rows.slice(0, f.limit).map(toBookingRow);
    return { items, nextCursor: r.rows.length > f.limit ? (items[items.length - 1]?.bookingNo ?? null) : null };
  }

  async getBooking(ws: string, bookingNo: string): Promise<BookingRow | null> {
    const r = await this.pool.query<BRow>(`${BOOKING_FROM} WHERE b.workspace_id = $1 AND b.booking_no = $2`, [ws, bookingNo]);
    return r.rows[0] ? toBookingRow(r.rows[0]) : null;
  }

  async createBooking(ws: string, input: NewBooking): Promise<BookingRow> {
    const customerName = input.customerName.trim();
    const customerEmail = input.customerEmail.trim().toLowerCase();
    if (!customerName) throw new DomainError("NO_CUSTOMER_NAME", "a booking needs the customer's name", 422);
    const seats = cinemaNormalizeSeats(input.seats);
    const bookingNo = await withTx(this.pool, async (c) => {
      // Locking the showtime serialises bookings of it, so two writers can never both take one seat.
      const lock = await c.query("SELECT code FROM cinema.showtimes WHERE workspace_id = $1 AND code = $2 FOR UPDATE", [ws, input.showtimeCode]);
      if (!lock.rowCount) throw new DomainError("UNKNOWN_SHOWTIME", `no showtime ${input.showtimeCode}`, 404);
      const rows = await loadRows(c, ws, { codes: [input.showtimeCode] });
      const showtime = rows.showtimes[0]!;
      const ctx = {
        cinema: rows.cinemas.find((x) => x.code === showtime.cinemaCode) as Cinema,
        screen: rows.screens.find((x) => x.code === showtime.screenCode) as CinemaScreen,
        film: rows.films.find((x) => x.code === showtime.filmCode) as CinemaFilm,
        showtime,
        prices: rows.prices,
      };
      const problem = cinemaBookingProblem(ctx, { seats, counts: input.counts }, rows.bookings);
      if (problem) throw new DomainError(problem.code, problem.message, statusOf(problem.code));
      const quote = cinemaQuote(ctx, seats, input.counts);
      const n = await c.query<{ value: number }>(
        `INSERT INTO cinema.counters (workspace_id, name, value) VALUES ($1, 'booking', 1)
         ON CONFLICT (workspace_id, name) DO UPDATE SET value = cinema.counters.value + 1 RETURNING value`,
        [ws],
      );
      const no = `TK-${70000 + (n.rows[0]?.value ?? 0)}`;
      await c.query(
        `INSERT INTO cinema.bookings (workspace_id, booking_no, showtime_code, customer_name, customer_email, tickets, fees_cents, total_cents, status)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, 'confirmed')`,
        [ws, no, showtime.code, customerName, customerEmail, JSON.stringify(quote.tickets), quote.feesCents, quote.totalCents],
      );
      return no;
    });
    // Read back after the commit: getBooking uses the pool, which cannot see the open transaction.
    return (await this.getBooking(ws, bookingNo)) as BookingRow;
  }

  async cancelBooking(ws: string, bookingNo: string): Promise<BookingRow> {
    const r = await this.pool.query("UPDATE cinema.bookings SET status = 'cancelled', cancelled_at = now() WHERE workspace_id = $1 AND booking_no = $2 AND status = 'confirmed'", [ws, bookingNo]);
    if (!r.rowCount) {
      if (!(await this.getBooking(ws, bookingNo))) throw new DomainError("UNKNOWN_BOOKING", `no booking ${bookingNo}`, 404);
      throw new DomainError("ALREADY_CANCELLED", `booking ${bookingNo} is already cancelled`, 409);
    }
    return (await this.getBooking(ws, bookingNo)) as BookingRow;
  }
}

