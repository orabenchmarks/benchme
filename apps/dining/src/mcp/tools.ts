import { DINING_MAX_PARTY } from "@benchme/scenarios";
import { DomainError, ToolRegistry } from "@benchme/site-kit";
import { z } from "zod";
import { area, date, phone, time } from "../api/inputs.js";
import type { DiningRepo } from "../db/dining-repo.js";

export type ToolContext = { workspaceId: string; dining: DiningRepo };

const notFound = (what: string) => {
  throw new DomainError("NOT_FOUND", `${what} not found`, 404);
};
const party = z.number().int().min(1).max(50).describe(`number of guests; parties of more than ${DINING_MAX_PARTY} are not booked online`);
const menus = z.array(z.string()).optional().describe('Dietary menus the restaurant must offer, every one of them: "vegetarian", "vegan", "gluten-free"');
const areaOf = area.describe("seating area: indoor, terrace, bar or private (the private room)");
const seatingTime = time.describe("seating time, HH:MM on the hour or half hour; the table is held for 2 hours");

/** The reservation site's MCP surface (and, through the bridge, its WebMCP tools): search, read, reserve, change, cancel. */
export function diningTools(): ToolRegistry<ToolContext> {
  return new ToolRegistry<ToolContext>()
    .register({
      name: "list_cities",
      description: "The cities the site has restaurants in, with how many restaurants each.",
      input: {},
      handler: (_a, c) => c.dining.cities(c.workspaceId),
    })
    .register({
      name: "list_restaurants",
      description: "Restaurants, optionally in one city, of one cuisine, offering every listed dietary menu, or with seating in one area. No dates: use search_tables to see what is free.",
      input: { city: z.string().optional(), cuisine: z.string().optional(), menus, area: areaOf.optional() },
      handler: (a, c) => c.dining.listRestaurants(c.workspaceId, { ...(a.city ? { city: a.city } : {}), ...(a.cuisine ? { cuisine: a.cuisine } : {}), ...(a.menus ? { menus: a.menus } : {}), ...(a.area ? { area: a.area } : {}) }),
    })
    .register({
      name: "get_restaurant",
      description: "One restaurant: cuisine, price level (1-4), dietary menus, opening hours per weekday and its closed day, deposit per guest and private-room fee in cents, and its seating: per area, how many tables and how many guests each seats.",
      input: { restaurantCode: z.string() },
      handler: async (a, c) => (await c.dining.getRestaurant(c.workspaceId, a.restaurantCode)) ?? notFound(`restaurant ${a.restaurantCode}`),
    })
    .register({
      name: "search_tables",
      description:
        "Restaurants in a city with a table that seats the party and is free for the 2 hours from the seating time, one row per restaurant and area, optionally only one area, one cuisine, restaurants offering every listed menu, or at most a price level. depositCents is what the reservation would take.",
      input: { city: z.string(), date: date.describe("YYYY-MM-DD"), time: seatingTime, partySize: party, area: areaOf.optional(), cuisine: z.string().optional(), menus, maxPriceLevel: z.number().int().min(1).max(4).optional() },
      handler: (a, c) =>
        c.dining.search(c.workspaceId, {
          city: a.city,
          date: a.date,
          time: a.time,
          partySize: a.partySize,
          menus: a.menus ?? [],
          ...(a.area ? { area: a.area } : {}),
          ...(a.cuisine ? { cuisine: a.cuisine } : {}),
          ...(a.maxPriceLevel !== undefined ? { maxPriceLevel: a.maxPriceLevel } : {}),
        }),
    })
    .register({
      name: "check_availability",
      description: "One restaurant's day for a party: for each area whose tables seat it, every seating time and how many tables are free for the 2 hours from it (0 = full). No slots on its closed day.",
      input: { restaurantCode: z.string(), date, partySize: party },
      handler: (a, c) => c.dining.availability(c.workspaceId, a.restaurantCode, a.date, a.partySize),
    })
    .register({
      name: "list_reservations",
      description: "Reservations, optionally for one guest email, one restaurant, one date, or one status (confirmed|cancelled). Paginated via cursor.",
      input: { guestEmail: z.string().optional(), restaurantCode: z.string().optional(), date: date.optional(), status: z.enum(["confirmed", "cancelled"]).optional(), cursor: z.string().optional(), limit: z.number().int().min(1).max(100).optional() },
      handler: (a, c) =>
        c.dining.listReservations(c.workspaceId, {
          ...(a.guestEmail ? { guestEmail: a.guestEmail } : {}),
          ...(a.restaurantCode ? { restaurant: a.restaurantCode } : {}),
          ...(a.date ? { date: a.date } : {}),
          ...(a.status ? { status: a.status } : {}),
          ...(a.cursor ? { cursor: a.cursor } : {}),
          limit: a.limit ?? 25,
        }),
    })
    .register({
      name: "get_reservation",
      description: "One reservation by its number (RV-…).",
      input: { reservationNo: z.string() },
      handler: async (a, c) => (await c.dining.getReservation(c.workspaceId, a.reservationNo)) ?? notFound(`reservation ${a.reservationNo}`),
    })
    .register({
      name: "create_reservation",
      description:
        "Reserve one table in an area for a guest. Fails if the date is outside 2027, the time is not on the hour or half hour, the restaurant is closed that day or the time is outside its seating hours (the last seating is 2 hours before closing), it has no seating in the area, the party is over 12 or larger than the area's tables, or no table of the area is free for the 2 hours. note is the special request, entered as given.",
      input: { restaurantCode: z.string(), area: areaOf, date, time: seatingTime, partySize: party, guestName: z.string(), guestEmail: z.string().email(), guestPhone: phone, note: z.string().max(500).default("") },
      handler: (a, c) => c.dining.createReservation(c.workspaceId, a),
    })
    .register({
      name: "change_reservation",
      description: "Change a confirmed reservation's date, time, party size, area or special request; the reservation, as changed, must meet every rule create_reservation does (its own table does not count against it). Fields left out stay as they are.",
      input: { reservationNo: z.string(), date: date.optional(), time: seatingTime.optional(), partySize: party.optional(), area: areaOf.optional(), note: z.string().max(500).optional() },
      handler: (a, c) => {
        const { reservationNo, ...change } = a;
        return c.dining.changeReservation(c.workspaceId, reservationNo, change);
      },
    })
    .register({
      name: "cancel_reservation",
      description: "Cancel a confirmed reservation. A cancelled reservation cannot be restored; reserve again instead.",
      input: { reservationNo: z.string() },
      handler: (a, c) => c.dining.cancelReservation(c.workspaceId, a.reservationNo),
    });
}
