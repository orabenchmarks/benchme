import { HOME_FEATURES, HOME_LISTING_STATUSES, HOME_TYPES, isDate, isHomeTime, type HomeListingQuery } from "@benchme/scenarios";
import { z } from "zod";

/**
 * The input shapes REST and the pages share, so both doors accept the same
 * thing (the MCP tools take the same fields, typed). Money a person types is
 * dollars (`minPrice`, `maxPrice`); money the site returns is cents
 * (`priceCents`, `monthlyFeeCents`, `annualTaxCents`).
 */
export const date = z.string().refine(isDate, "a date as YYYY-MM-DD");
export const time = z.string().refine(isHomeTime, "a time as HH:MM (24-hour)");
/** "YYYY-MM-DDTHH:MM": a slot's date and start time together. */
export const moment = z.string().refine((s) => s.length === 16 && s[10] === "T" && isDate(s.slice(0, 10)) && isHomeTime(s.slice(11)), "a moment as YYYY-MM-DDTHH:MM");

/** "a,b", ["a", "b"] or one repeated query param — whichever the door sends — each checked against the allowed values. */
const listOf = (allowed: readonly string[], what: string) =>
  z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) => (v === undefined ? [] : (Array.isArray(v) ? v : v.split(",")).map((a) => a.trim().toLowerCase()).filter(Boolean)))
    .refine((xs) => xs.every((x) => allowed.includes(x)), `${what}: any of ${allowed.join(", ")}`);
export const typeList = listOf(HOME_TYPES, "home types");
export const featureList = listOf(HOME_FEATURES, "features");
const count = z.coerce.number().int().min(0).max(20).optional();

export const searchInput = {
  city: z.string().min(1).optional(),
  neighbourhood: z.string().min(1).optional(),
  type: typeList,
  minPrice: z.coerce.number().nonnegative().optional(),
  maxPrice: z.coerce.number().positive().optional(),
  minBeds: count,
  minBaths: count,
  minArea: z.coerce.number().nonnegative().optional(),
  minYearBuilt: z.coerce.number().int().optional(),
  features: featureList,
  status: z.enum(HOME_LISTING_STATUSES).optional(),
};
export const searchSchema = z.object(searchInput);
export type SearchInput = z.infer<typeof searchSchema>;

/** A search's dollar bounds as the cents the rows carry. */
export const toQuery = (s: SearchInput): HomeListingQuery => ({
  ...(s.city ? { city: s.city } : {}),
  ...(s.neighbourhood ? { neighbourhood: s.neighbourhood } : {}),
  types: s.type,
  features: s.features,
  ...(s.minPrice !== undefined ? { minPriceCents: Math.round(s.minPrice * 100) } : {}),
  ...(s.maxPrice !== undefined ? { maxPriceCents: Math.round(s.maxPrice * 100) } : {}),
  ...(s.minBeds !== undefined ? { minBeds: s.minBeds } : {}),
  ...(s.minBaths !== undefined ? { minBaths: s.minBaths } : {}),
  ...(s.minArea !== undefined ? { minAreaSqm: s.minArea } : {}),
  ...(s.minYearBuilt !== undefined ? { minYearBuilt: s.minYearBuilt } : {}),
  ...(s.status ? { status: s.status } : {}),
});

export const viewingInput = {
  listingCode: z.string().min(1),
  agentCode: z.string().min(1).optional(),
  date,
  time,
  viewerName: z.string().min(1),
  viewerEmail: z.string().email(),
};
export const viewingSchema = z.object(viewingInput);

/** Form and query values with the empty ones dropped: an empty box means "no filter", not "0". */
export const filled = (f: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined && v !== ""));
