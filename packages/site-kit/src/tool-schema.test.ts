import { describe, expect, it } from "vitest";
import { z } from "zod";
import { toolInputJsonSchema } from "./tool-schema.js";

describe("toolInputJsonSchema", () => {
  it("renders a raw zod shape as a draft-07 object schema with required keys", () => {
    const s = toolInputJsonSchema({ input: { sku: z.string().describe("The SKU"), limit: z.number().int().optional() } });
    expect(s.type).toBe("object");
    expect(s.required).toEqual(["sku"]);
    expect((s.properties.sku as { type: string; description: string })).toMatchObject({ type: "string", description: "The SKU" });
    expect((s.properties.limit as { type: string })).toMatchObject({ type: "integer" });
    expect(s).not.toHaveProperty("$schema");
  });
  it("renders an empty shape as an object with no properties", () => {
    expect(toolInputJsonSchema({ input: {} })).toEqual({ type: "object", properties: {}, additionalProperties: false });
  });
});
