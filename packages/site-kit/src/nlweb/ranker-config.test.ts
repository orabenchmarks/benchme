import { describe, expect, it } from "vitest";
import { buildRanker, defaultRankerRegistry, rankerEnvSchema } from "./ranker-config.js";

describe("ranker config", () => {
  it("defaults to the free lexical ranker so /ask answers with no credentials", () => {
    expect(buildRanker({}).kind).toBe("lexical");
    expect(rankerEnvSchema.parse({})).toMatchObject({ ASK_RANKER: "lexical", LLM_MODEL: "claude-haiku-4-5-20251001", JEV_BASE_URL: "https://api.typesafe.ai", JEV_MODEL: "jev-latest", RANKER_CONCURRENCY: 8 });
  });

  it("registers exactly the three kinds", () => {
    expect(defaultRankerRegistry().kinds()).toEqual(["lexical", "llm", "jev"]);
  });

  // A missing key must fail BOOT, never silently serve lexical answers while a
  // benchmark believes it is measuring the llm/jev ranker.
  it("fails loudly when the selected ranker has no credentials", () => {
    expect(() => buildRanker({ ASK_RANKER: "jev" })).toThrow("invalid configuration: ASK_RANKER=jev requires JEV_BASE_URL and JEV_API_KEY");
    expect(() => buildRanker({ ASK_RANKER: "llm", LLM_BASE_URL: "http://llm.test" })).toThrow(
      "invalid configuration: ASK_RANKER=llm requires LLM_BASE_URL and LLM_API_KEY",
    );
    expect(() => buildRanker({ ASK_RANKER: "llm", LLM_API_KEY: "k" })).toThrow("invalid configuration: ASK_RANKER=llm requires LLM_BASE_URL and LLM_API_KEY");
  });

  it("builds the selected ranker once its credentials are present", () => {
    expect(buildRanker({ ASK_RANKER: "jev", JEV_API_KEY: "k" }).kind).toBe("jev");
    expect(buildRanker({ ASK_RANKER: "llm", LLM_BASE_URL: "http://llm.test", LLM_API_KEY: "k" }).kind).toBe("llm");
  });

  it("rejects an unknown ranker name and a malformed number", () => {
    expect(() => buildRanker({ ASK_RANKER: "magic" })).toThrow(/invalid configuration/);
    expect(() => buildRanker({ RANKER_CONCURRENCY: "lots" })).toThrow(/invalid configuration/);
  });

  it("coerces the per-million-token prices used for the llm cost line", () => {
    expect(rankerEnvSchema.parse({ LLM_INPUT_USD_PER_MTOK: "3", LLM_OUTPUT_USD_PER_MTOK: "15" })).toMatchObject({ LLM_INPUT_USD_PER_MTOK: 3, LLM_OUTPUT_USD_PER_MTOK: 15 });
  });
});
