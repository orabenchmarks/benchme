import { describe, expect, it } from "vitest";
import { webmcpV1 } from "../../webmcp-v1/index.js";
import { CITY_LIST } from "../../acme-v1/names.js";
import { HOME_SIZES, homeRows } from "./generate.js";
import { HOME_FEATURES, HOME_VIEWING_WINDOW, homeEarliestFreeSlot, homeSlotTimes, homeSlotsOf, homeViewingProblem, homeYearlyCostsCents, searchHomeListings } from "./rules.js";
import type { HomeAgentDay, HomeListing, HomeViewing } from "./types.js";

describe("webmcp-v1 homes", () => {
  const rows = homeRows(4242);

  it("is byte-identical for the same seed, and the same rows webmcpV1.generate carries", () => {
    expect(JSON.stringify(homeRows(4242))).toBe(JSON.stringify(rows));
    expect(JSON.stringify(homeRows(4243))).not.toBe(JSON.stringify(rows));
    expect(webmcpV1.generate(4242).homes).toEqual(rows);
  });

  it("has listings and two agents in every city, unique keys, and every reference resolving", () => {
    for (const city of CITY_LIST) {
      const n = rows.listings.filter((l) => l.city === city).length;
      expect(n).toBeGreaterThanOrEqual(HOME_SIZES.listingsPerCity[0]);
      expect(n).toBeLessThanOrEqual(HOME_SIZES.listingsPerCity[1]);
      expect(rows.agents.filter((a) => a.city === city)).toHaveLength(HOME_SIZES.agentsPerCity);
    }
    for (const [items, key] of [[rows.listings, "code"], [rows.agents, "code"], [rows.viewings, "viewingNo"], [rows.listings, "address"]] as const) {
      expect(new Set(items.map((x) => (x as Record<string, unknown>)[key])).size).toBe(items.length);
    }
    expect(new Set(rows.agentDays.map((d) => `${d.agentCode}:${d.date}`)).size).toBe(rows.agentDays.length);
    const agent = new Map(rows.agents.map((a) => [a.code, a]));
    const listing = new Map(rows.listings.map((l) => [l.code, l]));
    for (const l of rows.listings) {
      expect(agent.get(l.agentCode)?.city).toBe(l.city);
      expect(l.features.every((f) => (HOME_FEATURES as readonly string[]).includes(f))).toBe(true);
      expect(l.listedOn < HOME_VIEWING_WINDOW.first).toBe(true);
    }
    for (const d of rows.agentDays) {
      expect(agent.has(d.agentCode)).toBe(true);
      expect(d.date >= HOME_VIEWING_WINDOW.first && d.date <= HOME_VIEWING_WINDOW.last).toBe(true);
    }
    for (const v of rows.viewings) expect(listing.get(v.listingCode)?.agentCode).toBe(v.agentCode);
  });

  it("holds every seeded request to the rules, books some agent days out on purpose, and seeds the rest of what tasks need", () => {
    const listing = new Map(rows.listings.map((l) => [l.code, l]));
    const requested = rows.viewings.filter((v) => v.status === "requested");
    for (const v of requested) {
      const others = requested.filter((o) => o !== v);
      expect(homeViewingProblem(listing.get(v.listingCode) as HomeListing, rows.agentDays, others, v)).toBeNull();
    }
    const full = rows.agentDays.filter((d) => homeSlotsOf(rows, d.agentCode).filter((s) => s.date === d.date).every((s) => !s.free));
    expect(full.length).toBeGreaterThanOrEqual(HOME_SIZES.fullDays);
    expect(rows.viewings.some((v) => v.status === "cancelled")).toBe(true);
    expect(rows.listings.some((l) => l.status === "pending") && rows.listings.some((l) => l.status === "sold")).toBe(true);
    const perViewer = new Map<string, number>();
    for (const v of requested) perViewer.set(v.viewerEmail, (perViewer.get(v.viewerEmail) ?? 0) + 1);
    expect([...perViewer.values()].filter((n) => n >= 3).length).toBeGreaterThan(5);
  });
});

describe("home rules", () => {
  const listing: HomeListing = {
    code: "L1", city: "Velmora", neighbourhood: "North", address: "1 A Street", type: "house", priceCents: 50_000_000, beds: 3, baths: 2, areaSqm: 150, yearBuilt: 2000,
    features: ["garage", "garden"], monthlyFeeCents: 10_000, annualTaxCents: 400_000, status: "active", listedOn: "2027-03-01", agentCode: "A1", description: "",
  };
  const days: HomeAgentDay[] = [
    { agentCode: "A1", date: "2027-06-08", from: "10:00", until: "11:00" },
    { agentCode: "A1", date: "2027-06-10", from: "09:00", until: "10:00" },
    { agentCode: "A2", date: "2027-06-08", from: "10:00", until: "12:00" },
  ];
  const viewing = (date: string, time: string, extra: Partial<HomeViewing> = {}): HomeViewing => ({
    viewingNo: `V-${date}-${time}`, listingCode: "L1", agentCode: "A1", date, time, viewerName: "V", viewerEmail: "v@example.com", status: "requested", createdAt: "", ...extra,
  });
  const req = { listingCode: "L1", date: "2027-06-08", time: "10:00", viewerName: "Ilsa Voss", viewerEmail: "ilsa@example.com" };

  it("cuts an agent's hours into 30-minute slots", () => {
    expect(homeSlotTimes({ from: "09:00", until: "11:00" })).toEqual(["09:00", "09:30", "10:00", "10:30"]);
    expect(homeSlotTimes({ from: "14:00", until: "14:30" })).toEqual(["14:00"]);
  });

  it("refuses each rule on its own", () => {
    expect(homeViewingProblem(listing, days, [], req)).toBeNull();
    expect(homeViewingProblem(listing, days, [], { ...req, viewerName: " " })?.code).toBe("NO_VIEWER_NAME");
    expect(homeViewingProblem(listing, days, [], { ...req, date: "2027-02-30" })?.code).toBe("BAD_DATE");
    expect(homeViewingProblem(listing, days, [], { ...req, time: "25:00" })?.code).toBe("BAD_TIME");
    expect(homeViewingProblem(listing, days, [], { ...req, date: "2027-06-20" })?.code).toBe("OUTSIDE_WINDOW");
    expect(homeViewingProblem({ ...listing, status: "pending" }, days, [], req)?.code).toBe("NOT_ACTIVE");
    expect(homeViewingProblem({ ...listing, status: "sold" }, days, [], req)?.code).toBe("NOT_ACTIVE");
    expect(homeViewingProblem(listing, days, [], { ...req, agentCode: "A2" })?.code).toBe("WRONG_AGENT");
    expect(homeViewingProblem(listing, days, [], { ...req, time: "11:00" })?.code).toBe("NO_SLOT");
    expect(homeViewingProblem(listing, days, [], { ...req, date: "2027-06-09" })?.code).toBe("NO_SLOT");
    expect(homeViewingProblem(listing, days, [viewing("2027-06-08", "10:00", { listingCode: "L9" })], req)?.code).toBe("SLOT_TAKEN");
    expect(homeViewingProblem(listing, days, [viewing("2027-06-08", "10:00", { agentCode: "A2", viewerEmail: "Ilsa@Example.com" })], req)?.code).toBe("VIEWER_BUSY");
    expect(homeViewingProblem(listing, days, [viewing("2027-06-08", "10:00", { status: "cancelled" })], req)).toBeNull();
  });

  it("marks slots free or taken, and finds the earliest free one at or after a moment", () => {
    const viewings = [viewing("2027-06-08", "10:00"), viewing("2027-06-08", "10:30"), viewing("2027-06-10", "09:00", { status: "cancelled" })];
    const slots = homeSlotsOf({ agentDays: days, viewings }, "A1");
    expect(slots.map((s) => `${s.date} ${s.time} ${s.free}`)).toEqual(["2027-06-08 10:00 false", "2027-06-08 10:30 false", "2027-06-10 09:00 true", "2027-06-10 09:30 true"]);
    expect(homeEarliestFreeSlot({ agentDays: days, viewings }, "A1", { date: "2027-06-08", time: "10:00" })).toEqual({ date: "2027-06-10", time: "09:00", free: true });
    expect(homeEarliestFreeSlot({ agentDays: days, viewings }, "A1", { date: "2027-06-10", time: "09:15" })).toEqual({ date: "2027-06-10", time: "09:30", free: true });
    expect(homeEarliestFreeSlot({ agentDays: days, viewings }, "A1", { date: "2027-06-11", time: "09:00" })).toBeNull();
  });

  it("searches by every filter, cheapest first, every status unless asked", () => {
    const flat: HomeListing = { ...listing, code: "L2", type: "apartment", priceCents: 30_000_000, beds: 2, baths: 1, areaSqm: 70, features: ["balcony", "elevator"], status: "pending", agentCode: "A2" };
    const ls = [listing, flat];
    expect(searchHomeListings(ls, { city: "velmora" }).map((l) => l.code)).toEqual(["L2", "L1"]);
    expect(searchHomeListings(ls, { status: "active" }).map((l) => l.code)).toEqual(["L1"]);
    expect(searchHomeListings(ls, { types: ["House"] }).map((l) => l.code)).toEqual(["L1"]);
    expect(searchHomeListings(ls, { maxPriceCents: 40_000_000 }).map((l) => l.code)).toEqual(["L2"]);
    expect(searchHomeListings(ls, { minPriceCents: 40_000_000 }).map((l) => l.code)).toEqual(["L1"]);
    expect(searchHomeListings(ls, { minBeds: 3 }).map((l) => l.code)).toEqual(["L1"]);
    expect(searchHomeListings(ls, { minBaths: 2 }).map((l) => l.code)).toEqual(["L1"]);
    expect(searchHomeListings(ls, { minAreaSqm: 100 }).map((l) => l.code)).toEqual(["L1"]);
    expect(searchHomeListings(ls, { minYearBuilt: 2001 })).toEqual([]);
    expect(searchHomeListings(ls, { neighbourhood: "north" })).toHaveLength(2);
    expect(searchHomeListings(ls, { features: ["Elevator"] }).map((l) => l.code)).toEqual(["L2"]);
    expect(searchHomeListings(ls, { features: ["garage", "balcony"] })).toEqual([]);
    expect(searchHomeListings(ls, { city: "Ostrand" })).toEqual([]);
  });

  it("totals a year of fees: twelve monthly service fees plus the annual tax", () => {
    expect(homeYearlyCostsCents(listing)).toBe(520_000);
  });
});
