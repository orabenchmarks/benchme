/**
 * Naive plural/singular pair for a keyword. `tokenize` (./lexical.ts) has no
 * stemming, so a query for either form of a word ("fastener" vs "fasteners")
 * is a different token to it — a site that only puts one form in an item's
 * `keywords` silently misses the other. Not linguistically correct (just
 * drop/add a trailing "s"); good enough for synthetic-corpus vocabulary,
 * and shared here so every site's item mapper agrees on it instead of
 * carrying its own copy that can drift.
 */
export function wordVariants(word: string): string[] {
  const w = word.toLowerCase();
  return w.endsWith("s") ? [w, w.slice(0, -1)] : [w, `${w}s`];
}
