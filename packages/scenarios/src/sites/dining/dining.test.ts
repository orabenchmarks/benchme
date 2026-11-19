import { describe, expect, it } from "vitest";
import { webmcpV1 } from "../../webmcp-v1/index.js";
import { CITY_LIST } from "../../acme-v1/names.js";
import { hotelRows } from "../hotels/generate.js";
import { addDays } from "../../stays.js";
import { DINING_SIZES, diningRows } from "./generate.js";
import {
  diningAvailability,
  diningDepositCents,
  diningFitProblem,
  diningReservationProblem,
  diningSearch,
  diningSeatingTimes,
  diningTablesLeft,
  diningWeekdayOf,
} from "./rules.js";
import { DINING_WEEKDAYS, type DiningReservation, type DiningRestaurant, type DiningRows, type DiningSeating } from "./types.js";

describe("webmcp-v1 dining", () => {
  const rows = diningRows(4242);
  const restaurant = new Map(rows.restaurants.map((r) => [r.code, r]));
  const seatingOf = (code: string, area: string) => rows.seating.find((s) => s.restaurantCode === code && s.area === area);

  it("is byte-identical for the same seed, the rows webmcpV1.generate carries, and moved no hotel row", () => {
    expect(JSON.stringify(diningRows(4242))).toBe(JSON.stringify(rows));
    expect(JSON.stringify(diningRows(4243))).not.toBe(JSON.stringify(rows));
    const all = webmcpV1.generate(4242);
    expect(all.dining).toEqual(rows);
    expect(all.hotels).toEqual(hotelRows(4242));
  });

  it("has restaurants in every city, unique codes and names, seating that belongs to them, and one closed day each", () => {
    for (const city of CITY_LIST) {
      const n = rows.restaurants.filter((r) => r.city === city).length;
      expect(n).toBeGreaterThanOrEqual(DINING_SIZES.restaurantsPerCity[0]);
      expect(n).toBeLessThanOrEqual(DINING_SIZES.restaurantsPerCity[1]);
    }
    expect(new Set(rows.restaurants.map((r) => r.code)).size).toBe(rows.restaurants.length);
    expect(new Set(rows.restaurants.map((r) => r.name)).size).toBe(rows.restaurants.length);
    expect(new Set(rows.seating.map((s) => `${s.restaurantCode}:${s.area}`)).size).toBe(rows.seating.length);
    for (const s of rows.seating) expect(restaurant.has(s.restaurantCode)).toBe(true);
    for (const r of rows.restaurants) {
      expect(seatingOf(r.code, "indoor")).toBeDefined();
      expect(r.privateRoomFeeCents !== null).toBe(!!seatingOf(r.code, "private"));
      expect(DINING_WEEKDAYS.filter((d) => r.hours[d] === null)).toEqual([r.closedDay]);
    }
  });

  it("holds every reservation to the rules, never seats an area beyond its tables, and fills some on purpose", () => {
    for (const b of rows.reservations) {
      const r = restaurant.get(b.restaurantCode) as DiningRestaurant;
      expect(diningFitProblem(r, seatingOf(b.restaurantCode, b.area), b)).toBeNull();
      expect(b.depositCents).toBe(diningDepositCents(r, b.area, b.partySize));
      // Left out of the count, each confirmed reservation still had a table: no area is over-seated.
      if (b.status === "confirmed") expect(diningTablesLeft(seatingOf(b.restaurantCode, b.area) as DiningSeating, rows.reservations, b.date, b.time, b.reservationNo)).toBeGreaterThan(0);
    }
    const full = rows.reservations.filter((b) => b.status === "confirmed" && diningTablesLeft(seatingOf(b.restaurantCode, b.area) as DiningSeating, rows.reservations, b.date, b.time) === 0);
    expect(new Set(full.map((b) => `${b.restaurantCode}:${b.area}:${b.date}`)).size).toBeGreaterThanOrEqual(DINING_SIZES.fullBlocks / 2);
    expect(rows.reservations.some((b) => b.status === "cancelled")).toBe(true);
    const perGuest = new Map<string, number>();
    for (const b of rows.reservations) perGuest.set(b.guestEmail, (perGuest.get(b.guestEmail) ?? 0) + 1);
    expect(Math.max(...perGuest.values())).toBeGreaterThanOrEqual(3);
  });
});

describe("dining rules", () => {
  const hours = { opens: "17:00", closes: "22:00" };
  const r: DiningRestaurant = {
    code: "R1", name: "One", city: "Velmora", cuisine: "greek", priceLevel: 2, description: "", menus: ["vegan"], closedDay: "monday",
    hours: { monday: null, tuesday: hours, wednesday: hours, thursday: hours, friday: hours, saturday: hours, sunday: hours },
    depositPerGuestCents: 1000, privateRoomFeeCents: 5000,
  };
  const r2: DiningRestaurant = { ...r, code: "R2", name: "Two", cuisine: "thai", priceLevel: 4, menus: ["vegan", "gluten-free"], depositPerGuestCents: 0, privateRoomFeeCents: null };
  const terrace: DiningSeating = { restaurantCode: "R1", area: "terrace", seats: 4, tables: 2 };
  const terrace2: DiningSeating = { restaurantCode: "R2", area: "terrace", seats: 6, tables: 1 };
  const room: DiningSeating = { restaurantCode: "R1", area: "private", seats: 10, tables: 1 };
  const held = (no: string, time: string, status: DiningReservation["status"] = "confirmed", restaurantCode = "R1"): DiningReservation => ({
    reservationNo: no, restaurantCode, area: "terrace", date: "2027-05-12", time, partySize: 2, guestName: "G", guestEmail: "g@example.com", guestPhone: "5550000000", note: "", status, depositCents: 0, createdAt: "",
  });
  // 2027-05-12 is a Wednesday; 2027-05-10 a Monday.
  const q = { date: "2027-05-12", time: "19:00", partySize: 4, area: "terrace" as const };

  it("reads weekdays and seating times from the hours", () => {
    expect(diningWeekdayOf("2027-05-10")).toBe("monday");
    expect(diningSeatingTimes(r, "2027-05-10")).toEqual([]);
    expect(diningSeatingTimes(r, "2027-05-12")).toEqual(["17:00", "17:30", "18:00", "18:30", "19:00", "19:30", "20:00"]);
  });

  it("holds a table for two hours from its seating time, counts the busiest half hour, and ignores cancelled reservations", () => {
    expect(diningTablesLeft(terrace, [held("A", "17:00")], q.date, "19:00")).toBe(2);
    expect(diningTablesLeft(terrace, [held("A", "17:30")], q.date, "19:00")).toBe(1);
    expect(diningTablesLeft(terrace, [held("A", "20:30")], q.date, "19:00")).toBe(1);
    expect(diningTablesLeft(terrace, [held("A", "21:00")], q.date, "19:00")).toBe(2);
    // Two that never overlap each other leave one table free all the way through.
    expect(diningTablesLeft(terrace, [held("A", "17:30"), held("B", "20:30")], q.date, "19:00")).toBe(1);
    expect(diningTablesLeft(terrace, [held("A", "18:30"), held("B", "19:30")], q.date, "19:00")).toBe(0);
    expect(diningTablesLeft(terrace, [held("A", "19:00", "cancelled"), held("B", "19:00")], q.date, "19:00")).toBe(1);
    expect(diningTablesLeft(terrace, [held("A", "19:00"), held("B", "19:00")], q.date, "19:00", "A")).toBe(1);
    expect(diningTablesLeft(terrace, [held("A", "19:00", "confirmed", "R2")], q.date, "19:00")).toBe(2);
  });

  it("refuses each rule on its own", () => {
    const full = [held("A", "18:30"), held("B", "19:30")];
    expect(diningReservationProblem(r, terrace, q, [])).toBeNull();
    expect(diningReservationProblem(r, terrace, { ...q, date: "2027-02-30" }, [])?.code).toBe("BAD_DATE");
    expect(diningReservationProblem(r, terrace, { ...q, date: "2028-01-05" }, [])?.code).toBe("OUTSIDE_WINDOW");
    expect(diningReservationProblem(r, terrace, { ...q, time: "19:15" }, [])?.code).toBe("BAD_TIME");
    expect(diningReservationProblem(r, terrace, { ...q, partySize: 0 }, [])?.code).toBe("BAD_PARTY");
    expect(diningReservationProblem(r, room, { ...q, area: "private", partySize: 13 }, [])?.code).toBe("PARTY_LIMIT");
    expect(diningReservationProblem(r, terrace, { ...q, date: "2027-05-10" }, [])?.code).toBe("CLOSED");
    expect(diningReservationProblem(r, terrace, { ...q, time: "16:30" }, [])?.code).toBe("OUTSIDE_HOURS");
    expect(diningReservationProblem(r, terrace, { ...q, time: "20:00" }, [])).toBeNull();
    expect(diningReservationProblem(r, terrace, { ...q, time: "20:30" }, [])?.code).toBe("OUTSIDE_HOURS");
    expect(diningReservationProblem(r, undefined, { ...q, area: "bar" }, [])?.code).toBe("NO_AREA");
    expect(diningReservationProblem(r, terrace, { ...q, partySize: 5 }, [])?.code).toBe("TABLE_TOO_SMALL");
    expect(diningReservationProblem(r, terrace, q, full)?.code).toBe("FULL");
    expect(diningReservationProblem(r, terrace, q, full, "A")).toBeNull();
  });

  it("takes a deposit per guest plus the private-room fee", () => {
    expect(diningDepositCents(r, "terrace", 4)).toBe(4000);
    expect(diningDepositCents(r, "private", 8)).toBe(13000);
    expect(diningDepositCents(r2, "terrace", 4)).toBe(0);
  });

  it("searches by city, cuisine, menus, price level, area, party and free tables", () => {
    const rows: DiningRows = { restaurants: [r, r2], seating: [terrace, room, terrace2], reservations: [] };
    const base = { city: "velmora", date: q.date, time: "19:00", partySize: 4 };
    const at = (o: { restaurantCode: string; area: string }[]) => o.map((x) => `${x.restaurantCode}:${x.area}`);
    expect(at(diningSearch(rows, base))).toEqual(["R1:terrace", "R1:private", "R2:terrace"]);
    expect(at(diningSearch(rows, { ...base, area: "terrace" }))).toEqual(["R1:terrace", "R2:terrace"]);
    expect(at(diningSearch(rows, { ...base, area: "terrace", partySize: 6 }))).toEqual(["R2:terrace"]);
    expect(at(diningSearch(rows, { ...base, menus: ["gluten-free"] }))).toEqual(["R2:terrace"]);
    expect(at(diningSearch(rows, { ...base, cuisine: "Greek" }))).toEqual(["R1:terrace", "R1:private"]);
    expect(at(diningSearch(rows, { ...base, maxPriceLevel: 3 }))).toEqual(["R1:terrace", "R1:private"]);
    expect(at(diningSearch({ ...rows, reservations: [held("A", "19:00", "confirmed", "R2")] }, { ...base, area: "terrace" }))).toEqual(["R1:terrace"]);
    expect(diningSearch(rows, { ...base, date: "2027-05-10" })).toEqual([]);
    expect(diningSearch(rows, { ...base, city: "Ostrand" })).toEqual([]);
    expect(diningSearch(rows, { ...base, area: "private" })[0]?.depositCents).toBe(9000);
  });

  it("lays out a day's availability per area that seats the party", () => {
    const rows = { seating: [terrace, room], reservations: [held("A", "18:30"), held("B", "19:30")] };
    const slots = diningAvailability(r, rows, q.date, 4);
    expect(slots.filter((s) => s.area === "terrace").map((s) => `${s.time}=${s.tablesLeft}`)).toEqual(["17:00=1", "17:30=1", "18:00=0", "18:30=0", "19:00=0", "19:30=0", "20:00=0"]);
    expect(slots.filter((s) => s.area === "private").every((s) => s.tablesLeft === 1)).toBe(true);
    expect(diningAvailability(r, rows, q.date, 6).map((s) => s.area)).toEqual(Array(7).fill("private"));
    expect(diningAvailability(r, rows, addDays(q.date, -2), 2)).toEqual([]);
  });
});
