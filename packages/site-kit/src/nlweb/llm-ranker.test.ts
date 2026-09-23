import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { LlmRanker } from "./llm-ranker.js";
import type { AskItem } from "./types.js";

/**
 * The stub answers the REAL Anthropic Messages wire format, so a drift in the
 * request shape (header, path, prompt) shows up here and not in production.
 */
const OK_BODY = { content: [{ type: "text", text: '{"score":80,"description":"d"}' }], usage: { input_tokens: 120, output_tokens: 10 } };
const PROMPT =
  'Assign a score between 0 and 100 to the following item based on how relevant it is to the user\'s question. If the score is above 50, provide a short description. If the score is below 75, in the description, include the reason why it is still relevant. Answer ONLY with JSON {"score": <integer>, "description": "<short>"}.';

type Call = { url: string | undefined; headers: NodeJS.Dict<string | string[]>; body: { system?: string; messages?: { role: string; content: string }[]; model?: string; max_tokens?: number } };

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
      if (req.url !== "/v1/messages") return send(404, { error: "not found" });
      if (asked.includes("FAIL")) return send(500, { error: "boom" });
      // A good answer whose envelope omits `usage`: scoreable, just not meterable.
      if (asked.includes("NOUSAGE")) return send(200, { content: [{ type: "text", text: '{"score":80,"description":"d"}' }] });
      // A 200 with no usage block at all: nothing to meter, still degrades.
      if (asked.includes("GARBAGE")) return send(200, { nope: true });
      // A 200 the ranker cannot read: the model answered in prose.
      if (asked.includes("NOJSON")) return send(200, { content: [{ type: "text", text: "I cannot rate this." }], usage: { input_tokens: 5, output_tokens: 5 } });
      if (asked.includes("RETRY")) {
        const n = (attempts.get("retry") ?? 0) + 1;
        attempts.set("retry", n);
        if (n === 1) return send(429, { error: "slow down" });
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

const ranker = (log?: (m: string) => void): LlmRanker =>
  new LlmRanker({ baseUrl, apiKey: "k1", model: "m1", concurrency: 2, ...(log ? { log } : {}) });

describe("LlmRanker", () => {
  it("sends NLWeb's per-item prompt in the Anthropic Messages format", async () => {
    const it0 = item("a", "Steel bolt");
    await ranker().rank("steel bolt", [it0]);
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe("/v1/messages");
    expect(call.headers["x-api-key"]).toBe("k1");
    expect(call.headers["anthropic-version"]).toBe("2023-06-01");
    expect(call.headers["content-type"]).toContain("application/json");
    expect(call.body.model).toBe("m1");
    expect(call.body.max_tokens).toBe(200);
    expect(call.body.system).toBe(PROMPT);
    expect(call.body.messages).toEqual([{ role: "user", content: `Question: steel bolt\n\nItem: ${JSON.stringify(it0.schema)}` }]);
  });

  it("normalises 0-100 to 0-1, keeps the description, and sums usage and cost", async () => {
    const out = await ranker().rank("steel bolt", [item("a", "Steel bolt"), item("b", "Steel nut")]);
    expect(out.ranked).toEqual([
      { id: "a", score: 0.8, description: "d" },
      { id: "b", score: 0.8, description: "d" },
    ]);
    expect(out.usage.calls).toBe(2);
    expect(out.usage.inputTokens).toBe(240);
    // 120 input × $1.00/Mtok + 10 output × $5.00/Mtok, twice.
    expect(out.usage.costUsd).toBeCloseTo(2 * (120 * 1.0 + 10 * 5.0) / 1e6, 12);
    expect(out.usage.degraded).toBe(false);
    expect(out.usage.latencyMs).toBeGreaterThanOrEqual(0);
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
    expect(logged[0]).toContain("llm");
  });

  it("retries a 429 and succeeds without degrading", async () => {
    const out = await ranker().rank("steel bolt", [item("retry", "RETRY widget")]);
    expect(out.ranked).toEqual([{ id: "retry", score: 0.8, description: "d" }]);
    expect(out.usage.degraded).toBe(false);
    expect(calls).toHaveLength(2);
    // usage.calls counts ATTEMPTS, so a retried query still shows what the
    // provider's rate limit counted.
    expect(out.usage.calls).toBe(2);
  });

  it("keeps the lexical score when a 200 carries no JSON object, and still ranks the rest", async () => {
    const logged: string[] = [];
    const out = await ranker((m) => logged.push(m)).rank("steel bolt", [item("a", "Steel bolt"), item("prose", "NOJSON widget", 0.35), item("c", "Steel nut")]);
    expect(out.ranked).toContainEqual({ id: "prose", score: 0.35 });
    expect(out.ranked.filter((r) => r.score === 0.8).map((r) => r.id)).toEqual(["a", "c"]);
    expect(out.usage.degraded).toBe(true);
    expect(logged).toHaveLength(1);
    // The unreadable reply was billed like any other: its tokens and its cost
    // are metered even though its score was lost. Cost is this benchmark's
    // headline, so a degraded query must never look cheaper than it was.
    expect(out.usage.calls).toBe(3);
    expect(out.usage.inputTokens).toBe(245);
    expect(out.usage.costUsd).toBeCloseTo((2 * (120 * 1.0 + 10 * 5.0) + (5 * 1.0 + 5 * 5.0)) / 1e6, 12);
  });

  it("meters nothing, and still degrades, when even the usage block is unreadable", async () => {
    const out = await ranker(() => {}).rank("steel bolt", [item("a", "Steel bolt"), item("junk", "GARBAGE widget", 0.2)]);
    expect(out.ranked).toContainEqual({ id: "junk", score: 0.2 });
    expect(out.usage.degraded).toBe(true);
    expect(out.usage.calls).toBe(2);
    expect(out.usage.inputTokens).toBe(120);
    expect(out.usage.costUsd).toBeCloseTo((120 * 1.0 + 10 * 5.0) / 1e6, 12);
  });

  it("still scores a candidate whose envelope omits usage, metering nothing for it", async () => {
    const out = await ranker(() => {}).rank("steel bolt", [item("free", "NOUSAGE widget", 0.2)]);
    expect(out.ranked).toEqual([{ id: "free", score: 0.8, description: "d" }]);
    expect(out.usage.degraded).toBe(false);
    expect(out.usage.calls).toBe(1);
    expect(out.usage.inputTokens).toBe(0);
    expect(out.usage.costUsd).toBe(0);
  });

  it("degrades, rather than throwing, when the endpoint is unreachable", async () => {
    const dead = new LlmRanker({ baseUrl: "http://127.0.0.1:1", apiKey: "k", model: "m", log: () => {} });
    const out = await dead.rank("q", [item("a", "Steel bolt", 0.3)]);
    expect(out.ranked).toEqual([{ id: "a", score: 0.3 }]);
    expect(out.usage.degraded).toBe(true);
  });
});
