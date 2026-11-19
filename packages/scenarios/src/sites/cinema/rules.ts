import type { Cinema, CinemaBooking, CinemaFilm, CinemaFormat, CinemaPrice, CinemaRows, CinemaScreen, CinemaShowtime, CinemaTicket, CinemaTicketType } from "./types.js";

/**
 * The cinema site's booking rules, as pure functions over rows. apps/cinema
 * enforces them on every write and answers every search with them, and the
 * intent corpus derives its answer keys from them, so the site and the keys
 * cannot disagree about which seats are free or what tickets cost.
 */

/** The dates showtimes run on. Fixed, not "from today", so a seed means the same programme forever. */
export const CINEMA_WINDOW = { first: "2027-05-14", last: "2027-05-16" } as const;
export const CINEMA_MAX_SEATS = 10;
export const CINEMA_FORMATS: readonly CinemaFormat[] = ["2d", "3d", "large"];
export const CINEMA_TICKET_TYPES: readonly CinemaTicketType[] = ["adult", "child", "senior", "student"];
/** Child tickets are not sold for films with these ratings. */
export const CINEMA_ADULT_RATINGS: readonly string[] = ["15", "18"];
export const CINEMA_ROW_LETTERS = "ABCDEFGH";

export type CinemaTicketCounts = Record<CinemaTicketType, number>;
export type CinemaProblem = { code: string; message: string };
export type CinemaBookingContext = { cinema: Cinema; screen: CinemaScreen; film: CinemaFilm; showtime: CinemaShowtime; prices: readonly CinemaPrice[] };
export type CinemaBookingRequest = { seats: readonly string[]; counts?: Partial<CinemaTicketCounts> | undefined };
export type CinemaQuote = { tickets: CinemaTicket[]; feesCents: number; totalCents: number };
export type CinemaSeatRow = { row: string; premium: boolean; seats: { seat: string; free: boolean }[]; free: string[] };
export type CinemaShowtimeQuery = {
  city?: string | undefined;
  cinemaCode?: string | undefined;
  date?: string | undefined;
  genre?: string | undefined;
  filmCode?: string | undefined;
  format?: CinemaFormat | undefined;
  /** Start time at or after this "HH:MM". */
  after?: string | undefined;
  /** At least this many free seats. */
  seats?: number | undefined;
  /** With `seats`: that many free seats side by side in one row. */
  together?: boolean | undefined;
};
export type CinemaShowtimeOffer = {
  showtimeCode: string;
  cinemaCode: string;
  cinemaName: string;
  city: string;
  screenCode: string;
  screenName: string;
  filmCode: string;
  filmTitle: string;
  genre: string;
  rating: string;
  language: string;
  date: string;
  time: string;
  format: CinemaFormat;
  seatsTotal: number;
  freeSeats: number;
  /** The most free seats side by side in any one row. */
  bestRun: number;
  adultPriceCents: number | null;
};
/** A booking as the site serves it: the stored row plus its showtime and the seat facts a check reads. */
export type CinemaBookingView = CinemaBooking & {
  cinemaCode: string;
  filmCode: string;
  date: string;
  time: string;
  format: CinemaFormat;
  /** Seat codes in seat order, comma-separated: "F4,F5,F6". */
  seats: string;
  seatCount: number;
  /** All seats in one row with consecutive numbers. */
  together: boolean;
  ticketCounts: CinemaTicketCounts;
};

const SEAT = /^([A-H])(\d{1,2})$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export const cinemaIsTime = (s: string): boolean => TIME.test(s);

export function cinemaParseSeat(seat: string): { row: string; number: number } | null {
  const m = SEAT.exec(seat.trim().toUpperCase());
  return m ? { row: m[1] as string, number: Number(m[2]) } : null;
}

/** "f4, F5 f6", ["f4", "F5"] → ["F4", "F5", "F6"]: trimmed, upper-cased, in the order given. */
export function cinemaNormalizeSeats(input: string | readonly string[]): string[] {
  const parts = typeof input === "string" ? input.split(/[\s,;]+/) : input.flatMap((s) => s.split(/[\s,;]+/));
  return parts.map((s) => s.trim().toUpperCase()).filter(Boolean);
}

const seatKey = (seat: string) => {
  const p = cinemaParseSeat(seat);
  return p ? CINEMA_ROW_LETTERS.indexOf(p.row) * 100 + p.number : 10_000;
};
/** Seat order: row, then number (A1, A2, …, A10, B1). */
export const cinemaSortSeats = (seats: readonly string[]): string[] => [...seats].sort((x, y) => seatKey(x) - seatKey(y) || x.localeCompare(y));

export const cinemaRowsOf = (screen: CinemaScreen): string[] => CINEMA_ROW_LETTERS.slice(0, screen.rows).split("");
export const cinemaSeatsOf = (screen: CinemaScreen): string[] => cinemaRowsOf(screen).flatMap((r) => Array.from({ length: screen.seatsPerRow }, (_, i) => `${r}${i + 1}`));
export const cinemaIsPremiumSeat = (screen: CinemaScreen, seat: string): boolean => screen.premiumRows.includes(cinemaParseSeat(seat)?.row ?? "");

/** Seats held by confirmed bookings of the showtime. Cancelled bookings hold nothing. */
export function cinemaTakenSeats(bookings: readonly CinemaBooking[], showtimeCode: string): Set<string> {
  return new Set(bookings.filter((b) => b.showtimeCode === showtimeCode && b.status === "confirmed").flatMap((b) => b.tickets.map((t) => t.seat)));
}

export const cinemaFreeSeats = (screen: CinemaScreen, taken: ReadonlySet<string>): string[] => cinemaSeatsOf(screen).filter((s) => !taken.has(s));

/** Each row's maximal runs of free seats side by side, in seat order. */
export function cinemaFreeRuns(screen: CinemaScreen, taken: ReadonlySet<string>): string[][] {
  const runs: string[][] = [];
  for (const row of cinemaRowsOf(screen)) {
    let run: string[] = [];
    for (let n = 1; n <= screen.seatsPerRow; n++) {
      const seat = `${row}${n}`;
      if (taken.has(seat)) {
        if (run.length) runs.push(run);
        run = [];
      } else run.push(seat);
    }
    if (run.length) runs.push(run);
  }
  return runs;
}

export const cinemaBestRun = (screen: CinemaScreen, taken: ReadonlySet<string>): number => Math.max(0, ...cinemaFreeRuns(screen, taken).map((r) => r.length));

export function cinemaSeatMap(screen: CinemaScreen, taken: ReadonlySet<string>): CinemaSeatRow[] {
  return cinemaRowsOf(screen).map((row) => {
    const seats = Array.from({ length: screen.seatsPerRow }, (_, i) => ({ seat: `${row}${i + 1}`, free: !taken.has(`${row}${i + 1}`) }));
    return { row, premium: screen.premiumRows.includes(row), seats, free: seats.filter((s) => s.free).map((s) => s.seat) };
  });
}

/** One row, consecutive numbers. */
export function cinemaSeatsTogether(seats: readonly string[]): boolean {
  const parsed = cinemaSortSeats(seats).map(cinemaParseSeat);
  if (parsed.length === 0 || parsed.some((p) => !p)) return false;
  return parsed.every((p, i) => i === 0 || (p!.row === parsed[0]!.row && p!.number === parsed[i - 1]!.number + 1));
}

/** The ticket mix asked for; none given at all means every seat is an adult ticket. */
export function cinemaResolveCounts(seatCount: number, counts?: Partial<CinemaTicketCounts>): CinemaTicketCounts {
  const c = { adult: counts?.adult ?? 0, child: counts?.child ?? 0, senior: counts?.senior ?? 0, student: counts?.student ?? 0 };
  return c.adult + c.child + c.senior + c.student === 0 ? { adult: seatCount, child: 0, senior: 0, student: 0 } : c;
}

export function cinemaCountsOf(tickets: readonly { ticketType: CinemaTicketType }[]): CinemaTicketCounts {
  const c: CinemaTicketCounts = { adult: 0, child: 0, senior: 0, student: 0 };
  for (const t of tickets) c[t.ticketType]++;
  return c;
}

export function cinemaPriceOf(prices: readonly CinemaPrice[], cinemaCode: string, format: CinemaFormat, ticketType: CinemaTicketType): number | null {
  return prices.find((p) => p.cinemaCode === cinemaCode && p.format === format && p.ticketType === ticketType)?.priceCents ?? null;
}

/** Seats in seat order get ticket types in this order: adults, then children, seniors, students. */
export function cinemaAssignTypes(seats: readonly string[], counts: CinemaTicketCounts): { seat: string; ticketType: CinemaTicketType }[] {
  const types = CINEMA_TICKET_TYPES.flatMap((t) => Array.from({ length: counts[t] }, () => t));
  return cinemaSortSeats(seats).map((seat, i) => ({ seat, ticketType: types[i] ?? "adult" }));
}

/** What a valid request costs: each ticket's price for the showtime's format, plus the premium surcharge on premium-row seats, plus the booking fee per ticket. */
export function cinemaQuote(ctx: Omit<CinemaBookingContext, "film">, seats: readonly string[], counts?: Partial<CinemaTicketCounts>): CinemaQuote {
  const all = cinemaNormalizeSeats(seats);
  const tickets = cinemaAssignTypes(all, cinemaResolveCounts(all.length, counts)).map((t) => ({
    ...t,
    priceCents: (cinemaPriceOf(ctx.prices, ctx.cinema.code, ctx.showtime.format, t.ticketType) ?? 0) + (cinemaIsPremiumSeat(ctx.screen, t.seat) ? ctx.cinema.premiumSurchargeCents : 0),
  }));
  const feesCents = ctx.cinema.bookingFeeCents * tickets.length;
  return { tickets, feesCents, totalCents: tickets.reduce((s, t) => s + t.priceCents, 0) + feesCents };
}

/** Why the request cannot be booked, before availability: seat count, seat codes, the ticket mix, the film's rating, prices. */
export function cinemaRequestProblem(ctx: CinemaBookingContext, req: CinemaBookingRequest): CinemaProblem | null {
  const seats = cinemaNormalizeSeats(req.seats);
  const { screen, film } = ctx;
  if (seats.length === 0) return { code: "NO_SEATS", message: "a booking needs at least one seat" };
  if (seats.length > CINEMA_MAX_SEATS) return { code: "TOO_MANY_SEATS", message: `one booking takes at most ${CINEMA_MAX_SEATS} seats` };
  const onMap = new Set(cinemaSeatsOf(screen));
  const bad = seats.find((s) => !onMap.has(s));
  if (bad) return { code: "BAD_SEAT", message: `seat ${bad} is not in ${screen.name} (rows A–${CINEMA_ROW_LETTERS[screen.rows - 1]}, seats 1–${screen.seatsPerRow})` };
  const dup = seats.find((s, i) => seats.indexOf(s) !== i);
  if (dup) return { code: "DUPLICATE_SEAT", message: `seat ${dup} is listed twice` };
  const given = req.counts ?? {};
  if (CINEMA_TICKET_TYPES.some((t) => given[t] !== undefined && (!Number.isInteger(given[t]) || (given[t] as number) < 0))) return { code: "BAD_TICKET_COUNT", message: "ticket counts are whole numbers, 0 or more" };
  const counts = cinemaResolveCounts(seats.length, given);
  const tickets = CINEMA_TICKET_TYPES.reduce((s, t) => s + counts[t], 0);
  if (tickets !== seats.length) return { code: "BAD_TICKET_COUNT", message: `${seats.length} seat(s) but ${tickets} ticket(s): give one ticket type per seat` };
  if (counts.child > 0 && CINEMA_ADULT_RATINGS.includes(film.rating)) return { code: "CHILD_NOT_ALLOWED", message: `child tickets are not sold for ${film.title}, rated ${film.rating}` };
  const unpriced = CINEMA_TICKET_TYPES.find((t) => counts[t] > 0 && cinemaPriceOf(ctx.prices, ctx.cinema.code, ctx.showtime.format, t) === null);
  if (unpriced) return { code: "NO_PRICE", message: `${ctx.cinema.name} has no ${unpriced} price for ${ctx.showtime.format}` };
  return null;
}

/** cinemaRequestProblem, then whether every seat is free. The rule every booking write is held to. */
export function cinemaBookingProblem(ctx: CinemaBookingContext, req: CinemaBookingRequest, bookings: readonly CinemaBooking[]): CinemaProblem | null {
  const fit = cinemaRequestProblem(ctx, req);
  if (fit) return fit;
  const taken = cinemaTakenSeats(bookings, ctx.showtime.code);
  if (cinemaFreeSeats(ctx.screen, taken).length === 0) return { code: "SOLD_OUT", message: `the ${ctx.showtime.time} showing of ${ctx.film.title} on ${ctx.showtime.date} is sold out` };
  const busy = cinemaSortSeats(cinemaNormalizeSeats(req.seats)).filter((s) => taken.has(s));
  if (busy.length) return { code: "SEAT_TAKEN", message: `seat(s) ${busy.join(", ")} already booked for the ${ctx.showtime.time} showing on ${ctx.showtime.date}` };
  return null;
}

export function cinemaBookingView(b: CinemaBooking, s: CinemaShowtime): CinemaBookingView {
  const seats = cinemaSortSeats(b.tickets.map((t) => t.seat));
  return { ...b, cinemaCode: s.cinemaCode, filmCode: s.filmCode, date: s.date, time: s.time, format: s.format, seats: seats.join(","), seatCount: seats.length, together: cinemaSeatsTogether(seats), ticketCounts: cinemaCountsOf(b.tickets) };
}

/**
 * Showtimes matching every given filter (city, cinema, date, genre, film,
 * format, starting at or after a time, with enough free seats — side by side
 * when `together`), by date, then start time, then code.
 */
export function cinemaSearchShowtimes(rows: CinemaRows, q: CinemaShowtimeQuery): CinemaShowtimeOffer[] {
  const cinema = new Map(rows.cinemas.map((c) => [c.code, c]));
  const screen = new Map(rows.screens.map((s) => [s.code, s]));
  const film = new Map(rows.films.map((f) => [f.code, f]));
  const lc = (s: string | undefined) => s?.trim().toLowerCase();
  const out: CinemaShowtimeOffer[] = [];
  for (const s of rows.showtimes) {
    const c = cinema.get(s.cinemaCode) as Cinema;
    const f = film.get(s.filmCode) as CinemaFilm;
    const sc = screen.get(s.screenCode) as CinemaScreen;
    if (q.city && c.city.toLowerCase() !== lc(q.city)) continue;
    if (q.cinemaCode && s.cinemaCode !== q.cinemaCode) continue;
    if (q.date && s.date !== q.date) continue;
    if (q.genre && f.genre !== lc(q.genre)) continue;
    if (q.filmCode && s.filmCode !== q.filmCode) continue;
    if (q.format && s.format !== q.format) continue;
    if (q.after && s.time < q.after) continue;
    const taken = cinemaTakenSeats(rows.bookings, s.code);
    const freeSeats = cinemaFreeSeats(sc, taken).length;
    const bestRun = cinemaBestRun(sc, taken);
    if (q.seats !== undefined && (freeSeats < q.seats || (q.together && bestRun < q.seats))) continue;
    out.push({
      showtimeCode: s.code, cinemaCode: c.code, cinemaName: c.name, city: c.city, screenCode: sc.code, screenName: sc.name, filmCode: f.code, filmTitle: f.title, genre: f.genre, rating: f.rating,
      language: f.language, date: s.date, time: s.time, format: s.format, seatsTotal: sc.rows * sc.seatsPerRow, freeSeats, bestRun, adultPriceCents: cinemaPriceOf(rows.prices, c.code, s.format, "adult"),
    });
  }
  return out.sort((x, y) => x.date.localeCompare(y.date) || x.time.localeCompare(y.time) || x.showtimeCode.localeCompare(y.showtimeCode));
}
