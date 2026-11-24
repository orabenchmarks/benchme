import type { FastifyRequest } from "fastify";
import { BRIDGE_TOKEN_HEADER } from "./doors/bridge-credential.js";
import type { ToolRegistry } from "./tool-registry.js";
import { toolInputJsonSchema } from "./tool-schema.js";

export const WEBMCP_SCRIPT_MARKER = 'data-webmcp="bridge"';

/** The global a late-injecting agent sidecar can call once it has installed a modelContext. */
export const WEBMCP_REGISTER_GLOBAL = "__benchmeWebmcpRegister";

/**
 * The page's WebMCP bridge for this request, to render before </body>; nothing
 * at all when the request's workspace is not served through the WebMCP door,
 * so a page then names neither the site's /mcp nor a single tool.
 *
 * The bridge carries a token for the browser's bridge cookie, which the site
 * sets on this response when the browser holds none yet (the workspace scope
 * does, see `registerWorkspaceScope`), and every tool call it makes sends the
 * token back. The site counts a call to /mcp as the page's bridge only when
 * the token is the one for the cookie the call carries: see
 * `BridgeCredential`.
 */
export function webmcpBridge<C>(req: FastifyRequest, tools: ToolRegistry<C>): string {
  if (!req.bridge || !req.doors.has("webmcp")) return "";
  return bridgeScript(tools, req.prefix, req.bridge.issue());
}

/**
 * WebMCP tools are closures inside the page. This script registers one per
 * catalog entry and bridges `execute` to the app's own `/mcp` (JSON-RPC
 * `tools/call`), so the page surface and the MCP surface can never disagree:
 * both are rendered from `ToolRegistry.list()`. Every call it makes is a
 * same-origin request, so the browser sends the site's cookies with it (the
 * bridge cookie and, once signed in, the session), and it sends the page's
 * token in BRIDGE_TOKEN_HEADER.
 *
 * Two globals carry the API today, and a page cannot know which browser it is
 * in, so it registers on EVERY distinct one present:
 *  - `document.modelContext` — the WebMCP Community Group draft; Cloudflare's
 *    Kitesurf browser implements this one (2026-09-28);
 *  - `navigator.modelContext` — Chromium behind its WebMCP testing flag, and
 *    the injected shims agent harnesses install.
 * A browser that exposes one object under both names registers once; a
 * registry that refuses a name it already holds (two names over one backing
 * store) costs that tool a console warning, never the rest of the tools.
 *
 * Registration is a FUNCTION, not a parse-time side effect, because the agent
 * that provides `navigator.modelContext` usually injects it AFTER the page
 * parses: a one-shot attempt at parse time silently registered nothing and
 * never tried again. So it runs immediately, again on `DOMContentLoaded`, and
 * on demand via `window.__benchmeWebmcpRegister()` — remembering each context
 * it already registered on, so the three paths together still register each
 * tool exactly once per context, and a context that appears late (a shim
 * injected after parse) still gets its tools. `document` and `navigator` are
 * read defensively: a non-browser runtime must be a no-op, never a
 * ReferenceError that kills the rest of the page's scripts.
 */
export function bridgeScript<C>(tools: ToolRegistry<C>, prefix: string, token: string): string {
  const catalog = tools.list().map((t) => ({ name: t.name, description: t.description, inputSchema: toolInputJsonSchema(t) }));
  const json = JSON.stringify({ endpoint: `${prefix}/mcp`, token, tools: catalog }).replace(/<\//g, "<\\/");
  return `<script ${WEBMCP_SCRIPT_MARKER}>(function(){var cfg=${json};var seq=0;var done=[];
function call(name,args){return fetch(cfg.endpoint,{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json","accept":"application/json, text/event-stream","${BRIDGE_TOKEN_HEADER}":cfg.token},body:JSON.stringify({jsonrpc:"2.0",id:++seq,method:"tools/call",params:{name:name,arguments:args||{}}})}).then(function(r){return r.text()}).then(function(t){var line=t.split("\\n").filter(function(l){return l.indexOf("data:")===0}).pop();var body=JSON.parse(line?line.slice(5):t);var c=body.result&&body.result.content;return c&&c[0]&&c[0].text?c[0].text:JSON.stringify(body.result||body.error)})}
function contexts(){var out=[];if(typeof document!=="undefined"&&document&&document.modelContext)out.push(document.modelContext);if(typeof navigator!=="undefined"&&navigator&&navigator.modelContext&&out.indexOf(navigator.modelContext)<0)out.push(navigator.modelContext);return out.filter(function(mc){return typeof mc.registerTool==="function"})}
function register(){contexts().forEach(function(mc){if(done.indexOf(mc)>=0)return;done.push(mc);
cfg.tools.forEach(function(t){try{mc.registerTool({name:t.name,description:t.description,inputSchema:t.inputSchema,execute:function(a){return call(t.name,a)}})}catch(e){if(typeof console!=="undefined")console.warn("webmcp: "+t.name+" not registered: "+e)}})});return done.length>0}
if(typeof window!=="undefined")window.${WEBMCP_REGISTER_GLOBAL}=register;
register();
if(typeof document!=="undefined"&&document.addEventListener)document.addEventListener("DOMContentLoaded",register);})();</script>`;
}
