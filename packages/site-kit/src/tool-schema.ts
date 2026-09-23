import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { ToolDef } from "./tool-registry.js";

/** The JSON Schema a WebMCP registration carries (draft-07 subset, no `$schema` key). */
export type JsonSchemaObject = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

/**
 * One catalog, two surfaces: the MCP SDK converts `ToolDef.input` itself; the
 * page-side WebMCP registration needs the same schema as data. Strip `$schema`
 * so the object is exactly what `navigator.modelContext.registerTool` expects.
 */
export function toolInputJsonSchema(def: Pick<ToolDef<unknown>, "input">): JsonSchemaObject {
  const { $schema: _drop, ...rest } = zodToJsonSchema(z.object(def.input).strict(), { target: "jsonSchema7" }) as Record<string, unknown>;
  const out = rest as JsonSchemaObject;
  if (!out.properties) out.properties = {};
  return out;
}
