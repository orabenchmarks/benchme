/**
 * The NLWeb wire model, kept separate from any site's own domain types: a site
 * maps its rows to `AskItem`s (Task 7) and everything downstream — retrieval,
 * ranking, /ask, the schema feed — works only against these.
 */

/** One answerable thing on a site, already carrying the JSON-LD a crawler or an agent gets back. */
export type AskItem = {
  id: string;
  /** Link an agent can follow; item mappers build it from the request prefix. */
  url: string;
  name: string;
  /** Free text retrieval reads, and the fallback description of a result. */
  text: string;
  keywords?: string[];
  /** JSON-LD for this item, including @context/@type/@id — served verbatim in results and in the feed. */
  schema: Record<string, unknown>;
  /**
   * Stamped by `retrieve` on the copy it returns, so a Ranker can re-emit or
   * blend the lexical score without paying to re-score the corpus.
   */
  lexicalScore?: number;
};

/** One NLWeb result object, exactly as the /ask wire format names its fields. */
export type AskResult = {
  url: string;
  name: string;
  site: string;
  score: number;
  description: string;
  schema_object: Record<string, unknown>;
};

/** A ranker's verdict on one candidate; `description` lets a ranker explain the match. */
export type RankedCandidate = { id: string; score: number; description?: string };

/** What one ranking pass cost, so a degraded (failed-over) ranker is visible in the response and in metrics. */
export type RankerUsage = { calls: number; inputTokens: number; latencyMs: number; costUsd: number; degraded: boolean };

/**
 * The ranking seam. Lexical ranking ships here; LLM and jev rankers (Task 6)
 * are added by registering another implementation — never by editing /ask.
 */
export interface Ranker {
  readonly kind: string;
  rank(query: string, candidates: AskItem[]): Promise<{ ranked: RankedCandidate[]; usage: RankerUsage }>;
}

/** Builds a Ranker from process env (api keys, model ids, endpoints). */
export type RankerFactory = (env: NodeJS.ProcessEnv) => Ranker;

/**
 * Registry (Open/Closed): a deployment picks a ranker by kind, and a new kind
 * is added by registering a factory — no switch anywhere in the request path.
 */
export class RankerRegistry {
  private readonly factories = new Map<string, RankerFactory>();

  register(kind: string, make: RankerFactory): this {
    if (this.factories.has(kind)) throw new Error(`duplicate ranker: ${kind}`);
    this.factories.set(kind, make);
    return this;
  }

  build(kind: string, env: NodeJS.ProcessEnv): Ranker {
    const make = this.factories.get(kind);
    if (!make) throw new Error(`unknown ranker: ${kind} (known: ${this.kinds().join(", ") || "none"})`);
    return make(env);
  }

  kinds(): string[] {
    return [...this.factories.keys()];
  }
}

/** Everything /ask needs, injected: the site never reaches into the service. */
export type AskDeps = {
  /** The site's name, echoed in every result's `site` field. */
  site: string;
  /** The workspace's corpus. Scoped by workspace so one tenant never answers with another's rows. */
  items: (workspaceId: string) => Promise<AskItem[]>;
  ranker: Ranker;
  /** Candidates retrieved before ranking, and the maximum results returned. */
  topK?: number;
  /** Injected clock, so the schema map's <lastmod> is testable. */
  now?: () => Date;
  /**
   * Resolves an `X-Ask-Ranker` override to the Ranker it names, or `undefined`
   * for a kind the deployment doesn't have (unregistered, or missing its
   * credentials) — the route answers 422 rather than silently keeping the
   * default ranker. Only consulted when `allowRankerOverride` is true; site-kit
   * never builds a ranker itself here, so it stays free of ranker credentials
   * and of `process.env`.
   */
  rankerFor?: (kind: string) => Ranker | undefined;
  /**
   * Enables the `X-Ask-Ranker` override — an eval-only knob (tools/ask-eval.mjs
   * scores every arm of the ranker grid against one running deployment instead
   * of redeploying per arm) that must default OFF in production. The app sets
   * this from its own `ASK_RANKER_OVERRIDE=1` env read; site-kit itself must
   * never read process.env.
   */
  allowRankerOverride?: boolean;
};

/** What one /ask call cost and how long it took, surfaced so an eval can compare rankers on cost/latency, not just relevance. */
export type AskUsage = { calls: number; inputTokens: number; costUsd: number; latencyMs: number };

/** The non-streaming /ask body; the SSE frames carry only `results` (and a `ranker` message on degrade) from the same answer. */
export type AskResponse = {
  query_id: string;
  results: AskResult[];
  ranker: string;
  /** Present only when the ranker fell back, so a grader can tell a degraded answer from a good one. */
  ranker_degraded?: true;
  /** What ranking this answer cost — the primitive tools/ask-eval.mjs reads for its cost/query and latency columns. */
  usage: AskUsage;
};
