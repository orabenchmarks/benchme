import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createApp } from "./http.js";

describe("createApp", () => {
  it("serves healthz and readyz", async () => {
    let ready = false;
    const app = createApp({ name: "t", readiness: async () => ready });
    expect((await app.inject("/healthz")).statusCode).toBe(200);
    expect((await app.inject("/readyz")).statusCode).toBe(503);
    ready = true;
    expect((await app.inject("/readyz")).statusCode).toBe(200);
  });
  it("renders zod errors as 400 with issues and hides internals as 500", async () => {
    const app = createApp({ name: "t" });
    app.get("/v", async () => z.object({ n: z.number() }).parse({ n: "x" }));
    app.get("/boom", async () => {
      throw new Error("secret detail");
    });
    const v = await app.inject("/v");
    expect(v.statusCode).toBe(400);
    expect(v.json().issues[0].path).toEqual(["n"]);
    const b = await app.inject("/boom");
    expect(b.statusCode).toBe(500);
    expect(b.body).not.toContain("secret detail");
  });
});
