import { loadConfig } from "@benchme/core";
import { z } from "zod";
import { JevRanker } from "./jev-ranker.js";
import { LexicalRanker } from "./lexical.js";
import { LlmRanker } from "./llm-ranker.js";
import { RankerRegistry, type Ranker } from "./types.js";

/**
 * Which ranker a deployment runs, and the credentials it needs. Selection is
 * env-driven so the SAME site image serves a lexical, an llm and a jev arm of
 * the grid — the only difference between the arms is this config.
 *
 * A missing key is a BOOT failure, never a quiet fall back to lexical: an arm
 * that silently answers lexically would be recorded as an llm/jev measurement
 * and poison every comparison made from it.
 */
export const rankerEnvSchema = z.object({
  ASK_RANKER: z.enum(["lexical", "llm", "jev"]).default("lexical"),
  /** Any Anthropic-Messages-compatible endpoint: the vendor API, a gateway, a mock. */
  LLM_BASE_URL: z.string().url().optional(),
  LLM_API_KEY: z.string().min(1).optional(),
  LLM_MODEL: z.string().min(1).default("claude-haiku-4-5-20251001"),
  /** Priced per run rather than hardcoded, so a model swap does not silently misreport cost. */
  LLM_INPUT_USD_PER_MTOK: z.coerce.number().nonnegative().default(1.0),
  LLM_OUTPUT_USD_PER_MTOK: z.coerce.number().nonnegative().default(5.0),
  JEV_BASE_URL: z.string().url().default("https://api.typesafe.ai"),
  JEV_API_KEY: z.string().min(1).optional(),
  JEV_MODEL: z.string().min(1).default("jev-latest"),
  /** In-flight upstream requests per /ask; one request is sent per candidate. */
  RANKER_CONCURRENCY: z.coerce.number().int().positive().default(8),
});

export type RankerEnv = z.infer<typeof rankerEnvSchema>;

/** Apps merge this into their own config schema, so one `readConfig` validates everything. */
export function readRankerEnv(env: NodeJS.ProcessEnv): RankerEnv {
  return loadConfig(rankerEnvSchema, env);
}

function credentials(kind: "llm" | "jev", baseUrl: string | undefined, apiKey: string | undefined): { baseUrl: string; apiKey: string } {
  const prefix = kind.toUpperCase();
  if (!baseUrl || !apiKey) throw new Error(`invalid configuration: ASK_RANKER=${kind} requires ${prefix}_BASE_URL and ${prefix}_API_KEY`);
  return { baseUrl, apiKey };
}

/**
 * The three kinds that ship. A fourth ranker is a `register` call here (or on a
 * registry a site owns) — never a branch in /ask or in this function.
 */
export function defaultRankerRegistry(): RankerRegistry {
  return new RankerRegistry()
    .register("lexical", () => new LexicalRanker())
    .register("llm", (env) => {
      const c = readRankerEnv(env);
      return new LlmRanker({
        ...credentials("llm", c.LLM_BASE_URL, c.LLM_API_KEY),
        model: c.LLM_MODEL,
        concurrency: c.RANKER_CONCURRENCY,
        inputUsdPerMTok: c.LLM_INPUT_USD_PER_MTOK,
        outputUsdPerMTok: c.LLM_OUTPUT_USD_PER_MTOK,
      });
    })
    .register("jev", (env) => {
      const c = readRankerEnv(env);
      return new JevRanker({ ...credentials("jev", c.JEV_BASE_URL, c.JEV_API_KEY), model: c.JEV_MODEL, concurrency: c.RANKER_CONCURRENCY });
    });
}

/** The ranker `ASK_RANKER` names; throws (failing boot) if it is unknown or unconfigured. */
export function buildRanker(env: NodeJS.ProcessEnv = process.env, registry: RankerRegistry = defaultRankerRegistry()): Ranker {
  return registry.build(readRankerEnv(env).ASK_RANKER, env);
}
