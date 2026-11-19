import { isDate } from "../../stays.js";
import { DINING_AREAS, DINING_WEEKDAYS, type DiningArea, type DiningDayHours, type DiningReservation, type DiningRestaurant, type DiningRows, type DiningSeating, type DiningWeekday } from "./types.js";

/**
 * The reservation site's rules, as pure functions over rows. apps/dining
 * enforces them on every write and answers every search with them, and the
 * intent corpus derives its answer keys from them, so the site and the keys
 * cannot disagree about what is free or what a deposit is.
 */

/** The dates the site takes reservations for. Fixed, not "from today", so a seed means the same evenings forever. */
export const DINING_WINDOW = { first: "2027-01-01", last: "2027-12-31" } as const;
/** How long a reservation holds its table. */
export const DINING_HOLD_MINUTES = 120;
/** Seating times are on the hour and the half hour. */
export const DINING_SLOT_MINUTES = 30;
/** Larger parties are not booked online. */
export const DINING_MAX_PARTY = 12;

export type DiningProblem = { code: string; message: string };
/** What a reservation asks for: one table in one area, for a party, from a seating time. */
export type DiningRequest = { date: string; time: string; partySize: number; area: DiningArea };
export type DiningQuery = {
  city: string;
  date: string;
  time: string;
  partySize: number;
  area?: DiningArea;
  cuisine?: string;
  /** Dietary menus the restaurant must offer, every one of them. */
  menus?: readonly string[];
  maxPriceLevel?: number;
};
/** One area of one restaurant with a table free for the party for the two hours from the asked time. */
export type DiningOffer = { restaurantCode: string; restaurantName: string; cuisine: string; priceLevel: number; area: DiningArea; seats: number; tablesLeft: number; depositCents: number };
export type DiningSlot = { area: DiningArea; time: string; tablesLeft: number };

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const AREA_LABEL: Record<DiningArea, string> = { indoor: "indoor", terrace: "terrace", bar: "bar", private: "private room" };

/** "HH:MM" with a real hour and minute (any minute; seating times are checked separately). */
export function diningIsTime(s: string): boolean {
  return TIME.test(s);
}

export function diningMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function diningClock(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export function diningAreaLabel(area: DiningArea): string {
  return AREA_LABEL[area];
}

export function diningWeekdayOf(date: string): DiningWeekday {
  const sundayFirst = new Date(`${date}T00:00:00Z`).getUTCDay();
  return DINING_WEEKDAYS[(sundayFirst + 6) % 7] as DiningWeekday;
}

/** The latest seating of a day: the table is held two hours, and the meal ends by closing time. */
export function diningLastSeating(h: DiningDayHours): string {
  return diningClock(diningMinutes(h.closes) - DINING_HOLD_MINUTES);
}

/** Every seating time on a date: each half hour from opening to the last seating. None on the closed day. */
export function diningSeatingTimes(r: DiningRestaurant, date: string): string[] {
  if (!isDate(date)) return [];
  const h = r.hours[diningWeekdayOf(date)];
  if (!h) return [];
  const out: string[] = [];
  for (let m = diningMinutes(h.opens); m <= diningMinutes(h.closes) - DINING_HOLD_MINUTES; m += DINING_SLOT_MINUTES) out.push(diningClock(m));
  return out;
}

/**
 * Tables of the area still free for the WHOLE two hours from `time` on `date`:
 * the area's tables less the most reservations holding one at any half hour of
 * that span. Cancelled reservations hold nothing; `exceptNo` leaves one
 * reservation out (a change is checked against the others).
 */
export function diningTablesLeft(seating: DiningSeating, reservations: readonly DiningReservation[], date: string, time: string, exceptNo?: string): number {
  const held = reservations.filter(
    (r) => r.restaurantCode === seating.restaurantCode && r.area === seating.area && r.date === date && r.status === "confirmed" && r.reservationNo !== exceptNo,
  );
  const start = diningMinutes(time);
  let least = seating.tables;
  for (let at = start; at < start + DINING_HOLD_MINUTES; at += DINING_SLOT_MINUTES) {
    const taken = held.filter((r) => diningMinutes(r.time) <= at && at < diningMinutes(r.time) + DINING_HOLD_MINUTES).length;
    least = Math.min(least, seating.tables - taken);
  }
  return Math.max(0, least);
}

/** Deposit taken when the reservation is made: per guest, plus the private-room fee for the private room. */
export function diningDepositCents(r: DiningRestaurant, area: DiningArea, partySize: number): number {
  return partySize * r.depositPerGuestCents + (area === "private" ? (r.privateRoomFeeCents ?? 0) : 0);
}

const day = (d: DiningWeekday) => `${d[0]!.toUpperCase()}${d.slice(1)}s`;

/** Why the restaurant cannot seat the request at all, before availability: date, time, party, opening hours, area, table size. */
export function diningFitProblem(r: DiningRestaurant, seating: DiningSeating | undefined, q: DiningRequest): DiningProblem | null {
  if (!isDate(q.date)) return { code: "BAD_DATE", message: `${q.date} is not a date (YYYY-MM-DD)` };
  if (q.date < DINING_WINDOW.first || q.date > DINING_WINDOW.last) return { code: "OUTSIDE_WINDOW", message: `reservations are taken for dates from ${DINING_WINDOW.first} to ${DINING_WINDOW.last}` };
  if (!diningIsTime(q.time) || diningMinutes(q.time) % DINING_SLOT_MINUTES !== 0) return { code: "BAD_TIME", message: `seating times are on the hour or the half hour (HH:00 or HH:30), not ${q.time}` };
  if (!Number.isInteger(q.partySize) || q.partySize < 1) return { code: "BAD_PARTY", message: "a reservation is for at least one guest" };
  if (q.partySize > DINING_MAX_PARTY) return { code: "PARTY_LIMIT", message: `parties of more than ${DINING_MAX_PARTY} are not booked online` };
  const weekday = diningWeekdayOf(q.date);
  const h = r.hours[weekday];
  if (!h) return { code: "CLOSED", message: `${r.name} is closed on ${day(weekday)}` };
  if (diningMinutes(q.time) < diningMinutes(h.opens) || diningMinutes(q.time) > diningMinutes(h.closes) - DINING_HOLD_MINUTES) {
    return { code: "OUTSIDE_HOURS", message: `${r.name} seats guests from ${h.opens} to ${diningLastSeating(h)} on ${day(weekday)}: it closes at ${h.closes} and a table is held for 2 hours` };
  }
  if (!seating) return { code: "NO_AREA", message: `${r.name} has no ${AREA_LABEL[q.area]} seating` };
  if (q.partySize > seating.seats) return { code: "TABLE_TOO_SMALL", message: `the ${AREA_LABEL[q.area]} tables at ${r.name} seat at most ${seating.seats}` };
  return null;
}

/** diningFitProblem, then whether a table of the area is free for the two hours. The rule every reservation write is held to. */
export function diningReservationProblem(r: DiningRestaurant, seating: DiningSeating | undefined, q: DiningRequest, reservations: readonly DiningReservation[], exceptNo?: string): DiningProblem | null {
  const fit = diningFitProblem(r, seating, q);
  if (fit) return fit;
  if (diningTablesLeft(seating as DiningSeating, reservations, q.date, q.time, exceptNo) < 1) {
    return { code: "FULL", message: `no ${AREA_LABEL[q.area]} table is free at ${r.name} on ${q.date} for 2 hours from ${q.time}` };
  }
  return null;
}

const areaOrder = (a: DiningArea) => DINING_AREAS.indexOf(a);
const seatingOf = (rows: Pick<DiningRows, "seating">, code: string) => rows.seating.filter((s) => s.restaurantCode === code).sort((x, y) => areaOrder(x.area) - areaOrder(y.area));

/**
 * Every area of every restaurant in the city — of the cuisine, offering every
 * asked menu, at no more than the price level — with a table that seats the
 * party and is free for the two hours from the asked time. Restaurant code
 * order, then area order.
 */
export function diningSearch(rows: DiningRows, q: DiningQuery): DiningOffer[] {
  const city = q.city.trim().toLowerCase();
  const cuisine = q.cuisine?.trim().toLowerCase();
  const menus = (q.menus ?? []).map((m) => m.trim().toLowerCase()).filter(Boolean);
  const offers: DiningOffer[] = [];
  for (const r of [...rows.restaurants].sort((x, y) => x.code.localeCompare(y.code))) {
    if (r.city.toLowerCase() !== city || (cuisine && r.cuisine !== cuisine)) continue;
    if (!menus.every((m) => r.menus.includes(m)) || (q.maxPriceLevel !== undefined && r.priceLevel > q.maxPriceLevel)) continue;
    for (const s of seatingOf(rows, r.code)) {
      if (q.area && s.area !== q.area) continue;
      if (diningFitProblem(r, s, { date: q.date, time: q.time, partySize: q.partySize, area: s.area })) continue;
      const left = diningTablesLeft(s, rows.reservations, q.date, q.time);
      if (left < 1) continue;
      offers.push({ restaurantCode: r.code, restaurantName: r.name, cuisine: r.cuisine, priceLevel: r.priceLevel, area: s.area, seats: s.seats, tablesLeft: left, depositCents: diningDepositCents(r, s.area, q.partySize) });
    }
  }
  return offers;
}

/**
 * One restaurant's day for a party: for each area whose tables seat it, every
 * seating time and how many of its tables are free for the two hours from it
 * (0 when full). Empty on the closed day or a date the site does not take.
 */
export function diningAvailability(r: DiningRestaurant, rows: Pick<DiningRows, "seating" | "reservations">, date: string, partySize: number): DiningSlot[] {
  const slots: DiningSlot[] = [];
  for (const s of seatingOf(rows, r.code)) {
    for (const time of diningSeatingTimes(r, date)) {
      if (diningFitProblem(r, s, { date, time, partySize, area: s.area })) continue;
      slots.push({ area: s.area, time, tablesLeft: diningTablesLeft(s, rows.reservations, date, time) });
    }
  }
  return slots;
}
