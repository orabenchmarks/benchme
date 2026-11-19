import { isDate } from "../../stays.js";
import type { HomeAgentDay, HomeListing, HomeRows, HomeType, HomeViewing, HomeListingStatus } from "./types.js";

/**
 * The home listings site's rules, as pure functions over rows. apps/homes
 * answers every search with them and holds every viewing request to them
 * inside its write transaction; the intent corpus derives its answer keys with
 * the same functions, so the site and the keys cannot disagree.
 */

export const HOME_TYPES = ["house", "apartment", "townhouse"] as const satisfies readonly HomeType[];
export const HOME_LISTING_STATUSES = ["active", "pending", "sold"] as const satisfies readonly HomeListingStatus[];
export const HOME_FEATURES = ["garage", "garden", "pool", "balcony", "elevator", "pets allowed", "fireplace", "solar panels", "air conditioning", "home office"] as const;
/** The days viewings are taken for. Fixed, not "from today", so a seed means the same slots forever. */
export const HOME_VIEWING_WINDOW = { first: "2027-06-07", last: "2027-06-19" } as const;
export const HOME_SLOT_MINUTES = 30;

export type HomeProblem = { code: string; message: string };
/** Every field narrows; an absent one does not. Money is cents. `status` absent: every status. */
export type HomeListingQuery = {
  city?: string;
  neighbourhood?: string;
  types?: readonly string[];
  minPriceCents?: number;
  maxPriceCents?: number;
  minBeds?: number;
  minBaths?: number;
  minAreaSqm?: number;
  minYearBuilt?: number;
  features?: readonly string[];
  status?: HomeListingStatus;
};
export type HomeSlot = { date: string; time: string; free: boolean };
export type HomeViewingRequest = { listingCode: string; agentCode?: string | undefined; date: string; time: string; viewerName: string; viewerEmail: string };

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const minutesOf = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const clock = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const norm = (s: string) => s.trim().toLowerCase();

export function isHomeTime(s: string): boolean {
  return TIME.test(s);
}

/** The start of every 30-minute slot of one agent's day, in order. */
export function homeSlotTimes(day: Pick<HomeAgentDay, "from" | "until">): string[] {
  const out: string[] = [];
  for (let m = minutesOf(day.from); m + HOME_SLOT_MINUTES <= minutesOf(day.until); m += HOME_SLOT_MINUTES) out.push(clock(m));
  return out;
}

/** What a year of owning the listing costs in fees: twelve monthly service fees plus the annual property tax. */
export function homeYearlyCostsCents(l: Pick<HomeListing, "monthlyFeeCents" | "annualTaxCents">): number {
  return l.monthlyFeeCents * 12 + l.annualTaxCents;
}

/** Listings matching every given filter, cheapest first (then by code). */
export function searchHomeListings(listings: readonly HomeListing[], q: HomeListingQuery): HomeListing[] {
  const types = (q.types ?? []).map(norm).filter(Boolean);
  const features = (q.features ?? []).map(norm).filter(Boolean);
  return listings
    .filter(
      (l) =>
        (!q.city || norm(l.city) === norm(q.city)) &&
        (!q.neighbourhood || norm(l.neighbourhood) === norm(q.neighbourhood)) &&
        (types.length === 0 || types.includes(l.type)) &&
        (q.minPriceCents === undefined || l.priceCents >= q.minPriceCents) &&
        (q.maxPriceCents === undefined || l.priceCents <= q.maxPriceCents) &&
        (q.minBeds === undefined || l.beds >= q.minBeds) &&
        (q.minBaths === undefined || l.baths >= q.minBaths) &&
        (q.minAreaSqm === undefined || l.areaSqm >= q.minAreaSqm) &&
        (q.minYearBuilt === undefined || l.yearBuilt >= q.minYearBuilt) &&
        features.every((f) => l.features.includes(f)) &&
        (!q.status || l.status === q.status),
    )
    .sort((x, y) => x.priceCents - y.priceCents || x.code.localeCompare(y.code));
}

/** Whether a requested (not cancelled) viewing holds the agent's slot. */
const holds = (v: HomeViewing, agentCode: string, date: string, time: string) => v.status === "requested" && v.agentCode === agentCode && v.date === date && v.time === time;

/** Every slot of one agent in the window, in time order; a slot is free when no requested viewing holds it. */
export function homeSlotsOf(rows: Pick<HomeRows, "agentDays" | "viewings">, agentCode: string): HomeSlot[] {
  const held = rows.viewings.filter((v) => v.agentCode === agentCode && v.status === "requested");
  return rows.agentDays
    .filter((d) => d.agentCode === agentCode)
    .sort((x, y) => x.date.localeCompare(y.date))
    .flatMap((d) => homeSlotTimes(d).map((time) => ({ date: d.date, time, free: !held.some((v) => v.date === d.date && v.time === time) })));
}

/** The agent's first free slot starting at or after `after` (date + time), or null when every later slot is taken. */
export function homeEarliestFreeSlot(rows: Pick<HomeRows, "agentDays" | "viewings">, agentCode: string, after: { date: string; time: string }): HomeSlot | null {
  const from = `${after.date}T${after.time}`;
  return homeSlotsOf(rows, agentCode).find((s) => s.free && `${s.date}T${s.time}` >= from) ?? null;
}

/**
 * Why a viewing request cannot be taken, or null: the viewer's name, the date
 * and time, the window, the listing (only active ones can be viewed), the
 * slot (one of the listing agent's, and free), and the viewer (no two
 * requested viewings at the same time). The rule every request write is held to.
 */
export function homeViewingProblem(listing: HomeListing, days: readonly HomeAgentDay[], viewings: readonly HomeViewing[], req: HomeViewingRequest): HomeProblem | null {
  if (!req.viewerName.trim()) return { code: "NO_VIEWER_NAME", message: "a viewing request needs the viewer's name" };
  if (!isDate(req.date)) return { code: "BAD_DATE", message: `${req.date} is not a date (YYYY-MM-DD)` };
  if (!isHomeTime(req.time)) return { code: "BAD_TIME", message: `${req.time} is not a time (HH:MM)` };
  if (req.date < HOME_VIEWING_WINDOW.first || req.date > HOME_VIEWING_WINDOW.last) return { code: "OUTSIDE_WINDOW", message: `viewings are taken from ${HOME_VIEWING_WINDOW.first} to ${HOME_VIEWING_WINDOW.last}` };
  if (listing.status !== "active") return { code: "NOT_ACTIVE", message: `${listing.code} is ${listing.status}: only active listings can be viewed` };
  if (req.agentCode && req.agentCode !== listing.agentCode) return { code: "WRONG_AGENT", message: `${listing.code} is shown by ${listing.agentCode}, not ${req.agentCode}` };
  const day = days.find((d) => d.agentCode === listing.agentCode && d.date === req.date);
  if (!day || !homeSlotTimes(day).includes(req.time)) return { code: "NO_SLOT", message: `${listing.agentCode} has no viewing slot at ${req.time} on ${req.date}` };
  if (viewings.some((v) => holds(v, listing.agentCode, req.date, req.time))) return { code: "SLOT_TAKEN", message: `the ${req.time} slot on ${req.date} with ${listing.agentCode} is already taken` };
  const email = norm(req.viewerEmail);
  if (viewings.some((v) => v.status === "requested" && norm(v.viewerEmail) === email && v.date === req.date && v.time === req.time)) return { code: "VIEWER_BUSY", message: `${email} already has a viewing at ${req.time} on ${req.date}` };
  return null;
}
