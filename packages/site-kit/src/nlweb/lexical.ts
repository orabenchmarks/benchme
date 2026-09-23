import type { AskItem, RankedCandidate, Ranker, RankerUsage } from "./types.js";

/**
 * Deterministic, zero-cost retrieval over a site's items. It is both the first
 * stage for every ranker (the candidate set an LLM/jev ranker re-scores) and a
 * complete ranker on its own, so /ask always answers even with no credentials.
 */

/** Dropped because they match nearly every item and so carry no signal. */
const STOP = new Set(["the", "a", "an", "for", "of", "and", "or", "to", "in", "on", "with", "is", "are"]);

/** Lowercase, split on non-alphanumerics, drop stopwords and single characters (noise from units/initials). */
export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

function fieldTokens(item: AskItem): { name: Set<string>; body: Set<string> } {
  return {
    name: new Set(tokenize(item.name)),
    body: new Set([...tokenize(item.text), ...(item.keywords ?? []).flatMap(tokenize)]),
  };
}

/**
 * Fraction of the query matched, with a name hit worth twice a body hit — a
 * product whose TITLE is "steel bolt" beats one that merely mentions steel.
 * Normalised by the best possible score so it stays in [0, 1] across queries.
 */
function scoreItem(queryTokens: readonly string[], item: AskItem): number {
  if (queryTokens.length === 0) return 0;
  const { name, body } = fieldTokens(item);
  let hits = 0;
  for (const t of queryTokens) hits += name.has(t) ? 2 : body.has(t) ? 1 : 0;
  return hits / (2 * queryTokens.length);
}

/**
 * Top-`topK` matching items, best first. Ties break by `id` ascending so the
 * same corpus in any order yields the same answer — a benchmark that grades an
 * agent's answer cannot tolerate result order depending on row order.
 * Items scoring 0 are dropped: "no match" is an empty list, never a bad list.
 */
export function retrieve(query: string, items: readonly AskItem[], topK: number): { item: AskItem; score: number }[] {
  const q = tokenize(query);
  return items
    .map((item) => {
      const score = scoreItem(q, item);
      return { item: { ...item, lexicalScore: score }, score };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score || (a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0))
    .slice(0, topK);
}

const FREE: RankerUsage = { calls: 0, inputTokens: 0, latencyMs: 0, costUsd: 0, degraded: false };

/** Re-emits the retrieval score: the default ranker, and the fallback every paid ranker degrades to. */
export class LexicalRanker implements Ranker {
  readonly kind = "lexical";

  async rank(query: string, candidates: AskItem[]): Promise<{ ranked: RankedCandidate[]; usage: RankerUsage }> {
    const q = tokenize(query);
    const ranked = candidates.map((c) => ({ id: c.id, score: c.lexicalScore ?? scoreItem(q, c) }));
    return { ranked, usage: { ...FREE } };
  }
}
