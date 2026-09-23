import { z } from "zod";
import { RemoteRanker, type FetchInit, type Tokens, type Verdict } from "./remote-ranker.js";
import type { AskItem } from "./types.js";

/**
 * Ranking as a jev (TypeSafe System One) `score` question. The contrast with
 * the llm ranker is the point of the grid: jev is asked for a POSITION on a
 * labelled scale and answers with a calibrated float plus per-level
 * probabilities, instead of being asked to write a number in prose. It emits
 * no text at all, which is why a jev-ranked result keeps the item's own
 * description rather than a generated one.
 */

/** The scale the score is a position on; the last index is "perfect match", so levels-1 normalises it. */
const RELEVANCE_CRITERIA = ["irrelevant", "tangential", "somewhat relevant", "relevant", "exactly what was asked"] as const;
const RELEVANCE_INSTRUCTIONS = "How relevant is this item to the user's question?";
/** System One list price, input only: it writes no tokens, so output is free. */
const JEV_INPUT_USD_PER_MTOK = 0.042;

/** Read separately from the answers, so a reply we cannot score is still billed. */
const systemOneUsage = z.object({ usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }) });
const systemOneAnswers = z.object({ answers: z.object({ relevance: z.object({ type: z.string(), score: z.number() }) }) });

export class JevRanker extends RemoteRanker {
  readonly kind = "jev";

  protected override request(query: string, item: AskItem): { url: string; init: FetchInit } {
    return {
      url: `${this.baseUrl}/v1/systemone`,
      init: {
        method: "POST",
        headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
        // `state` is the world the question is asked about; the question itself
        // is declarative, so the scale — not a prompt — defines what a 3 means.
        body: JSON.stringify({
          model: this.model,
          state: { question: query, item: item.schema },
          questions: { relevance: { type: "score", instructions: RELEVANCE_INSTRUCTIONS, criteria: RELEVANCE_CRITERIA } },
        }),
      },
    };
  }

  protected override usageOf(body: unknown): Tokens {
    const { usage } = systemOneUsage.parse(body);
    return { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens };
  }

  protected override verdictOf(body: unknown): Verdict {
    // The API returns the weighted position over the levels, in [0, levels-1].
    return { score: systemOneAnswers.parse(body).answers.relevance.score / (RELEVANCE_CRITERIA.length - 1) };
  }

  protected override costUsd(t: Tokens): number {
    return (t.inputTokens * JEV_INPUT_USD_PER_MTOK) / 1e6;
  }
}
