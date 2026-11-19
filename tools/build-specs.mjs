#!/usr/bin/env node
/**
 * build-specs — turn a benchme-hidden checkout into verifier chart values.
 *
 *   node tools/build-specs.mjs --hidden ../benchme-hidden --out specs.values.yaml
 *        [--image-prefix k3d-ora-registry:5000/benchme]   # dev: rewrite ghcr.io/orabenchmarks/<name>:<tag> → <prefix>/<name>:<tag>
 *        [--configmap <name> [--namespace <ns>]]           # GitOps: emit a ConfigMap manifest (keys <taskId>.json) for
 *                                                          # `verify.existingSpecsConfigMap` instead of a values file
 *        [--public compose/specs]                          # also carry the PUBLIC corpora's answer keys, so the cluster's
 *                                                          # verifier grades the intent tasks (acme-v1's and webmcp-v1's) too
 *
 * For every tasks/<id>/spec.json it inlines tasks/<id>/hidden/** into
 * oracle.hiddenFiles (path → content), checks that every requiredTest names a
 * test that exists in a hidden file ("<describe> <it>"), and refuses to emit
 * when a task has no reference solution or no known-wrong solution. The
 * output is a values file for the chart (`verify.specs`), never committed.
 *
 * `docker compose` mounts compose/specs into its verifier; a cluster's verifier
 * reads ONE ConfigMap, and without --public that is the hidden tasks alone, so
 * every intent task answers 404 UNKNOWN_TASK there. --public adds every
 * `<taskId>.json` of that directory whose oracle needs no runner (`json`,
 * `state`): the intent corpora's answer keys and the json smoke. The corpora's
 * public lists beside them (intent-tasks.json, webmcp-corpus.json, …) are not
 * specs and are passed over; a `patch` spec there is compose's own smoke (a
 * busybox runner) and is left out, by name, in what the tool prints.
 */
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1]] : [])).filter((e) => e.length));
const hiddenRoot = args.hidden ?? "../benchme-hidden";
const out = args.out ?? "specs.values.yaml";
const imagePrefix = args["image-prefix"];
const configMapName = args.configmap;
const configMapNamespace = args.namespace;
const publicDir = args.public;
/** The oracles a public spec may carry into a cluster: the ones that run no code. */
const PUBLIC_KINDS = new Set(["json", "state"]);
/** A ConfigMap holds 1 MiB in all; leave room for its keys and metadata. */
const CONFIGMAP_BUDGET_BYTES = 1_000_000;

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) files.push(...walk(p));
    else files.push(p);
  }
  return files;
}

function testNames(source) {
  const names = [];
  const describes = [...source.matchAll(/describe\(\s*["'`]([^"'`]+)["'`]/g)].map((m) => m[1]);
  const its = [...source.matchAll(/\bit\(\s*["'`]([^"'`]+)["'`]/g)].map((m) => m[1]);
  for (const d of describes.length ? describes : [""]) for (const t of its) names.push(d ? `${d} ${t}` : t);
  return names;
}

const tasksDir = join(hiddenRoot, "tasks");
const specs = {};
const problems = [];
for (const id of readdirSync(tasksDir).sort()) {
  const dir = join(tasksDir, id);
  const specPath = join(dir, "spec.json");
  if (!existsSync(specPath)) continue;
  const spec = JSON.parse(readFileSync(specPath, "utf8"));
  if (spec.id !== id) problems.push(`${id}: spec.id is ${spec.id}`);
  if (!existsSync(join(dir, "solution.patch")) && !existsSync(join(dir, "solution"))) problems.push(`${id}: no reference solution`);
  if (!existsSync(join(dir, "wrong.patch")) && !existsSync(join(dir, "wrong"))) problems.push(`${id}: no known-wrong solution`);
  const hiddenDir = join(dir, "hidden");
  if (spec.oracle.kind === "patch") {
    const files = existsSync(hiddenDir) ? walk(hiddenDir) : [];
    spec.oracle.hiddenFiles = Object.fromEntries(files.map((f) => [relative(hiddenDir, f), readFileSync(f, "utf8")]));
    const available = files.flatMap((f) => testNames(readFileSync(f, "utf8")));
    for (const t of spec.oracle.requiredTests ?? []) if (!available.includes(t)) problems.push(`${id}: requiredTest "${t}" not found in hidden tests`);
    // An EMPTY requiredTests would let a runner that never received the hidden
    // files pass on visible tests alone — so every hidden test is required by
    // default. Authors may list a subset explicitly.
    if (!(spec.oracle.requiredTests ?? []).length) spec.oracle.requiredTests = available;
    if (!spec.oracle.requiredTests.length) problems.push(`${id}: no hidden tests found`);
    const bytes = Object.values(spec.oracle.hiddenFiles).reduce((n, s) => n + Buffer.byteLength(s), 0);
    if (bytes > 800_000) problems.push(`${id}: hidden files are ${bytes} bytes (ConfigMap limit)`);
    if (imagePrefix && typeof spec.oracle.runnerImage === "string") {
      spec.oracle.runnerImage = spec.oracle.runnerImage.replace(/^ghcr\.io\/orabenchmarks\//, `${imagePrefix.replace(/\/+$/, "")}/`);
    }
  }
  const { repo: _repo, baseSha: _sha, ...chartSpec } = spec;
  specs[id] = chartSpec;
}
const hiddenCount = Object.keys(specs).length;
const leftOut = [];
if (publicDir) {
  for (const file of readdirSync(publicDir).filter((f) => f.endsWith(".json")).sort()) {
    const id = file.slice(0, -".json".length);
    let spec;
    try {
      spec = JSON.parse(readFileSync(join(publicDir, file), "utf8"));
    } catch {
      problems.push(`${join(publicDir, file)}: not JSON`);
      continue;
    }
    // The corpora's public lists sit beside the specs: arrays of tasks, never a spec.
    if (spec === null || typeof spec !== "object" || Array.isArray(spec) || !spec.oracle) continue;
    if (spec.id !== id) problems.push(`${join(publicDir, file)}: spec.id is ${spec.id}`);
    else if (!PUBLIC_KINDS.has(spec.oracle.kind)) leftOut.push(id);
    else if (specs[id]) problems.push(`${id}: in both the hidden tasks and ${publicDir}`);
    else specs[id] = spec;
  }
}
if (configMapName) {
  const bytes = Object.entries(specs).reduce((n, [id, spec]) => n + Buffer.byteLength(`${id}.json`) + Buffer.byteLength(JSON.stringify(spec)), 0);
  if (bytes > CONFIGMAP_BUDGET_BYTES) problems.push(`the specs are ${bytes} bytes: more than one ConfigMap holds (${CONFIGMAP_BUDGET_BYTES})`);
}
if (problems.length) {
  console.error("build-specs refused:\n  " + problems.join("\n  "));
  process.exit(1);
}
// Minimal YAML emitter (JSON is valid YAML): either the chart's `verify.specs`
// values map, or — for GitOps deployments, where values can never carry the
// hidden specs — a ConfigMap manifest to apply out-of-band and name in
// `verify.existingSpecsConfigMap` (keys `<taskId>.json`, exactly what the
// chart's own ConfigMap renders).
const yaml = configMapName
  ? ["apiVersion: v1", "kind: ConfigMap", "metadata:", `  name: ${configMapName}`, ...(configMapNamespace ? [`  namespace: ${configMapNamespace}`] : []), "data:"]
  : ["benchme:", "  verify:", "    specs:"];
for (const [id, spec] of Object.entries(specs)) yaml.push(configMapName ? `  ${id}.json: ${JSON.stringify(JSON.stringify(spec))}` : `      ${id}: ${JSON.stringify(spec)}`);
writeFileSync(out, yaml.join("\n") + "\n");
console.log(
  JSON.stringify({
    tasks: Object.keys(specs),
    hidden: hiddenCount,
    public: Object.keys(specs).length - hiddenCount,
    ...(leftOut.length ? { leftOut } : {}),
    out,
    format: configMapName ? "configmap" : "values",
  }),
);
