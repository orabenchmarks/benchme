import Fastify from "fastify";
import { describe, expect, it, beforeAll } from "vitest";
import { registerNlweb, type NlwebDeps } from "./ask-routes.js";
import { LexicalRanker } from "./lexical.js";
import type { AskItem, Ranker } from "./types.js";
const items: AskItem[] = [
  {
    id: "sku-1",
    url: "/w/x/warehouse/products/sku-1",
    name: "Steel bolt M8",
    text: "zinc plated",
    schema: { "@context": "https://schema.org", "@type": "Product", "@id": "sku-1", url: "/w/x/warehouse/products/sku-1", name: "Steel bolt M8" },
  },
];
/** A ranker that answered, but only by falling back — the state /ask must disclose. */
class DegradedRanker implements Ranker {
  readonly kind = "llm";
  async rank(_query: string, candidates: AskItem[]) {
    return {
      ranked: candidates.map((c) => ({ id: c.id, score: 0.5 })),
      usage: { calls: 1, inputTokens: 10, latencyMs: 1, costUsd: 0, degraded: true },
    };
  }
}

/** A second, distinguishable ranker so an override test can prove IT (not the default) answered. */
class OtherRanker implements Ranker {
  readonly kind = "other";
  async rank(_query: string, candidates: AskItem[]) {
    return {
      ranked: candidates.map((c) => ({ id: c.id, score: 1 })),
      usage: { calls: 1, inputTokens: 5, latencyMs: 1, costUsd: 0.001, degraded: false },
    };
  }
}

type ExtraDeps = Partial<Pick<NlwebDeps, "allowRankerOverride" | "rankerFor">>;

async function buildApp(ranker: Ranker, extra: ExtraDeps = {}) {
  const instance = Fastify();
  instance.decorateRequest("workspaceId", "");
  instance.decorateRequest("prefix", "");
  instance.addHook("onRequest", async (req) => {
    req.workspaceId = "x";
    req.prefix = "/w/x/warehouse";
  });
  await instance.register(async (s) => registerNlweb(s, { site: "warehouse", items: async (_workspaceId, _prefix) => items, ranker, publicBaseUrl: () => "http://gw.test/w/x/warehouse", ...extra }));
  await instance.ready();
  return instance;
}

let app: Awaited<ReturnType<typeof buildApp>>;
beforeAll(async () => {
  app = await buildApp(new LexicalRanker());
});
describe("/ask", () => {
  it("answers JSON when streaming=false with NLWeb result fields", async () => {
    const res = await app.inject({ method: "GET", url: "/ask?query=steel%20bolt&streaming=false&query_id=q1" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.query_id).toBe("q1");
    expect(body.results[0]).toMatchObject({ url: expect.stringContaining("sku-1"), name: "Steel bolt M8", site: "warehouse", schema_object: { "@type": "Product" } });
    expect(typeof body.results[0].score).toBe("number");
    expect(typeof body.results[0].description).toBe("string");
  });
  it("streams SSE by default: header messages, one results batch, a complete frame", async () => {
    const res = await app.inject({ method: "POST", url: "/ask", payload: { query: "bolt" } });
    expect(res.headers["content-type"]).toContain("text/event-stream");
    const frames = res.body
      .split("\n\n")
      .filter(Boolean)
      .map((f) => JSON.parse(f.replace(/^data: /, "")));
    expect(frames[0].message_type).toBe("license");
    expect(frames[1].message_type).toBe("data_retention");
    expect(frames.find((f) => f.results)).toBeTruthy();
    expect(frames.at(-1)).toMatchObject({ complete: true });
  });
  it("accepts the nested v0.55 body shape and its streaming preference", async () => {
    const res = await app.inject({ method: "POST", url: "/ask", payload: { query: { text: "steel bolt" }, context: { prev: ["fasteners"] }, prefer: { mode: "list", streaming: false } } });
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.json().results[0]).toMatchObject({ name: "Steel bolt M8" });
  });
  it("422s a missing query and an unsupported mode", async () => {
    expect((await app.inject({ method: "GET", url: "/ask" })).statusCode).toBe(422);
    expect((await app.inject({ method: "GET", url: "/ask?query=x&mode=generate" })).statusCode).toBe(422);
  });
  it("returns an empty result set, not an error, when nothing matches", async () => {
    const body = (await app.inject({ method: "GET", url: "/ask?query=banana&streaming=false" })).json();
    expect(body.results).toEqual([]);
  });
  it("serves the JSONL feed, the schema map and robots with the schemamap directive", async () => {
    const feed = await app.inject({ method: "GET", url: "/schema/feed.jsonl" });
    expect(feed.headers["content-type"]).toContain("application/jsonl");
    const line = JSON.parse(feed.body.trim().split("\n")[0]!);
    expect(line).toMatchObject({ "@context": "https://schema.org", "@type": "Product", "@id": "sku-1" });
    const map = await app.inject({ method: "GET", url: "/schema/map.xml" });
    expect(map.body).toContain("<sf:contentType>structuredData/schema.org</sf:contentType>");
    expect(map.body).toContain("http://gw.test/w/x/warehouse/schema/feed.jsonl");
    const robots = await app.inject({ method: "GET", url: "/robots.txt" });
    expect(robots.body).toContain("schemamap: http://gw.test/w/x/warehouse/schema/map.xml");
  });
  it("discloses a degraded ranker on the JSON path", async () => {
    const degraded = await buildApp(new DegradedRanker());
    const body = (await degraded.inject({ method: "GET", url: "/ask?query=bolt&streaming=false" })).json();
    expect(body.ranker).toBe("llm");
    expect(body.ranker_degraded).toBe(true);
    expect(body.results).toHaveLength(1);
    await degraded.close();
  });
  it("omits ranker_degraded when the ranker was healthy", async () => {
    const body = (await app.inject({ method: "GET", url: "/ask?query=bolt&streaming=false" })).json();
    expect(body.ranker).toBe("lexical");
    expect("ranker_degraded" in body).toBe(false);
  });
  describe("X-Ask-Ranker override", () => {
    it("is ignored when the deployment has not opted in", async () => {
      // allowRankerOverride is absent here, even though rankerFor could satisfy "other".
      const disabled = await buildApp(new LexicalRanker(), { rankerFor: (kind) => (kind === "other" ? new OtherRanker() : undefined) });
      const body = (await disabled.inject({ method: "GET", url: "/ask?query=bolt&streaming=false", headers: { "x-ask-ranker": "other" } })).json();
      expect(body.ranker).toBe("lexical");
      await disabled.close();
    });
    it("picks the named ranker when the deployment opted in", async () => {
      const enabled = await buildApp(new LexicalRanker(), { allowRankerOverride: true, rankerFor: (kind) => (kind === "other" ? new OtherRanker() : undefined) });
      const body = (await enabled.inject({ method: "GET", url: "/ask?query=bolt&streaming=false", headers: { "x-ask-ranker": "other" } })).json();
      expect(body.ranker).toBe("other");
      expect(body.results[0]).toMatchObject({ score: 1 });
      await enabled.close();
    });
    it("422s an unrecognised ranker kind", async () => {
      const enabled = await buildApp(new LexicalRanker(), { allowRankerOverride: true, rankerFor: () => undefined });
      const res = await enabled.inject({ method: "GET", url: "/ask?query=bolt&streaming=false", headers: { "x-ask-ranker": "nope" } });
      expect(res.statusCode).toBe(422);
      expect(res.json()).toMatchObject({ error: "UNKNOWN_RANKER" });
      await enabled.close();
    });
  });
  it("discloses a degraded ranker as an SSE frame before the complete frame", async () => {
    const degraded = await buildApp(new DegradedRanker());
    const res = await degraded.inject({ method: "POST", url: "/ask", payload: { query: "bolt" } });
    const frames = res.body
      .split("\n\n")
      .filter(Boolean)
      .map((f) => JSON.parse(f.replace(/^data: /, "")));
    const degradedFrame = frames.findIndex((f) => f.message_type === "ranker");
    expect(degradedFrame).toBeGreaterThan(-1);
    expect(frames[degradedFrame]).toMatchObject({ message_type: "ranker", content: { ranker: "llm", degraded: true } });
    // It must not be the last word: the client still needs its terminator.
    expect(frames.findIndex((f) => f.complete === true)).toBeGreaterThan(degradedFrame);
    expect(frames.at(-1)).toMatchObject({ complete: true });
    await degraded.close();
  });
  it("/ask/mcp exposes exactly one tool, ask, returning the same results", async () => {
    const list = await app.inject({
      method: "POST",
      url: "/ask/mcp",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      payload: { jsonrpc: "2.0", id: 1, method: "tools/list" },
    });
    const listed = JSON.parse(
      list.body
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .pop()!
        .slice(5),
    );
    expect(listed.result.tools.map((t: { name: string }) => t.name)).toEqual(["ask"]);
    const call = await app.inject({
      method: "POST",
      url: "/ask/mcp",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      payload: { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "ask", arguments: { query: "steel bolt" } } },
    });
    const called = JSON.parse(
      call.body
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .pop()!
        .slice(5),
    );
    const payload = JSON.parse(called.result.content[0].text);
    expect(payload.results[0]).toMatchObject({ name: "Steel bolt M8", site: "warehouse" });
  });
  it("builds item urls/@ids from the FORWARDED prefix, not the resolved workspace id — the shared-alias case", async () => {
    // The gateway forwards x-forwarded-prefix from the ORIGINAL path segment
    // (which may be a `shared-<scenario>-<seed>` alias), while req.workspaceId
    // is the id it RESOLVED to. `items` must build urls from the prefix it is
    // handed, never re-derive one from workspaceId — this is the regression
    // Task 7 shipped with (every item named an unstable internal id).
    const aliasApp = Fastify();
    aliasApp.decorateRequest("workspaceId", "");
    aliasApp.decorateRequest("prefix", "");
    aliasApp.addHook("onRequest", async (req) => {
      req.workspaceId = "ws_internal_123";
      req.prefix = (req.headers["x-forwarded-prefix"] as string) ?? "/w/ws_internal_123/warehouse";
    });
    await aliasApp.register(async (s) =>
      registerNlweb(s, {
        site: "warehouse",
        items: async (_workspaceId, prefix) => [
          {
            id: `${prefix}/products/sku-1`,
            url: `${prefix}/products/sku-1`,
            name: "Steel bolt M8",
            text: "zinc plated",
            schema: { "@context": "https://schema.org", "@type": "Product", "@id": `${prefix}/products/sku-1`, url: `${prefix}/products/sku-1`, name: "Steel bolt M8" },
          },
        ],
        ranker: new LexicalRanker(),
        publicBaseUrl: () => "http://gw.test",
      }),
    );
    await aliasApp.ready();
    const res = await aliasApp.inject({
      method: "GET",
      url: "/ask?query=steel%20bolt&streaming=false",
      headers: { "x-forwarded-prefix": "/w/shared-acme-v1-4242/warehouse" },
    });
    const body = res.json();
    expect(body.results[0].url).toBe("/w/shared-acme-v1-4242/warehouse/products/sku-1");
    expect(body.results[0].schema_object["@id"]).toBe("/w/shared-acme-v1-4242/warehouse/products/sku-1");
    expect(body.results[0].url).not.toContain("ws_internal_123");
    await aliasApp.close();
  });
});
