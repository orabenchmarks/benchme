import { describe, expect, it } from "vitest";
import { z } from "zod";
import { loadConfig } from "./config.js";

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
});

describe("loadConfig", () => {
  it("parses and applies defaults", () => {
    expect(loadConfig(schema, { DATABASE_URL: "postgres://x/y" })).toEqual({ PORT: 3000, DATABASE_URL: "postgres://x/y" });
  });
  it("names every offending key", () => {
    let message = "";
    try {
      loadConfig(schema, { PORT: "nope" });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("DATABASE_URL");
    expect(message).toContain("PORT");
  });
  // compose's `${X:-}` and a chart's `""` are how deployment tools say "not
  // set": an empty value reads as unset — never a failed URL check, never a
  // number coerced to 0 (an empty price would silently bill at $0).
  it("treats an empty value as unset", () => {
    const withOptionals = schema.extend({ LLM_BASE_URL: z.string().url().optional(), PRICE: z.coerce.number().nonnegative().default(1) });
    expect(loadConfig(withOptionals, { DATABASE_URL: "postgres://x/y", PORT: "", LLM_BASE_URL: "", PRICE: "" })).toEqual({ PORT: 3000, DATABASE_URL: "postgres://x/y", PRICE: 1 });
    expect(() => loadConfig(schema, { DATABASE_URL: "" })).toThrow(/DATABASE_URL/);
  });
});
