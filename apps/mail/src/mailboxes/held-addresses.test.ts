import { MAILBOXES, UnknownScenarioError, cujV1, scenarios, webmcpV1, type Scenario, type ScenarioRows } from "@benchme/scenarios";
import { describe, expect, it } from "vitest";
import { heldAddressesOf } from "./held-addresses.js";
import type { HeldAddressesRepo } from "./held-repo.js";
import { MAILBOX_POLICIES } from "./policies.js";
import { MailboxesSeeder } from "./seeder.js";

const rows = cujV1.generate(4242);
const held = new Set(heldAddressesOf(rows));

describe("the addresses a workspace's rows hold", () => {
  it("are every email-shaped value at any depth, whatever its field is called, trimmed, lower-cased, each once", () => {
    const loop: Record<string, unknown> = { contact: "loop@example.test" };
    loop.self = loop;
    const rowsOfALaterSite = {
      venues: [{ code: "V-1", ownerEmail: " Ada.Lovelace@Example.TEST ", rating: 4.5, open: true, note: null }],
      tickets: [{ attendees: ["grace@example.test", "GRACE@example.test"], buyer: { nested: { deeper: ["alan@example.test"] } } }],
      words: ["not an address", "two@at@signs", "no-dot@host", "a sentence naming bob@example.test is not an address", "@example.test", ""],
      loop,
    };
    expect(heldAddressesOf(rowsOfALaterSite)).toEqual(["ada.lovelace@example.test", "alan@example.test", "grace@example.test", "loop@example.test"]);
    expect(heldAddressesOf(null)).toEqual([]);
    expect(heldAddressesOf("Solo@Example.test")).toEqual(["solo@example.test"]);
  });

  it("hold, in real cuj-v1 rows, a seeded account, an event's organiser and a hotel guest without an account, but no new person a task names", () => {
    const account = rows.accounts?.events?.[0]?.email as string;
    const organiser = rows.events.events.find((e) => !rows.accounts?.events?.some((a) => a.email === e.organiserEmail))?.organiserEmail as string;
    const guest = rows.hotels.bookings.find((b) => !rows.accounts?.hotels?.some((a) => a.email === b.guestEmail))?.guestEmail as string;
    expect([account, organiser, guest].every((a) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a))).toBe(true);
    expect([held.has(account), held.has(organiser), held.has(guest)]).toEqual([true, true, true]);
    for (const newcomer of ["x.y.12345@journeys.example", "keira.greystone.52953@journeys.example"]) expect([newcomer, held.has(newcomer)]).toEqual([newcomer, false]);
  });

  it("hold everyone the nine sites name, site by site, and nothing that is not an address", () => {
    const named = [
      ...rows.hotels.bookings.map((b) => b.guestEmail),
      ...rows.flights.bookings.map((b) => b.contactEmail),
      ...rows.dining.reservations.map((r) => r.guestEmail),
      ...rows.pizza.orders.map((o) => o.customerEmail),
      ...rows.cinema.bookings.map((b) => b.customerEmail),
      ...rows.sports.customers.map((c) => c.email),
      ...rows.homes.viewings.map((v) => v.viewerEmail),
      ...rows.clinic.patients.map((p) => p.email),
      ...rows.events.people.map((p) => p.email),
      ...rows.events.events.flatMap((e) => [e.organiserEmail, ...e.guestEmails]),
      ...rows.events.registrations.map((r) => r.email),
      ...Object.values(rows.accounts ?? {}).flatMap((list) => list.map((a) => a.email)),
    ].map((a) => a.trim().toLowerCase());
    expect(named.filter((a) => !held.has(a))).toEqual([]);
    expect([...held].every((a) => a === a.trim().toLowerCase() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a))).toBe(true);
    expect(heldAddressesOf(rows)).toEqual([...held].sort());
  });
});

describe("the mailbox policies", () => {
  /** A scenario whose rows must never be generated: a shared seed has no reason to. */
  const neverGenerated = (mailboxes?: Scenario["mailboxes"]): Scenario => ({
    key: "stub",
    description: "stub",
    ...(mailboxes ? { mailboxes } : {}),
    generate: (): ScenarioRows => {
      throw new Error("generated");
    },
  });

  it("cover every kind of mailboxes", () => {
    expect(Object.keys(MAILBOX_POLICIES).sort()).toEqual([...MAILBOXES].sort());
  });

  it("hold nothing in a shared inbox, without generating the rows", () => {
    expect(MAILBOX_POLICIES.shared.held(neverGenerated("shared"), 4242)).toEqual([]);
  });

  it("hold everyone the rows of the workspace's own seed name, when the mailboxes are private", () => {
    expect(MAILBOX_POLICIES.private.held(cujV1, 4242)).toEqual([...held].sort());
    expect(MAILBOX_POLICIES.private.held(cujV1, 4243)).not.toEqual([...held].sort());
    // webmcp-v1 holds the same people as cuj-v1 at one seed (its rows, without the accounts, who are among them): only the declaration differs.
    expect(MAILBOX_POLICIES.private.held(webmcpV1, 4242)).toEqual([...held].sort());
  });
});

/** The held sets in memory: the seeder's contract, without a database (private-mailboxes.test.ts has the real one). */
class MemoryHeld implements HeldAddressesRepo {
  readonly sets = new Map<string, string[]>();
  async replace(ws: string, addresses: readonly string[]) {
    this.sets.set(ws, [...addresses]);
  }
  async any(ws: string) {
    return (this.sets.get(ws)?.length ?? 0) > 0;
  }
}

describe("seeding a workspace's mailboxes", () => {
  it("holds cuj-v1's people and nobody in any other scenario's workspace", async () => {
    const repo = new MemoryHeld();
    const seeder = new MailboxesSeeder(scenarios, repo);
    for (const s of scenarios.list()) {
      const answer = await seeder.seed(`ws_${s.key}`, s.key, 4242);
      expect([s.key, answer]).toEqual([s.key, s.key === "cuj-v1" ? { mailboxes: "private", held: held.size } : { mailboxes: "shared", held: 0 }]);
      expect([s.key, await repo.any(`ws_${s.key}`)]).toEqual([s.key, s.key === "cuj-v1"]);
    }
    expect(repo.sets.get("ws_cuj-v1")).toEqual([...held].sort());
  });

  it("replaces the held set on a re-seed, and refuses a scenario it does not know", async () => {
    const repo = new MemoryHeld();
    const seeder = new MailboxesSeeder(scenarios, repo);
    await seeder.seed("ws_a", "cuj-v1", 4243);
    await seeder.seed("ws_a", "cuj-v1", 4242);
    expect(repo.sets.get("ws_a")).toEqual([...held].sort());
    await expect(seeder.seed("ws_a", "no-such-v9", 1)).rejects.toBeInstanceOf(UnknownScenarioError);
  });
});
