#!/usr/bin/env node
/**
 * intent-corpus — author natural-language intent tasks (the kind a page
 * visitor would type, not a scripted API call) with ground truths DERIVED
 * from the same generator that seeds a workspace (@benchme/scenarios,
 * acme-v1) — never transcribed by hand. A `state` task is checked by the
 * verifier reading the app's own REST API afterwards; a `json` task by the
 * answer document it produces.
 *
 *   node tools/intent-corpus.mjs [--seed 4242] [--scale 1] [--out compose/specs]
 *   node tools/intent-corpus.mjs --check        # the committed files ARE the tool's output?
 *   node tools/intent-corpus.mjs --print <id>   # one task and its answer key
 *
 * Writes, into --out:
 *   intent-<…>.json      one answer key per task (taskSpecSchema-shaped) —
 *                        the verifier's hidden input, never served
 *   intent-tasks.json    the PUBLIC half a consumer shows an agent:
 *                        [{id, surfaces, app, intent, oracle, summary}]
 *   intent-corpus.json   the public half WITH each answer key under `key` —
 *                        for a platform that grades the answers itself
 *   intent-tasks.md      how every answer was derived
 *
 * The first ten tasks are tools/intent-corpus/original.mjs, verbatim; every
 * other kind is a template in tools/intent-corpus/templates/ (see its
 * index.mjs), instantiated `count × scale` times over distinct seeded rows.
 * tools/intent-integrity.mjs proves each task against a live benchme.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildCorpus, corpusFiles } from "./intent-corpus/corpus.mjs";

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const option = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};
const SEED = Number(option("seed", 4242));
const SCALE = Number(option("scale", 1));
const OUT = option("out", "compose/specs");
const PRINT = option("print");

const corpus = buildCorpus({ seed: SEED, scale: SCALE });
if (corpus.problems.length) {
  console.error(`intent-corpus refused (seed ${SEED}):\n  ${corpus.problems.join("\n  ")}`);
  process.exit(1);
}

if (PRINT) {
  const task = corpus.tasks.find((t) => t.id === PRINT);
  const spec = corpus.specs.find((s) => s.id === PRINT);
  if (!task || !spec) {
    console.error(`no such task id: ${PRINT}`);
    process.exit(1);
  }
  console.log(JSON.stringify({ task, spec }, null, 2));
  process.exit(0);
}

const files = corpusFiles(corpus);
// An intent-*.json on disk that the tool no longer produces is a stale answer
// key the verifier would still load; the corpus files themselves are not keys.
const stale = existsSync(OUT) ? readdirSync(OUT).filter((f) => /^intent-.*\.json$/.test(f) && !files.has(f)) : [];

if (flag("check")) {
  const drift = [...files].filter(([name, content]) => !existsSync(join(OUT, name)) || readFileSync(join(OUT, name), "utf8") !== content).map(([name]) => name);
  if (drift.length || stale.length) {
    console.error(`intent corpus in ${OUT} is not the tool's output (seed ${SEED}, scale ${SCALE}) — re-run node tools/intent-corpus.mjs:`);
    for (const name of drift) console.error(`  differs: ${name}`);
    for (const name of stale) console.error(`  stale:   ${name}`);
    process.exit(1);
  }
  console.log(`intent corpus in ${OUT} matches the tool (${corpus.tasks.length} tasks)`);
  process.exit(0);
}

mkdirSync(OUT, { recursive: true });
for (const name of stale) rmSync(join(OUT, name));
for (const [name, content] of files) writeFileSync(join(OUT, name), content);
const count = (kind) => corpus.tasks.filter((t) => t.oracle === kind).length;
console.log(JSON.stringify({ seed: SEED, scale: SCALE, out: OUT, tasks: corpus.tasks.length, state: count("state"), json: count("json"), removed: stale }, null, 2));
