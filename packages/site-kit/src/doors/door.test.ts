import { describe, expect, it } from "vitest";
import { doorOf } from "./door.js";

describe("doorOf", () => {
  it.each([
    ["/", "page"],
    ["/bookings/BK-1?x=1", "page"],
    ["/bookings/:no", "page"],
    ["/api/v1/bookings/BK-1", "rest"],
    ["/api/v1/bookings/:no", "rest"],
    ["/ask", "rest"],
    ["/ask/mcp", "mcp"],
    ["/mcp", "mcp"],
    ["/mcp?x=1", "mcp"],
  ] as const)("reads %s as %s", (path, door) => {
    expect(doorOf(path)).toBe(door);
  });

  it("calls /mcp the page's own tools only when the call proved it is the page's bridge", () => {
    expect(doorOf("/mcp", true)).toBe("webmcp");
    expect(doorOf("/mcp", false)).toBe("mcp");
    // The bridge only ever calls /mcp: a proof anywhere else leaves the request what it is.
    expect(doorOf("/ask/mcp", true)).toBe("mcp");
    expect(doorOf("/api/v1/bookings", true)).toBe("rest");
    expect(doorOf("/bookings", true)).toBe("page");
  });

  it("gives no door to what no agent opens: the gateway's own /internal/ and the probes", () => {
    expect(doorOf("/internal/workspaces/ws_0123456789ab/seed")).toBeNull();
    expect(doorOf("/internal/workspaces/ws_0123456789ab/ledger?cursor=3")).toBeNull();
    expect(doorOf("/healthz")).toBeNull();
    expect(doorOf("/readyz", true)).toBeNull();
  });
});
