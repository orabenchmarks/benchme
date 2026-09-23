/**
 * decision-eval metrics — pure functions over graded rows:
 *   { correct: boolean, confidence: number|null, probability?: number, truth, latencyMs, costUsd, invalid? }
 *
 * An INVALID answer (unparseable, HTTP error) counts as WRONG in accuracy —
 * a component that cannot answer has not decided — and is reported on its own
 * too, so a model is never flattered by quietly dropping its failures.
 */

export function percentile(values, p) {
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const rank = Math.ceil((p / 100) * xs.length);
  return xs[Math.min(xs.length - 1, Math.max(0, rank - 1))];
}

const mean = (xs) => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length);

/** Expected calibration error over equal-width confidence bins (rows with a confidence only). */
export function ece(rows, bins = 10) {
  const scored = rows.filter((r) => typeof r.confidence === "number");
  if (scored.length === 0) return null;
  let total = 0;
  for (let b = 0; b < bins; b++) {
    const lo = b / bins;
    const hi = (b + 1) / bins;
    const inBin = scored.filter((r) => r.confidence > lo - (b === 0 ? 1e-9 : 0) && r.confidence <= hi);
    if (inBin.length === 0) continue;
    const acc = mean(inBin.map((r) => (r.correct ? 1 : 0)));
    const conf = mean(inBin.map((r) => r.confidence));
    total += (inBin.length / scored.length) * Math.abs(acc - conf);
  }
  return total;
}

/** Brier score for yes/no rows (probability that the statement is true vs the truth). */
export function brier(rows) {
  const scored = rows.filter((r) => typeof r.probability === "number");
  return scored.length === 0 ? null : mean(scored.map((r) => (r.probability - (r.truth ? 1 : 0)) ** 2));
}

/** AUROC of the probability against the boolean truth (ties count half). */
export function auroc(rows) {
  const scored = rows.filter((r) => typeof r.probability === "number");
  const pos = scored.filter((r) => r.truth).map((r) => r.probability);
  const neg = scored.filter((r) => !r.truth).map((r) => r.probability);
  if (pos.length === 0 || neg.length === 0) return null;
  let wins = 0;
  for (const p of pos) for (const n of neg) wins += p > n ? 1 : p === n ? 0.5 : 0;
  return wins / (pos.length * neg.length);
}

/** Accuracy on the most-confident `coverage` share of rows (selective prediction). */
export function selectiveAccuracy(rows, coverage = 0.5) {
  const scored = rows.filter((r) => typeof r.confidence === "number").sort((a, b) => b.confidence - a.confidence);
  if (scored.length === 0) return null;
  const top = scored.slice(0, Math.max(1, Math.round(scored.length * coverage)));
  return mean(top.map((r) => (r.correct ? 1 : 0)));
}

export function summarize(rows) {
  return {
    n: rows.length,
    accuracy: mean(rows.map((r) => (r.correct ? 1 : 0))),
    invalid: rows.filter((r) => r.invalid).length,
    p50Ms: percentile(rows.map((r) => r.latencyMs), 50),
    p95Ms: percentile(rows.map((r) => r.latencyMs), 95),
    usdPer1k: rows.length === 0 ? null : (rows.reduce((a, r) => a + (r.costUsd ?? 0), 0) / rows.length) * 1000,
    ece: ece(rows),
    brier: brier(rows),
    auroc: auroc(rows),
    top50Accuracy: selectiveAccuracy(rows, 0.5),
  };
}
