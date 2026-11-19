import { FLIGHT_MAX_PASSENGERS, isDate, isFlightTime, type FlightOffer, type FlightQuery } from "@benchme/scenarios";
import { z } from "zod";
import type { FlightsRepo } from "../db/flights-repo.js";

/**
 * The input shapes REST, MCP and the pages share, so every door accepts the
 * same thing. Money a person types is dollars (`maxPrice`, per passenger);
 * money the site returns is cents (`priceCents`, `totalCents`).
 */
export const date = z.string().refine(isDate, "a date as YYYY-MM-DD");
export const time = z.string().refine(isFlightTime, "a time as HH:MM");
export const cabinClass = z.enum(["economy", "premium", "business"]);
export const passengerCount = z.coerce.number().int().min(1).max(FLIGHT_MAX_PASSENGERS);
/** "QE,SZ", ["QE", "SZ"] or one repeated query param — whichever the door sends. */
export const codeList = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => (v === undefined ? [] : (Array.isArray(v) ? v : v.split(",")).map((c) => c.trim().toUpperCase()).filter(Boolean)));
/** A list of names, or one text with a name per line (the booking form's textarea). Blank names in a list are left for the rules to refuse. */
export const passengerList = z
  .union([z.string(), z.array(z.string())])
  .transform((v) => (Array.isArray(v) ? v : v.split(/\r?\n/).map((n) => n.trim()).filter(Boolean)))
  .pipe(z.array(z.string()).max(20));

/** A form or query string sends an empty field as ""; an empty optional field means "not given". */
export const dropEmpty = (o: unknown): Record<string, unknown> =>
  Object.fromEntries(Object.entries((o ?? {}) as Record<string, unknown>).filter(([, v]) => v !== "" && v !== undefined));

export const searchSchema = z
  .object({
    origin: z.string().min(1),
    destination: z.string().min(1),
    /** Optional: a return date alone makes a round trip; "one-way" ignores a return date; "round-trip" needs one. */
    tripType: z.enum(["one-way", "round-trip"]).optional(),
    date,
    returnDate: date.optional(),
    passengers: passengerCount.default(1),
    cabin: cabinClass.default("economy"),
    maxStops: z.coerce.number().int().min(0).max(1).optional(),
    carriers: codeList,
    maxPrice: z.coerce.number().positive().optional(),
    departAfter: time.optional(),
    departBefore: time.optional(),
  })
  .refine((s) => s.tripType !== "round-trip" || !!s.returnDate, { message: "a round trip needs a return date", path: ["returnDate"] })
  .refine((s) => s.tripType === "one-way" || !s.returnDate || s.returnDate >= s.date, { message: "the return date is before the departure date", path: ["returnDate"] });
export type SearchInput = z.infer<typeof searchSchema>;

export const bookingSchema = z.object({
  flightNo: z.string().min(1),
  date,
  cabin: cabinClass.default("economy"),
  passengers: passengerList,
  bags: z.coerce.number().int().min(0).max(20).default(0),
  contactEmail: z.string().email(),
});

/** One leg of a search: the dollar cap as the cents the rows carry. */
export const toQuery = (s: SearchInput): FlightQuery => ({
  origin: s.origin,
  destination: s.destination,
  date: s.date,
  passengers: s.passengers,
  cabin: s.cabin,
  carriers: s.carriers,
  ...(s.maxStops !== undefined ? { maxStops: s.maxStops } : {}),
  ...(s.maxPrice !== undefined ? { maxPriceCents: Math.round(s.maxPrice * 100) } : {}),
  ...(s.departAfter ? { departAfter: s.departAfter } : {}),
  ...(s.departBefore ? { departBefore: s.departBefore } : {}),
});
/** The return leg: the same filters, the other way, on the return date. */
export const returnQuery = (s: SearchInput): FlightQuery | null => (s.returnDate && s.tripType !== "one-way" ? { ...toQuery(s), origin: s.destination, destination: s.origin, date: s.returnDate } : null);

export type TripResult = { tripType: "one-way" | "round-trip"; outbound: FlightOffer[]; inbound: FlightOffer[] };
/** A search as every door answers it: the outbound leg, and the return leg when a return date is given. */
export async function searchTrip(flights: FlightsRepo, ws: string, s: SearchInput): Promise<TripResult> {
  const back = returnQuery(s);
  return { tripType: back ? "round-trip" : "one-way", outbound: await flights.search(ws, toQuery(s)), inbound: back ? await flights.search(ws, back) : [] };
}
