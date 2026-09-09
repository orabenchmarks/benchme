import { describe, expect, it } from "vitest";
import { parseBytes, parseCpus } from "./quantity.js";

describe("resource quantities", () => {
  it("parses cpus", () => {
    expect(parseCpus("2")).toBe(2);
    expect(parseCpus("500m")).toBe(0.5);
    expect(parseCpus("1.5")).toBe(1.5);
    expect(() => parseCpus("two")).toThrow(/invalid cpu/);
  });
  it("parses memory", () => {
    expect(parseBytes("2Gi")).toBe(2 * 1024 ** 3);
    expect(parseBytes("512Mi")).toBe(512 * 1024 ** 2);
    expect(parseBytes("1G")).toBe(1e9);
    expect(parseBytes("1024")).toBe(1024);
    expect(() => parseBytes("2GB")).toThrow(/invalid memory/);
  });
});
