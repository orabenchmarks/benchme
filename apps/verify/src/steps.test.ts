import { describe, expect, it } from "vitest";
import { JsonOracle } from "./oracles/json-oracle.js";
import { OracleRegistry } from "./oracles/oracle.js";
import { StateOracle } from "./oracles/state-oracle.js";
import { taskSpecSchema } from "./specs/spec.js";
import { judgeTask } from "./steps.js";
import { FakeSites, T } from "./testing/fake-sites.js";

const ctx = { workspaceId: "ws_0123456789ab", taskId: "steps-test" };
const judge = (sites: FakeSites, spec: unknown, artifact: unknown = {}) =>
  judgeTask(taskSpecSchema.parse(spec), Buffer.from(JSON.stringify(artifact)), new OracleRegistry().register(new JsonOracle()).register(new StateOracle(sites)), ctx);

// A trip in three steps: book a hotel (state), say what it cost (an answer), then move the dinner to after check-in (state).
const booked = { kind: "ledger", name: "booked", match: { app: "hotels", entity: { type: "booking" }, action: "create", outcome: "ok" } };
const dinnerMoved = { kind: "ledger", name: "dinner moved", match: { app: "dining", entity: { type: "reservation", id: "RS-9" }, action: "change", outcome: "ok" }, after: "booked" };
const stillOne = { kind: "absent", name: "no second booking", app: "hotels", path: "/api/v1/bookings?status=confirmed", where: { guestEmail: "bram@example.com" } };
const state = (...checks: unknown[]) => ({ kind: "state", checks });
const answer = { kind: "json", expect: { total: 910 } };
const trip = { id: "cuj-trip-01", oracle: state(booked), steps: [{ oracle: answer }, { oracle: state(dinnerMoved, stillOne) }] };

const hotelBooked = { entity: { type: "booking", id: "BK-1" }, action: "create", at: T(2, 482) };
const dinnerChanged = { entity: { type: "reservation", id: "RS-9" }, action: "change", at: T(9) };
/** The sites after a run that did all of it, in order. */
const done = () => new FakeSites().seed("hotels", stillOne.path, []).ledger("hotels", [hotelBooked]).ledger("dining", [dinnerChanged]);

describe("a task with steps", () => {
  it("is answered with each state step's result: every check's name, whether it passed, and when what satisfied it happened", async () => {
    const result = await judge(done(), trip);
    expect(result.verdict).toBe("OK");
    expect(result.steps).toEqual([
      { step: 1, verdict: "OK", checks: [{ name: "booked", passed: true, at: "2027-03-01T10:02:00.482Z" }] },
      { step: 3, verdict: "OK", checks: [{ name: "dinner moved", passed: true, at: "2027-03-01T10:09:00.000Z" }, { name: "no second booking", passed: true }] },
    ]);
  });

  it("counts steps from 1, the task's own prompt, and does not list a step that is answered in a reply", async () => {
    expect((await judge(done(), trip)).steps!.map((s) => s.step)).toEqual([1, 3]);
    // The same task with the answer first: its state steps are steps 2 and 3.
    const answerFirst = { id: "cuj-trip-02", oracle: answer, steps: [{ oracle: state(booked) }, { oracle: state(dinnerMoved, stillOne) }] };
    expect((await judge(done(), answerFirst)).steps!.map((s) => s.step)).toEqual([2, 3]);
  });

  it("is OK only when every state step is OK: one step's failure fails the task and leaves the other's result standing", async () => {
    // Step 3 undone: the dinner was never moved.
    const noDinner = await judge(new FakeSites().seed("hotels", stillOne.path, []).ledger("hotels", [hotelBooked]).ledger("dining", []), trip);
    expect([noDinner.verdict, noDinner.steps!.map((s) => [s.step, s.verdict])]).toEqual(["FAIL", [[1, "OK"], [3, "FAIL"]]]);
    expect(noDinner.steps![1]).toEqual({ step: 3, verdict: "FAIL", checks: [{ name: "dinner moved", passed: false }, { name: "no second booking", passed: true }] });
    // Step 1 undone: nothing was booked, so nothing came after it either.
    const noHotel = await judge(new FakeSites().seed("hotels", stillOne.path, []).ledger("hotels", []).ledger("dining", [dinnerChanged]), trip);
    expect([noHotel.verdict, noHotel.steps!.map((s) => [s.step, s.verdict])]).toEqual(["FAIL", [[1, "FAIL"], [3, "FAIL"]]]);
  });

  it("lets a later step's check come after an earlier step's: the same change, made before the booking, does not pass step 3", async () => {
    const early = new FakeSites().seed("hotels", stillOne.path, []).ledger("hotels", [hotelBooked]).ledger("dining", [{ ...dinnerChanged, at: T(1) }]);
    expect((await judge(early, trip)).steps![1]).toMatchObject({ step: 3, verdict: "FAIL", checks: [{ name: "dinner moved", passed: false }, { name: "no second booking", passed: true }] });
  });

  it("never judges a reply: whatever is submitted, a json step neither passes nor fails the task", async () => {
    for (const artifact of [{}, { total: 910 }, { total: 1 }]) expect((await judge(done(), trip, artifact)).verdict).toBe("OK");
    const answerFirst = { id: "cuj-trip-02", oracle: answer, steps: [{ oracle: state(booked) }] };
    expect((await judge(done(), answerFirst, { total: 1 })).verdict).toBe("OK");
  });

  it("gives the receipt's details every check that was judged, in order, in the shape they always had", async () => {
    const result = await judge(new FakeSites().seed("hotels", stillOne.path, []).ledger("hotels", [hotelBooked]).ledger("dining", []), trip);
    expect(result.checks.map((c) => [c.name, c.ok])).toEqual([["booked", true], ["dinner moved", false], ["no second booking", true]]);
  });

  it("reads each site's ledger once for the whole submission, and current state only: asked again, it answers the same", async () => {
    const twoStepsOneApp = { id: "cuj-two-01", oracle: state({ ...booked, name: "first" }), steps: [{ oracle: state({ ...booked, name: "second" }) }] };
    const sites = done();
    const first = await judge(sites, twoStepsOneApp);
    expect(sites.ledgerReads).toBe(1);
    expect(await judge(sites, twoStepsOneApp)).toEqual(first);
    expect(sites.ledgerReads).toBe(2);
  });

  it("is refused when no step of several has state to check: its replies are graded against the key, not here", async () => {
    const allAnswers = { id: "cuj-talk-01", oracle: answer, steps: [{ oracle: answer }] };
    await expect(judge(done(), allAnswers, { total: 910 })).rejects.toMatchObject({ code: "NO_STATE_STEP", status: 422 });
  });

  it("carries counts and no check's name when the task is blind", async () => {
    const result = await judge(new FakeSites().seed("hotels", stillOne.path, []).ledger("hotels", [hotelBooked]).ledger("dining", []), { ...trip, blind: true });
    expect(result.steps).toEqual([{ step: 1, verdict: "OK", passed: 1, failed: 0 }, { step: 3, verdict: "FAIL", passed: 1, failed: 1 }]);
    expect(JSON.stringify(result.steps)).not.toMatch(/booked|dinner/);
  });
});

describe("a task of one step", () => {
  const oneState = { id: "t-one-state", oracle: state(booked) };
  const oneAnswer = { id: "t-one-answer", oracle: answer };

  it("is judged as it always was when its spec declares no steps, and is answered with no steps", async () => {
    const stateResult = await judge(done(), oneState);
    expect(stateResult).toEqual({ verdict: "OK", checks: [{ name: "booked", ok: true, at: T(2, 482) }] });
    expect("steps" in stateResult).toBe(false);
    expect(await judge(done(), oneAnswer, { total: 910 })).toEqual({ verdict: "OK", checks: [{ name: "parse", ok: true }, { name: "total", ok: true, note: undefined }] });
    expect((await judge(done(), oneAnswer, { total: 1 })).verdict).toBe("FAIL");
  });

  it("declaring an empty list of steps adds the step's result and changes nothing else", async () => {
    const plain = await judge(done(), oneState);
    const stepped = await judge(done(), { ...oneState, steps: [] });
    expect(stepped).toEqual({ ...plain, steps: [{ step: 1, verdict: "OK", checks: [{ name: "booked", passed: true, at: T(2, 482) }] }] });
    // An answer is still judged from the artifact, as on any task of one step; it has no state step to list.
    expect(await judge(done(), { ...oneAnswer, steps: [] }, { total: 910 })).toMatchObject({ verdict: "OK", steps: [] });
    expect(await judge(done(), { ...oneAnswer, steps: [] }, { total: 1 })).toMatchObject({ verdict: "FAIL", steps: [] });
  });
});

describe("the spec of a task with steps", () => {
  const parse = (spec: unknown) => taskSpecSchema.parse(spec);

  it("keeps a spec without steps exactly as it was: nothing is added to it", () => {
    const written = { id: "t-plain", blind: false, oracle: { kind: "state", checks: [{ name: "shipped", app: "warehouse", path: "/api/v1/orders", expect: { status: "shipped" } }] } };
    expect(parse(written)).toEqual(written);
  });

  it("takes up to seven follow-up steps, each an answer or the sites' state", () => {
    const follow = (n: number) => Array.from({ length: n }, (_, i) => ({ oracle: state({ ...booked, name: `step ${i + 2}` }) }));
    expect(parse({ ...trip, steps: follow(7) }).steps).toHaveLength(7);
    expect(() => parse({ ...trip, steps: follow(8) })).toThrow();
    expect(() => parse({ ...trip, steps: [{ oracle: { kind: "xlsx", sheets: [] } }] })).toThrow();
    expect(() => parse({ ...trip, steps: [{ oracle: answer, hint: "x" }] })).toThrow(/hint/);
  });

  it("refuses steps on a task whose own oracle is a document or a patch", () => {
    expect(() => parse({ id: "t-doc", oracle: { kind: "docx", contains: ["x"] }, steps: [] })).toThrow(/a task with steps has a json or state oracle, not docx/);
  });

  it("names each check once across the steps, so an answer and an `after` can tell them apart", () => {
    expect(() => parse({ ...trip, steps: [{ oracle: state({ ...dinnerMoved, name: "booked" }) }] })).toThrow(/is named twice in the task/);
    // A task that declares no steps is held to what it always was.
    expect(() => parse({ id: "t-dup", oracle: state({ ...booked }, { ...booked }) })).not.toThrow();
  });

  it("lets `after` name a check of an earlier step, and no check of a later one", () => {
    expect(() => parse(trip)).not.toThrow();
    expect(() => parse({ id: "cuj-backwards-01", oracle: state(dinnerMoved), steps: [{ oracle: state(booked) }] })).toThrow(/no earlier check is called/);
  });
});
