import { z } from "zod";
import { RemoteRanker, type FetchInit, type RemoteRankerOptions, type Verdict } from "./remote-ranker.js";
import type { AskItem } from "./types.js";

/**
 * NLWeb's own ranking step: one small model call per candidate, scoring the
 * item's JSON-LD against the question. Per-item (rather than one call ranking
 * the whole list) is what NLWeb does and what makes it parallelisable and
 * degradable — a failed item costs that item's score, not the answer.
 *
 * The endpoint is provider-agnostic: anything speaking the Anthropic Messages
 * format (the vendor API, a gateway, a local mock) is configured by base URL.
 */

/** Verbatim from NLWeb's ranking prompt; changing it changes what the benchmark measures. */
export const NLWEB_RANKING_PROMPT = `Assign a score between 0 and 100 to the following item based on how relevant it is to the user's question. If the score is above 50, provide a short description. If the score is below 75, in the description, include the reason why it is still relevant. Answer ONLY with JSON {"score": <integer>, "description": "<short>"}.`;

const ANTHROPIC_VERSION = "2023-06-01";
/** A score plus one sentence; anything longer is the model ignoring the prompt. */
const MAX_TOKENS = 200;
const DEFAULT_INPUT_USD_PER_MTOK = 1.0;
const DEFAULT_OUTPUT_USD_PER_MTOK = 5.0;

const messagesResponse = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }),
});

const scoreJson = z.object({ score: z.number(), description: z.string().optional() });

/**
 * The first balanced `{...}` in the reply. Models prepend "Here is the JSON:"
 * often enough that a whole-string JSON.parse would degrade good answers; a
 * brace scan (string-aware, so a `}` inside a description does not end it) is
 * the cheapest thing that survives that.
 */
export function firstJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  if (start < 0) throw new Error("llm ranker: reply contained no JSON object");
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i] as string;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return JSON.parse(text.slice(start, i + 1));
  }
  throw new Error("llm ranker: reply contained an unterminated JSON object");
}

export type LlmRankerOptions = RemoteRankerOptions & { inputUsdPerMTok?: number; outputUsdPerMTok?: number };

export class LlmRanker extends RemoteRanker {
  readonly kind = "llm";
  private readonly inputUsdPerMTok: number;
  private readonly outputUsdPerMTok: number;

  constructor(o: LlmRankerOptions) {
    super(o);
    this.inputUsdPerMTok = o.inputUsdPerMTok ?? DEFAULT_INPUT_USD_PER_MTOK;
    this.outputUsdPerMTok = o.outputUsdPerMTok ?? DEFAULT_OUTPUT_USD_PER_MTOK;
  }

  protected override request(query: string, item: AskItem): { url: string; init: FetchInit } {
    return {
      url: `${this.baseUrl}/v1/messages`,
      init: {
        method: "POST",
        headers: { "x-api-key": this.apiKey, "anthropic-version": ANTHROPIC_VERSION, "content-type": "application/json" },
        // The item's JSON-LD, not its prose: the model scores exactly what an
        // agent would receive back, so the score explains the result it grades.
        body: JSON.stringify({
          model: this.model,
          max_tokens: MAX_TOKENS,
          system: NLWEB_RANKING_PROMPT,
          messages: [{ role: "user", content: `Question: ${query}\n\nItem: ${JSON.stringify(item.schema)}` }],
        }),
      },
    };
  }

  protected override interpret(body: unknown): Verdict {
    const parsed = messagesResponse.parse(body);
    const text = parsed.content.find((b) => b.type === "text")?.text;
    if (!text) throw new Error("llm ranker: reply had no text block");
    const scored = scoreJson.parse(firstJsonObject(text));
    const description = scored.description?.trim();
    return {
      score: scored.score / 100,
      ...(description ? { description } : {}),
      inputTokens: parsed.usage.input_tokens,
      outputTokens: parsed.usage.output_tokens,
    };
  }

  protected override costUsd(v: Verdict): number {
    return (v.inputTokens * this.inputUsdPerMTok + v.outputTokens * this.outputUsdPerMTok) / 1e6;
  }
}
