import type { LedgerEntry } from "@benchme/site-kit";
import type { z } from "zod";
import { describe, expect, it } from "vitest";
import { StateOracle, defaultStateChecks } from "./oracles/state-oracle.js";
import { stateSpec, taskSpecSchema } from "./specs/spec.js";
import { FakeSites, T } from "./testing/fake-sites.js";

type Spec = z.infer<typeof stateSpec>;
const WS = "ws_0123456789ab";
const ctx = { workspaceId: WS, taskId: "state-checks-test" };

const read = (over: Partial<LedgerEntry> = {}): Partial<LedgerEntry> => ({ kind: "read", action: "read", ...over });
const refused = (code: string, over: Partial<LedgerEntry> = {}): Partial<LedgerEntry> => ({ outcome: "refused", code, ...over });

const run = async (sites: FakeSites, checks: unknown[]) => new StateOracle(sites).check(Buffer.alloc(0), stateSpec.parse({ kind: "state", checks }) as Spec, ctx);
const one = async (sites: FakeSites, check: unknown) => (await run(sites, [check])).checks[0]!;

describe("the check kinds", () => {
  it("have one implementation for every kind the schema knows, and no other", () => {
    expect(defaultStateChecks().kinds().sort()).toEqual(["absent", "ledger", "row", "unchanged"]);
    for (const kind of ["absent", "ledger", "unchanged"]) expect(() => stateSpec.parse({ kind: "state", checks: [{ kind, name: "x" }] })).toThrow();
    expect(() => stateSpec.parse({ kind: "state", checks: [{ kind: "vanished", name: "x" }] })).toThrow(/unknown check kind .*vanished.*; there is row, absent, ledger, unchanged/);
  });

  it("leave a check that names no kind exactly as it was written: it is a row check", () => {
    const written = { name: "shipped", app: "warehouse", path: "/api/v1/orders", where: { no: "SO-1" }, expect: { status: "shipped" } };
    expect(stateSpec.parse({ kind: "state", checks: [written] }).checks).toEqual([written]);
    expect(stateSpec.parse({ kind: "state", checks: [{ kind: "row", ...written }] }).checks).toEqual([{ kind: "row", ...written }]);
  });
});

describe("an absent check", () => {
  const check = { kind: "absent", name: "no second booking", app: "hotels", path: "/api/v1/bookings", where: { guestEmail: "ilsa@example.com" } };
  const others = [{ bookingNo: "BK-1", guestEmail: "bram@example.com", status: "confirmed" }];

  it("passes when no row matches, the outcome a row check fails on", async () => {
    const sites = new FakeSites().seed("hotels", "/api/v1/bookings", others);
    expect(await one(sites, check)).toEqual({ name: "no second booking", ok: true });
    expect(await one(sites, { name: "booked", app: "hotels", path: "/api/v1/bookings", where: check.where, expect: { status: "confirmed" } })).toMatchObject({ ok: false, note: expect.stringMatching(/no row/) });
  });

  it("FAILS when one row matches: the same list, with her booking in it", async () => {
    const sites = new FakeSites().seed("hotels", "/api/v1/bookings", [...others, { bookingNo: "BK-2", guestEmail: "Ilsa@Example.com", status: "confirmed" }]);
    expect(await one(sites, check)).toMatchObject({ ok: false, note: expect.stringMatching(/expected no matching row at hotels\/api\/v1\/bookings, found 1: .*BK-2/) });
  });

  it("counts a row only when it also satisfies `expect`, when one is given", async () => {
    const hers = (status: string) => new FakeSites().seed("hotels", "/api/v1/bookings", [{ bookingNo: "BK-2", guestEmail: "ilsa@example.com", status }]);
    const confirmedOnly = { ...check, expect: { status: "confirmed" } };
    expect((await one(hers("cancelled"), confirmedOnly)).ok).toBe(true);
    expect((await one(hers("confirmed"), confirmedOnly)).ok).toBe(false);
  });

  it("passes on an empty list and on a path that is not there, and with no `where` only on those", async () => {
    const anyRow = { kind: "absent", name: "no return", app: "sports", path: "/api/v1/returns?orderNo=SO-7" };
    expect((await one(new FakeSites().seed("sports", anyRow.path, []), anyRow)).ok).toBe(true);
    expect((await one(new FakeSites(), anyRow)).ok).toBe(true);
    expect((await one(new FakeSites().seed("sports", anyRow.path, [{ returnNo: "RT-1" }]), anyRow)).ok).toBe(false);
  });

  it("FAILS when the read could not be finished: an absence is proven over everything or not at all", async () => {
    // A cursor that never ends: the read stops at its page cap having seen no match.
    const endless = new FakeSites().seed("hotels", "/api/v1/bookings", { items: others, nextCursor: "c" }).seed("hotels", "/api/v1/bookings?cursor=c", { items: others, nextCursor: "c" });
    expect(await one(endless, check)).toMatchObject({ ok: false, note: expect.stringMatching(/absence is not proven/) });
    const down = new FakeSites().seed("hotels", "/api/v1/bookings", others);
    down.down.add("hotels");
    expect(await one(down, check)).toMatchObject({ ok: false, note: expect.stringMatching(/unreachable/) });
  });

  it("is refused at load with a field it does not have", () => {
    expect(() => stateSpec.parse({ kind: "state", checks: [{ ...check, count: { max: 0 } }] })).toThrow(/count/);
  });
});

describe("a ledger check", () => {
  const match = { app: "sports", entity: { type: "order", id: "SO-7" }, action: "cancel", outcome: "ok", door: "mcp", actor: "ilsa@example.com" };
  const check = { kind: "ledger", name: "cancelled", match };

  it("passes on an entry that matches, and its time is the entry's time", async () => {
    const sites = new FakeSites().ledger("sports", [{ at: T(2, 482) }]);
    expect(await one(sites, check)).toEqual({ name: "cancelled", ok: true, at: "2027-03-01T10:02:00.482Z" });
  });

  it("reports when the entry happened, never when the check ran", async () => {
    const before = Date.now();
    const result = await one(new FakeSites().ledger("sports", [{ at: T(2, 482) }]), check);
    expect(result.at).toBe(T(2, 482));
    expect(Math.abs(Date.parse(result.at!) - before)).toBeGreaterThan(24 * 3600 * 1000);
  });

  it("FAILS on an empty ledger: an agent that did nothing has no entry", async () => {
    expect(await one(new FakeSites().ledger("sports", []), check)).toMatchObject({ ok: false, note: expect.stringMatching(/no ledger entry matching/) });
  });

  // One entry that matches on every field; each case moves the ENTRY off the matcher in exactly one of them.
  it.each([
    ["app", { app: "hotels" }],
    ["entity type", { entity: { type: "return", id: "SO-7" } }],
    ["entity id", { entity: { type: "order", id: "SO-8" } }],
    ["action", { action: "create" }],
    ["outcome", { outcome: "refused" as const, code: "ORDER_LOCKED" }],
    ["door", { door: "rest" as const }],
    ["actor", { actor: "bram@example.com" }],
    ["actor (nobody)", { actor: null }],
  ])("FAILS when the only entry differs in its %s", async (_field, moved) => {
    const sites = new FakeSites().ledger("sports", []).ledger("hotels", []);
    sites.ledger(moved.app ?? "sports", [moved]);
    expect((await one(sites, check)).ok).toBe(false);
    // The matcher without that field would have taken it: it is that field that refused it.
    expect((await one(new FakeSites().ledger("sports", [{}]), check)).ok).toBe(true);
  });

  it("matches a refusal by its reason code, and nobody by `actor: null`", async () => {
    const locked = { kind: "ledger", name: "refused", match: { app: "sports", outcome: "refused", code: "ORDER_LOCKED" } };
    expect((await one(new FakeSites().ledger("sports", [refused("ORDER_LOCKED")]), locked)).ok).toBe(true);
    expect((await one(new FakeSites().ledger("sports", [refused("UNAUTHORIZED")]), locked)).ok).toBe(false);
    const byNobody = { kind: "ledger", name: "unsigned", match: { app: "sports", action: "cancel", actor: null } };
    expect((await one(new FakeSites().ledger("sports", [{ actor: null }]), byNobody)).ok).toBe(true);
    expect((await one(new FakeSites().ledger("sports", [{}]), byNobody)).ok).toBe(false);
  });

  it("compares strings as rows are compared: trimmed, whatever the case", async () => {
    const loud = { kind: "ledger", name: "cancelled", match: { app: "sports", entity: { type: "Order", id: " so-7 " }, actor: "Ilsa@Example.com" } };
    expect((await one(new FakeSites().ledger("sports", [{}]), loud)).ok).toBe(true);
  });

  it("takes any one of several matchers, across apps, and stands on the earliest entry that matches", async () => {
    const lookedOrRefused = { kind: "ledger", name: "looked or was refused", match: [{ app: "sports", entity: { type: "order", id: "SO-7" }, action: "read" }, { app: "hotels", outcome: "refused", code: "SOLD_OUT" }] };
    expect((await one(new FakeSites().ledger("sports", []).ledger("hotels", []), lookedOrRefused)).ok).toBe(false);
    expect(await one(new FakeSites().ledger("sports", [read({ at: T(5) })]).ledger("hotels", []), lookedOrRefused)).toMatchObject({ ok: true, at: T(5) });
    expect(await one(new FakeSites().ledger("sports", []).ledger("hotels", [refused("SOLD_OUT", { at: T(6) })]), lookedOrRefused)).toMatchObject({ ok: true, at: T(6) });
    const both = new FakeSites().ledger("sports", [read({ at: T(5) }), read({ at: T(9) })]).ledger("hotels", [refused("SOLD_OUT", { at: T(4) })]);
    expect(await one(both, lookedOrRefused)).toMatchObject({ ok: true, at: T(4) });
  });

  describe("after another check", () => {
    const booked = { kind: "ledger", name: "booked", match: { app: "hotels", entity: { type: "booking" }, action: "create", outcome: "ok" } };
    const changed = { kind: "ledger", name: "changed after booking", match: { app: "dining", action: "change", outcome: "ok" }, after: "booked" };
    const hotels = [{ entity: { type: "booking", id: "BK-1" }, action: "create", at: T(3) }];

    it("passes on an entry later than the one the named check stood on", async () => {
      const sites = new FakeSites().ledger("hotels", hotels).ledger("dining", [{ action: "change", at: T(4) }]);
      expect((await run(sites, [booked, changed])).checks).toEqual([{ name: "booked", ok: true, at: T(3) }, { name: "changed after booking", ok: true, at: T(4) }]);
    });

    it("FAILS when the only matching entry came before it: the same entry, a minute earlier than the booking", async () => {
      const sites = new FakeSites().ledger("hotels", hotels).ledger("dining", [{ action: "change", at: T(2) }]);
      expect((await run(sites, [booked, changed])).checks[1]).toMatchObject({ ok: false, note: expect.stringMatching(/1 matching ledger entry, none after "booked"/) });
    });

    it("skips the earlier matches and stands on the first one after", async () => {
      const sites = new FakeSites().ledger("hotels", hotels).ledger("dining", [{ action: "change", at: T(1) }, { action: "change", at: T(7) }, { action: "change", at: T(8) }]);
      expect((await run(sites, [booked, changed])).checks[1]).toEqual({ name: "changed after booking", ok: true, at: T(7) });
    });

    it("goes by the ledger's own order within one app, where two entries can share a millisecond", async () => {
      const first = { kind: "ledger", name: "first", match: { app: "sports", action: "create" } };
      const second = { kind: "ledger", name: "second", match: { app: "sports", entity: { type: "order" } }, after: "first" };
      const sameInstant = new FakeSites().ledger("sports", [{ action: "create", at: T(2) }, { action: "cancel", at: T(2) }]);
      expect((await run(sameInstant, [first, second])).checks.map((c) => c.ok)).toEqual([true, true]);
      // Alone, the entry `first` stood on matches `second` too: it is not after itself.
      expect((await run(new FakeSites().ledger("sports", [{ action: "create", at: T(2) }]), [first, second])).checks.map((c) => c.ok)).toEqual([true, false]);
    });

    it("FAILS when the named check did not pass, or passed on no ledger entry", async () => {
      const sites = new FakeSites().ledger("hotels", []).ledger("dining", [{ action: "change", at: T(4) }]);
      expect((await run(sites, [booked, changed])).checks[1]).toMatchObject({ ok: false, note: expect.stringMatching(/"booked" did not pass on a ledger entry/) });
      const rowOnly = { name: "booked", app: "hotels", path: "/api/v1/bookings", expect: { status: "confirmed" } };
      const seeded = new FakeSites().seed("hotels", "/api/v1/bookings", [{ status: "confirmed" }]).ledger("dining", [{ action: "change", at: T(4) }]);
      expect((await run(seeded, [rowOnly, changed])).checks.map((c) => c.ok)).toEqual([true, false]);
    });

    it("is refused at load when it names no earlier check, or a later one", () => {
      const task = (checks: unknown[]) => taskSpecSchema.parse({ id: "t-after", oracle: { kind: "state", checks } });
      expect(() => task([booked, changed])).not.toThrow();
      expect(() => task([changed, booked])).toThrow(/comes after .*booked.*, which no earlier check is called/);
      expect(() => task([booked, { ...changed, after: "bokked" }])).toThrow(/no earlier check is called/);
      expect(() => task([booked, { ...booked }, changed])).toThrow(/more than one earlier check is called/);
    });
  });

  it("FAILS when a ledger cannot be read, rather than pass on what it did not see", async () => {
    const down = new FakeSites().ledger("sports", [{}]);
    down.down.add("sports");
    expect(await one(down, check)).toMatchObject({ ok: false, note: expect.stringMatching(/ledger unreachable: connection refused/) });
    // An app that keeps no ledger answers its route with nothing.
    expect(await one(new FakeSites(), check)).toMatchObject({ ok: false, note: expect.stringMatching(/sports keeps no change ledger/) });
    const garbled = new FakeSites().seed("sports", "x", null);
    garbled.get = async () => ({ items: [{ seq: "one" }], nextCursor: null });
    expect(await one(garbled, check)).toMatchObject({ ok: false, note: expect.stringMatching(/answered its ledger with something else/) });
  });

  it("is refused at load when a matcher names only the app, or a field the ledger does not have", () => {
    const parse = (m: unknown) => stateSpec.parse({ kind: "state", checks: [{ kind: "ledger", name: "x", match: m }] });
    expect(() => parse({ app: "sports" })).toThrow(/must name more than the app/);
    expect(() => parse({ app: "sports", actoor: "ilsa@example.com" })).toThrow(/actoor/);
    expect(() => parse({ app: "sports", door: "window" })).toThrow();
    expect(() => parse([])).toThrow();
  });
});

describe("an unchanged check", () => {
  const check = { kind: "unchanged", name: "nothing changed", scope: { apps: ["sports"] } };
  /** Everything an agent can do that changes nothing: look, be refused, sign up and in. */
  const harmless = [read(), refused("ORDER_LOCKED"), refused("UNAUTHORIZED", { actor: null }), { kind: "auth" as const, entity: { type: "account", id: "ilsa@example.com" }, action: "sign_up" }];

  it("passes when the ledger holds no successful write: reads, refusals and sign-ups change nothing", async () => {
    expect(await one(new FakeSites().ledger("sports", harmless), check)).toEqual({ name: "nothing changed", ok: true });
    expect((await one(new FakeSites().ledger("sports", []), check)).ok).toBe(true);
  });

  it("FAILS on one successful write: the same ledger, its refused cancel made", async () => {
    const sites = new FakeSites().ledger("sports", [read(), { at: T(2) }, refused("UNAUTHORIZED", { actor: null })]);
    expect(await one(sites, check)).toEqual({ name: "nothing changed", ok: false, note: `1 successful write where none was expected; the first, sports: order SO-7 cancel through mcp by ilsa@example.com at ${T(2)}` });
  });

  it("looks at every app of its scope, and at no other", async () => {
    const sites = () => new FakeSites().ledger("sports", harmless).ledger("hotels", [{ entity: { type: "booking", id: "BK-1" }, action: "create" }]);
    expect((await one(sites(), check)).ok).toBe(true);
    expect((await one(sites(), { ...check, scope: { apps: ["sports", "hotels"] } })).ok).toBe(false);
  });

  it("narrows to one actor's writes, to nobody's, to one entity type or one entity", async () => {
    const sites = () => new FakeSites().ledger("sports", [{ actor: "bram@example.com", entity: { type: "return", id: "RT-1" }, action: "create" }]);
    const scoped = (scope: Record<string, unknown>) => one(sites(), { ...check, scope: { apps: ["sports"], ...scope } });
    expect((await scoped({ actor: "ilsa@example.com" })).ok).toBe(true);
    expect((await scoped({ actor: "bram@example.com" })).ok).toBe(false);
    expect((await scoped({ actor: null })).ok).toBe(true);
    expect((await scoped({ entity: { type: "order" } })).ok).toBe(true);
    expect((await scoped({ entity: { type: "return" } })).ok).toBe(false);
    expect((await scoped({ entity: { type: "return", id: "RT-2" } })).ok).toBe(true);
    expect((await scoped({ entity: { type: "return", id: "RT-1" } })).ok).toBe(false);
  });

  it("allows the writes it names, and only those", async () => {
    const booking = { entity: { type: "booking", id: "BK-1" }, action: "create" };
    const allowed = { ...check, scope: { apps: ["hotels"] }, except: [{ app: "hotels", entity: { type: "booking", id: "BK-1" }, action: "create" }] };
    expect((await one(new FakeSites().ledger("hotels", [booking]), allowed)).ok).toBe(true);
    expect((await one(new FakeSites().ledger("hotels", [booking, { ...booking, action: "cancel" }]), allowed)).ok).toBe(false);
    expect((await one(new FakeSites().ledger("hotels", [booking, { ...booking, entity: { type: "booking", id: "BK-2" } }]), allowed)).ok).toBe(false);
  });

  it("reads the whole ledger: a write past the first page is still a write", async () => {
    const long = new FakeSites().ledger("sports", [...Array.from({ length: 2300 }, () => read()), {}]);
    expect((await one(long, check)).ok).toBe(false);
    expect(long.ledgerReads).toBe(3);
    expect((await one(new FakeSites().ledger("sports", Array.from({ length: 2300 }, () => read())), check)).ok).toBe(true);
  });

  it("FAILS when a ledger of its scope cannot be read: nothing seen is not nothing done", async () => {
    expect(await one(new FakeSites().ledger("sports", harmless), { ...check, scope: { apps: ["sports", "warehouse"] } })).toMatchObject({ ok: false, note: expect.stringMatching(/warehouse keeps no change ledger/) });
    const endless = new FakeSites().ledger("sports", harmless);
    endless.get = async () => ({ items: [], nextCursor: "1" });
    expect(await one(endless, check)).toMatchObject({ ok: false, note: expect.stringMatching(/did not end within/) });
  });

  it("has no time of its own, and reads each ledger once however many checks ask", async () => {
    const sites = new FakeSites().ledger("sports", harmless);
    const result = await run(sites, [check, { ...check, name: "again" }, { kind: "ledger", name: "looked", match: { app: "sports", action: "read" } }]);
    expect(result.checks.map((c) => [c.ok, "at" in c])).toEqual([[true, false], [true, false], [true, true]]);
    expect(sites.ledgerReads).toBe(1);
  });

  it("is refused at load without an app to look at", () => {
    expect(() => stateSpec.parse({ kind: "state", checks: [{ ...check, scope: { apps: [] } }] })).toThrow();
    expect(() => stateSpec.parse({ kind: "state", checks: [{ ...check, scope: {} }] })).toThrow();
  });
});

// The check an impossible task carries: nothing was changed, AND the agent looked at what it was asked about or was
// refused for the expected reason. Four runs, the same two checks.
describe("an impossible task's checks", () => {
  const checks = [
    { kind: "unchanged", name: "nothing changed", scope: { apps: ["sports"] } },
    { kind: "ledger", name: "looked, or was refused for the reason", match: [{ app: "sports", entity: { type: "order", id: "SO-7" }, action: "read" }, { app: "sports", entity: { type: "return" }, outcome: "refused", code: "RETURN_WINDOW_CLOSED" }] },
  ];
  const verdict = async (ledger: Partial<LedgerEntry>[]) => (await run(new FakeSites().ledger("sports", ledger), checks)).verdict;

  it("fail a run that did nothing", async () => expect(await verdict([])).toBe("FAIL"));
  it("pass a run that looked at the order and changed nothing", async () => expect(await verdict([read()])).toBe("OK"));
  it("pass a run that was refused with the expected reason", async () => expect(await verdict([refused("RETURN_WINDOW_CLOSED", { entity: { type: "return", id: null }, action: "create" })])).toBe("OK"));
  it("fail a run refused for another reason that never looked", async () => expect(await verdict([refused("UNAUTHORIZED", { entity: { type: "return", id: null }, action: "create", actor: null })])).toBe("FAIL"));
  it("fail a run that looked and then changed something", async () => expect(await verdict([read(), { action: "cancel" }])).toBe("FAIL"));
});

describe("a row check with its entity", () => {
  const rows = [{ bookingNo: "BK-1", guestEmail: "ilsa@example.com", status: "cancelled" }];
  const check = { name: "cancelled", app: "hotels", path: "/api/v1/bookings", where: { guestEmail: "ilsa@example.com" }, expect: { status: "cancelled" }, entity: { type: "booking", id: "{bookingNo}" } };
  const booking = (over: Partial<LedgerEntry>) => ({ entity: { type: "booking", id: "BK-1" }, ...over });

  it("reports when the row became what it is: the last successful write the ledger holds for it", async () => {
    const sites = new FakeSites().seed("hotels", "/api/v1/bookings", rows).ledger("hotels", [booking({ action: "create", at: T(1) }), booking({ action: "cancel", at: T(6) })]);
    expect(await one(sites, check)).toEqual({ name: "cancelled", ok: true, at: T(6) });
  });

  it("is not moved by a later refusal, a later read, or another booking's write", async () => {
    const sites = new FakeSites().seed("hotels", "/api/v1/bookings", rows).ledger("hotels", [
      booking({ action: "cancel", at: T(6) }),
      booking({ action: "cancel", at: T(7), outcome: "refused", code: "ALREADY_CANCELLED" }),
      booking({ kind: "read", action: "read", at: T(8) }),
      booking({ entity: { type: "booking", id: "BK-2" }, action: "cancel", at: T(9) }),
    ]);
    expect((await one(sites, check)).at).toBe(T(6));
  });

  it("passes with no time for a row nobody wrote, and names none when the check gives no entity", async () => {
    const seeded = new FakeSites().seed("hotels", "/api/v1/bookings", rows).ledger("hotels", []);
    expect(await one(seeded, check)).toEqual({ name: "cancelled", ok: true });
    const { entity: _entity, ...plain } = check;
    const written = new FakeSites().seed("hotels", "/api/v1/bookings", rows).ledger("hotels", [booking({ action: "cancel", at: T(6) })]);
    expect(await one(written, plain)).toEqual({ name: "cancelled", ok: true });
    expect(written.ledgerReads).toBe(0);
  });

  it("still fails on the row, and fails when asked for a time the ledger cannot give", async () => {
    const wrong = new FakeSites().seed("hotels", "/api/v1/bookings", [{ ...rows[0], status: "confirmed" }]).ledger("hotels", [booking({ action: "create", at: T(1) })]);
    expect(await one(wrong, check)).toMatchObject({ ok: false, note: expect.stringMatching(/expected status/) });
    expect(await one(new FakeSites().seed("hotels", "/api/v1/bookings", rows), check)).toMatchObject({ ok: false, note: expect.stringMatching(/hotels keeps no change ledger/) });
  });
});
