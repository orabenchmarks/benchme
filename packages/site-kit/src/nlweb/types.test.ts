import { describe, expect, it } from "vitest";
import { LexicalRanker } from "./lexical.js";
import { RankerRegistry, type Ranker } from "./types.js";

const fake = (kind: string): Ranker => ({ kind, rank: async () => ({ ranked: [], usage: { calls: 0, inputTokens: 0, latencyMs: 0, costUsd: 0, degraded: false } }) });

describe("RankerRegistry", () => {
  it("builds a registered kind, passing env to the factory", () => {
    const seen: NodeJS.ProcessEnv[] = [];
    const reg = new RankerRegistry().register("lexical", () => new LexicalRanker()).register("llm", (env) => {
      seen.push(env);
      return fake("llm");
    });
    expect(reg.build("lexical", {}).kind).toBe("lexical");
    expect(reg.build("llm", { MODEL: "m" }).kind).toBe("llm");
    expect(seen).toEqual([{ MODEL: "m" }]);
  });
  it("refuses a duplicate kind rather than silently shadowing the first", () => {
    const reg = new RankerRegistry().register("llm", () => fake("llm"));
    expect(() => reg.register("llm", () => fake("llm"))).toThrow(/duplicate ranker: llm/);
  });
  it("throws on an unknown kind and names what it does know", () => {
    const reg = new RankerRegistry().register("lexical", () => new LexicalRanker());
    expect(() => reg.build("jev", {})).toThrow(/unknown ranker: jev/);
    expect(() => reg.build("jev", {})).toThrow(/lexical/);
  });
  it("lists kinds in registration order", () => {
    const reg = new RankerRegistry().register("lexical", () => new LexicalRanker()).register("llm", () => fake("llm")).register("jev", () => fake("jev"));
    expect(reg.kinds()).toEqual(["lexical", "llm", "jev"]);
  });
  it("starts empty", () => expect(new RankerRegistry().kinds()).toEqual([]));
});
