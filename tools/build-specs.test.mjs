/**
 * build-specs turns a benchme-hidden checkout into the verifier's specs — and, with --public, also carries the
 * public corpora's answer keys, so a cluster's verifier (which reads ONE ConfigMap) grades the intent tasks that
 * `docker compose` grades from compose/specs.
 *
 * Each test builds a throwaway hidden checkout and a throwaway public directory; nothing of a real task is read.
 *
 * Not part of the vitest workspace (that covers packages/* and apps/* only):
 *   node --test tools/build-specs.test.mjs
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { after, test } from "node:test";

const tool = join(dirname(fileURLToPath(import.meta.url)), "build-specs.mjs");
const scratch = [];
after(() => scratch.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const spec = (id, kind) => ({ id, blind: false, oracle: kind === "json" ? { kind, expect: { answer: 1 } } : { kind, checks: [] } });

/** A hidden checkout with one json task, and a public directory holding `files` (name → content). */
function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), "build-specs-"));
  scratch.push(root);
  const task = join(root, "hidden", "tasks", "docs-fixture-01");
  mkdirSync(task, { recursive: true });
  writeFileSync(join(task, "spec.json"), JSON.stringify(spec("docs-fixture-01", "json")));
  writeFileSync(join(task, "solution"), "{}");
  writeFileSync(join(task, "wrong"), "{}");
  const pub = join(root, "public");
  mkdirSync(pub);
  for (const [name, content] of Object.entries(files)) writeFileSync(join(pub, name), typeof content === "string" ? content : JSON.stringify(content));
  return { root, hidden: join(root, "hidden"), pub, out: join(root, "specs-cm.yaml") };
}

function run(f, extra) {
  const res = spawnSync(process.execPath, [tool, "--hidden", f.hidden, "--configmap", "specs", "--namespace", "benchme", "--out", f.out, ...extra], { encoding: "utf8" });
  return { status: res.status, stderr: res.stderr, printed: res.status === 0 ? JSON.parse(res.stdout) : null };
}

/** The ConfigMap's data: key → the spec it holds. Every data line is `  <key>: <a JSON string of the spec's JSON>`. */
function data(out) {
  const lines = readFileSync(out, "utf8").split("\n");
  const entries = lines.slice(lines.indexOf("data:") + 1).filter(Boolean);
  return Object.fromEntries(entries.map((line) => [line.slice(2, line.indexOf(": ")), JSON.parse(JSON.parse(line.slice(line.indexOf(": ") + 2)))]));
}

const PUBLIC = {
  "intent-answer-01.json": spec("intent-answer-01", "json"),
  "intent-change-01.json": spec("intent-change-01", "state"),
  // The corpora's public lists: arrays of tasks, never a spec.
  "intent-tasks.json": [{ id: "intent-answer-01", intent: "…" }],
  // compose's own smoke: a patch spec with a busybox runner.
  "code-smoke-01.json": { id: "code-smoke-01", blind: false, oracle: { kind: "patch", runnerImage: "busybox:1.36" } },
};

test("without --public the ConfigMap holds the hidden tasks alone", () => {
  const f = fixture(PUBLIC);
  const res = run(f, []);
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(Object.keys(data(f.out)), ["docs-fixture-01.json"]);
  assert.deepEqual({ hidden: res.printed.hidden, public: res.printed.public }, { hidden: 1, public: 0 });
});

test("--public adds every json and state spec of the directory, passes over its lists, and leaves a patch spec out by name", () => {
  const f = fixture(PUBLIC);
  const res = run(f, ["--public", f.pub]);
  assert.equal(res.status, 0, res.stderr);
  const held = data(f.out);
  assert.deepEqual(Object.keys(held).sort(), ["docs-fixture-01.json", "intent-answer-01.json", "intent-change-01.json"]);
  assert.deepEqual(held["intent-change-01.json"], PUBLIC["intent-change-01.json"]);
  assert.deepEqual({ hidden: res.printed.hidden, public: res.printed.public, leftOut: res.printed.leftOut }, { hidden: 1, public: 2, leftOut: ["code-smoke-01"] });
  assert.match(readFileSync(f.out, "utf8"), /^apiVersion: v1\nkind: ConfigMap\nmetadata:\n {2}name: specs\n {2}namespace: benchme\ndata:\n/);
});

test("refuses a public spec whose id is not its file's, and one a hidden task already has", () => {
  const misnamed = fixture({ "intent-answer-01.json": spec("intent-answer-02", "json") });
  const first = run(misnamed, ["--public", misnamed.pub]);
  assert.equal(first.status, 1);
  assert.match(first.stderr, /intent-answer-01\.json: spec\.id is intent-answer-02/);

  const twice = fixture({ "docs-fixture-01.json": spec("docs-fixture-01", "json") });
  const second = run(twice, ["--public", twice.pub]);
  assert.equal(second.status, 1);
  assert.match(second.stderr, /docs-fixture-01: in both the hidden tasks and /);
});

test("refuses more specs than one ConfigMap holds", () => {
  const big = { ...spec("intent-answer-01", "json"), padding: "x".repeat(1_100_000) };
  const f = fixture({ "intent-answer-01.json": big });
  const res = run(f, ["--public", f.pub]);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /more than one ConfigMap holds/);
});
