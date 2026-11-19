import { describe, expect, it } from "vitest";
import { addDays, fitProblem, nightsOf, roomsLeft, searchStays, stayProblem, stayTotalCents } from "../../stays.js";
import type { Booking, Hotel, HotelRows, RoomType } from "../../scenario.js";
import { HOTEL_SIZES, hotelRows } from "./generate.js";
import { webmcpV1 } from "../../webmcp-v1/index.js";
import { CITY_LIST } from "../../acme-v1/names.js";

describe("webmcp-v1 hotels", () => {
  const rows = hotelRows(4242);

  it("is byte-identical for the same seed, and the same rows webmcpV1.generate carries", () => {
    expect(JSON.stringify(hotelRows(4242))).toBe(JSON.stringify(rows));
    expect(JSON.stringify(hotelRows(4243))).not.toBe(JSON.stringify(rows));
    expect(webmcpV1.generate(4242).hotels).toEqual(rows);
  });

  it("has hotels in every city, unique codes and names, and room types that belong to them", () => {
    for (const city of CITY_LIST) {
      const n = rows.hotels.filter((h) => h.city === city).length;
      expect(n).toBeGreaterThanOrEqual(HOTEL_SIZES.hotelsPerCity[0]);
      expect(n).toBeLessThanOrEqual(HOTEL_SIZES.hotelsPerCity[1]);
    }
    expect(new Set(rows.hotels.map((h) => h.code)).size).toBe(rows.hotels.length);
    expect(new Set(rows.hotels.map((h) => h.name)).size).toBe(rows.hotels.length);
    expect(new Set(rows.rooms.map((r) => r.code)).size).toBe(rows.rooms.length);
    const codes = new Set(rows.hotels.map((h) => h.code));
    for (const r of rows.rooms) expect(codes.has(r.hotelCode)).toBe(true);
    for (const h of rows.hotels) {
      expect(h.petsAllowed).toBe(h.petFeeCents !== null);
      expect(h.lateCheckoutUntil === null).toBe(h.lateCheckoutFeeCents === null);
    }
  });

  it("never books a night beyond a room type's rooms, holds every booking to the stay rules, and books some out on purpose", () => {
    const hotel = new Map(rows.hotels.map((h) => [h.code, h]));
    const room = new Map(rows.rooms.map((r) => [r.code, r]));
    for (const b of rows.bookings) {
      const h = hotel.get(b.hotelCode) as Hotel;
      const r = room.get(b.roomCode) as RoomType;
      expect(fitProblem(h, r, b)).toBeNull();
      expect(b.totalCents).toBe(stayTotalCents(h, r, b));
    }
    let bookedOut = 0;
    for (const r of rows.rooms) {
      for (let d = 0; d < 130; d++) {
        const night = addDays("2027-03-01", d);
        const taken = rows.bookings.filter((b) => b.roomCode === r.code && b.status === "confirmed" && nightsOf(b.checkIn, b.nights).includes(night)).length;
        expect(taken).toBeLessThanOrEqual(r.rooms);
        if (taken === r.rooms) bookedOut++;
      }
    }
    expect(bookedOut).toBeGreaterThan(HOTEL_SIZES.soldOutBlocks);
    expect(rows.bookings.some((b) => b.status === "cancelled")).toBe(true);
  });
});

describe("stays rules", () => {
  const hotel: Hotel = { code: "H1", name: "One", city: "Velmora", rating: 4, description: "", amenities: ["wifi", "gym"], petsAllowed: false, petFeeCents: null, lateCheckoutUntil: "14:00", lateCheckoutFeeCents: 2000 };
  const pets: Hotel = { ...hotel, code: "H2", name: "Two", amenities: ["wifi"], petsAllowed: true, petFeeCents: 3000, lateCheckoutUntil: null, lateCheckoutFeeCents: null };
  const room: RoomType = { hotelCode: "H1", code: "H1-DBL", name: "Double room", maxAdults: 2, maxKids: 1, nightlyCents: 10000, rooms: 1 };
  const room2: RoomType = { hotelCode: "H2", code: "H2-DBL", name: "Double room", maxAdults: 2, maxKids: 1, nightlyCents: 8000, rooms: 2 };
  const booking = (roomCode: string, checkIn: string, nights: number, status: Booking["status"] = "confirmed"): Booking => ({
    bookingNo: `B-${checkIn}`, hotelCode: roomCode.slice(0, 2), roomCode, guestName: "G", guestEmail: "g@example.com", checkIn, nights, adults: 1, kids: 0, pets: 0, lateCheckout: false, status, totalCents: 0, createdAt: "",
  });
  const stay = { checkIn: "2027-04-10", nights: 2, adults: 2, kids: 0, pets: 0, lateCheckout: false };

  it("counts a night as taken from check-in up to the day before check-out, and ignores cancelled bookings", () => {
    expect(roomsLeft(room, [booking("H1-DBL", "2027-04-08", 2)], "2027-04-10", 2)).toBe(1);
    expect(roomsLeft(room, [booking("H1-DBL", "2027-04-09", 2)], "2027-04-10", 2)).toBe(0);
    expect(roomsLeft(room, [booking("H1-DBL", "2027-04-11", 1)], "2027-04-10", 2)).toBe(0);
    expect(roomsLeft(room, [booking("H1-DBL", "2027-04-12", 1)], "2027-04-10", 2)).toBe(1);
    expect(roomsLeft(room, [booking("H1-DBL", "2027-04-10", 2, "cancelled")], "2027-04-10", 2)).toBe(1);
  });

  it("refuses each rule on its own", () => {
    expect(stayProblem(hotel, room, stay, [])).toBeNull();
    expect(stayProblem(hotel, room, { ...stay, checkIn: "2026-12-31" }, [])?.code).toBe("OUTSIDE_WINDOW");
    expect(stayProblem(hotel, room, { ...stay, checkIn: "2027-02-30" }, [])?.code).toBe("BAD_DATE");
    expect(stayProblem(hotel, room, { ...stay, nights: 15 }, [])?.code).toBe("BAD_NIGHTS");
    expect(stayProblem(hotel, room, { ...stay, adults: 3 }, [])?.code).toBe("TOO_MANY_GUESTS");
    expect(stayProblem(hotel, room, { ...stay, kids: 2 }, [])?.code).toBe("TOO_MANY_GUESTS");
    expect(stayProblem(hotel, room, { ...stay, pets: 1 }, [])?.code).toBe("NO_PETS");
    expect(stayProblem(pets, room2, { ...stay, lateCheckout: true }, [])?.code).toBe("NO_LATE_CHECKOUT");
    expect(stayProblem(hotel, room, stay, [booking("H1-DBL", "2027-04-11", 1)])?.code).toBe("SOLD_OUT");
  });

  it("totals nights, one pet fee per stay and the late-checkout fee", () => {
    expect(stayTotalCents(hotel, room, { nights: 3, pets: 0, lateCheckout: true })).toBe(32000);
    expect(stayTotalCents(pets, room2, { nights: 3, pets: 2, lateCheckout: false })).toBe(27000);
  });

  it("searches by city, amenities, pets, cap and availability, cheapest first", () => {
    const rows: HotelRows = { hotels: [hotel, pets], rooms: [room, room2], bookings: [] };
    const q = { city: "velmora", checkIn: "2027-04-10", nights: 2, adults: 2, kids: 0, pets: 0 };
    expect(searchStays(rows, q).map((o) => o.hotelCode)).toEqual(["H2", "H1"]);
    expect(searchStays(rows, { ...q, amenities: ["gym"] }).map((o) => o.hotelCode)).toEqual(["H1"]);
    expect(searchStays(rows, { ...q, pets: 1 }).map((o) => [o.hotelCode, o.totalCents])).toEqual([["H2", 19000]]);
    expect(searchStays(rows, { ...q, maxNightlyCents: 9000 }).map((o) => o.hotelCode)).toEqual(["H2"]);
    expect(searchStays({ ...rows, bookings: [booking("H1-DBL", "2027-04-11", 3)] }, q).map((o) => o.hotelCode)).toEqual(["H2"]);
    expect(searchStays(rows, { ...q, city: "Ostrand" })).toEqual([]);
  });
});
