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
});
