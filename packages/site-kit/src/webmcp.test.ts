import { DOORS_HEADER, DOORS_SIG_HEADER, DoorSet, WORKSPACE_HEADER, WORKSPACE_SIG_HEADER, doorsHeaders, signWorkspaceHeader } from "@benchme/core";
import Fastify, { type FastifyInstance } from "fastify";
import { createContext, runInContext } from "node:vm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { BRIDGE_COOKIE, BRIDGE_TOKEN_HEADER, bridgeToken } from "./doors/bridge-credential.js";
import { ToolRegistry } from "./tool-registry.js";
import { bridgeScript, webmcpBridge, WEBMCP_SCRIPT_MARKER } from "./webmcp.js";
import { registerWorkspaceScope } from "./workspace-scope.js";

const reg = new ToolRegistry<unknown>().register({ name: "get_stock", description: "Stock of a SKU", input: { sku: z.string() }, handler: async () => ({}) });
const TOKEN = "a".repeat(64);

describe("bridgeScript", () => {
  it("embeds every tool with its JSON Schema, the page's token, and bridges execute to <prefix>/mcp", () => {
    const s = bridgeScript(reg, "/w/abc/warehouse", TOKEN);
    expect(s.startsWith(`<script ${WEBMCP_SCRIPT_MARKER}>`)).toBe(true);
    expect(s).toContain('"name":"get_stock"');
    expect(s).toContain('"required":["sku"]');
    expect(s).toContain('"/w/abc/warehouse/mcp"');
    expect(s).toContain(`"token":"${TOKEN}"`);
    expect(s).toContain("navigator.modelContext");
    expect(s).toContain("registerTool");
    // The label it used to send, which any client could copy, is gone.
    expect(s).not.toContain("x-benchme-door");
  });
  it("escapes </script> inside tool text so the page cannot be broken by a description", () => {
    const r = new ToolRegistry<unknown>().register({ name: "x", description: "a</script><b>", input: {}, handler: async () => 1 });
    expect(bridgeScript(r, "/p", TOKEN)).not.toContain("a</script><b>");
  });
});

/** The script body as a browser would execute it, with the <script> wrapper peeled off. */
function body(prefix = "/w/abc/warehouse"): string {
  const s = bridgeScript(reg, prefix, TOKEN);
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
    // Every call sends the page's token, and goes as a same-origin request: the browser adds the site's cookies to it,
    // the bridge cookie the token is for among them. The site counts the call as the page's bridge only with both.
    const sent = (fetchSpy.mock.calls[0] as unknown as [string, { credentials: string; headers: Record<string, string> }])[1];
    expect(sent.credentials).toBe("same-origin");
    expect(sent.headers[BRIDGE_TOKEN_HEADER]).toBe(TOKEN);
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
    const s = bridgeScript(two, "/p", TOKEN);
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

// The bridge a page renders for a request: its workspace's doors decide whether there is one, and its cookie what token it carries.
describe("webmcpBridge", () => {
  const SECRET = "gateway-secret-for-tests";
  const WS = "ws_0123456789ab";
  const OTHER_WS = "ws_ba9876543210";
  let app: FastifyInstance;
  /** What the gateway forwards: the workspace, signed, its prefix, and (when given) the workspace's doors, signed. */
  const forwarded = (ws = WS, doors?: DoorSet) => ({ [WORKSPACE_HEADER]: ws, [WORKSPACE_SIG_HEADER]: signWorkspaceHeader(SECRET, ws), "x-forwarded-prefix": `/w/${ws}/toy`, ...(doors ? doorsHeaders(SECRET, ws, doors) : {}) });
  const page = (headers: Record<string, string>) => app.inject({ url: "/", headers });
  const tokenIn = (html: string) => /"token":"([0-9a-f]+)"/.exec(html)?.[1];

  beforeAll(async () => {
    app = Fastify();
    registerWorkspaceScope(app, SECRET);
    app.get("/", async (req, reply) => reply.type("text/html").send(`<!doctype html><p>a page</p>${webmcpBridge(req, reg)}`));
  });
  afterAll(async () => {
    await app?.close();
  });

  it("renders nothing, and sets no cookie, where the workspace is not served through the WebMCP door", async () => {
    for (const doors of [DoorSet.of(["rest", "mcp"]), DoorSet.of([])]) {
      const res = await page(forwarded(WS, doors));
      expect(res.body).toBe("<!doctype html><p>a page</p>");
      expect(res.body).not.toContain("/mcp");
      expect(res.headers["set-cookie"]).toBeUndefined();
    }
  });

  it("mints a bridge cookie for a browser that holds none, only the site's pages', unreadable by scripts, never sent by another site; and embeds its token", async () => {
    const res = await page(forwarded(WS, DoorSet.of(["webmcp"])));
    expect(res.body).toContain(WEBMCP_SCRIPT_MARKER);
    const setCookie = String(res.headers["set-cookie"]);
    expect(setCookie).toMatch(new RegExp(`^${BRIDGE_COOKIE}=[0-9a-f]{32}; Path=/w/${WS}/toy/; HttpOnly; SameSite=Strict$`));
    const cookie = setCookie.split(";")[0]!.split("=")[1]!;
    expect(tokenIn(res.body)).toBe(bridgeToken(SECRET, WS, cookie));
    // The cookie itself is nowhere in the page: only its token is.
    expect(res.body).not.toContain(cookie);
  });

  it("keeps the cookie a browser already holds, so several tabs share one, and mints a fresh one for anything else under its name", async () => {
    const held = "0123456789abcdef0123456789abcdef";
    const tabs = await Promise.all([1, 2].map(() => page({ ...forwarded(), cookie: `other=1; ${BRIDGE_COOKIE}=${held}` })));
    for (const tab of tabs) {
      expect(tab.headers["set-cookie"]).toBeUndefined();
      expect(tokenIn(tab.body)).toBe(bridgeToken(SECRET, WS, held));
    }
    for (const junk of ["x", "0123456789ABCDEF0123456789ABCDEF", `${held}00`]) {
      const res = await page({ ...forwarded(), cookie: `${BRIDGE_COOKIE}=${junk}` });
      const minted = String(res.headers["set-cookie"]).split(";")[0]!.split("=")[1]!;
      expect([junk, minted]).toEqual([junk, expect.stringMatching(/^[0-9a-f]{32}$/)]);
      expect(tokenIn(res.body)).toBe(bridgeToken(SECRET, WS, minted));
    }
  });

  it("binds the token to the workspace: one cookie, two workspaces, two tokens", async () => {
    const held = "fedcba9876543210fedcba9876543210";
    const mine = tokenIn((await page({ ...forwarded(WS), cookie: `${BRIDGE_COOKIE}=${held}` })).body);
    const theirs = tokenIn((await page({ ...forwarded(OTHER_WS), cookie: `${BRIDGE_COOKIE}=${held}` })).body);
    expect(mine).toBe(bridgeToken(SECRET, WS, held));
    expect(theirs).toBe(bridgeToken(SECRET, OTHER_WS, held));
    expect(mine).not.toBe(theirs);
  });

  it("renders the bridge as it always did behind a gateway that names no doors", async () => {
    const res = await page(forwarded());
    expect([res.body.includes(WEBMCP_SCRIPT_MARKER), DOORS_HEADER in forwarded(), DOORS_SIG_HEADER in forwarded()]).toEqual([true, false, false]);
  });
});
