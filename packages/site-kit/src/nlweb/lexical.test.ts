import { describe, expect, it } from "vitest";
import { retrieve, tokenize, LexicalRanker } from "./lexical.js";
import type { AskItem } from "./types.js";
const item = (id: string, name: string, text: string): AskItem => ({ id, url: `/p/${id}`, name, text, schema: { "@context": "https://schema.org", "@type": "Product", "@id": id, url: `/p/${id}` } });
describe("lexical", () => {
  it("tokenizes case-insensitively and drops stopwords", () => expect(tokenize("The Steel BOLTS, for m8")).toEqual(["steel", "bolts", "m8"]));
  it("ranks by overlap and is deterministic across input order", () => {
    const items = [item("a", "Steel bolt M8", "zinc"), item("b", "Copper wire", "2mm"), item("c", "Bolt cutter", "steel")];
    const r1 = retrieve("steel bolt", items, 10).map((x) => x.item.id);
    const r2 = retrieve("steel bolt", [...items].reverse(), 10).map((x) => x.item.id);
    expect(r1).toEqual(["a", "c"]);
    expect(r2).toEqual(r1);
  });
  it("weights a name hit above a body hit", () => {
    const [top, next] = retrieve("steel bolt", [item("a", "Steel bolt M8", "zinc"), item("c", "Bolt cutter", "steel")], 10);
    expect(top!.item.id).toBe("a");
    expect(top!.score).toBeGreaterThan(next!.score);
  });
  it("breaks ties by id ascending, whatever the input order", () => {
    const tied = [item("c", "Steel bolt", "x"), item("a", "Steel bolt", "y"), item("b", "Steel bolt", "z")];
    expect(retrieve("steel bolt", tied, 10).map((x) => x.item.id)).toEqual(["a", "b", "c"]);
    expect(retrieve("steel bolt", [...tied].reverse(), 10).map((x) => x.item.id)).toEqual(["a", "b", "c"]);
  });
  it("returns nothing for a query with no overlap", () => expect(retrieve("banana", [item("a", "bolt", "")], 10)).toEqual([]));
  it("keeps only topK", () => expect(retrieve("bolt", [item("a", "bolt", ""), item("b", "bolt", ""), item("c", "bolt", "")], 2).map((x) => x.item.id)).toEqual(["a", "b"]));
  it("LexicalRanker re-emits the retrieval score with zero cost", async () => {
    const out = await new LexicalRanker().rank("bolt", [item("a", "bolt", "")]);
    expect(out.ranked[0]).toMatchObject({ id: "a" });
    expect(out.usage).toMatchObject({ calls: 0, costUsd: 0, degraded: false });
  });
});
