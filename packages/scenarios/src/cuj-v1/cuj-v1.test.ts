import { describe, expect, it } from "vitest";
import { scenarios } from "../index.js";
import { SITE_APPS } from "../sites/rows.js";
import { webmcpV1 } from "../webmcp-v1/index.js";
import { ACCOUNTS_PER_SITE } from "./accounts.js";
import { cujV1 } from "./index.js";

describe("cuj-v1", () => {
  it("is registered, and advertises the nine sites and the inbox", () => {
    expect(scenarios.get("cuj-v1")).toBe(cujV1);
    expect(cujV1.apps).toEqual([...SITE_APPS, "mail"]);
  });

  it("has webmcp-v1's rows at the same seed, row for row, and adds only accounts", () => {
    const { accounts, ...rows } = cujV1.generate(4242);
    expect(rows).toEqual(webmcpV1.generate(4242));
    expect(accounts).toBeDefined();
    expect(webmcpV1.generate(4242).accounts).toBeUndefined();
  });

  it("gives each site the same accounts for the same seed, and others for another seed", () => {
    expect(cujV1.generate(4242).accounts).toEqual(cujV1.generate(4242).accounts);
    expect(cujV1.generate(4243).accounts).not.toEqual(cujV1.generate(4242).accounts);
  });

  it("gives accounts to people each site already has something for, a few per site, each email once", () => {
    const r = cujV1.generate(4242);
    const known: Record<string, Set<string>> = {
      hotels: new Set(r.hotels.bookings.map((b) => b.guestEmail)),
      flights: new Set(r.flights.bookings.map((b) => b.contactEmail)),
      dining: new Set(r.dining.reservations.map((x) => x.guestEmail)),
      pizza: new Set(r.pizza.orders.map((o) => o.customerEmail)),
      cinema: new Set(r.cinema.bookings.map((b) => b.customerEmail)),
      sports: new Set(r.sports.customers.map((c) => c.email)),
      homes: new Set(r.homes.viewings.map((v) => v.viewerEmail)),
      clinic: new Set(r.clinic.patients.map((p) => p.email)),
      events: new Set(r.events.people.map((p) => p.email)),
    };
    for (const app of SITE_APPS) {
      const list = r.accounts?.[app] ?? [];
      expect([app, list.length]).toEqual([app, ACCOUNTS_PER_SITE]);
      expect(new Set(list.map((a) => a.email)).size).toBe(list.length);
      for (const a of list) {
        expect([app, known[app]?.has(a.email)]).toEqual([app, true]);
        expect(a.password).toMatch(/^[a-z]+-\d{4}-[a-z]+$/);
      }
    }
  });
});
