import { readdirSync, readFileSync } from "node:fs";
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
const NOT_A_SPEC = new Set(["intent-tasks.json", "intent-corpus.json"]);

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

// A drift guard for the one manifest excluded above: intent-tasks.json is a
// PROJECTION of the real specs (id, app, intent, oracle kind, summary) for a
// benchmark consumer to copy — it must never name a task that doesn't have a
// matching, valid <taskId>.json spec sitting right next to it, and its
// `oracle` field (a kind string) must agree with the spec's actual kind.
describe("compose/specs/intent-tasks.json", () => {
  const manifest = JSON.parse(readFileSync(join(SPECS_DIR, "intent-tasks.json"), "utf8"));

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
describe("compose/specs/intent-corpus.json", () => {
  const manifest = JSON.parse(readFileSync(join(SPECS_DIR, "intent-tasks.json"), "utf8"));
  const corpus = JSON.parse(readFileSync(join(SPECS_DIR, "intent-corpus.json"), "utf8"));

  it("is intent-tasks.json, row for row, with each task's own spec as its key", () => {
    expect(corpus.map((r: { id: string }) => r.id)).toEqual(manifest.map((t: { id: string }) => t.id));
    for (const [i, row] of corpus.entries()) {
      const { key, ...publicRow } = row;
      expect(publicRow).toEqual(manifest[i]);
      const spec = taskSpecSchema.parse(JSON.parse(readFileSync(join(SPECS_DIR, `${row.id}.json`), "utf8")));
      expect(key).toEqual({ blind: spec.blind, oracle: spec.oracle });
    }
  });
});
