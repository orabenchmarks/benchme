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
