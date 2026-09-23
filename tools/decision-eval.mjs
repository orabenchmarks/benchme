#!/usr/bin/env node
/**
 * decision-eval — benchmark a DECISION MODEL natively: the model answers
 * closed-set questions directly (pick the record, pick the cheapest, is this
 * claim true, which app handles this), and is scored against ground truth
 * computed from the seeded scenario rows. The same items go to LLM baselines
 * as a strict-JSON prompt, so accuracy, calibration, latency and cost are
 * compared on identical questions. No agent, no tools, no workspace.
 *
 *   node tools/decision-eval.mjs [--seed 4242] [--models jev:jev-latest,anthropic:claude-haiku-4-5-20251001]
 *        [--families match,argmin,claim,route] [--concurrency 4] [--out decision-eval]
 *
 * Env: JEV_API_KEY (+ JEV_BASE_URL, default https://api.typesafe.ai);
 *      LLM_BASE_URL (Anthropic-compatible, default https://api.anthropic.com) + LLM_API_KEY.
 *
 * Writes <out>.json (every item, every answer) and <out>.md (tables).
 * Its own tests: `node --test tools/decision-eval.test.mjs`.
 */
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { acmeV1 } from "../packages/scenarios/dist/index.js";
import { buildItems } from "./decision-eval/items.mjs";
import { summarize } from "./decision-eval/metrics.mjs";
import { anthropicModel, jevModel } from "./decision-eval/models.mjs";

/**
 * The LLM baselines: per-MTok USD prices (input, output) and whether the
 * model accepts `temperature` (claude-sonnet-5 rejects it outright — 400
 * "temperature is deprecated for this model" — so it runs at its default).
 */
const LLM_MODELS = {
  "claude-haiku-4-5-20251001": { price: [1.0, 5.0], temperature: 0 },
  // Thinks adaptively BY DEFAULT: with the direct-answer budget the thinking
  // eats the tokens and no answer is written (26/30 SLA claims came back
  // empty), so the direct arm turns it off explicitly.
  "claude-sonnet-5": { price: [3.0, 15.0], temperature: null, thinksByDefault: true },
};

/**
 * `anthropic:<model>` = a direct answer (thinking off, 400 output tokens) — the
 * like-for-like baseline for a decision model. `anthropic:<model>+think` =
 * adaptive thinking with room to finish (2,000 tokens) — a reasoning ceiling.
 */
function thinkingFor(spec, entry) {
  if (spec.endsWith("+think")) return { thinking: { type: "adaptive" }, maxTokens: 2000 };
  // 400, not 80: with thinking off, claude-sonnet-5 still writes its arithmetic
  // (hours between two timestamps) in the visible reply before the JSON, and a
  // tight cap truncated 28/30 SLA answers — a budget artifact, not a wrong answer.
  return { thinking: entry.thinksByDefault ? { type: "disabled" } : undefined, maxTokens: 400 };
}

function parseArgs(argv) {
  const args = { seed: 4242, models: "jev:jev-latest,anthropic:claude-haiku-4-5-20251001,anthropic:claude-sonnet-5", families: null, concurrency: 4, out: "decision-eval" };
  for (let i = 0; i < argv.length; i++) {
    const [k, v] = [argv[i], argv[i + 1]];
    if (k === "--seed") (args.seed = Number(v)), i++;
    else if (k === "--models") (args.models = v), i++;
    else if (k === "--families") (args.families = v.split(",")), i++;
    else if (k === "--concurrency") (args.concurrency = Number(v)), i++;
    else if (k === "--out") (args.out = v), i++;
    else throw new Error(`unknown argument ${k}`);
  }
  return args;
}

export function makeModel(spec, env = process.env) {
  const [kind, model] = spec.split(":");
  if (kind === "jev") {
    if (!env.JEV_API_KEY) throw new Error("JEV_API_KEY is required for a jev model");
    return jevModel({ baseUrl: env.JEV_BASE_URL ?? "https://api.typesafe.ai", apiKey: env.JEV_API_KEY, model });
  }
  if (kind === "anthropic") {
    const id = model.replace(/\+think$/, "");
    const entry = LLM_MODELS[id];
    if (!entry) throw new Error(`no entry for ${id} — add it to LLM_MODELS`);
    const { thinking, maxTokens } = thinkingFor(model, entry);
    return anthropicModel({
      baseUrl: env.LLM_BASE_URL ?? "https://api.anthropic.com",
      apiKey: env.LLM_API_KEY ?? "",
      model: id,
      name: model,
      inputUsdPerMTok: entry.price[0],
      outputUsdPerMTok: entry.price[1],
      temperature: thinking?.type === "adaptive" ? null : entry.temperature,
      thinking,
      maxTokens,
    });
  }
  throw new Error(`unknown model kind "${kind}" (jev | anthropic)`);
}

/** Grade one answer against the item's truth. */
export function grade(item, ans) {
  if (ans.invalid) return { ...ans, correct: false, truth: item.truth };
  if (item.kind === "choice") return { ...ans, correct: ans.answer === item.truth, truth: item.truth };
  return { ...ans, correct: ans.probability >= 0.5 === item.truth, truth: item.truth };
}

async function runModel(model, items, concurrency) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      let ans;
      try {
        ans = await model.answer(items[i]);
      } catch (err) {
        ans = { invalid: err instanceof Error ? err.message : String(err), latencyMs: null, costUsd: 0, confidence: null };
      }
      results[i] = { itemId: items[i].id, family: items[i].family, subtype: items[i].subtype, ...grade(items[i], ans) };
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

export function groupSummaries(results) {
  const groups = new Map();
  const add = (key, r) => groups.set(key, [...(groups.get(key) ?? []), r]);
  for (const r of results) {
    add(`${r.family}.${r.subtype}`, r);
    add(r.family, r);
    add("all", r);
  }
  return Object.fromEntries([...groups].map(([k, rows]) => [k, summarize(rows)]));
}

const f = (v, d = 3) => (v === null || v === undefined ? "—" : typeof v === "number" ? v.toFixed(d) : String(v));
const pct = (v) => (v === null || v === undefined ? "—" : `${(v * 100).toFixed(1)}%`);

export function renderMarkdown({ seed, models, summaries, items }) {
  const keys = [...new Set(Object.values(summaries).flatMap((s) => Object.keys(s)))];
  const order = ["all", ...keys.filter((k) => !k.includes(".") && k !== "all").sort(), ...keys.filter((k) => k.includes(".")).sort()];
  const lines = [`# decision-eval: acme-v1 seed ${seed}`, "", `${items.length} items · models: ${models.join(", ")} · generated ${new Date().toISOString()}`, ""];
  lines.push("Accuracy counts an invalid answer as wrong. Confidence for a choice is the model's probability for the option it picked; for a yes/no claim it is max(p, 1 − p). ECE = expected calibration error (10 bins, lower is better); top-50% = accuracy on the half the model was most confident about.", "");
  for (const key of order) {
    lines.push(`## ${key}`, "", "| model | n | accuracy | invalid | top-50% acc | ECE | Brier | AUROC | p50 ms | p95 ms | $ / 1k decisions |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const m of models) {
      const s = summaries[m]?.[key];
      if (!s) continue;
      lines.push(`| ${m} | ${s.n} | ${pct(s.accuracy)} | ${s.invalid} | ${pct(s.top50Accuracy)} | ${f(s.ece)} | ${f(s.brier)} | ${f(s.auroc)} | ${f(s.p50Ms, 0)} | ${f(s.p95Ms, 0)} | ${f(s.usdPer1k, 4)} |`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rows = acmeV1.generate(args.seed);
  const items = buildItems(rows, args.seed).filter((it) => !args.families || args.families.includes(it.family));
  const specs = args.models.split(",");
  const runs = await Promise.all(specs.map(async (spec) => [spec, await runModel(makeModel(spec), items, args.concurrency)]));
  const summaries = Object.fromEntries(runs.map(([spec, results]) => [spec, groupSummaries(results)]));
  writeFileSync(`${args.out}.json`, JSON.stringify({ seed: args.seed, items, results: Object.fromEntries(runs), summaries }, null, 1));
  writeFileSync(`${args.out}.md`, renderMarkdown({ seed: args.seed, models: specs, summaries, items }));
  for (const spec of specs) console.log(spec, JSON.stringify(summaries[spec].all));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
