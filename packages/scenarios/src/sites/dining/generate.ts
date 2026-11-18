import { CITY_LIST, FIRST_NAMES, LAST_NAMES, word } from "../../acme-v1/names.js";
import { type Rng, int, pick, substream } from "../../prng.js";
import { addDays } from "../../stays.js";
import { diningClock, diningDepositCents, diningMinutes, diningSeatingTimes, diningTablesLeft } from "./rules.js";
import {
  DINING_AREAS,
  DINING_CUISINES,
  DINING_MENUS,
  DINING_WEEKDAYS,
  type DiningArea,
  type DiningDayHours,
  type DiningReservation,
  type DiningRestaurant,
  type DiningRows,
  type DiningSeating,
  type DiningWeekday,
} from "./types.js";

/**
 * The reservation site's rows: restaurants in the six cities, their seating
 * and reservations already made. Drawn from a stream of its own
 * (`substream(seed, "dining")`), so adding the site moved no other row. Some
 * areas are fully booked at some times on purpose: a search has to check the
 * tables, not just the menus and hours.
 */
export const DINING_SIZES = { restaurantsPerCity: [4, 6], guests: 40, reservations: 170, fullBlocks: 24 } as const;

/** How often each menu and area appears; every restaurant has indoor tables. */
const MENU_ODDS: Record<(typeof DINING_MENUS)[number], number> = { vegetarian: 0.7, vegan: 0.4, "gluten-free": 0.5 };
const AREA_ODDS: Record<DiningArea, number> = { indoor: 1, terrace: 0.55, bar: 0.45, private: 0.35 };
const SUFFIXES = ["Kitchen", "Table", "Dining Room", "Canteen", "House", "Bistro", "Grill", "Eatery"] as const;
const SETTINGS = ["on the market square", "by the river", "near the central station", "on a quiet side street", "in the old town", "above the harbour"] as const;
const NOTES = ["Birthday dinner", "A table by the window if possible", "One guest uses a wheelchair", "We need a high chair", "One guest is allergic to shellfish", "Business dinner, a quiet table please"] as const;
/** Seeded reservations fall in this span, so the reservable year has busy weeks and empty ones. */
const BUSY_FROM = "2027-04-05";
const BUSY_DAYS = 56;

function makeHours(rng: Rng): { closedDay: DiningWeekday; hours: Record<DiningWeekday, DiningDayHours | null> } {
  const closedDay = pick(rng, DINING_WEEKDAYS.filter((d) => d !== "friday" && d !== "saturday"));
  const opens = pick(rng, ["11:30", "12:00", "12:00", "17:00", "17:30"]);
  const closes = diningMinutes(pick(rng, ["22:00", "22:30", "23:00"]));
  const hours = Object.fromEntries(
    DINING_WEEKDAYS.map((d) => {
      if (d === closedDay) return [d, null];
      const late = d === "friday" || d === "saturday" ? Math.min(closes + 60, diningMinutes("23:30")) : d === "sunday" ? closes - 60 : closes;
      return [d, { opens, closes: diningClock(late) }];
    }),
  ) as Record<DiningWeekday, DiningDayHours | null>;
  return { closedDay, hours };
}

function makeSeating(rng: Rng, code: string): DiningSeating[] {
  return DINING_AREAS.filter((a) => rng() < AREA_ODDS[a]).map((area) => {
    if (area === "indoor") return { restaurantCode: code, area, seats: pick(rng, [4, 6]), tables: int(rng, 2, 5) };
    if (area === "terrace") return { restaurantCode: code, area, seats: pick(rng, [2, 4]), tables: int(rng, 1, 3) };
    if (area === "bar") return { restaurantCode: code, area, seats: 2, tables: int(rng, 2, 4) };
    return { restaurantCode: code, area, seats: pick(rng, [8, 10, 12]), tables: 1 };
  });
}

function makeRestaurants(rng: Rng): { restaurants: DiningRestaurant[]; seating: DiningSeating[] } {
  const restaurants: DiningRestaurant[] = [];
  const seating: DiningSeating[] = [];
  const names = new Set<string>();
  let n = 100;
  for (const city of CITY_LIST) {
    const count = int(rng, DINING_SIZES.restaurantsPerCity[0], DINING_SIZES.restaurantsPerCity[1]);
    for (let i = 0; i < count; i++) {
      let name = "";
      do name = `${word(rng)} ${pick(rng, SUFFIXES)}`;
      while (names.has(name));
      names.add(name);
      const code = `RS-${++n}`;
      const cuisine = pick(rng, DINING_CUISINES);
      const { closedDay, hours } = makeHours(rng);
      const areas = makeSeating(rng, code);
      seating.push(...areas);
      restaurants.push({
        code,
        name,
        city,
        cuisine,
        priceLevel: int(rng, 1, 4),
        description: `${name} serves ${cuisine} food ${pick(rng, SETTINGS)} in ${city}.`,
        menus: DINING_MENUS.filter((m) => rng() < MENU_ODDS[m]),
        closedDay,
        hours,
        depositPerGuestCents: rng() < 0.5 ? 0 : int(rng, 1, 5) * 500,
        privateRoomFeeCents: areas.some((a) => a.area === "private") ? int(rng, 5, 20) * 1000 : null,
      });
    }
  }
  return { restaurants, seating };
}

function makeGuests(rng: Rng): { name: string; email: string; phone: string }[] {
  const out = new Map<string, { name: string; email: string; phone: string }>();
  while (out.size < DINING_SIZES.guests) {
    const first = pick(rng, FIRST_NAMES);
    const last = pick(rng, LAST_NAMES);
    const email = `${first}.${last}${int(rng, 1, 9)}@example.com`.toLowerCase();
    if (!out.has(email)) out.set(email, { name: `${first} ${last}`, email, phone: `555-${int(rng, 200, 899)}-${int(rng, 1000, 9999)}` });
  }
  return [...out.values()];
}

export function diningRows(seed: number): DiningRows {
  const rng = substream(seed, "dining");
  const { restaurants, seating } = makeRestaurants(rng);
  const guests = makeGuests(rng);
  const restaurantOf = new Map(restaurants.map((r) => [r.code, r]));
  const reservations: DiningReservation[] = [];
  const reserve = (s: DiningSeating, date: string, time: string, status: DiningReservation["status"]) => {
    const r = restaurantOf.get(s.restaurantCode) as DiningRestaurant;
    const guest = pick(rng, guests);
    const partySize = s.area === "private" ? int(rng, 6, s.seats) : int(rng, Math.min(2, s.seats), s.seats);
    reservations.push({
      reservationNo: `RV-${10001 + reservations.length}`,
      restaurantCode: r.code,
      area: s.area,
      date,
      time,
      partySize,
      guestName: guest.name,
      guestEmail: guest.email,
      guestPhone: guest.phone,
      note: rng() < 0.3 ? pick(rng, NOTES) : "",
      status,
      depositCents: diningDepositCents(r, s.area, partySize),
      createdAt: new Date(Date.UTC(2027, 0, 2 + int(rng, 0, 80), int(rng, 7, 21), int(rng, 0, 59))).toISOString(),
    });
  };
  /** A seating day and time in the busy span, or null on the restaurant's closed day. */
  const when = (s: DiningSeating) => {
    const date = addDays(BUSY_FROM, int(rng, 0, BUSY_DAYS - 1));
    const times = diningSeatingTimes(restaurantOf.get(s.restaurantCode) as DiningRestaurant, date);
    return times.length ? { date, time: pick(rng, times) } : null;
  };
  for (let i = 0; i < DINING_SIZES.reservations; i++) {
    const s = pick(rng, seating);
    const at = when(s);
    const status = rng() < 0.1 ? "cancelled" : "confirmed";
    if (!at || (status === "confirmed" && diningTablesLeft(s, reservations, at.date, at.time) < 1)) continue;
    reserve(s, at.date, at.time, status);
  }
  // Fully booked on purpose: every table of the area taken at one time, by seatings up to half an hour either side of it.
  for (let i = 0; i < DINING_SIZES.fullBlocks; i++) {
    const s = pick(rng, seating);
    const at = when(s);
    if (!at) continue;
    const times = diningSeatingTimes(restaurantOf.get(s.restaurantCode) as DiningRestaurant, at.date);
    while (diningTablesLeft(s, reservations, at.date, at.time) > 0) {
      const near = diningClock(diningMinutes(at.time) + pick(rng, [-30, 0, 0, 30]));
      reserve(s, at.date, times.includes(near) && diningTablesLeft(s, reservations, at.date, near) > 0 ? near : at.time, "confirmed");
    }
  }
  return { restaurants, seating, reservations };
}
