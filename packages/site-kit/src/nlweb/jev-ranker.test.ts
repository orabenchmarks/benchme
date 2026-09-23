import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { JevRanker } from "./jev-ranker.js";
import type { AskItem } from "./types.js";

/** The live System One response shape: a float in [0, levels-1] over the criteria we send. */
const OK_BODY = {
  model: "jev-1.13.0",
  answers: { relevance: { type: "score", score: 3.2, probabilities: {}, confidence: 0.7 } },
  usage: { input_tokens: 200, output_tokens: 20 },
};

type Call = { url: string | undefined; headers: NodeJS.Dict<string | string[]>; body: { model?: string; state?: { question?: string; item?: unknown }; questions?: Record<string, { type?: string; instructions?: string; criteria?: string[] }> } };

let server: Server;
let baseUrl = "";
let calls: Call[] = [];
let attempts = new Map<string, number>();

const item = (id: string, name: string, lexicalScore = 0.25): AskItem => ({
  id,
  url: `/p/${id}`,
  name,
  text: name,
  schema: { "@context": "https://schema.org", "@type": "Product", "@id": id, name },
  lexicalScore,
});

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw || "{}");
      calls.push({ url: req.url, headers: req.headers, body });
      const asked = JSON.stringify(body);
      const send = (code: number, payload: unknown): void => {
        res.writeHead(code, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      if (req.url !== "/v1/systemone") return send(404, { error: "not found" });
      if (asked.includes("FAIL")) return send(500, { error: "boom" });
      if (asked.includes("RETRY")) {
        const n = (attempts.get("retry") ?? 0) + 1;
        attempts.set("retry", n);
        if (n === 1) return send(529, { error: "overloaded" });
      }
      return send(200, OK_BODY);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  calls = [];
  attempts = new Map();
});

const ranker = (log?: (m: string) => void): JevRanker =>
  new JevRanker({ baseUrl, apiKey: "k1", model: "jev-latest", concurrency: 2, ...(log ? { log } : {}) });

describe("JevRanker", () => {
  it("asks System One one scored question per candidate, bearer-authenticated", async () => {
    const it0 = item("a", "Steel bolt");
    await ranker().rank("steel bolt", [it0]);
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe("/v1/systemone");
    expect(call.headers.authorization).toBe("Bearer k1");
    expect(call.body.model).toBe("jev-latest");
    expect(call.body.state).toEqual({ question: "steel bolt", item: it0.schema });
    expect(call.body.questions?.relevance).toEqual({
      type: "score",
      instructions: "How relevant is this item to the user's question?",
      criteria: ["irrelevant", "tangential", "somewhat relevant", "relevant", "exactly what was asked"],
    });
  });

  it("normalises the score by levels-1, writes no description, and sums usage and cost", async () => {
    const out = await ranker().rank("steel bolt", [item("a", "Steel bolt"), item("b", "Steel nut")]);
    // 3.2 over five criteria → 3.2 / 4.
    expect(out.ranked).toEqual([
      { id: "a", score: 0.8 },
      { id: "b", score: 0.8 },
    ]);
    expect(out.ranked.every((r) => r.description === undefined)).toBe(true);
    expect(out.usage.calls).toBe(2);
    expect(out.usage.inputTokens).toBe(400);
    // Input only: jev writes no tokens, so output is free.
    expect(out.usage.costUsd).toBeCloseTo(2 * (200 * 0.042) / 1e6, 12);
    expect(out.usage.degraded).toBe(false);
  });

  it("degrades only the failing candidates to their lexical score, ranks the rest, and logs once", async () => {
    const logged: string[] = [];
    // TWO failures, so "logged once" is a real assertion and not an artefact of
    // there being only one thing to log.
    const out = await ranker((m) => logged.push(m)).rank("steel bolt", [item("a", "Steel bolt"), item("bad", "FAIL widget", 0.4), item("worse", "FAIL nut", 0.1), item("c", "Steel nut")]);
    expect(out.ranked).toContainEqual({ id: "bad", score: 0.4 });
    expect(out.ranked).toContainEqual({ id: "worse", score: 0.1 });
    expect(out.ranked.filter((r) => r.score === 0.8).map((r) => r.id)).toEqual(["a", "c"]);
    expect(out.usage.degraded).toBe(true);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain("2/4");
    expect(logged[0]).toContain("jev");
  });

  it("retries a 529 and succeeds without degrading", async () => {
    const out = await ranker().rank("steel bolt", [item("retry", "RETRY widget")]);
    expect(out.ranked).toEqual([{ id: "retry", score: 0.8 }]);
    expect(out.usage.degraded).toBe(false);
    expect(calls).toHaveLength(2);
  });
});
