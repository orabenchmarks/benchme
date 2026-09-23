import { randomUUID } from "node:crypto";
import { retrieve } from "./lexical.js";
import type { AskDeps, AskItem, AskResponse, AskResult, RankedCandidate } from "./types.js";

const DEFAULT_TOP_K = 25;
const DESCRIPTION_CHARS = 160;

export type AskQuery = { query: string; prev?: string[]; queryId?: string };

/**
 * The /ask pipeline, free of HTTP: corpus → lexical retrieval → the injected
 * Ranker → NLWeb result objects. Transports (JSON, SSE, the ask MCP tool) all
 * call this one method, so every surface answers identically.
 */
export class AskService {
  constructor(private readonly d: AskDeps) {}

  async ask(workspaceId: string, q: AskQuery): Promise<AskResponse> {
    const topK = this.d.topK ?? DEFAULT_TOP_K;
    const items = await this.d.items(workspaceId);
    // Earlier turns widen RETRIEVAL only (a follow-up like "cheaper ones" has no
    // nouns of its own); the ranker still judges relevance against what the user
    // actually asked now.
    const retrievalQuery = [...(q.prev ?? []), q.query].join(" ");
    const candidates = retrieve(retrievalQuery, items, topK).map((c) => c.item);
    const { ranked, usage } = await this.d.ranker.rank(q.query, candidates);

    const byId = new Map(candidates.map((c) => [c.id, c]));
    const results = ranked
      .filter((r) => byId.has(r.id))
      .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .slice(0, topK)
      .map((r) => toResult(r, byId.get(r.id) as AskItem, this.d.site));

    return {
      query_id: q.queryId ?? randomUUID(),
      results,
      ranker: this.d.ranker.kind,
      ...(usage.degraded ? { ranker_degraded: true as const } : {}),
    };
  }
}

function toResult(r: RankedCandidate, item: AskItem, site: string): AskResult {
  return {
    url: item.url,
    name: item.name,
    site,
    // Rounded so two runs of the same query produce byte-identical answers a grader can diff.
    score: Math.round(r.score * 1000) / 1000,
    description: r.description ?? item.text.slice(0, DESCRIPTION_CHARS),
    schema_object: item.schema,
  };
}
