#!/usr/bin/env node
/**
 * intent-corpus — author natural-language intent tasks (the kind a page
 * visitor would type, not a scripted API call) with ground truths DERIVED
 * from the same generator that seeds a workspace (@benchme/scenarios) —
 * never transcribed by hand. One corpus per scenario (tools/intent-corpus/
 * corpus.mjs CORPORA): acme-v1's, webmcp-v1's and cuj-v1's, written side by
 * side. A `state` task is checked by the
 * verifier reading the app's own REST API afterwards; a `json` task by the
 * answer document it produces.
 *
 *   node tools/intent-corpus.mjs [--seed 4242] [--scale 1] [--out compose/specs]
 *   node tools/intent-corpus.mjs --check        # the committed files ARE the tool's output?
 *   node tools/intent-corpus.mjs --print <id>   # one task and its answer key
 *
 * Writes, into --out, for every corpus:
 *   intent-<…>.json      one answer key per task (taskSpecSchema-shaped) —
 *                        the verifier's hidden input, never served
 *   intent-tasks.json    the PUBLIC half a consumer shows an agent:
 *                        [{id, surfaces, app, intent, oracle, summary}]
 *                        (webmcp-v1's: webmcp-tasks.json)
 *   intent-corpus.json   the public half WITH each answer key under `key` —
 *                        for a platform that grades the answers itself
 *                        (webmcp-v1's: webmcp-corpus.json)
 *   intent-tasks.md      how every answer was derived (webmcp-tasks.md)
 *
 * cuj-v1's are cuj-<…>.json keys, cuj-tasks.json, cuj-corpus.json and
 * cuj-tasks.md: records with an area, a level and follow-up steps
 * (docs/scenarios/cuj-v1.md). A task whose every step is answered in a reply
 * has no key file: the verifier has nothing of it to check.
 *
 * The first ten tasks are tools/intent-corpus/original.mjs, verbatim; every
 * other kind is a template in tools/intent-corpus/templates/ (see its
 * index.mjs), instantiated `count × scale` times over distinct seeded rows.
 * tools/intent-integrity.mjs proves each task against a live benchme.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CORPORA, buildCorpus, corpusFiles } from "./intent-corpus/corpus.mjs";

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

const corpora = CORPORA.map((def) => buildCorpus({ seed: SEED, scale: SCALE, scenario: def.scenario.key }));
const refused = corpora.flatMap((c, i) => (c.problems.length ? [`${CORPORA[i].scenario.key}: ${c.problems.join("; ")}`] : []));
if (refused.length) {
  console.error(`intent-corpus refused (seed ${SEED}):\n  ${refused.join("\n  ")}`);
  process.exit(1);
}

if (PRINT) {
  for (const corpus of corpora) {
    const task = corpus.tasks.find((t) => t.id === PRINT);
    const spec = corpus.specs.find((s) => s.id === PRINT);
    const record = corpus.corpus.find((r) => r.id === PRINT);
    if (task && (spec || record?.key)) {
      console.log(JSON.stringify({ scenario: corpus.scenario, task, spec: spec ?? null, ...(record?.key && !spec ? { key: record.key } : {}) }, null, 2));
      process.exit(0);
    }
  }
  console.error(`no such task id: ${PRINT}`);
  process.exit(1);
}

// One directory holds every corpus: a file two corpora both write would be one task's key overwriting another's.
const files = new Map();
for (const corpus of corpora) {
  for (const [name, content] of corpusFiles(corpus)) {
    if (files.has(name)) {
      console.error(`intent-corpus refused: ${name} is written by two corpora`);
      process.exit(1);
    }
    files.set(name, content);
  }
}
// An intent-*.json or cuj-*.json on disk that no corpus produces is a stale
// answer key the verifier would still load; the corpus files themselves are not keys.
const stale = existsSync(OUT) ? readdirSync(OUT).filter((f) => /^(intent|cuj)-.*\.json$/.test(f) && !files.has(f)) : [];
const summary = corpora.map((c) => `${c.scenario} ${c.tasks.length}`).join(", ");

if (flag("check")) {
  const drift = [...files].filter(([name, content]) => !existsSync(join(OUT, name)) || readFileSync(join(OUT, name), "utf8") !== content).map(([name]) => name);
  if (drift.length || stale.length) {
    console.error(`intent corpus in ${OUT} is not the tool's output (seed ${SEED}, scale ${SCALE}) — re-run node tools/intent-corpus.mjs:`);
    for (const name of drift) console.error(`  differs: ${name}`);
    for (const name of stale) console.error(`  stale:   ${name}`);
    process.exit(1);
  }
  console.log(`intent corpus in ${OUT} matches the tool (${summary} tasks)`);
  process.exit(0);
}

mkdirSync(OUT, { recursive: true });
for (const name of stale) rmSync(join(OUT, name));
for (const [name, content] of files) writeFileSync(join(OUT, name), content);
// A task's kind is its oracle's (acme-v1, webmcp-v1) or its first step's (cuj-v1).
const count = (c, kind) => c.tasks.filter((t) => (t.oracle ?? t.kind) === kind).length;
console.log(
  JSON.stringify(
    { seed: SEED, scale: SCALE, out: OUT, corpora: Object.fromEntries(corpora.map((c) => [c.scenario, { tasks: c.tasks.length, state: count(c, "state"), json: count(c, "json") }])), removed: stale },
    null,
    2,
  ),
);
