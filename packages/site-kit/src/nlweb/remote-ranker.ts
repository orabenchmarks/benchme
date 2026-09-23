import { pLimit } from "./p-limit.js";
import type { AskItem, RankedCandidate, Ranker, RankerUsage } from "./types.js";

/**
 * The half every paid ranker shares: one bounded-concurrency request per
 * candidate, retry on the two "come back later" statuses, and — the important
 * part — PER-CANDIDATE degradation. A provider hiccup on one item must never
 * fail the whole answer or, worse, silently drop that item from the results:
 * it keeps its lexical score and the response is flagged `degraded` so a
 * grader can tell a cheap answer from a paid one.
 *
 * Subclasses supply only the wire format (Template Method), so adding a
 * provider is a new subclass plus a registry line — /ask never changes.
 */

export type FetchInit = NonNullable<Parameters<typeof fetch>[1]>;

export type RemoteRankerOptions = {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Injected so tests drive a local stub — and so a gateway can be slotted in. */
  fetch?: typeof fetch;
  concurrency?: number;
  /** Called at most once per query; defaults to console.warn. */
  log?: (msg: string) => void;
};

/** One upstream answer about one candidate, before normalisation to the 0-1 result score. */
export type Verdict = { score: number; description?: string; inputTokens: number; outputTokens: number };

/** 429 = rate limited, 529 = overloaded: both mean "the same request will work shortly". */
const RETRY_STATUS = new Set([429, 529]);
const BACKOFF_MS = [250, 1000];
const DEFAULT_CONCURRENCY = 8;

type Meter = { calls: number; inputTokens: number; costUsd: number };

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

export abstract class RemoteRanker implements Ranker {
  abstract readonly kind: string;
  protected readonly baseUrl: string;
  protected readonly apiKey: string;
  protected readonly model: string;
  private readonly fetchImpl: typeof fetch;
  private readonly concurrency: number;
  private readonly log: (msg: string) => void;

  constructor(o: RemoteRankerOptions) {
    this.baseUrl = o.baseUrl.replace(/\/+$/, "");
    this.apiKey = o.apiKey;
    this.model = o.model;
    this.fetchImpl = o.fetch ?? fetch;
    this.concurrency = o.concurrency ?? DEFAULT_CONCURRENCY;
    this.log = o.log ?? ((msg) => console.warn(msg));
  }

  /** The request that scores ONE candidate. */
  protected abstract request(query: string, item: AskItem): { url: string; init: FetchInit };

  /** Reads the provider's successful body; throwing here degrades just this candidate. */
  protected abstract interpret(body: unknown): Verdict;

  /** What this verdict cost in USD. */
  protected abstract costUsd(v: Verdict): number;

  async rank(query: string, candidates: AskItem[]): Promise<{ ranked: RankedCandidate[]; usage: RankerUsage }> {
    const startedAt = Date.now();
    const limit = pLimit(this.concurrency);
    const meter: Meter = { calls: 0, inputTokens: 0, costUsd: 0 };
    const failures: string[] = [];

    const ranked = await Promise.all(candidates.map((item) => limit(() => this.scoreOne(query, item, meter, failures))));

    // Once per query, not once per candidate: a broken key would otherwise emit
    // a line per item and bury every other log on the site.
    if (failures.length > 0) {
      this.log(`${this.kind} ranker degraded: ${failures.length}/${candidates.length} candidates kept their lexical score (first error: ${failures[0]})`);
    }
    return {
      ranked,
      usage: { calls: meter.calls, inputTokens: meter.inputTokens, latencyMs: Date.now() - startedAt, costUsd: meter.costUsd, degraded: failures.length > 0 },
    };
  }

  private async scoreOne(query: string, item: AskItem, meter: Meter, failures: string[]): Promise<RankedCandidate> {
    try {
      const verdict = await this.call(query, item, meter);
      meter.inputTokens += verdict.inputTokens;
      meter.costUsd += this.costUsd(verdict);
      return { id: item.id, score: clamp01(verdict.score), ...(verdict.description ? { description: verdict.description } : {}) };
    } catch (e) {
      failures.push(e instanceof Error ? e.message : String(e));
      return { id: item.id, score: item.lexicalScore ?? 0 };
    }
  }

  private async call(query: string, item: AskItem, meter: Meter): Promise<Verdict> {
    const { url, init } = this.request(query, item);
    for (let attempt = 0; ; attempt++) {
      // Attempts, retries included: `calls` is what the provider's rate limit
      // counts, so a query that retried its way to an answer still shows it.
      meter.calls++;
      // A network error throws straight out: retrying a refused connection just
      // delays the degraded answer the caller is already waiting for.
      const res = await this.fetchImpl(url, init);
      if (res.ok) return this.interpret(await res.json());
      const detail = await res.text().catch(() => "");
      if (RETRY_STATUS.has(res.status) && attempt < BACKOFF_MS.length) {
        await sleep(BACKOFF_MS[attempt] as number);
        continue;
      }
      throw new Error(`${this.kind} ranker: ${res.status} ${detail.slice(0, 200)}`);
    }
  }
}
