import type { ToolRegistry } from "./tool-registry.js";
import { toolInputJsonSchema } from "./tool-schema.js";

export const WEBMCP_SCRIPT_MARKER = 'data-webmcp="bridge"';

/**
 * WebMCP (`navigator.modelContext`) tools are closures inside the page. This
 * script registers one per catalog entry and bridges `execute` to the app's
 * own `/mcp` (JSON-RPC `tools/call`), so the page surface and the MCP surface
 * can never disagree: both are rendered from `ToolRegistry.list()`.
 * A browser without `navigator.modelContext` runs nothing.
 */
export function webmcpScript<C>(tools: ToolRegistry<C>, prefix: string): string {
  const catalog = tools.list().map((t) => ({ name: t.name, description: t.description, inputSchema: toolInputJsonSchema(t) }));
  const json = JSON.stringify({ endpoint: `${prefix}/mcp`, tools: catalog }).replace(/<\//g, "<\\/");
  return `<script ${WEBMCP_SCRIPT_MARKER}>(function(){var mc=navigator.modelContext;if(!mc||typeof mc.registerTool!=="function")return;var cfg=${json};var seq=0;
function call(name,args){return fetch(cfg.endpoint,{method:"POST",headers:{"content-type":"application/json","accept":"application/json, text/event-stream"},body:JSON.stringify({jsonrpc:"2.0",id:++seq,method:"tools/call",params:{name:name,arguments:args||{}}})}).then(function(r){return r.text()}).then(function(t){var line=t.split("\\n").filter(function(l){return l.indexOf("data:")===0}).pop();var body=JSON.parse(line?line.slice(5):t);var c=body.result&&body.result.content;return c&&c[0]&&c[0].text?c[0].text:JSON.stringify(body.result||body.error)})}
cfg.tools.forEach(function(t){mc.registerTool({name:t.name,description:t.description,inputSchema:t.inputSchema,execute:function(a){return call(t.name,a)}})});})();</script>`;
}
