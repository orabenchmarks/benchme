/**
 * Ranking-quality primitives for tools/ask-eval.mjs (comparing lexical/llm/jev
 * over seed-derived relevance labels). Pure and dependency-free — no HTTP, no
 * randomness — so they're unit-testable on their own and the CLI can import
 * them from the built dist instead of re-implementing scoring math in a
 * `.mjs` file nothing typechecks.
 */

function toSet(relevant: ReadonlySet<string> | readonly string[]): ReadonlySet<string> {
  return relevant instanceof Set ? relevant : new Set(relevant);
}

/**
 * Binary-relevance nDCG@k: discounted gain (1 per relevant hit, 1/log2(rank+1)
 * discount) normalised by the ideal ordering's gain. A query with no relevant
 * items at all returns 1 (nothing to miss) rather than 0/0 — a ranker cannot
 * be penalised for a ground truth that has no answer.
 */
export function ndcgAt(rankedIds: readonly string[], relevant: ReadonlySet<string> | readonly string[], k: number): number {
  const rel = toSet(relevant);
  if (rel.size === 0) return 1;
  const gain = (rank: number): number => 1 / Math.log2(rank + 2); // rank is 0-based; +2 so rank 0 divides by log2(2)=1
  const dcg = rankedIds.slice(0, k).reduce((sum, id, i) => sum + (rel.has(id) ? gain(i) : 0), 0);
  const idealHits = Math.min(rel.size, k);
  let idcg = 0;
  for (let i = 0; i < idealHits; i++) idcg += gain(i);
  return idcg === 0 ? 0 : dcg / idcg;
}

/**
 * Fraction of the top-k results that are relevant. An empty top-k (the ranker
 * returned nothing) is 0, not NaN, so a caller can average across queries
 * without special-casing an empty answer.
 */
export function precisionAt(rankedIds: readonly string[], relevant: ReadonlySet<string> | readonly string[], k: number): number {
  const rel = toSet(relevant);
  const top = rankedIds.slice(0, k);
  if (top.length === 0) return 0;
  return top.filter((id) => rel.has(id)).length / top.length;
}

/**
 * Linear-interpolated percentile (0..100) over `values`, sorted on a copy so
 * the caller's array is never mutated. Empty input is 0, not NaN — a ranker
 * that answered zero queries should read as "no data", never poison a
 * downstream average.
 */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0] as number;
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo] as number;
  const frac = rank - lo;
  return (sorted[lo] as number) * (1 - frac) + (sorted[hi] as number) * frac;
}

/**
 * How many results the ranker was CONFIDENT about (score >= threshold) yet
 * were not actually relevant — the failure mode an averaged nDCG/precision
 * can hide entirely: a ranker can score well on average while still handing
 * out a handful of high-confidence wrong answers a user would trust.
 */
export function highConfidenceMisses(results: readonly { id: string; score: number }[], relevant: ReadonlySet<string> | readonly string[], threshold = 0.75): number {
  const rel = toSet(relevant);
  return results.filter((r) => r.score >= threshold && !rel.has(r.id)).length;
}
