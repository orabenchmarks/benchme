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
    expect(a.find((f) => f.path === "robots.txt")!.body).toContain("Disallow: /");
    expect(a.length).toBeGreaterThanOrEqual(15);
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
