/**
 * The restaurant reservation site (apps/dining). Restaurants in the cities of
 * CITY_LIST, their seating (tables per area), and reservations already made.
 * A reservation holds one table of its area for two hours from a half-hour
 * seating time. Rules: ./rules.ts.
 */

/** Seating areas, in the order the site lists them. */
export const DINING_AREAS = ["indoor", "terrace", "bar", "private"] as const;
export type DiningArea = (typeof DINING_AREAS)[number];

/** Dietary menus a restaurant may offer besides its regular one. */
export const DINING_MENUS = ["vegetarian", "vegan", "gluten-free"] as const;
export type DiningMenu = (typeof DINING_MENUS)[number];

export const DINING_CUISINES = ["french", "italian", "japanese", "indian", "mexican", "greek", "thai", "lebanese"] as const;

/** Monday first, as the site lists opening hours. */
export const DINING_WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
export type DiningWeekday = (typeof DINING_WEEKDAYS)[number];

/** One day's opening hours, "HH:MM" on the half hour. */
export type DiningDayHours = { opens: string; closes: string };

export type DiningRestaurant = {
  code: string;
  name: string;
  city: string;
  cuisine: string;
  /** 1 (inexpensive) to 4 (expensive); the pages print it as $ to $$$$. */
  priceLevel: number;
  description: string;
  menus: string[];
  /** The one weekday it is closed; `hours[closedDay]` is null. */
  closedDay: DiningWeekday;
  hours: Record<DiningWeekday, DiningDayHours | null>;
  /** Charged per guest when the reservation is made; 0 where no deposit is asked. */
  depositPerGuestCents: number;
  /** A flat fee added to the deposit of a private-room reservation; null where there is no private room. */
  privateRoomFeeCents: number | null;
};

/** A restaurant's tables in one area: `tables` tables, each seating up to `seats`. */
export type DiningSeating = { restaurantCode: string; area: DiningArea; seats: number; tables: number };

export type DiningReservationStatus = "confirmed" | "cancelled";
export type DiningReservation = {
  reservationNo: string;
  restaurantCode: string;
  area: DiningArea;
  /** "YYYY-MM-DD". */
  date: string;
  /** The seating time, "HH:MM" on the half hour; the table is held for two hours from it. */
  time: string;
  partySize: number;
  guestName: string;
  guestEmail: string;
  guestPhone: string;
  /** The special request, "" when there is none. */
  note: string;
  status: DiningReservationStatus;
  depositCents: number;
  createdAt: string;
};

export type DiningRows = { restaurants: DiningRestaurant[]; seating: DiningSeating[]; reservations: DiningReservation[] };
