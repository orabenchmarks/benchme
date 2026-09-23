import { describe, expect, it } from "vitest";
import { pLimit } from "./p-limit.js";

describe("pLimit", () => {
  it("never runs more than `concurrency` tasks at once, and runs them all", async () => {
    const limit = pLimit(2);
    let inFlight = 0;
    let peak = 0;
    const task = async (n: number): Promise<number> => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return n;
    };
    const out = await Promise.all([1, 2, 3, 4, 5].map((n) => limit(() => task(n))));
    expect(out).toEqual([1, 2, 3, 4, 5]);
    expect(peak).toBe(2);
  });

  it("releases its slot when a task rejects, so the queue still drains", async () => {
    const limit = pLimit(1);
    await expect(limit(async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    await expect(limit(async () => "after")).resolves.toBe("after");
  });
});
