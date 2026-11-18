import { DINING_AREAS, diningIsTime, isDate, type DiningQuery } from "@benchme/scenarios";
import { z } from "zod";

/**
 * The input shapes REST, MCP and the pages share, so every door accepts the
 * same thing. A malformed value (not a date, not HH:MM, an unknown area) is
 * the caller's to fix and answers 400; a well-formed request the rules refuse
 * (a closed day, 19:15, a party of 14) answers 422 from the rules. Money the
 * site returns is cents (`depositCents`).
 */
export const date = z.string().refine(isDate, "a date as YYYY-MM-DD");
export const time = z.string().refine(diningIsTime, "a time as HH:MM");
export const partySize = z.coerce.number().int().min(1).max(50);
export const area = z.enum(DINING_AREAS);
export const phone = z.string().refine((s) => s.replace(/\D/g, "").length >= 10, "a phone number with at least 10 digits");
/** "vegan,gluten-free", ["vegan", "gluten-free"] or one repeated query param — whichever the door sends. */
export const menuList = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => (v === undefined ? [] : (Array.isArray(v) ? v : v.split(",")).map((m) => m.trim().toLowerCase()).filter(Boolean)));

export const searchInput = {
  city: z.string().min(1),
  date,
  time,
  partySize,
  area: area.optional(),
  cuisine: z.string().min(1).optional(),
  menus: menuList,
  maxPriceLevel: z.coerce.number().int().min(1).max(4).optional(),
};
export const searchSchema = z.object(searchInput);
export type SearchInput = z.infer<typeof searchSchema>;

export const reservationInput = {
  restaurantCode: z.string().min(1),
  area,
  date,
  time,
  partySize,
  guestName: z.string().min(1),
  guestEmail: z.string().email(),
  guestPhone: phone,
  note: z.string().max(500).default(""),
};
export const reservationSchema = z.object(reservationInput);

export const changeInput = { date: date.optional(), time: time.optional(), partySize: partySize.optional(), area: area.optional(), note: z.string().max(500).optional() };
export const changeSchema = z.object(changeInput).refine((c) => Object.values(c).some((v) => v !== undefined), "name at least one of date, time, partySize, area, note");

export const toQuery = (s: SearchInput): DiningQuery => ({
  city: s.city,
  date: s.date,
  time: s.time,
  partySize: s.partySize,
  menus: s.menus,
  ...(s.area ? { area: s.area } : {}),
  ...(s.cuisine ? { cuisine: s.cuisine } : {}),
  ...(s.maxPriceLevel !== undefined ? { maxPriceLevel: s.maxPriceLevel } : {}),
});

/** A submitted form or query string without its empty fields: an unchosen select means "any", not "". */
export function filled(f: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v !== "" && v !== undefined));
}
