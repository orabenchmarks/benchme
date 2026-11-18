import type { Booking, Hotel, HotelRows, RoomType } from "./scenario.js";

/**
 * The hotel site's booking rules, as pure functions over rows. apps/hotels
 * enforces them on every write and answers every search with them, and the
 * intent corpus derives its answer keys from them, so the site and the keys
 * cannot disagree about what is bookable or what a stay costs.
 */

/** The check-in dates the site takes bookings for. Fixed, not "from today", so a seed means the same stays forever. */
export const STAY_WINDOW = { first: "2027-01-01", last: "2027-12-31" } as const;
export const MAX_NIGHTS = 14;

export type Stay = { checkIn: string; nights: number; adults: number; kids: number; pets: number; lateCheckout: boolean };
export type StayProblem = { code: string; message: string };
export type StayQuery = { city: string; checkIn: string; nights: number; adults: number; kids: number; pets: number; maxNightlyCents?: number; amenities?: readonly string[] };
/** One hotel's cheapest room that fits a query. `totalCents` includes the pet fee when pets come; late checkout is not part of a search. */
export type StayOffer = { hotelCode: string; hotelName: string; roomCode: string; roomName: string; nightlyCents: number; totalCents: number; roomsLeft: number };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isDate(s: string): boolean {
  if (!DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The nights a stay occupies, by date: check-in up to the day before check-out. */
export function nightsOf(checkIn: string, nights: number): string[] {
  return Array.from({ length: nights }, (_, i) => addDays(checkIn, i));
}

export function checkOutOf(checkIn: string, nights: number): string {
  return addDays(checkIn, nights);
}

/** Rooms of this type still free on EVERY night of the stay. Cancelled bookings hold nothing. */
export function roomsLeft(room: RoomType, bookings: readonly Booking[], checkIn: string, nights: number): number {
  const held = bookings.filter((b) => b.roomCode === room.code && b.status === "confirmed");
  let least = room.rooms;
  for (const night of nightsOf(checkIn, nights)) {
    const taken = held.filter((b) => b.checkIn <= night && night < checkOutOf(b.checkIn, b.nights)).length;
    least = Math.min(least, room.rooms - taken);
  }
  return Math.max(0, least);
}

export function stayTotalCents(hotel: Hotel, room: RoomType, stay: Pick<Stay, "nights" | "pets" | "lateCheckout">): number {
  return room.nightlyCents * stay.nights + (stay.pets > 0 ? (hotel.petFeeCents ?? 0) : 0) + (stay.lateCheckout ? (hotel.lateCheckoutFeeCents ?? 0) : 0);
}

/** Why the room cannot take the party for those nights at all, before availability: dates, length, capacity, pets, late checkout. */
export function fitProblem(hotel: Hotel, room: RoomType, stay: Stay): StayProblem | null {
  if (!isDate(stay.checkIn)) return { code: "BAD_DATE", message: `check-in ${stay.checkIn} is not a date (YYYY-MM-DD)` };
  if (stay.checkIn < STAY_WINDOW.first || stay.checkIn > STAY_WINDOW.last) return { code: "OUTSIDE_WINDOW", message: `bookings are taken for check-in dates from ${STAY_WINDOW.first} to ${STAY_WINDOW.last}` };
  if (!Number.isInteger(stay.nights) || stay.nights < 1 || stay.nights > MAX_NIGHTS) return { code: "BAD_NIGHTS", message: `a stay is 1 to ${MAX_NIGHTS} nights` };
  if (stay.adults < 1) return { code: "NO_ADULT", message: "a booking needs at least one adult" };
  if (stay.adults > room.maxAdults || stay.kids > room.maxKids) return { code: "TOO_MANY_GUESTS", message: `the ${room.name} at ${hotel.name} sleeps at most ${room.maxAdults} adults and ${room.maxKids} children` };
  if (stay.pets > 0 && !hotel.petsAllowed) return { code: "NO_PETS", message: `${hotel.name} does not allow pets` };
  if (stay.lateCheckout && !hotel.lateCheckoutUntil) return { code: "NO_LATE_CHECKOUT", message: `${hotel.name} does not offer late checkout` };
  return null;
}

/** fitProblem, then whether a room of the type is free every night. The rule every booking write is held to. */
export function stayProblem(hotel: Hotel, room: RoomType, stay: Stay, bookings: readonly Booking[]): StayProblem | null {
  const fit = fitProblem(hotel, room, stay);
  if (fit) return fit;
  if (roomsLeft(room, bookings, stay.checkIn, stay.nights) < 1) return { code: "SOLD_OUT", message: `no ${room.name} is free at ${hotel.name} for ${stay.nights} night(s) from ${stay.checkIn}` };
  return null;
}

/**
 * Every hotel in the city with all the asked amenities (and allowing pets when
 * pets come) that has a room fitting the party, free every night, at no more
 * than the nightly cap — each hotel's cheapest such room, cheapest first.
 */
export function searchStays(rows: HotelRows, q: StayQuery): StayOffer[] {
  const city = q.city.trim().toLowerCase();
  const wanted = (q.amenities ?? []).map((a) => a.trim().toLowerCase()).filter(Boolean);
  const stay: Stay = { checkIn: q.checkIn, nights: q.nights, adults: q.adults, kids: q.kids, pets: q.pets, lateCheckout: false };
  const offers: StayOffer[] = [];
  for (const hotel of rows.hotels) {
    if (hotel.city.toLowerCase() !== city) continue;
    if (!wanted.every((a) => hotel.amenities.includes(a))) continue;
    const fitting = rows.rooms
      .filter((r) => r.hotelCode === hotel.code && (q.maxNightlyCents === undefined || r.nightlyCents <= q.maxNightlyCents) && !fitProblem(hotel, r, stay))
      .map((r) => ({ room: r, left: roomsLeft(r, rows.bookings, q.checkIn, q.nights) }))
      .filter((x) => x.left > 0)
      .sort((x, y) => x.room.nightlyCents - y.room.nightlyCents || x.room.code.localeCompare(y.room.code));
    const best = fitting[0];
    if (!best) continue;
    offers.push({ hotelCode: hotel.code, hotelName: hotel.name, roomCode: best.room.code, roomName: best.room.name, nightlyCents: best.room.nightlyCents, totalCents: stayTotalCents(hotel, best.room, stay), roomsLeft: best.left });
  }
  return offers.sort((x, y) => x.nightlyCents - y.nightlyCents || x.hotelCode.localeCompare(y.hotelCode));
}
