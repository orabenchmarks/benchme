import { test } from "node:test";
import assert from "node:assert/strict";
import { acmeV1 } from "../packages/scenarios/dist/index.js";
import { buildItems } from "./decision-eval/items.mjs";
import { auroc, ece, selectiveAccuracy, summarize } from "./decision-eval/metrics.mjs";
import { grade } from "./decision-eval.mjs";

const rows = acmeV1.generate(4242);
const items = buildItems(rows, 4242);

test("every choice item's truth is one of its options, and ids are unique", () => {
  assert.equal(new Set(items.map((i) => i.id)).size, items.length);
  for (const it of items.filter((i) => i.kind === "choice")) assert.ok(it.truth in it.options, it.id);
});

test("match items are decidable: EXACTLY one option satisfies both parts of the request (hard negatives satisfy one)", () => {
  for (const it of items.filter((i) => i.family === "match")) {
    const parts = it.subtype === "customer"
      ? it.state.request.match(/^the (\S+)-tier customer based in (.+)$/).slice(1).map((p) => (t) => t.includes(p.includes(" ") || /^[A-Z]/.test(p) ? `based in ${p}` : `${p} tier`))
      : it.subtype === "ticket"
        ? it.state.request.match(/^the (\S+)-priority ticket about "(.+)"$/).slice(1).map((p, k) => (t) => (k === 0 ? t.includes(`, ${p} priority`) : t.includes(`"${p}"`)))
        : it.state.request.match(/^the (\S+) item priced at (\$[\d.]+)$/).slice(1).map((p, k) => (t) => (k === 0 ? t.includes(`— ${p},`) : t.endsWith(p)));
    const both = Object.entries(it.options).filter(([, t]) => parts.every((ok) => ok(t)));
    assert.deepEqual(both.map(([id]) => id), [it.truth], it.id);
  }
});

test("argmin items have a unique minimum and the truth holds it", () => {
  for (const it of items.filter((i) => i.family === "argmin")) {
    const prices = Object.fromEntries(Object.entries(it.options).map(([id, t]) => [id, Number(t.match(/\$([\d.]+)$/)[1])]));
    const min = Math.min(...Object.values(prices));
    assert.deepEqual(Object.keys(prices).filter((id) => prices[id] === min), [it.truth], it.id);
  }
});

test("claims are balanced true/false per subtype", () => {
  for (const sub of ["lookup", "aggregate", "rule"]) {
    const xs = items.filter((i) => i.family === "claim" && i.subtype === sub);
    const t = xs.filter((i) => i.truth).length;
    assert.ok(Math.abs(t - (xs.length - t)) <= 1, `${sub}: ${t}/${xs.length}`);
  }
});

test("an invalid answer grades as wrong; a yes/no answer grades at p >= 0.5", () => {
  const claim = { kind: "noul", truth: true };
  assert.equal(grade(claim, { invalid: "HTTP 500" }).correct, false);
  assert.equal(grade(claim, { probability: 0.5 }).correct, true);
  assert.equal(grade({ kind: "noul", truth: false }, { probability: 0.49 }).correct, true);
});

test("metrics: a perfectly calibrated set has ECE 0, a perfect ranking AUROC 1, and top-50% keeps the confident half", () => {
  const calibrated = [...Array(8).fill({ correct: true, confidence: 1 }), { correct: true, confidence: 0.5 }, { correct: false, confidence: 0.5 }];
  assert.equal(ece(calibrated), 0);
  assert.equal(auroc([{ truth: true, probability: 0.9 }, { truth: false, probability: 0.1 }]), 1);
  assert.equal(auroc([{ truth: true, probability: 0.1 }, { truth: false, probability: 0.9 }]), 0);
  assert.equal(selectiveAccuracy([{ correct: true, confidence: 0.9 }, { correct: false, confidence: 0.1 }], 0.5), 1);
  assert.equal(summarize([{ correct: false, invalid: "x", confidence: null, latencyMs: 1, costUsd: 0 }]).invalid, 1);
});
