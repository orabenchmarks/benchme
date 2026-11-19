import type { Pool, PoolClient } from "@benchme/core";
import {
  cinemaBookingView,
  type Cinema,
  type CinemaBooking,
  type CinemaBookingStatus,
  type CinemaBookingView,
  type CinemaFilm,
  type CinemaFormat,
  type CinemaPrice,
  type CinemaRating,
  type CinemaRows,
  type CinemaScreen,
  type CinemaScreenKind,
  type CinemaShowtime,
  type CinemaTicket,
  type CinemaTicketType,
} from "@benchme/scenarios";

/** Row shapes as Postgres returns them, and their mapping to the @benchme/scenarios rows the rules run on. */
export type Db = Pool | PoolClient;
export type BookingRow = CinemaBookingView & { cancelledAt: string | null };

type CRow = { code: string; name: string; city: string; address: string; booking_fee_cents: number; premium_surcharge_cents: number };
type SRow = { code: string; cinema_code: string; name: string; kind: CinemaScreenKind; seat_rows: number; seats_per_row: number; premium_rows: string[] };
type FRow = { code: string; title: string; genre: string; rating: CinemaRating; runtime_minutes: number; language: string; synopsis: string; formats: CinemaFormat[] };
type PRow = { cinema_code: string; format: CinemaFormat; ticket_type: CinemaTicketType; price_cents: number };
type TRow = { code: string; cinema_code: string; screen_code: string; film_code: string; show_date: string; start_time: string; format: CinemaFormat };
type BRow = {
  booking_no: string; showtime_code: string; customer_name: string; customer_email: string; tickets: CinemaTicket[]; fees_cents: number; total_cents: number; status: CinemaBookingStatus;
  created_at: Date; cancelled_at: Date | null; cinema_code: string; film_code: string; show_date: string; start_time: string; format: CinemaFormat;
};

export const toCinema = (r: CRow): Cinema => ({ code: r.code, name: r.name, city: r.city, address: r.address, bookingFeeCents: r.booking_fee_cents, premiumSurchargeCents: r.premium_surcharge_cents });
export const toScreen = (r: SRow): CinemaScreen => ({ cinemaCode: r.cinema_code, code: r.code, name: r.name, kind: r.kind, rows: r.seat_rows, seatsPerRow: r.seats_per_row, premiumRows: r.premium_rows });
export const toFilm = (r: FRow): CinemaFilm => ({ code: r.code, title: r.title, genre: r.genre, rating: r.rating, runtimeMinutes: r.runtime_minutes, language: r.language, synopsis: r.synopsis, formats: r.formats });
const toPrice = (r: PRow): CinemaPrice => ({ cinemaCode: r.cinema_code, format: r.format, ticketType: r.ticket_type, priceCents: r.price_cents });
export const toShowtime = (r: TRow): CinemaShowtime => ({ code: r.code, cinemaCode: r.cinema_code, screenCode: r.screen_code, filmCode: r.film_code, date: r.show_date, time: r.start_time, format: r.format });
const toBooking = (r: BRow): CinemaBooking => ({
  bookingNo: r.booking_no, showtimeCode: r.showtime_code, customerName: r.customer_name, customerEmail: r.customer_email, tickets: r.tickets, feesCents: r.fees_cents, totalCents: r.total_cents, status: r.status, createdAt: r.created_at.toISOString(),
});
export const toBookingRow = (r: BRow): BookingRow => ({
  ...cinemaBookingView(toBooking(r), { code: r.showtime_code, cinemaCode: r.cinema_code, screenCode: "", filmCode: r.film_code, date: r.show_date, time: r.start_time, format: r.format }),
  cancelledAt: r.cancelled_at?.toISOString() ?? null,
});

// A DATE column read as text: node-postgres turns a DATE into a local-midnight Date, which shifts a day in any zone west of UTC.
export const SHOWTIME_COLS = "code, cinema_code, screen_code, film_code, to_char(show_date, 'YYYY-MM-DD') AS show_date, start_time, format";
export const BOOKING_FROM = `SELECT b.booking_no, b.showtime_code, b.customer_name, b.customer_email, b.tickets, b.fees_cents, b.total_cents, b.status, b.created_at, b.cancelled_at,
  s.cinema_code, s.film_code, to_char(s.show_date, 'YYYY-MM-DD') AS show_date, s.start_time, s.format
  FROM cinema.bookings b JOIN cinema.showtimes s ON s.workspace_id = b.workspace_id AND s.code = b.showtime_code`;

export type ShowtimeWhere = { date?: string | undefined; cinemaCode?: string | undefined; filmCode?: string | undefined; codes?: string[] | undefined };

/**
 * The workspace's rows the rules need, as CinemaRows: every cinema, screen,
 * film and price (a few dozen rows), the showtimes the SQL filters keep, and
 * the confirmed bookings of those showtimes.
 */
export async function loadRows(db: Db, ws: string, w: ShowtimeWhere = {}): Promise<CinemaRows> {
  const params: unknown[] = [ws];
  let where = "workspace_id = $1";
  const add = (sql: string, v: unknown) => {
    params.push(v);
    where += ` AND ${sql.replace("?", `$${params.length}`)}`;
  };
  if (w.date) add("show_date = ?::date", w.date);
  if (w.cinemaCode) add("cinema_code = ?", w.cinemaCode);
  if (w.filmCode) add("film_code = ?", w.filmCode);
  if (w.codes) add("code = ANY(?::text[])", w.codes);
  // One after another: on a transaction's client, queries cannot overlap.
  const cinemas = await db.query<CRow>("SELECT * FROM cinema.cinemas WHERE workspace_id = $1 ORDER BY code", [ws]);
  const screens = await db.query<SRow>("SELECT * FROM cinema.screens WHERE workspace_id = $1 ORDER BY code", [ws]);
  const films = await db.query<FRow>("SELECT * FROM cinema.films WHERE workspace_id = $1 ORDER BY code", [ws]);
  const prices = await db.query<PRow>("SELECT * FROM cinema.prices WHERE workspace_id = $1", [ws]);
  const showtimes = await db.query<TRow>(`SELECT ${SHOWTIME_COLS} FROM cinema.showtimes WHERE ${where} ORDER BY code`, params);
  const codes = showtimes.rows.map((s) => s.code);
  const bookings = codes.length
    ? await db.query<BRow>(`${BOOKING_FROM} WHERE b.workspace_id = $1 AND b.showtime_code = ANY($2::text[]) AND b.status = 'confirmed' ORDER BY b.booking_no`, [ws, codes])
    : { rows: [] as BRow[] };
  return {
    cinemas: cinemas.rows.map(toCinema),
    screens: screens.rows.map(toScreen),
    films: films.rows.map(toFilm),
    prices: prices.rows.map(toPrice),
    showtimes: showtimes.rows.map(toShowtime),
    bookings: bookings.rows.map(toBooking),
  };
}

export type { BRow, CRow, FRow, SRow, TRow };
