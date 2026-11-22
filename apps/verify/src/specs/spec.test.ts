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
const NOT_A_SPEC = new Set<string>([...PROJECTIONS.flatMap((p) => [p.tasks, p.corpus]), CUJ.tasks, CUJ.corpus]);

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

    it(`is ${projection.tasks}, row for row, with each task's own spec as its key`, () => {
      expect(corpus.map((r: { id: string }) => r.id)).toEqual(manifest.map((t: { id: string }) => t.id));
      for (const [i, row] of corpus.entries()) {
        const { key, ...publicRow } = row;
        expect(publicRow).toEqual(manifest[i]);
        const spec = taskSpecSchema.parse(JSON.parse(readFileSync(join(SPECS_DIR, `${row.id}.json`), "utf8")));
        expect(key).toEqual({ blind: spec.blind, oracle: spec.oracle });
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
      expect({ blind: spec.blind, oracle: spec.oracle, steps: spec.steps }).toEqual(r.key);
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
});

// The corpora share one spec directory, so a task id two of them list would be one key graded as two tasks.
describe("compose/specs corpora", () => {
  it("never list the same task id twice", () => {
    const ids = [...PROJECTIONS.map((p) => p.tasks), CUJ.tasks].flatMap((f) => JSON.parse(readFileSync(join(SPECS_DIR, f), "utf8")).map((t: { id: string }) => t.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
});
