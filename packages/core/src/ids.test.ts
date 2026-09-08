import { describe, expect, it } from "vitest";
import { isWorkspaceId, newWorkspaceId } from "./ids.js";

describe("workspace ids", () => {
  it("has the ws_ + 12 hex shape", () => {
    expect(newWorkspaceId()).toMatch(/^ws_[0-9a-f]{12}$/);
  });
  it("does not collide across 10k draws", () => {
    const ids = new Set(Array.from({ length: 10_000 }, () => newWorkspaceId()));
    expect(ids.size).toBe(10_000);
  });
  it("validates shape strictly", () => {
    expect(isWorkspaceId("ws_0123456789ab")).toBe(true);
    expect(isWorkspaceId("ws_0123456789AB")).toBe(false);
    expect(isWorkspaceId("ws_0123456789abc")).toBe(false);
    expect(isWorkspaceId("0123456789ab")).toBe(false);
  });
});
