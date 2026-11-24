import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { taskSpecSchema } from "./spec.js";

const here = dirname(fileURLToPath(import.meta.url));
// compose/specs is the repo-root dir mounted read-only at /specs in the
// verifier container (see compose/specs/README.md) — every file there must
// be a valid TaskSpec, and every task the corpus tools emit must round-trip.
const SPECS_DIR = join(here, "..", "..", "..", "..", "compose", "specs");

// Files in compose/specs that are NOT a TaskSpec: corpus tools may also drop
// a public manifest there (e.g. intent-tasks.json, the [{id, app, intent,
// oracle, summary}] array tools/intent-corpus.mjs emits for a benchmark
// consumer to copy, and intent-corpus.json, the same rows with their answer
// keys) alongside the <taskId>.json specs themselves. The
// verifier's own FsSpecRegistry never parses these — it only ever reads one
// <taskId>.json by exact id — so they're excluded here rather than forced
// into taskSpecSchema's shape.
// Each scenario's corpus has its own pair (tools/intent-corpus/corpus.mjs CORPORA): acme-v1's intent-*, webmcp-v1's webmcp-*.
const PROJECTIONS = [
  { tasks: "intent-tasks.json", corpus: "intent-corpus.json" },
  { tasks: "webmcp-tasks.json", corpus: "webmcp-corpus.json" },
] as const;
// cuj-v1's pair holds records of another shape (an area, a level, steps): docs/scenarios/cuj-v1.md.
const CUJ = { tasks: "cuj-tasks.json", corpus: "cuj-corpus.json" } as const;
// The expected calls of webmcp-v1 and cuj-v1 as webmcp-evals suites: answer-key material, never a spec.
const SUITES = { "webmcp-v1": "webmcp-v1.webmcp-evals.json", "cuj-v1": "cuj-v1.webmcp-evals.json" } as const;
const NOT_A_SPEC = new Set<string>([...PROJECTIONS.flatMap((p) => [p.tasks, p.corpus]), CUJ.tasks, CUJ.corpus, ...Object.values(SUITES)]);

describe("compose/specs", () => {
  const files = readdirSync(SPECS_DIR).filter((f) => f.endsWith(".json") && !NOT_A_SPEC.has(f));

  it("has at least one spec file to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`${file} parses with taskSpecSchema and id matches the filename`, () => {
      const raw = JSON.parse(readFileSync(join(SPECS_DIR, file), "utf8"));
      const spec = taskSpecSchema.parse(raw);
      expect(spec.id).toBe(file.replace(/\.json$/, ""));
    });
  }
});

// A drift guard for each manifest excluded above: intent-tasks.json (and
// webmcp-tasks.json, its webmcp-v1 twin) is a PROJECTION of the real specs (id, app, intent, oracle kind, summary) for a
// benchmark consumer to copy — it must never name a task that doesn't have a
// matching, valid <taskId>.json spec sitting right next to it, and its
// `oracle` field (a kind string) must agree with the spec's actual kind.
for (const projection of PROJECTIONS) {
  describe(`compose/specs/${projection.tasks}`, () => {
    const manifest = JSON.parse(readFileSync(join(SPECS_DIR, projection.tasks), "utf8"));

    it("is an array of {id, app, intent, oracle, summary}", () => {
      expect(Array.isArray(manifest)).toBe(true);
      expect(manifest.length).toBeGreaterThan(0);
      for (const t of manifest) {
        expect(t).toMatchObject({ id: expect.any(String), app: expect.any(String), intent: expect.any(String), oracle: expect.any(String), summary: expect.any(String) });
      }
    });

    it("every listed task has a matching, valid spec file whose oracle kind agrees", () => {
      for (const t of manifest) {
        const raw = JSON.parse(readFileSync(join(SPECS_DIR, `${t.id}.json`), "utf8"));
        const spec = taskSpecSchema.parse(raw);
        expect(spec.id).toBe(t.id);
        expect(spec.oracle.kind).toBe(t.oracle);
      }
    });

    it("no json-oracle task's intent leaks its own expected answer value", () => {
      for (const t of manifest) {
        if (t.oracle !== "json") continue;
        const spec = taskSpecSchema.parse(JSON.parse(readFileSync(join(SPECS_DIR, `${t.id}.json`), "utf8")));
        if (spec.oracle.kind !== "json") continue;
        for (const expected of Object.values(spec.oracle.expect)) {
          if (typeof expected === "number" || typeof expected === "string") {
            expect(t.intent.toLowerCase().includes(String(expected).toLowerCase())).toBe(false);
          }
        }
      }
    });
  });

  // The drift guard for the OTHER projection: intent-corpus.json is
  // intent-tasks.json's rows with each task's answer key beside them, for a
  // platform that grades the answers itself — so each row must be exactly the
  // public row plus the verifier's own spec, or that platform grades something
  // the verifier never would.
  describe(`compose/specs/${projection.corpus}`, () => {
    const manifest = JSON.parse(readFileSync(join(SPECS_DIR, projection.tasks), "utf8"));
    const corpus = JSON.parse(readFileSync(join(SPECS_DIR, projection.corpus), "utf8"));

    it(`is ${projection.tasks}, row for row, with each task's own spec as its key (and, in webmcp-v1's, its expected calls)`, () => {
      expect(corpus.map((r: { id: string }) => r.id)).toEqual(manifest.map((t: { id: string }) => t.id));
      for (const [i, row] of corpus.entries()) {
        const { key, ...publicRow } = row;
        expect(publicRow).toEqual(manifest[i]);
        const spec = taskSpecSchema.parse(JSON.parse(readFileSync(join(SPECS_DIR, `${row.id}.json`), "utf8")));
        const { expectedCall, ...keyLess } = key;
        expect(keyLess).toEqual({ blind: spec.blind, oracle: spec.oracle });
        if (projection.corpus === "intent-corpus.json") expect(expectedCall).toBeUndefined();
      }
    });
  });
}

// The drift guards of cuj-v1's records: the shape the contract fixes, a public file that is the records less their
// keys, `stateChecked` present (and true) exactly when a step's oracle is a state check, and each key the
// verifier's own spec.
describe(`compose/specs/${CUJ.corpus}`, () => {
  type Step = { intent: string; rubric: string[]; kind: string };
  type Oracle = { kind: string; [k: string]: unknown };
  type CujRecord = {
    id: string; area: string; level: string; veryHard: boolean; apps: string[]; app: string; surfaces: string[]; intent: string; rubric: string[];
    steps: Step[]; kind: string; stateChecked?: true; summary: string; key: { blind: boolean; oracle: Oracle; steps: { oracle: Oracle }[] };
  };
  const corpus: CujRecord[] = JSON.parse(readFileSync(join(SPECS_DIR, CUJ.corpus), "utf8"));
  const tasks = JSON.parse(readFileSync(join(SPECS_DIR, CUJ.tasks), "utf8"));
  const AREAS = ["find-the-fit", "price-it", "book-it", "book-the-best", "change-it", "cancel-it", "return-or-repeat", "act-as-yourself", "carry-a-conversation", "plan-across-sites"];
  const LEVELS = ["easy", "medium", "hard", "impossible"];

  it("is one record per task in the contract's shape, fields in its order", () => {
    expect(corpus.length).toBeGreaterThan(0);
    for (const r of corpus) {
      const fields = ["id", "area", "level", "veryHard", "apps", "app", "surfaces", "intent", "rubric", "steps", "kind", ...("stateChecked" in r ? ["stateChecked"] : []), "summary", "key"];
      expect(Object.keys(r)).toEqual(fields);
      expect(r.id).toMatch(/^cuj-[a-z0-9-]+-\d{2}$/);
      expect(AREAS).toContain(r.area);
      expect(LEVELS).toContain(r.level);
      expect(r.veryHard === true ? r.level : "hard").toBe("hard");
      expect(r.apps.length >= 1 && r.apps.length <= 4).toBe(true);
      expect(r.app).toBe(r.apps[0]);
      expect(r.steps.length).toBeLessThanOrEqual(7);
      expect(r.rubric.length >= 2 && r.rubric.length <= 6).toBe(true);
      for (const s of r.steps) expect(s.rubric.length >= 1 && s.rubric.length <= 6).toBe(true);
      for (const c of [...r.rubric, ...r.steps.flatMap((s) => s.rubric)]) expect(c.length).toBeLessThanOrEqual(300);
      expect(r.key.oracle.kind).toBe(r.kind);
      expect(r.key.steps.map((s) => s.oracle.kind)).toEqual(r.steps.map((s) => s.kind));
    }
  });

  it("carries `stateChecked: true` exactly when step 1's oracle or a follow-up's is a state check, and no field otherwise", () => {
    for (const r of corpus) {
      const checked = [r.key.oracle, ...r.key.steps.map((s) => s.oracle)].some((o) => o.kind === "state");
      expect("stateChecked" in r).toBe(checked);
      if (checked) expect(r.stateChecked).toBe(true);
    }
    // Some tasks are answered in replies alone, so the absence is there to see.
    expect(corpus.some((r) => !("stateChecked" in r))).toBe(true);
  });

  it("has no record, public or graded, with `stateChecked: false`: a consumer reads the field's presence", () => {
    for (const r of [...corpus, ...tasks]) expect((r as { stateChecked?: unknown }).stateChecked).not.toBe(false);
  });

  it(`has ${CUJ.tasks} as its records less their keys, row for row`, () => {
    expect(tasks).toEqual(corpus.map(({ key: _key, ...rest }) => rest));
  });

  it("has each key as its task's own spec, and a spec for every task the verifier can check", () => {
    for (const r of corpus) {
      const file = join(SPECS_DIR, `${r.id}.json`);
      // A task whose every step is answered in a reply gives the verifier nothing to check (422 NO_STATE_STEP).
      const checkable = r.stateChecked || r.steps.length === 0;
      expect(existsSync(file)).toBe(checkable);
      if (!checkable) continue;
      const spec = taskSpecSchema.parse(JSON.parse(readFileSync(file, "utf8")));
      // The key is the spec and the expected calls beside its oracles, which are not the verifier's to read.
      const { expectedCall: _calls, steps, ...key } = r.key as CujRecord["key"] & { expectedCall?: unknown };
      expect({ blind: spec.blind, oracle: spec.oracle, steps: spec.steps }).toEqual({ ...key, steps: steps.map(({ oracle }) => ({ oracle })) });
    }
  });

  it("covers every area at every level, but easy in the two areas that have none", () => {
    for (const area of AREAS) {
      for (const level of LEVELS) {
        const n = corpus.filter((r) => r.area === area && r.level === level).length;
        if (level === "easy" && (area === "carry-a-conversation" || area === "plan-across-sites")) expect(n).toBe(0);
        else expect(n).toBeGreaterThan(0);
      }
    }
  });

  // tools/intent-corpus/cuj/actors.mjs: a run that changed something signed in as someone it was not asked to act
  // as fails its task, whichever template the task came from.
  const GUARD = "no change made as anyone else";
  type Check = { kind?: string; name: string; scope?: { apps: string[]; actor?: string }[] };
  const oraclesOf = (r: CujRecord) => [r.key.oracle, ...r.key.steps.map((s) => s.oracle)];
  const checksOf = (o: Oracle) => (o.kind === "state" ? (o.checks as Check[]) : []);

  it("holds every task that changes something to no change made as anyone else, on its last state step only", () => {
    for (const r of corpus.filter((x) => x.stateChecked)) {
      const states = oraclesOf(r).filter((o) => o.kind === "state");
      const guards = states.map((o) => checksOf(o).filter((c) => c.name === GUARD));
      expect(guards.slice(0, -1).flat()).toEqual([]);
      const [guard] = guards.at(-1) ?? [];
      expect(guard?.kind).toBe("unchanged");
      for (const s of guard?.scope ?? []) {
        expect(r.apps).toEqual(expect.arrayContaining(s.apps));
        expect(s.actor).toMatch(/@/);
      }
    }
  });

  it("never holds a task to its own person: no one the task signs in as is in its guard's scope", () => {
    for (const r of corpus.filter((x) => x.stateChecked)) {
      const others = oraclesOf(r).map((o) => (o.kind === "state" ? { ...o, checks: checksOf(o).filter((c) => c.name !== GUARD) } : o));
      const own = new Set(JSON.stringify(others).match(/"actor":"[^"]+"/g)?.map((m) => m.slice(9, -1).toLowerCase()) ?? []);
      const guard = checksOf(oraclesOf(r).filter((o) => o.kind === "state").at(-1)!).find((c) => c.name === GUARD);
      for (const s of guard?.scope ?? []) expect(own.has(s.actor!)).toBe(false);
    }
  });

  // A "which one" question reads the same whether an option meets every requirement or none does (kit.mjs
  // `whichAnswer`, `R.which`): its key says which.
  it("asks every which-one question in one shape, and keys it by `found`", () => {
    const which = corpus.filter((r) => r.intent.includes(`or {"found": false}`));
    expect(which.length).toBeGreaterThan(0);
    const none = which.filter((r) => r.key.oracle.kind === "json" && (r.key.oracle.expect as Record<string, unknown>).found === false);
    expect(none.length).toBeGreaterThan(0);
    for (const r of which) {
      expect(r.kind).toBe("json");
      expect(r.steps).toEqual([]);
      const expectFound = (r.key.oracle.expect as Record<string, unknown>).found;
      expect(r.intent).toMatch(/Answer as JSON: \{"found": true, .+\}, or \{"found": false\} if none (does|is in stock)\.$/);
      expect(r.rubric[0]).toMatch(/, or says that none (does|is in stock), as /);
      if (expectFound === false) {
        expect(r.level).toBe("impossible");
        expect(Object.keys(r.key.oracle.expect as object)).toEqual(["found"]);
      } else expect(expectFound).toBe(true);
    }
  });
});

// The corpora share one spec directory, so a task id two of them list would be one key graded as two tasks.
describe("compose/specs corpora", () => {
  it("never list the same task id twice", () => {
    const ids = [...PROJECTIONS.map((p) => p.tasks), CUJ.tasks].flatMap((f) => JSON.parse(readFileSync(join(SPECS_DIR, f), "utf8")).map((t: { id: string }) => t.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ─── Graded records: judge criteria and expected calls (tools/intent-corpus/rubrics.mjs, calls.mjs) ────────────────

const readSpecs = (file: string) => JSON.parse(readFileSync(join(SPECS_DIR, file), "utf8"));
const WEBMCP = PROJECTIONS[1];
/** The rules a criterion follows in every corpus that has them (tools/intent-corpus/rubrics.mjs). */
const NOT_IN_A_RUBRIC = /\b(mcp|webmcp|rest|api|endpoint|tool|tools|browser|click|curl|json|markdown|bullets?|formatted|concise|polite|tone)\b/i;

describe(`compose/specs/${WEBMCP.corpus} judge criteria`, () => {
  const corpus = readSpecs(WEBMCP.corpus);
  const tasks = readSpecs(WEBMCP.tasks);

  it("gives every record a rubric right after its intent: 2 to 6 criteria of at most 300 characters, none naming a door or a reply style", () => {
    expect(corpus.length).toBeGreaterThan(0);
    for (const [i, r] of corpus.entries()) {
      expect(Object.keys(r)).toEqual(["id", "surfaces", "app", "intent", "rubric", "oracle", "summary", "key"]);
      expect(Object.keys(tasks[i])).toEqual(["id", "surfaces", "app", "intent", "rubric", "oracle", "summary"]);
      expect(r.rubric.length >= 2 && r.rubric.length <= 6).toBe(true);
      for (const c of r.rubric) {
        expect(typeof c === "string" && c.trim().length > 0 && c.length <= 300).toBe(true);
        expect(c).not.toMatch(NOT_IN_A_RUBRIC);
      }
    }
  });

  it("states no value its key expects in a criterion", () => {
    for (const r of corpus) {
      if (r.key.oracle.kind !== "json") continue;
      for (const v of Object.values(r.key.oracle.expect as Record<string, unknown>)) {
        if (typeof v === "string" || (typeof v === "number" && Math.abs(v) >= 10)) for (const c of r.rubric) expect(c.toLowerCase()).not.toContain(String(v).toLowerCase());
      }
    }
  });

  it("leaves acme-v1's records as they were: no rubric, no expected calls", () => {
    for (const r of readSpecs(PROJECTIONS[0].corpus)) {
      expect(r).not.toHaveProperty("rubric");
      expect(r.key).not.toHaveProperty("expectedCall");
    }
  });
});

describe("expected calls (in webmcp-evals' shape)", () => {
  type Call = { functionName: string; arguments: Record<string, unknown> };
  type Oracle = { kind: string; checks?: { kind?: string; match?: unknown }[]; [k: string]: unknown };
  type Step = { id: string; n: number; stepped: boolean; apps: string[]; kind: string; oracle: Oracle; calls?: Call[]; intents: string[] };
  /** Every step of webmcp-v1 and cuj-v1, in corpus order, with its key's calls. */
  const stepsOf: Record<keyof typeof SUITES, Step[]> = {
    "webmcp-v1": readSpecs(WEBMCP.corpus).map((r: { id: string; app: string; intent: string; oracle: string; key: { oracle: Oracle; expectedCall?: Call[] } }) => ({
      id: r.id, n: 1, stepped: false, apps: [r.app], kind: r.oracle, oracle: r.key.oracle, calls: r.key.expectedCall, intents: [r.intent],
    })),
    "cuj-v1": readSpecs(CUJ.corpus).flatMap((r: { id: string; apps: string[]; intent: string; kind: string; steps: { intent: string; kind: string }[]; key: { oracle: Oracle; expectedCall?: Call[]; steps: { oracle: Oracle; expectedCall?: Call[] }[] } }) => {
      const intents = [r.intent, ...r.steps.map((s) => s.intent)];
      const all = [{ kind: r.kind, oracle: r.key.oracle, calls: r.key.expectedCall }, ...r.steps.map((s, i) => ({ kind: s.kind, oracle: r.key.steps[i]!.oracle, calls: r.key.steps[i]!.expectedCall }))];
      return all.map((s, i) => ({ id: r.id, n: i + 1, stepped: r.steps.length > 0, apps: r.apps, ...s, intents: intents.slice(0, i + 1) }));
    }),
  };
  const every = [...stepsOf["webmcp-v1"], ...stepsOf["cuj-v1"]];
  const SIGN_IN = ["sign_up", "verify_email", "sign_in", "sign_out", "whoami"];
  /** The sites' writes, by the one naming every site keeps (tools/intent-corpus/expected-calls.mjs `isWrite`). */
  const WRITE = /^(create|cancel|change|place|request|register|book|reorder)(_|$)/;
  type Matcher = { outcome?: string; action?: string };
  const matchers = (o: Oracle) => (o.checks ?? []).filter((c) => c.kind === "ledger").flatMap((c) => [c.match].flat() as Matcher[]);
  /**
   * A state step that changes something: one of its checks stands on a row, or on a write the ledger shows made. An
   * impossible step's checks say nothing changed, and that the agent looked or was refused: a refusal is what one
   * of them stands on, and no changing step's check does.
   */
  const changes = (o: Oracle) =>
    o.kind === "state" &&
    !matchers(o).some((m) => m.outcome === "refused") &&
    ((o.checks ?? []).some((c) => (c.kind ?? "row") === "row") || matchers(o).some((m) => m.outcome === "ok" && !["read", "verify", "sign_in", "sign_up"].includes(m.action ?? "")));
  /** The one change no single call makes: a repeat, which `reorder` and a new `place_order` of the same lines make alike (the templates' `noCall`). */
  const NO_ONE_WRITE = /-reorder-/;

  it("sit in the keys only: no public record and no verifier spec carries one", () => {
    for (const file of [WEBMCP.tasks, CUJ.tasks, PROJECTIONS[0].tasks]) expect(readFileSync(join(SPECS_DIR, file), "utf8")).not.toMatch(/"(expectedCall|functionName)"/);
    for (const file of readdirSync(SPECS_DIR).filter((f) => f.endsWith(".json") && !NOT_A_SPEC.has(f))) expect(readFileSync(join(SPECS_DIR, file), "utf8")).not.toContain('"expectedCall"');
    expect(every.filter((s) => s.calls).length).toBeGreaterThan(0);
  });

  it("are a non-empty list of { functionName, arguments }, arguments a partial match in webmcp-evals' constraint vocabulary, never a sign-in tool", () => {
    const OPS: Record<string, (v: unknown) => boolean> = {
      $pattern: (v) => typeof v === "string" && (() => { try { new RegExp(v); return true; } catch { return false; } })(),
      $contains: (v) => typeof v === "string",
      $lte: (v) => typeof v === "number", $gte: (v) => typeof v === "number", $lt: (v) => typeof v === "number", $gt: (v) => typeof v === "number",
      $type: (v) => ["string", "number", "boolean", "array", "object", "null"].includes(v as string),
      $any: (v) => v === true,
    };
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) return v.forEach(walk);
      if (!v || typeof v !== "object") return;
      const keys = Object.keys(v);
      const ops = keys.filter((k) => k.startsWith("$"));
      // An object is a constraint (every key an operator webmcp-evals reads) or a partial object (none is): never both.
      expect(ops.length === 0 || ops.length === keys.length).toBe(true);
      for (const k of ops) expect([k, OPS[k]?.((v as Record<string, unknown>)[k]) ?? false]).toEqual([k, true]);
      if (!ops.length) Object.values(v).forEach(walk);
    };
    for (const s of every.filter((x) => x.calls)) {
      expect(s.calls!.length).toBeGreaterThan(0);
      for (const c of s.calls!) {
        expect(Object.keys(c)).toEqual(["functionName", "arguments"]);
        expect(c.functionName).toMatch(/^[a-z][a-z_]*$/);
        expect(SIGN_IN).not.toContain(c.functionName);
        expect(c.arguments !== null && typeof c.arguments === "object" && !Array.isArray(c.arguments)).toBe(true);
        walk(c.arguments);
      }
    }
  });

  it("give every state step that changes something its writes, a question only reads, and a step that changes nothing none", () => {
    for (const s of every) {
      const at = `${s.id} step ${s.n}`;
      const names = (s.calls ?? []).map((c) => c.functionName);
      if (s.kind === "json") expect([at, names.filter((n) => WRITE.test(n))]).toEqual([at, []]);
      else if (!changes(s.oracle)) expect([at, names]).toEqual([at, []]);
      else if (NO_ONE_WRITE.test(s.id)) expect([at, names]).toEqual([at, []]);
      else {
        expect([at, names.length > 0]).toEqual([at, true]);
        expect([at, names.filter((n) => !WRITE.test(n))]).toEqual([at, []]);
      }
    }
    // The exception is there to see: changes that no single call makes, none of them given one.
    expect(every.filter((s) => NO_ONE_WRITE.test(s.id) && changes(s.oracle)).length).toBeGreaterThan(0);
  });

  for (const [scenario, file] of Object.entries(SUITES) as [keyof typeof SUITES, string][]) {
    it(`are compose/specs/${file}: one webmcp-evals case per step that has them, its prompts so far and its calls`, () => {
      const suite = readSpecs(file);
      const want = stepsOf[scenario].filter((s) => s.calls);
      expect(suite.length).toBe(want.length);
      for (const [i, s] of want.entries()) {
        const c = suite[i];
        expect(Object.keys(c)).toEqual(["name", "messages", "expectedCall"]);
        const name = new RegExp(`^${s.id}${s.stepped ? ` step ${s.n}` : ""} \\(([a-z, ]+)\\)$`).exec(c.name);
        expect([c.name, !!name]).toEqual([c.name, true]);
        for (const app of name![1]!.split(", ")) expect(s.apps).toContain(app);
        expect(c.messages).toEqual(s.intents.map((content) => ({ role: "user", type: "message", content })));
        expect(c.expectedCall).toEqual(s.calls!.length === 1 ? s.calls : [{ unordered: s.calls }]);
      }
    });
  }
});
