import { CINEMA_GENRES, CINEMA_MAX_SEATS } from "@benchme/scenarios";
import { DomainError, ToolRegistry } from "@benchme/site-kit";
import { z } from "zod";
import { date, format, time } from "../api/inputs.js";
import type { CinemaRepo } from "../db/cinema-repo.js";

export type ToolContext = { workspaceId: string; cinema: CinemaRepo };

const notFound = (what: string) => {
  throw new DomainError("NOT_FOUND", `${what} not found`, 404);
};
const genre = z.string().optional().describe(`One of: ${CINEMA_GENRES.join(", ")}`);
const tickets = (type: string) => z.number().int().min(0).max(CINEMA_MAX_SEATS).optional().describe(`How many of the seats are ${type} tickets`);

/** The cinema site's MCP surface (and, through the bridge, its WebMCP tools): browse, search showtimes, read a seat map, book, cancel. */
export function cinemaTools(): ToolRegistry<ToolContext> {
  return new ToolRegistry<ToolContext>()
    .register({
      name: "list_cinemas",
      description: "The cinemas, one per city, with address, booking fee per ticket and premium-row surcharge (cents).",
      input: {},
      handler: (_a, c) => c.cinema.listCinemas(c.workspaceId),
    })
    .register({
      name: "get_cinema",
      description: "One cinema: its screens (seat rows, seats per row, premium rows, standard or large format) and its ticket price table by format (2d, 3d, large) and ticket type (adult, child, senior, student), in cents.",
      input: { cinemaCode: z.string() },
      handler: async (a, c) => (await c.cinema.getCinema(c.workspaceId, a.cinemaCode)) ?? notFound(`cinema ${a.cinemaCode}`),
    })
    .register({
      name: "list_films",
      description: "Films, optionally of one genre, or showing in one city. Each has an age rating (U, PG, 12, 15, 18), runtime, language and the formats it is shown in.",
      input: { genre, city: z.string().optional() },
      handler: (a, c) => c.cinema.listFilms(c.workspaceId, a),
    })
    .register({
      name: "get_film",
      description: "One film and every showtime of it, with free seats.",
      input: { filmCode: z.string() },
      handler: async (a, c) => (await c.cinema.getFilm(c.workspaceId, a.filmCode)) ?? notFound(`film ${a.filmCode}`),
    })
    .register({
      name: "search_showtimes",
      description:
        "Showtimes matching every filter given, by date then start time. `after` keeps showtimes starting at or after that time. `seats` keeps those with at least that many free seats; with `together`, that many free seats side by side in one row. Each result has freeSeats and bestRun (the most free seats side by side in a row).",
      input: {
        city: z.string().optional(),
        cinemaCode: z.string().optional(),
        date: date.optional().describe("YYYY-MM-DD"),
        genre,
        filmCode: z.string().optional(),
        format: format.optional().describe("2d, 3d or large"),
        after: time.optional().describe("HH:MM, 24-hour"),
        seats: z.number().int().min(1).max(CINEMA_MAX_SEATS).optional(),
        together: z.boolean().optional(),
      },
      handler: (a, c) => c.cinema.search(c.workspaceId, a),
    })
    .register({
      name: "get_showtime",
      description:
        "One showtime: film, cinema, screen, format, ticket prices by type for its format (cents), booking fee per ticket, premium rows and their surcharge, whether child tickets are sold, and the seat map (every seat, free or taken).",
      input: { showtimeCode: z.string() },
      handler: async (a, c) => (await c.cinema.getShowtime(c.workspaceId, a.showtimeCode)) ?? notFound(`showtime ${a.showtimeCode}`),
    })
    .register({
      name: "list_bookings",
      description: "Bookings, optionally for one customer email, one showtime, one film, or one status (confirmed|cancelled). Paginated via cursor.",
      input: {
        customerEmail: z.string().optional(),
        showtimeCode: z.string().optional(),
        filmCode: z.string().optional(),
        status: z.enum(["confirmed", "cancelled"]).optional(),
        cursor: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      },
      handler: (a, c) => c.cinema.listBookings(c.workspaceId, { customerEmail: a.customerEmail, showtime: a.showtimeCode, film: a.filmCode, status: a.status, cursor: a.cursor, limit: a.limit ?? 25 }),
    })
    .register({
      name: "get_booking",
      description: "One booking by its number (TK-…).",
      input: { bookingNo: z.string() },
      handler: async (a, c) => (await c.cinema.getBooking(c.workspaceId, a.bookingNo)) ?? notFound(`booking ${a.bookingNo}`),
    })
    .register({
      name: "create_booking",
      description:
        "Book seats at a showtime for a customer. Give the seat codes and how many of them are adult, child, senior and student tickets (seats get types in seat order: adults, children, seniors, students); with no counts, every seat is an adult ticket. Fails if a seat is not on the screen's map or is already booked, more than 10 seats are asked, the counts do not add up to the seats, or child tickets are asked for a film rated 15 or 18. The total is each ticket's price, the premium surcharge for premium-row seats, and the booking fee per ticket.",
      input: {
        showtimeCode: z.string(),
        seats: z.array(z.string()).describe('Seat codes, e.g. ["F4", "F5"]'),
        adult: tickets("adult"),
        child: tickets("child"),
        senior: tickets("senior"),
        student: tickets("student"),
        customerName: z.string(),
        customerEmail: z.string().email(),
      },
      handler: (a, c) =>
        c.cinema.createBooking(c.workspaceId, { showtimeCode: a.showtimeCode, seats: a.seats, counts: { adult: a.adult, child: a.child, senior: a.senior, student: a.student }, customerName: a.customerName, customerEmail: a.customerEmail }),
    })
    .register({
      name: "cancel_booking",
      description: "Cancel a confirmed booking; its seats become free. A cancelled booking cannot be restored; book again instead.",
      input: { bookingNo: z.string() },
      handler: (a, c) => c.cinema.cancelBooking(c.workspaceId, a.bookingNo),
    });
}
