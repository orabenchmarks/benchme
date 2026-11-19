import { DomainError, ToolRegistry } from "@benchme/site-kit";
import { z } from "zod";
import { cabinClass, date, searchSchema, searchTrip, time } from "../api/inputs.js";
import type { FlightsRepo } from "../db/flights-repo.js";

export type ToolContext = { workspaceId: string; flights: FlightsRepo };

const notFound = (what: string) => {
  throw new DomainError("NOT_FOUND", `${what} not found`, 404);
};
const place = (what: string) => z.string().describe(`${what}: an airport code (e.g. from list_airports) or a city name`);

/** The flight site's MCP surface (and, through the bridge, its WebMCP tools): search, read, book, cancel. */
export function flightTools(): ToolRegistry<ToolContext> {
  return new ToolRegistry<ToolContext>()
    .register({
      name: "list_airports",
      description: "The airports the site flies from and to (with their cities), and the hubs one-stop flights stop at.",
      input: {},
      handler: (_a, c) => c.flights.airports(c.workspaceId),
    })
    .register({
      name: "list_carriers",
      description: "The carriers whose flights the site sells, each with its checked-bag fee in cents (per bag, per passenger) and the most checked bags one passenger may bring.",
      input: {},
      handler: (_a, c) => c.flights.carriers(c.workspaceId),
    })
    .register({
      name: "list_flights",
      description: "The schedule: flights, optionally from one place, to one place, or by one carrier code, with their cabins and fares. Every flight runs daily. No seats: use search_flights or check_seats for a date.",
      input: { origin: place("From").optional(), destination: place("To").optional(), carrierCode: z.string().optional() },
      handler: (a, c) => c.flights.listFlights(c.workspaceId, { ...(a.origin ? { origin: a.origin } : {}), ...(a.destination ? { destination: a.destination } : {}), ...(a.carrierCode ? { carrier: a.carrierCode } : {}) }),
    })
    .register({
      name: "get_flight",
      description: "One flight by its number: route, stop, times, carrier (bag fee and bag limit) and its cabins with the fare per passenger in cents and the seats sold on each departure.",
      input: { flightNo: z.string() },
      handler: async (a, c) => (await c.flights.getFlight(c.workspaceId, a.flightNo)) ?? notFound(`flight ${a.flightNo}`),
    })
    .register({
      name: "check_seats",
      description: "How many seats each cabin of one flight has left on one departure date.",
      input: { flightNo: z.string(), date: date.describe("departure date, YYYY-MM-DD") },
      handler: (a, c) => c.flights.seats(c.workspaceId, a.flightNo, a.date),
    })
    .register({
      name: "search_flights",
      description:
        "Flights from origin to destination on a date that have a seat in the cabin for every passenger, cheapest first. Give returnDate for a round trip: the return leg comes back in `inbound`, with the same filters. Filters: maxStops (0 = nonstop only), carriers (codes), maxPrice (dollars per passenger), departAfter / departBefore (HH:MM, inclusive). totalCents is every passenger's fare; checked bags are extra.",
      input: {
        origin: place("From"),
        destination: place("To"),
        tripType: z.enum(["one-way", "round-trip"]).optional(),
        date: date.describe("departure date, YYYY-MM-DD"),
        returnDate: date.optional().describe("return date for a round trip, YYYY-MM-DD"),
        passengers: z.number().int().min(1).max(9).default(1),
        cabin: cabinClass.default("economy"),
        maxStops: z.number().int().min(0).max(1).optional(),
        carriers: z.array(z.string()).optional().describe('Carrier codes, e.g. ["QE", "SZ"]'),
        maxPrice: z.number().positive().optional(),
        departAfter: time.optional(),
        departBefore: time.optional(),
      },
      handler: (a, c) => {
        const s = searchSchema.safeParse(a);
        if (!s.success) throw new DomainError("BAD_REQUEST", s.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), 400);
        return searchTrip(c.flights, c.workspaceId, s.data);
      },
    })
    .register({
      name: "list_bookings",
      description: "Bookings, optionally for one contact email, one flight, one departure date, or one status (confirmed|cancelled). Paginated via cursor.",
      input: { contactEmail: z.string().optional(), flightNo: z.string().optional(), date: date.optional(), status: z.enum(["confirmed", "cancelled"]).optional(), cursor: z.string().optional(), limit: z.number().int().min(1).max(100).optional() },
      handler: (a, c) =>
        c.flights.listBookings(c.workspaceId, {
          ...(a.contactEmail ? { contactEmail: a.contactEmail } : {}),
          ...(a.flightNo ? { flightNo: a.flightNo } : {}),
          ...(a.date ? { date: a.date } : {}),
          ...(a.status ? { status: a.status } : {}),
          ...(a.cursor ? { cursor: a.cursor } : {}),
          limit: a.limit ?? 25,
        }),
    })
    .register({
      name: "get_booking",
      description: "One booking by its number (BK-…).",
      input: { bookingNo: z.string() },
      handler: async (a, c) => (await c.flights.getBooking(c.workspaceId, a.bookingNo)) ?? notFound(`booking ${a.bookingNo}`),
    })
    .register({
      name: "create_booking",
      description:
        "Book one flight on one date in one cabin for 1–9 named passengers, each with the same number of checked bags. A round trip is two bookings. Fails if the date is outside 2027-03-01..2027-06-30, the flight has no such cabin, a name is blank, the bags exceed the carrier's limit, or the cabin has fewer seats left than passengers. totalCents = passengers × fare + passengers × bags × the carrier's bag fee.",
      input: {
        flightNo: z.string(),
        date: date.describe("departure date, YYYY-MM-DD"),
        cabin: cabinClass.default("economy"),
        passengers: z.array(z.string()).describe("every passenger's full name"),
        bags: z.number().int().min(0).max(20).default(0).describe("checked bags per passenger"),
        contactEmail: z.string().email(),
      },
      handler: (a, c) => c.flights.createBooking(c.workspaceId, a),
    })
    .register({
      name: "cancel_booking",
      description: "Cancel a confirmed booking; its seats are free again. A cancelled booking cannot be restored; book again instead.",
      input: { bookingNo: z.string() },
      handler: (a, c) => c.flights.cancelBooking(c.workspaceId, a.bookingNo),
    });
}
