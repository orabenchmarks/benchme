import { describe, expect, it } from "vitest";
// The corpus tool's own modules (tools/intent-corpus), read against the sites' built tool registries: `npm run build`.
// @ts-expect-error — plain ESM, no types
import { call, callProblem, free, pattern, publishCall } from "../../../../tools/intent-corpus/calls.mjs";
// @ts-expect-error — plain ESM, no types
import { buildCujCorpus } from "../../../../tools/intent-corpus/cuj/build.mjs";
// @ts-expect-error — plain ESM, no types
import { deriveTemplated } from "../../../../tools/intent-corpus/derive.mjs";
// @ts-expect-error — plain ESM, no types
import { stepCalls } from "../../../../tools/intent-corpus/expected-calls.mjs";
// @ts-expect-error — plain ESM, no types
import { R } from "../../../../tools/intent-corpus/rubrics.mjs";
// @ts-expect-error — plain ESM, no types
import { SIGN_IN_TOOLS, SITE_TOOLS } from "../../../../tools/intent-corpus/site-tools.mjs";
import { cujV1, webmcpV1 } from "@benchme/scenarios";

/**
 * The static proof of the expected calls (tools/intent-corpus/calls.mjs, ./expected-calls.mjs): a call names a tool
 * its site registers, its arguments parse against that tool's input schema with constraint objects set aside, and a
 * template whose call does not refuses the corpus, in both corpora that carry calls.
 */
type Call = { functionName: string; args: Record<string, unknown>; as: Record<string, unknown> };
const hotels = SITE_TOOLS.get("hotels");
const problem = (c: Call) => callProblem(c, hotels, { signIn: SIGN_IN_TOOLS });
const BOOKING = { roomCode: "HT-101-DBL", hotelCode: "HT-101", checkIn: "2027-10-04", nights: 2, adults: 2, kids: 0, pets: 0, lateCheckout: false, guestName: "Ada Byrne", guestEmail: "ada.byrne@example.com" };
const booking = (args: Record<string, unknown> = BOOKING, as: Record<string, unknown> = { hotelCode: free, guestName: free }) => call("create_booking", args, as);

describe("an expected call, checked against its site's tool registry", () => {
  it("reads every site's registry, and the sign-in tools apart", () => {
    expect([...SITE_TOOLS.keys()]).toEqual(["hotels", "flights", "dining", "pizza", "cinema", "sports", "homes", "clinic", "events"]);
    expect([...hotels.keys()]).toContain("create_booking");
    expect([...hotels.keys()]).not.toContain("sign_in");
    expect(SIGN_IN_TOOLS).toEqual(["sign_up", "verify_email", "sign_in", "sign_out", "whoami"]);
  });

  it("takes a call the tool takes, and publishes the partial match: defaults and free fields left out", () => {
    expect(problem(booking())).toBeNull();
    expect(publishCall(booking(), hotels.get("create_booking"))).toEqual({ functionName: "create_booking", arguments: { roomCode: "HT-101-DBL", checkIn: "2027-10-04", nights: 2, adults: 2, guestEmail: "ada.byrne@example.com" } });
  });

  it("refuses a misspelled tool", () => {
    expect(problem(call("create_bookng", BOOKING))).toMatch(/create_bookng: the site has no such tool/);
  });

  it("refuses a misspelled argument, in the call and in what it publishes", () => {
    const { roomCode, ...rest } = BOOKING;
    expect(problem(booking({ ...rest, roomCod: roomCode }))).toMatch(/roomCod: the tool takes no such argument/);
    expect(problem(booking(BOOKING, { guestNam: free }))).toMatch(/publishes guestNam, which the call does not send/);
  });

  it("refuses an argument of the wrong type, and a call that leaves out one the tool needs", () => {
    expect(problem(booking({ ...BOOKING, checkIn: "4 October" }))).toMatch(/checkIn: "4 October" is not what the tool takes/);
    const { guestEmail: _email, ...noEmail } = BOOKING;
    expect(problem(booking(noEmail))).toMatch(/guestEmail: the tool needs it/);
  });

  it("refuses a constraint webmcp-evals would not read as meant", () => {
    expect(problem(booking(BOOKING, { guestName: { $patern: "^Ada" } }))).toMatch(/\$patern is no webmcp-evals constraint/);
    expect(problem(booking(BOOKING, { guestName: pattern("(?i)^ada") }))).toMatch(/no plain JavaScript regular expression/);
    expect(problem(booking(BOOKING, { nights: pattern("^2$") }))).toMatch(/\$pattern on a field that takes no string/);
    expect(problem(booking(BOOKING, { guestName: ["09:00"] }))).toMatch(/neither free nor a constraint/);
  });

  it("refuses a sign-in tool", () => {
    expect(problem(call("sign_in", { email: "ada.byrne@example.com", password: "x" }))).toMatch(/sign-in tool/);
  });

  it("holds a step's calls to the rule: writes for a change, reads for a question, none for an impossible request", () => {
    const at = { apps: ["hotels"] };
    expect(stepCalls([booking()], { ...at, kind: "state" }).problem).toBeUndefined();
    expect(stepCalls([call("get_hotel", { hotelCode: "HT-101" })], { ...at, kind: "state" }).problem).toMatch(/declares the writes it makes/);
    expect(stepCalls([], { ...at, kind: "state" }).problem).toMatch(/declares the writes it makes/);
    expect(stepCalls([], { ...at, kind: "state", noCall: "two tools make the same change" }).problem).toBeUndefined();
    expect(stepCalls([booking()], { ...at, kind: "json" }).problem).toMatch(/only reads/);
    expect(stepCalls([booking()], { ...at, kind: "state", impossible: true }).problem).toMatch(/impossible step declares no call/);
    expect(stepCalls(undefined, { ...at, kind: "json" }).problem).toMatch(/declares no expected calls/);
    expect(stepCalls([booking()], { apps: ["flights", "hotels"], kind: "state" }).problem).toMatch(/names which of them it is made on/);
  });
});

describe("a corpus whose template declares a call its site does not take", () => {
  const task = (calls: Call[]) => ({
    intent: "On the hotel booking site, book the Double room (HT-101-DBL) for Ada Byrne (ada.byrne@example.com).",
    summary: "One booking.",
    note: "fixture",
    rubric: R.change(["hotels"], "the room was booked"),
    oracle: { kind: "state", checks: [{ name: "booked", app: "hotels", path: "/api/v1/bookings", expect: { roomCode: "HT-101-DBL" } }] },
    calls,
    solve: async () => undefined,
  });
  const template = (calls: Call[]) => ({ key: "fixture-book", app: "hotels", oracle: "state", surfaces: ["tools"], count: 1, about: "fixture", candidates: () => [1], claims: () => [], build: () => task(calls) });

  it("is refused in webmcp-v1's build: a misspelled tool, a misspelled argument", () => {
    const rows = webmcpV1.generate(4242);
    const graded = (calls: Call[]) => deriveTemplated(rows, { seed: 4242, templates: [template(calls)], graded: true }).problems.join("; ");
    expect(graded([booking()])).toBe("");
    expect(graded([call("create_bookng", BOOKING)])).toMatch(/template "fixture-book": hotels: create_bookng: the site has no such tool/);
    const { roomCode, ...rest } = BOOKING;
    expect(graded([booking({ ...rest, roomCod: roomCode })])).toMatch(/template "fixture-book": hotels: create_booking: roomCod: the tool takes no such argument/);
  });

  it("is refused in cuj-v1's build: a misspelled tool, a misspelled argument", () => {
    const rows = cujV1.generate(4242);
    const cuj = (calls: Call[]) => ({
      key: "fixture-book",
      area: "book-it",
      surfaces: ["tools"],
      count: 1,
      about: "fixture",
      candidates: () => [1],
      claims: () => [],
      build: () => ({ apps: ["hotels"], target: "HT-101-DBL", effort: { reads: 0, writes: 1 }, summary: "One booking.", steps: [{ ...task(calls), kind: "state" }] }),
    });
    const problems = (calls: Call[]) => buildCujCorpus(rows, { seed: 4242, templates: [cuj(calls)] }).problems.filter((p: string) => !/^no (easy|medium|hard|impossible) task/.test(p)).join("; ");
    expect(problems([booking()])).toBe("");
    expect(problems([call("create_bookng", BOOKING)])).toMatch(/template fixture-book: step 1: hotels: create_bookng: the site has no such tool/);
    const { roomCode, ...rest } = BOOKING;
    expect(problems([booking({ ...rest, roomCod: roomCode })])).toMatch(/template fixture-book: step 1: hotels: create_booking: roomCod: the tool takes no such argument/);
  });
});
