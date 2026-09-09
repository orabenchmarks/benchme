#!/usr/bin/env node
/**
 * build-specs — turn a benchme-hidden checkout into verifier chart values.
 *
 *   node tools/build-specs.mjs --hidden ../benchme-hidden --out specs.values.yaml
 *        [--image-prefix k3d-ora-registry:5000/benchme]   # dev: rewrite ghcr.io/orabenchmarks/<name>:<tag> → <prefix>/<name>:<tag>
 *        [--configmap <name> [--namespace <ns>]]           # GitOps: emit a ConfigMap manifest (keys <taskId>.json) for
 *                                                          # `verify.existingSpecsConfigMap` instead of a values file
 *
 * For every tasks/<id>/spec.json it inlines tasks/<id>/hidden/** into
 * oracle.hiddenFiles (path → content), checks that every requiredTest names a
 * test that exists in a hidden file ("<describe> <it>"), and refuses to emit
 * when a task has no reference solution or no known-wrong solution. The
 * output is a values file for the chart (`verify.specs`), never committed.
 */
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1]] : [])).filter((e) => e.length));
const hiddenRoot = args.hidden ?? "../benchme-hidden";
const out = args.out ?? "specs.values.yaml";
const imagePrefix = args["image-prefix"];
const configMapName = args.configmap;
const configMapNamespace = args.namespace;

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
console.log(JSON.stringify({ tasks: Object.keys(specs), out, format: configMapName ? "configmap" : "values" }));
