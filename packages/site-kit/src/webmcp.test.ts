import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ToolRegistry } from "./tool-registry.js";
import { webmcpScript, WEBMCP_SCRIPT_MARKER } from "./webmcp.js";

const reg = new ToolRegistry<unknown>().register({ name: "get_stock", description: "Stock of a SKU", input: { sku: z.string() }, handler: async () => ({}) });

describe("webmcpScript", () => {
  it("embeds every tool with its JSON Schema and bridges execute to <prefix>/mcp", () => {
    const s = webmcpScript(reg, "/w/abc/warehouse");
    expect(s.startsWith(`<script ${WEBMCP_SCRIPT_MARKER}>`)).toBe(true);
    expect(s).toContain('"name":"get_stock"');
    expect(s).toContain('"required":["sku"]');
    expect(s).toContain('"/w/abc/warehouse/mcp"');
    expect(s).toContain("navigator.modelContext");
    expect(s).toContain("registerTool");
  });
  it("escapes </script> inside tool text so the page cannot be broken by a description", () => {
    const r = new ToolRegistry<unknown>().register({ name: "x", description: "a</script><b>", input: {}, handler: async () => 1 });
    expect(webmcpScript(r, "/p")).not.toContain("a</script><b>");
  });
});
