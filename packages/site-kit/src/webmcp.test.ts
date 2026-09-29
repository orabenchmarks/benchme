import { createContext, runInContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
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

/** The script body as a browser would execute it, with the <script> wrapper peeled off. */
function body(prefix = "/w/abc/warehouse"): string {
  const s = webmcpScript(reg, prefix);
  return s.slice(s.indexOf(">") + 1, s.lastIndexOf("</script>"));
}

/** A `navigator.modelContext` that records what got registered. */
function spyNavigator(): { navigator: unknown; names: string[] } {
  const names: string[] = [];
  return { navigator: { modelContext: { registerTool: (t: { name: string }) => names.push(t.name) } }, names };
}

/** A minimal `document` that can replay its DOMContentLoaded listeners on demand. */
function fakeDocument(): { document: unknown; fire: () => void } {
  const listeners: (() => void)[] = [];
  return { document: { addEventListener: (ev: string, fn: () => void) => ev === "DOMContentLoaded" && listeners.push(fn) }, fire: () => listeners.forEach((f) => f()) };
}

// The script used to run `navigator.modelContext` at PARSE time, unguarded:
// on a non-browser runtime (or a page whose agent sidecar injects
// modelContext after parse) it either threw or registered nothing, forever.
describe("the emitted bridge script", () => {
  it("does not throw where `navigator` does not exist at all", () => {
    const ctx = createContext({});
    expect(() => runInContext(body(), ctx)).not.toThrow();
  });

  it("does not throw, and registers nothing, on a browser with no modelContext", () => {
    const ctx = createContext({ navigator: {}, window: {} });
    expect(() => runInContext(body(), ctx)).not.toThrow();
  });

  it("registers every catalog tool when modelContext is already there", () => {
    const { navigator, names } = spyNavigator();
    runInContext(body(), createContext({ navigator, window: {} }));
    expect(names).toEqual(["get_stock"]);
  });

  it("registers exactly once however many times __benchmeWebmcpRegister is called", () => {
    const { navigator, names } = spyNavigator();
    const window: { __benchmeWebmcpRegister?: () => boolean } = {};
    runInContext(body(), createContext({ navigator, window }));
    expect(typeof window.__benchmeWebmcpRegister).toBe("function");
    expect(window.__benchmeWebmcpRegister?.()).toBe(true);
    expect(window.__benchmeWebmcpRegister?.()).toBe(true);
    expect(names).toEqual(["get_stock"]);
  });

  it("registers on DOMContentLoaded when modelContext arrives after parse (a late sidecar)", () => {
    const { navigator, names } = spyNavigator();
    const { document, fire } = fakeDocument();
    const ctx = createContext({ window: {}, document });
    runInContext(body(), ctx);
    expect(names).toEqual([]);
    ctx.navigator = navigator;
    fire();
    expect(names).toEqual(["get_stock"]);
  });

  it("bridges execute to <prefix>/mcp tools/call", async () => {
    const { navigator, names } = spyNavigator();
    const tools: { name: string; execute: (a: unknown) => Promise<string> }[] = [];
    (navigator as { modelContext: { registerTool: (t: never) => void } }).modelContext.registerTool = (t: never) => {
      tools.push(t);
      names.push((t as { name: string }).name);
    };
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ result: { content: [{ text: "42" }] } })));
    runInContext(body(), createContext({ navigator, window: {}, fetch: fetchSpy }));
    expect(await tools[0]?.execute({ sku: "A" })).toBe("42");
    expect(fetchSpy.mock.calls[0]?.[0]).toBe("/w/abc/warehouse/mcp");
  });
});

/** A modelContext that records what got registered. */
function spyContext(): { mc: { registerTool: (t: { name: string }) => void }; names: string[] } {
  const names: string[] = [];
  return { mc: { registerTool: (t) => names.push(t.name) }, names };
}

// Cloudflare's Kitesurf (2026-09-28) implements the WebMCP Community Group
// draft's `document.modelContext`; Chromium's testing flag and agent shims use
// `navigator.modelContext`. A page registered on navigator alone showed
// Kitesurf agents "No WebMCP tools available".
describe("the bridge on each WebMCP global", () => {
  it("registers on document.modelContext when navigator has none (the CG draft, Kitesurf)", () => {
    const doc = spyContext();
    runInContext(body(), createContext({ document: { modelContext: doc.mc }, navigator: {}, window: {} }));
    expect(doc.names).toEqual(["get_stock"]);
  });

  it("registers on both when the page has two distinct contexts", () => {
    const doc = spyContext();
    const nav = spyContext();
    runInContext(body(), createContext({ document: { modelContext: doc.mc }, navigator: { modelContext: nav.mc }, window: {} }));
    expect(doc.names).toEqual(["get_stock"]);
    expect(nav.names).toEqual(["get_stock"]);
  });

  it("registers once when both names are the same object", () => {
    const one = spyContext();
    runInContext(body(), createContext({ document: { modelContext: one.mc }, navigator: { modelContext: one.mc }, window: {} }));
    expect(one.names).toEqual(["get_stock"]);
  });

  it("a registry refusing one name loses only that tool, not the rest", () => {
    const two = new ToolRegistry<unknown>()
      .register({ name: "get_stock", description: "d", input: {}, handler: async () => 1 })
      .register({ name: "list_orders", description: "d", input: {}, handler: async () => 1 });
    const s = webmcpScript(two, "/p");
    const names: string[] = [];
    const mc = {
      registerTool: (t: { name: string }) => {
        if (t.name === "get_stock") throw new Error("InvalidStateError: duplicate name");
        names.push(t.name);
      },
    };
    const warn = vi.fn();
    const script = s.slice(s.indexOf(">") + 1, s.lastIndexOf("</script>"));
    expect(() => runInContext(script, createContext({ document: { modelContext: mc }, window: {}, console: { warn } }))).not.toThrow();
    expect(names).toEqual(["list_orders"]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("a context that appears late gets its tools; the early one is not registered twice", () => {
    const doc = spyContext();
    const nav = spyContext();
    const window: { __benchmeWebmcpRegister?: () => boolean } = {};
    const ctx = createContext({ document: { modelContext: doc.mc }, window });
    runInContext(body(), ctx);
    ctx.navigator = { modelContext: nav.mc };
    expect(window.__benchmeWebmcpRegister?.()).toBe(true);
    expect(doc.names).toEqual(["get_stock"]);
    expect(nav.names).toEqual(["get_stock"]);
  });
});
