import { scenarios } from "@benchme/scenarios";
import { describe, expect, it } from "vitest";
import { buildSite } from "./site.js";

describe("data site", () => {
  it("is deterministic and carries the scenario's figures", () => {
    const a = buildSite(20260908);
    const b = buildSite(20260908);
    expect(a).toEqual(b);
    const rows = scenarios.get("acme-v1").generate(20260908);
    const about = a.find((f) => f.path === "about.html")!.body;
    expect(about).toContain(String(rows.company.employees));
    const csv = a.find((f) => f.path === "downloads/products.csv")!.body.split("\n");
    expect(csv).toHaveLength(rows.warehouse.products.length + 1);
    expect(a.find((f) => f.path === "robots.txt")!.body).toContain("Allow: /");
    expect(a.length).toBeGreaterThanOrEqual(15);
  });
});

describe("structured data", () => {
  it("gives every html page exactly one application/ld+json block that parses", () => {
    const files = buildSite(20260908);
    const htmlFiles = files.filter((f) => f.contentType.startsWith("text/html"));
    expect(htmlFiles.length).toBeGreaterThan(0);
    for (const f of htmlFiles) {
      const blocks = [...f.body.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
      expect(blocks, f.path).toHaveLength(1);
      expect(() => JSON.parse(blocks[0]![1]!), f.path).not.toThrow();
    }
  });

  it("publishes schema/feed.jsonl with one JSON-LD object per line", () => {
    const files = buildSite(20260908);
    const rows = scenarios.get("acme-v1").generate(20260908);
    const feed = files.find((f) => f.path === "schema/feed.jsonl")!;
    expect(feed.contentType).toBe("application/jsonl");
    const lines = feed.body.split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(rows.warehouse.products.length + rows.warehouse.locations.length + 1);
    for (const line of lines) {
      const obj = JSON.parse(line);
      expect(obj["@context"]).toBe("https://schema.org");
      expect(obj["@type"]).toBeTruthy();
      expect(obj["@id"]).toBeTruthy();
    }
  });

  it("publishes schema/map.xml as a schemafeed sitemap and robots.txt advertises it", () => {
    const files = buildSite(20260908);
    const map = files.find((f) => f.path === "schema/map.xml")!;
    expect(map.contentType).toBe("application/xml");
    expect(map.body).toContain("<sf:contentType>structuredData/schema.org</sf:contentType>");
    expect(map.body).toContain("<loc>feed.jsonl</loc>");
    const robots = files.find((f) => f.path === "robots.txt")!;
    expect(robots.body).toContain("schemamap: schema/map.xml");
  });
});

describe("links", () => {
  it("are relative and resolve to a generated file from every page (the site is served under /w/<workspace>/data/)", () => {
    const files = buildSite(4242);
    const paths = new Set(files.map((f) => f.path));
    const resolves = (from: string, href: string) => {
      const dir = from.split("/").slice(0, -1);
      for (const seg of href.split("/")) {
        if (seg === "..") dir.pop();
        else if (seg !== "." && seg !== "") dir.push(seg);
      }
      const target = dir.join("/");
      return paths.has(target) || paths.has(`${target ? `${target}/` : ""}index.html`);
    };
    let checked = 0;
    for (const f of files.filter((x) => x.contentType.startsWith("text/html"))) {
      for (const [, href] of f.body.matchAll(/href="([^"]*)"/g)) {
        if (href === "/registry") continue; // the gateway's own page, deliberately absolute
        expect(href, `${f.path} → ${href}`).not.toMatch(/^\//);
        expect(resolves(f.path, href!), `${f.path} → ${href}`).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(30);
  });
});
