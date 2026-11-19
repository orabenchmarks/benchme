import { type Rng, int, pick, shuffle, substream } from "../../prng.js";
import type { Booking, Hotel, HotelRows, RoomType } from "../../scenario.js";
import { addDays, roomsLeft, stayTotalCents } from "../../stays.js";
import { CITY_LIST, FIRST_NAMES, LAST_NAMES, word } from "../../acme-v1/names.js";

/**
 * The hotel booking site's rows: hotels in six cities (every depot's city among
 * them), their room types, and bookings already made. Drawn from a stream of its
 * own (`substream(seed, "hotels")`), so adding the site moved no warehouse,
 * helpdesk or vault row. Some room types are booked out for a few nights on
 * purpose: a search has to check availability, not just prices.
 */
export const HOTEL_SIZES = { hotelsPerCity: [4, 6], guests: 40, bookings: 160, soldOutBlocks: 10 } as const;

export const AMENITIES = ["wifi", "gym", "breakfast", "spa", "pool", "free parking", "washer", "restaurant", "airport shuttle"] as const;
/** How often each amenity appears; wifi is everywhere. */
const AMENITY_ODDS: Record<(typeof AMENITIES)[number], number> = { wifi: 1, gym: 0.6, breakfast: 0.5, spa: 0.3, pool: 0.35, "free parking": 0.4, washer: 0.25, restaurant: 0.5, "airport shuttle": 0.2 };
const SUFFIXES = ["Hotel", "Inn", "Suites", "Lodge", "House", "Residences"] as const;
const ROOM_KINDS = [
  { key: "SGL", name: "Single room", maxAdults: 1, maxKids: 0, factor: 0.8 },
  { key: "DBL", name: "Double room", maxAdults: 2, maxKids: 1, factor: 1 },
  { key: "KNG", name: "King room", maxAdults: 2, maxKids: 2, factor: 1.25 },
  { key: "FAM", name: "Family suite", maxAdults: 4, maxKids: 3, factor: 1.6 },
] as const;
const SETTINGS = ["a short walk from the old market", "beside the river", "near the central station", "on a quiet residential street", "next to the convention hall", "in the business district"] as const;
/** Seeded stays start in this span, so the bookable year has busy weeks and empty ones. */
const BUSY_FROM = "2027-03-01";
const BUSY_DAYS = 120;

const roundTo5Dollars = (cents: number) => Math.max(500, Math.round(cents / 500) * 500);

function makeHotels(rng: Rng): Hotel[] {
  const out: Hotel[] = [];
  const names = new Set<string>();
  let n = 100;
  for (const city of CITY_LIST) {
    const count = int(rng, HOTEL_SIZES.hotelsPerCity[0], HOTEL_SIZES.hotelsPerCity[1]);
    for (let i = 0; i < count; i++) {
      let name = "";
      do name = `${word(rng)} ${pick(rng, SUFFIXES)}`;
      while (names.has(name));
      names.add(name);
      const amenities = AMENITIES.filter((a) => rng() < AMENITY_ODDS[a]);
      const petsAllowed = rng() < 0.35;
      const late = rng() < 0.45;
      out.push({
        code: `HT-${++n}`,
        name,
        city,
        rating: Math.round((3.2 + rng() * 1.7) * 10) / 10,
        description: `${name} is ${pick(rng, SETTINGS)} in ${city}.`,
        amenities,
        petsAllowed,
        petFeeCents: petsAllowed ? int(rng, 2, 6) * 1000 : null,
        lateCheckoutUntil: late ? pick(rng, ["13:00", "14:00", "15:00"]) : null,
        lateCheckoutFeeCents: late ? int(rng, 2, 8) * 500 : null,
      });
    }
  }
  return out;
}

function makeRooms(rng: Rng, hotels: Hotel[]): RoomType[] {
  return hotels.flatMap((h) => {
    const base = int(rng, 9, 26) * 1000;
    const kinds = shuffle(rng, ROOM_KINDS).slice(0, int(rng, 2, 3));
    return ROOM_KINDS.filter((k) => kinds.includes(k)).map((k) => ({
      hotelCode: h.code,
      code: `${h.code}-${k.key}`,
      name: k.name,
      maxAdults: k.maxAdults,
      maxKids: k.maxKids,
      nightlyCents: roundTo5Dollars(base * k.factor),
      rooms: int(rng, 1, 4),
    }));
  });
}

function makeGuests(rng: Rng): { name: string; email: string }[] {
  const out = new Map<string, { name: string; email: string }>();
  while (out.size < HOTEL_SIZES.guests) {
    const first = pick(rng, FIRST_NAMES);
    const last = pick(rng, LAST_NAMES);
    const email = `${first}.${last}${int(rng, 1, 9)}@example.com`.toLowerCase();
    if (!out.has(email)) out.set(email, { name: `${first} ${last}`, email });
  }
  return [...out.values()];
}

export function hotelRows(seed: number): HotelRows {
  const rng = substream(seed, "hotels");
  const hotels = makeHotels(rng);
  const rooms = makeRooms(rng, hotels);
  const guests = makeGuests(rng);
  const hotelOf = new Map(hotels.map((h) => [h.code, h]));
  const bookings: Booking[] = [];
  const book = (room: RoomType, checkIn: string, nights: number, status: Booking["status"]) => {
    const hotel = hotelOf.get(room.hotelCode) as Hotel;
    const guest = pick(rng, guests);
    const adults = int(rng, 1, room.maxAdults);
    const kids = room.maxKids > 0 && rng() < 0.3 ? int(rng, 1, room.maxKids) : 0;
    const pets = hotel.petsAllowed && rng() < 0.2 ? 1 : 0;
    const lateCheckout = !!hotel.lateCheckoutUntil && rng() < 0.25;
    bookings.push({
      bookingNo: `BK-${10001 + bookings.length}`,
      hotelCode: hotel.code,
      roomCode: room.code,
      guestName: guest.name,
      guestEmail: guest.email,
      checkIn,
      nights,
      adults,
      kids,
      pets,
      lateCheckout,
      status,
      totalCents: stayTotalCents(hotel, room, { nights, pets, lateCheckout }),
      createdAt: new Date(Date.UTC(2027, 0, 2 + int(rng, 0, 50), int(rng, 7, 21), int(rng, 0, 59))).toISOString(),
    });
  };
  for (let i = 0; i < HOTEL_SIZES.bookings; i++) {
    const room = pick(rng, rooms);
    const checkIn = addDays(BUSY_FROM, int(rng, 0, BUSY_DAYS - 1));
    const nights = int(rng, 1, 5);
    const status = rng() < 0.1 ? "cancelled" : "confirmed";
    if (status === "confirmed" && roomsLeft(room, bookings, checkIn, nights) < 1) continue;
    book(room, checkIn, nights, status);
  }
  // Booked out on purpose: every room of the type taken for a few nights.
  for (let i = 0; i < HOTEL_SIZES.soldOutBlocks; i++) {
    const room = pick(rng, rooms);
    const checkIn = addDays(BUSY_FROM, int(rng, 0, BUSY_DAYS - 1));
    const nights = int(rng, 2, 4);
    while (roomsLeft(room, bookings, checkIn, nights) > 0) book(room, checkIn, nights, "confirmed");
  }
  return { hotels, rooms, bookings };
}
