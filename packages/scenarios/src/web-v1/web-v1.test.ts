import { describe, expect, it } from "vitest";
import { acmeV1 } from "../acme-v1/index.js";
import { scenarios, webV1 } from "../index.js";

describe("web-v1", () => {
  it("is registered in the default registry, after acme-v1 (robots.txt advertises the first scenario's shared workspace)", () => {
    expect(scenarios.get("web-v1")).toBe(webV1);
    expect(scenarios.list()[0]?.key).toBe("acme-v1");
  });

  it("advertises the site network alone", () => {
    expect(webV1.apps).toEqual(["web"]);
  });

  it("seeds nothing into the acme apps: the network's pages are a function of the seed", () => {
    const rows = webV1.generate(104_729);
    expect(rows.warehouse).toEqual({ products: [], locations: [], stock: [], customers: [], orders: [], orderLines: [], transfers: [] });
    expect(rows.helpdesk).toEqual({ agents: [], tickets: [], comments: [], slaPolicies: [] });
    expect(rows.vault).toEqual({ documents: [] });
    expect(rows.company).toEqual(acmeV1.generate(1).company);
  });
});
