import { MAX_NIGHTS, isDate } from "@benchme/scenarios";
import { z } from "zod";

/**
 * The input shapes REST, MCP and the pages share, so every door accepts the
 * same thing. Money a person types is dollars (`maxPrice`, per night); money
 * the site returns is cents (`nightlyCents`, `totalCents`), as in the warehouse.
 */
export const date = z.string().refine(isDate, "a date as YYYY-MM-DD");
export const nights = z.coerce.number().int().min(1).max(MAX_NIGHTS);
const count = (min: number) => z.coerce.number().int().min(min).max(20);
/** A form or query string sends a field left empty as "": read it as not given, so its default (or no cap, no filter) applies instead of 0 or a 400. */
export const given = <T extends z.ZodTypeAny>(schema: T) => z.preprocess((v) => (v === "" ? undefined : v), schema);
/** "gym,spa", ["gym", "spa"] or one repeated query param — whichever the door sends. */
export const amenityList = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => (v === undefined ? [] : (Array.isArray(v) ? v : v.split(",")).map((a) => a.trim().toLowerCase()).filter(Boolean)));

export const searchInput = {
  city: z.string().min(1),
  checkIn: date,
  nights,
  adults: given(count(1).default(1)),
  kids: given(count(0).default(0)),
  pets: given(count(0).default(0)),
  maxPrice: given(z.coerce.number().positive().optional()),
  amenities: amenityList,
};
export const searchSchema = z.object(searchInput);
export type SearchInput = z.infer<typeof searchSchema>;

export const bookingInput = {
  roomCode: z.string().min(1),
  hotelCode: given(z.string().min(1).optional()),
  checkIn: date,
  nights,
  adults: given(count(1).default(1)),
  kids: given(count(0).default(0)),
  pets: given(count(0).default(0)),
  lateCheckout: z.boolean().default(false),
  guestName: z.string().min(1),
  guestEmail: z.string().email(),
};
export const bookingSchema = z.object(bookingInput);

/** A search's dollar cap as the cents the rows carry. */
export const toQuery = (s: SearchInput) => ({
  city: s.city,
  checkIn: s.checkIn,
  nights: s.nights,
  adults: s.adults,
  kids: s.kids,
  pets: s.pets,
  amenities: s.amenities,
  ...(s.maxPrice !== undefined ? { maxNightlyCents: Math.round(s.maxPrice * 100) } : {}),
});
