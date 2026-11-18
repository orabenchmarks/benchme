import { DomainError, ToolRegistry } from "@benchme/site-kit";
import { z } from "zod";
import { date, nights } from "../api/inputs.js";
import type { HotelsRepo } from "../db/hotels-repo.js";

export type ToolContext = { workspaceId: string; hotels: HotelsRepo };

const notFound = (what: string) => {
  throw new DomainError("NOT_FOUND", `${what} not found`, 404);
};
const guests = { adults: z.number().int().min(1).max(20).default(1), kids: z.number().int().min(0).max(20).default(0), pets: z.number().int().min(0).max(20).default(0) };
const amenities = z.array(z.string()).optional().describe('Amenities every hotel must have, e.g. ["gym", "breakfast"]');

/** The hotel site's MCP surface (and, through the bridge, its WebMCP tools): search, read, book, cancel. */
export function hotelTools(): ToolRegistry<ToolContext> {
  return new ToolRegistry<ToolContext>()
    .register({
      name: "list_cities",
      description: "The cities the site has hotels in, with how many hotels each.",
      input: {},
      handler: (_a, c) => c.hotels.cities(c.workspaceId),
    })
    .register({
      name: "list_hotels",
      description: "Hotels, optionally in one city, having every listed amenity, or allowing pets. No dates: use search_stays to see what is free.",
      input: { city: z.string().optional(), amenities, petsAllowed: z.boolean().optional() },
      handler: (a, c) => c.hotels.listHotels(c.workspaceId, { ...(a.city ? { city: a.city } : {}), ...(a.amenities ? { amenities: a.amenities } : {}), ...(a.petsAllowed ? { pets: true } : {}) }),
    })
    .register({
      name: "get_hotel",
      description: "One hotel: amenities, pet policy and fee, late checkout (latest time and fee), and its room types with capacity, nightly price in cents and how many rooms of each it has.",
      input: { hotelCode: z.string() },
      handler: async (a, c) => (await c.hotels.getHotel(c.workspaceId, a.hotelCode)) ?? notFound(`hotel ${a.hotelCode}`),
    })
    .register({
      name: "search_stays",
      description:
        "Hotels in a city with a room that fits the party and is free every night of the stay, each hotel's cheapest such room, cheapest first. maxPrice is dollars per night. totalCents includes the pet fee when pets come; late checkout is extra.",
      input: { city: z.string(), checkIn: date.describe("first night, YYYY-MM-DD"), nights, ...guests, maxPrice: z.number().positive().optional(), amenities },
      handler: (a, c) =>
        c.hotels.search(c.workspaceId, {
          city: a.city,
          checkIn: a.checkIn,
          nights: a.nights,
          adults: a.adults,
          kids: a.kids,
          pets: a.pets,
          amenities: a.amenities ?? [],
          ...(a.maxPrice !== undefined ? { maxNightlyCents: Math.round(a.maxPrice * 100) } : {}),
        }),
    })
    .register({
      name: "check_availability",
      description: "How many rooms of one room type are free on every night of a stay.",
      input: { roomCode: z.string(), checkIn: date, nights },
      handler: (a, c) => c.hotels.availability(c.workspaceId, a.roomCode, a.checkIn, a.nights),
    })
    .register({
      name: "list_bookings",
      description: "Bookings, optionally for one guest email, one hotel, or one status (confirmed|cancelled). Paginated via cursor.",
      input: { guestEmail: z.string().optional(), hotelCode: z.string().optional(), status: z.enum(["confirmed", "cancelled"]).optional(), cursor: z.string().optional(), limit: z.number().int().min(1).max(100).optional() },
      handler: (a, c) =>
        c.hotels.listBookings(c.workspaceId, { ...(a.guestEmail ? { guestEmail: a.guestEmail } : {}), ...(a.hotelCode ? { hotel: a.hotelCode } : {}), ...(a.status ? { status: a.status } : {}), ...(a.cursor ? { cursor: a.cursor } : {}), limit: a.limit ?? 25 }),
    })
    .register({
      name: "get_booking",
      description: "One booking by its number (BK-…).",
      input: { bookingNo: z.string() },
      handler: async (a, c) => (await c.hotels.getBooking(c.workspaceId, a.bookingNo)) ?? notFound(`booking ${a.bookingNo}`),
    })
    .register({
      name: "create_booking",
      description:
        "Book one room of a room type for a guest. Fails if the dates are outside 2027, the stay is not 1–14 nights, the party does not fit the room, pets come to a hotel that does not allow them, late checkout is asked where it is not offered, or no room of the type is free every night.",
      input: { roomCode: z.string(), hotelCode: z.string().optional(), checkIn: date, nights, ...guests, lateCheckout: z.boolean().default(false), guestName: z.string(), guestEmail: z.string().email() },
      handler: (a, c) => c.hotels.createBooking(c.workspaceId, a),
    })
    .register({
      name: "cancel_booking",
      description: "Cancel a confirmed booking. A cancelled booking cannot be restored; book again instead.",
      input: { bookingNo: z.string() },
      handler: (a, c) => c.hotels.cancelBooking(c.workspaceId, a.bookingNo),
    });
}
