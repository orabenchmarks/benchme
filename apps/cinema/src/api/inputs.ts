import { CINEMA_MAX_SEATS, cinemaIsTime, cinemaNormalizeSeats, isDate, type CinemaShowtimeQuery } from "@benchme/scenarios";
import { z } from "zod";
import type { NewBooking } from "../db/cinema-repo.js";

/**
 * The input shapes REST, MCP and the pages share, so every door accepts the
 * same thing. Money the site returns is cents (`priceCents`, `totalCents`).
 */
export const date = z.string().refine(isDate, "a date as YYYY-MM-DD");
export const time = z.string().refine(cinemaIsTime, "a start time as HH:MM, 24-hour");
export const format = z
  .string()
  .transform((s) => s.trim().toLowerCase())
  .pipe(z.enum(["2d", "3d", "large"]));
/** "F4,F5", "F4 F5" or ["F4", "F5"] — whichever the door sends. */
export const seatList = z.union([z.string(), z.array(z.string())]).transform((v) => cinemaNormalizeSeats(v));
/** true/false from JSON, or "true"/"1"/"on" from a query string or a form. */
export const flag = z.union([z.boolean(), z.enum(["true", "false", "1", "0", "on"])]).transform((v) => v === true || v === "true" || v === "1" || v === "on");
const tickets = z.coerce.number().int().min(0).max(CINEMA_MAX_SEATS).optional();

export const searchInput = {
  city: z.string().min(1).optional(),
  cinema: z.string().min(1).optional(),
  date: date.optional(),
  genre: z.string().min(1).optional(),
  film: z.string().min(1).optional(),
  format: format.optional(),
  after: time.optional(),
  seats: z.coerce.number().int().min(1).max(CINEMA_MAX_SEATS).optional(),
  together: flag.optional(),
};
export const searchSchema = z.object(searchInput);
export type SearchInput = z.infer<typeof searchSchema>;

export const toQuery = (s: SearchInput): CinemaShowtimeQuery => ({
  city: s.city,
  cinemaCode: s.cinema,
  date: s.date,
  genre: s.genre,
  filmCode: s.film,
  format: s.format,
  after: s.after,
  seats: s.seats,
  together: s.together,
});

export const bookingInput = {
  showtimeCode: z.string().min(1),
  seats: seatList,
  adult: tickets,
  child: tickets,
  senior: tickets,
  student: tickets,
  customerName: z.string().min(1),
  customerEmail: z.string().email(),
};
export const bookingSchema = z.object(bookingInput);
export type BookingInput = z.infer<typeof bookingSchema>;

export const toNewBooking = (b: BookingInput): NewBooking => ({
  showtimeCode: b.showtimeCode,
  seats: b.seats,
  counts: { adult: b.adult, child: b.child, senior: b.senior, student: b.student },
  customerName: b.customerName,
  customerEmail: b.customerEmail,
});

/** A form or query string sends "" for a field left blank; blank means "not given", never 0. */
export const blankless = (f: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(Object.entries(f).filter(([, v]) => v !== "" && v !== undefined));
