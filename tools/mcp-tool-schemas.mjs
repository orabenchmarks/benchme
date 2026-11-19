#!/usr/bin/env node
/**
 * mcp-tool-schemas — refuse an MCP tool whose advertised input schema carries
 * a "$ref": some agent clients cannot follow one.
 *
 *   npm run build && node tools/mcp-tool-schemas.mjs
 *
 * A tool's input is a zod raw shape (ToolDef.input, packages/site-kit). The
 * MCP SDK turns it into JSON Schema for tools/list, and the pages' WebMCP
 * registration does the same (site-kit's toolInputJsonSchema). The converter
 * writes a zod schema OBJECT it has already met in the same tool as a pointer
 * to the first place it met it — so two fields sharing one instance
 * (`startTime: time, endTime: time`, or `date.optional()` twice: the inner
 * string is one object) make the second `{"$ref": "#/properties/startTime"}`.
 * The fix is a fresh instance per field: a factory (`timeOf()`, `key()`), as
 * the sites' src/api/inputs.ts export beside the constants REST keeps.
 *
 * For every app with a built apps/<app>/dist/mcp/tools.js it calls each
 * exported `*Tools()` registry factory and converts each tool's input as the
 * SDK does (zod-to-json-schema over z.object(input), strictUnions, no name —
 * so $refStrategy is "root"; pipeStrategy left at "all", which reads both
 * halves of a pipe, as the WebMCP conversion does). One line per tool that
 * carries a "$ref", and exit 1 on any; exit 0 prints how many tools it read.
 * Tools that are not built, do not load or come back empty fail too: a list
 * that was never read is not a clean one.
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
// Neither is a root dependency: both are @benchme/site-kit's, hoisted to the root node_modules.
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** Every `{"$ref": "<pointer>"}` in a JSON Schema, as [where it sits, what it points at]. A property NAMED $ref holds a schema, not a string. */
const refsIn = (node, at = "#") => {
  if (Array.isArray(node)) return node.flatMap((n, i) => refsIn(n, `${at}/${i}`));
  if (!node || typeof node !== "object") return [];
  return [...(typeof node.$ref === "string" ? [[at, node.$ref]] : []), ...Object.entries(node).flatMap(([k, v]) => refsIn(v, `${at}/${k}`))];
};

const problems = [];
const hits = [];
let apps = 0;
let tools = 0;
for (const app of readdirSync(join(ROOT, "apps")).sort()) {
  const built = join(ROOT, "apps", app, "dist/mcp/tools.js");
  if (!existsSync(built)) {
    if (existsSync(join(ROOT, "apps", app, "src/mcp/tools.ts"))) problems.push(`${app}: src/mcp/tools.ts is not built (no dist/mcp/tools.js) — npm run build`);
    continue;
  }
  let mod;
  try {
    mod = await import(pathToFileURL(built).href);
  } catch (err) {
    problems.push(`${app}: dist/mcp/tools.js does not load — ${err instanceof Error ? err.message : err}`);
    continue;
  }
  let read = 0;
  for (const [name, factory] of Object.entries(mod)) {
    if (typeof factory !== "function" || !/Tools$/.test(name)) continue;
    let registry;
    try {
      registry = factory();
    } catch (err) {
      problems.push(`${app}: ${name}() threw — ${err instanceof Error ? err.message : err}`);
      continue;
    }
    if (typeof registry?.list !== "function") continue;
    for (const tool of registry.list()) {
      read++;
      const refs = refsIn(zodToJsonSchema(z.object(tool.input), { strictUnions: true }));
      if (refs.length) hits.push(`${app}.${tool.name}: ${refs.map(([at, to]) => `${at} → ${to}`).join(", ")}`);
    }
  }
  if (!read) problems.push(`${app}: dist/mcp/tools.js gave no tool (no exported *Tools() registry with a tool in it)`);
  apps++;
  tools += read;
}
if (!tools) problems.push("no MCP tool read from apps/*/dist/mcp/tools.js — npm run build");

if (hits.length || problems.length) {
  if (hits.length) {
    console.error(`${hits.length} MCP tool(s) advertise a "$ref" — two fields of one tool share a zod schema instance; give each field its own (a factory, as apps/pizza/src/api/inputs.ts does):`);
    for (const hit of hits) console.error(`  ${hit}`);
  }
  for (const problem of problems) console.error(`mcp-tool-schemas: ${problem}`);
  process.exit(1);
}
console.log(`mcp tool schemas: ${tools} tools in ${apps} apps, none with a "$ref"`);
