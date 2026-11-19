import { describe, expect, it } from "vitest";
import { webmcpV1 } from "../../webmcp-v1/index.js";
import { CITY_LIST } from "../../acme-v1/names.js";
import { CINEMA_SIZES, cinemaRows } from "./generate.js";
import {
  CINEMA_WINDOW,
  cinemaBestRun,
  cinemaBookingProblem,
  cinemaBookingView,
  cinemaCountsOf,
  cinemaFreeRuns,
  cinemaFreeSeats,
  cinemaQuote,
  cinemaResolveCounts,
  cinemaSearchShowtimes,
  cinemaSeatsTogether,
  cinemaSortSeats,
  cinemaTakenSeats,
  type CinemaBookingContext,
} from "./rules.js";
import type { Cinema, CinemaBooking, CinemaFilm, CinemaPrice, CinemaRows, CinemaScreen, CinemaShowtime } from "./types.js";

describe("webmcp-v1 cinema rows", () => {
  const rows = cinemaRows(4242);
  const cinema = new Map(rows.cinemas.map((c) => [c.code, c]));
  const screen = new Map(rows.screens.map((s) => [s.code, s]));
  const film = new Map(rows.films.map((f) => [f.code, f]));
  const showtime = new Map(rows.showtimes.map((s) => [s.code, s]));
  const ctxOf = (s: CinemaShowtime): CinemaBookingContext => ({ cinema: cinema.get(s.cinemaCode)!, screen: screen.get(s.screenCode)!, film: film.get(s.filmCode)!, showtime: s, prices: rows.prices });

  it("is byte-identical for the same seed, and the same rows webmcpV1.generate carries", () => {
    expect(JSON.stringify(cinemaRows(4242))).toBe(JSON.stringify(rows));
    expect(JSON.stringify(cinemaRows(4243))).not.toBe(JSON.stringify(rows));
    expect(webmcpV1.generate(4242).cinema).toEqual(rows);
  });

  it("has one cinema per city, unique codes, and every reference resolves", () => {
    expect(rows.cinemas.map((c) => c.city).sort()).toEqual([...CITY_LIST].sort());
    for (const list of [rows.cinemas.map((c) => c.code), rows.screens.map((s) => s.code), rows.films.map((f) => f.code), rows.films.map((f) => f.title), rows.showtimes.map((s) => s.code), rows.bookings.map((b) => b.bookingNo)]) {
      expect(new Set(list).size).toBe(list.length);
    }
    for (const s of rows.screens) {
      expect(cinema.has(s.cinemaCode)).toBe(true);
      expect(s.rows).toBeLessThanOrEqual(8);
    }
    const starts = new Set<string>();
    for (const s of rows.showtimes) {
      const sc = screen.get(s.screenCode)!;
      expect(sc.cinemaCode).toBe(s.cinemaCode);
      expect(film.get(s.filmCode)!.formats).toContain(s.format);
      expect(sc.kind === "large").toBe(s.format === "large");
      expect(s.date >= CINEMA_WINDOW.first && s.date <= CINEMA_WINDOW.last).toBe(true);
      for (const t of ["adult", "child", "senior", "student"]) expect(rows.prices.some((p) => p.cinemaCode === s.cinemaCode && p.format === s.format && p.ticketType === t)).toBe(true);
      // No two showings of one cinema start together, so "the earliest" is never a tie.
      expect(starts.has(`${s.cinemaCode}:${s.date}:${s.time}`)).toBe(false);
      starts.add(`${s.cinemaCode}:${s.date}:${s.time}`);
    }
    for (const b of rows.bookings) expect(showtime.has(b.showtimeCode)).toBe(true);
  });

  it("holds every seeded booking to the rules at the moment it was made, and never sells a seat twice", () => {
    rows.bookings.forEach((b, i) => {
      const s = showtime.get(b.showtimeCode)!;
      const seats = b.tickets.map((t) => t.seat);
      expect(seats).toEqual(cinemaSortSeats(seats));
      expect(cinemaBookingProblem(ctxOf(s), { seats, counts: cinemaCountsOf(b.tickets) }, rows.bookings.slice(0, i))).toBeNull();
      expect(cinemaQuote(ctxOf(s), seats, cinemaCountsOf(b.tickets))).toEqual({ tickets: b.tickets, feesCents: b.feesCents, totalCents: b.totalCents });
    });
    for (const s of rows.showtimes) {
      const held = rows.bookings.filter((b) => b.showtimeCode === s.code && b.status === "confirmed").flatMap((b) => b.tickets.map((t) => t.seat));
      expect(new Set(held).size).toBe(held.length);
    }
    expect(rows.bookings.some((b) => b.status === "cancelled")).toBe(true);
  });

  it("sells some showtimes out and leaves others with single seats only, on purpose", () => {
    const offers = cinemaSearchShowtimes(rows, {});
    expect(offers.filter((o) => o.freeSeats === 0).length).toBeGreaterThanOrEqual(CINEMA_SIZES.soldOut);
    expect(offers.filter((o) => o.freeSeats >= 3 && o.freeSeats <= 5 && o.bestRun === 1).length).toBeGreaterThanOrEqual(CINEMA_SIZES.nearlyFull);
    const confirmed = new Map<string, number>();
    for (const b of rows.bookings) if (b.status === "confirmed") confirmed.set(b.customerEmail, (confirmed.get(b.customerEmail) ?? 0) + 1);
    expect([...confirmed.values()].some((n) => n >= 3)).toBe(true);
  });
});

describe("cinema rules", () => {
  const cinema: Cinema = { code: "C1", name: "One", city: "Velmora", address: "", bookingFeeCents: 100, premiumSurchargeCents: 300 };
  const screen: CinemaScreen = { cinemaCode: "C1", code: "C1-S1", name: "Screen 1", kind: "standard", rows: 3, seatsPerRow: 4, premiumRows: ["C"] };
  const film: CinemaFilm = { code: "F1", title: "Kids Film", genre: "comedy", rating: "PG", runtimeMinutes: 90, language: "English", synopsis: "", formats: ["2d", "3d"] };
  const adultFilm: CinemaFilm = { ...film, code: "F2", title: "Late Film", genre: "horror", rating: "18" };
  const prices: CinemaPrice[] = (["adult", "child", "senior", "student"] as const).map((ticketType, i) => ({ cinemaCode: "C1", format: "2d", ticketType, priceCents: 1000 - i * 100 }));
  const show: CinemaShowtime = { code: "S1", cinemaCode: "C1", screenCode: "C1-S1", filmCode: "F1", date: "2027-05-13", time: "18:30", format: "2d" };
  const ctx: CinemaBookingContext = { cinema, screen, film, showtime: show, prices };
  const booking = (seats: string[], status: CinemaBooking["status"] = "confirmed"): CinemaBooking => ({
    bookingNo: `B-${seats.join("")}`, showtimeCode: "S1", customerName: "C", customerEmail: "c@example.com", tickets: seats.map((seat) => ({ seat, ticketType: "adult", priceCents: 0 })), feesCents: 0, totalCents: 0, status, createdAt: "",
  });
  const rows: CinemaRows = { cinemas: [cinema], screens: [screen], films: [film, adultFilm], prices, showtimes: [show, { ...show, code: "S2", filmCode: "F2", time: "21:00" }, { ...show, code: "S3", format: "3d", time: "12:30" }], bookings: [] };

  it("refuses each rule on its own", () => {
    const req = { seats: ["B2", "B3"], counts: { adult: 1, child: 1 } };
    expect(cinemaBookingProblem(ctx, req, [])).toBeNull();
    expect(cinemaBookingProblem(ctx, { seats: [] }, [])?.code).toBe("NO_SEATS");
    expect(cinemaBookingProblem({ ...ctx, screen: { ...screen, rows: 4, seatsPerRow: 4 } }, { seats: ["A1", "A2", "A3", "A4", "B1", "B2", "B3", "B4", "C1", "C2", "C3"] }, [])?.code).toBe("TOO_MANY_SEATS");
    expect(cinemaBookingProblem(ctx, { ...req, seats: ["B2", "D1"] }, [])?.code).toBe("BAD_SEAT");
    expect(cinemaBookingProblem(ctx, { ...req, seats: ["B2", "B5"] }, [])?.code).toBe("BAD_SEAT");
    expect(cinemaBookingProblem(ctx, { ...req, seats: ["B2", "b2"] }, [])?.code).toBe("DUPLICATE_SEAT");
    expect(cinemaBookingProblem(ctx, { ...req, counts: { adult: 2, child: 1 } }, [])?.code).toBe("BAD_TICKET_COUNT");
    expect(cinemaBookingProblem(ctx, { ...req, counts: { adult: 3, child: -1 } }, [])?.code).toBe("BAD_TICKET_COUNT");
    expect(cinemaBookingProblem({ ...ctx, film: adultFilm }, req, [])?.code).toBe("CHILD_NOT_ALLOWED");
    expect(cinemaBookingProblem({ ...ctx, showtime: { ...show, format: "3d" } }, req, [])?.code).toBe("NO_PRICE");
    expect(cinemaBookingProblem(ctx, req, [booking(["B3"])])?.code).toBe("SEAT_TAKEN");
    expect(cinemaBookingProblem(ctx, req, [booking(["B3"], "cancelled")])).toBeNull();
    const all = ["A", "B", "C"].map((r) => booking([1, 2, 3, 4].map((n) => `${r}${n}`)));
    expect(cinemaBookingProblem(ctx, req, all)?.code).toBe("SOLD_OUT");
  });

  it("prices each ticket by type, adds the premium surcharge per premium seat and the fee per ticket", () => {
    const q = cinemaQuote(ctx, ["C2", "b1", "C1"], { adult: 1, senior: 2 });
    expect(q.tickets).toEqual([
      { seat: "B1", ticketType: "adult", priceCents: 1000 },
      { seat: "C1", ticketType: "senior", priceCents: 800 + 300 },
      { seat: "C2", ticketType: "senior", priceCents: 800 + 300 },
    ]);
    expect([q.feesCents, q.totalCents]).toEqual([300, 3500]);
    expect(cinemaResolveCounts(3)).toEqual({ adult: 3, child: 0, senior: 0, student: 0 });
    expect(cinemaResolveCounts(3, { child: 0 })).toEqual({ adult: 3, child: 0, senior: 0, student: 0 });
  });

  it("reads seats side by side, free runs and the booking view", () => {
    expect(cinemaSeatsTogether(["A3", "A1", "A2"])).toBe(true);
    expect(cinemaSeatsTogether(["A1", "A3"])).toBe(false);
    expect(cinemaSeatsTogether(["A4", "B1"])).toBe(false);
    const taken = cinemaTakenSeats([booking(["A2"]), booking(["B1", "B2", "B3", "B4"]), booking(["C1"], "cancelled")], "S1");
    expect(cinemaFreeRuns(screen, taken)).toEqual([["A1"], ["A3", "A4"], ["C1", "C2", "C3", "C4"]]);
    expect([cinemaFreeSeats(screen, taken).length, cinemaBestRun(screen, taken)]).toEqual([7, 4]);
    const view = cinemaBookingView({ ...booking(["A4", "A3"]), tickets: [{ seat: "A3", ticketType: "child", priceCents: 0 }, { seat: "A4", ticketType: "adult", priceCents: 0 }] }, show);
    expect([view.seats, view.seatCount, view.together, view.ticketCounts]).toEqual(["A3,A4", 2, true, { adult: 1, child: 1, senior: 0, student: 0 }]);
  });

  it("searches by city, date, genre, film, format, start time and free seats", () => {
    const codes = (q: Parameters<typeof cinemaSearchShowtimes>[1], r = rows) => cinemaSearchShowtimes(r, q).map((o) => o.showtimeCode);
    expect(codes({ city: "velmora" })).toEqual(["S3", "S1", "S2"]);
    expect(codes({ city: "Ostrand" })).toEqual([]);
    expect(codes({ genre: "Horror" })).toEqual(["S2"]);
    expect(codes({ format: "3d" })).toEqual(["S3"]);
    expect(codes({ after: "18:30" })).toEqual(["S1", "S2"]);
    expect(codes({ filmCode: "F1", date: "2027-05-14" })).toEqual([]);
    const busy = { ...rows, bookings: [booking(["A1", "A3", "B2", "B4", "C1", "C3"])] };
    expect(codes({ seats: 6 }, busy)).toEqual(["S3", "S1", "S2"]);
    expect(codes({ seats: 7 }, busy)).toEqual(["S3", "S2"]);
    expect(codes({ seats: 2, together: true }, busy)).toEqual(["S3", "S2"]);
    expect(cinemaSearchShowtimes(busy, { filmCode: "F1", format: "2d" })[0]).toMatchObject({ freeSeats: 6, bestRun: 1, seatsTotal: 12, adultPriceCents: 1000 });
  });
});
