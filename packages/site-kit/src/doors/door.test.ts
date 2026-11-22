import { describe, expect, it } from "vitest";
import { DOOR_HEADER, doorOf } from "./door.js";

describe("doorOf", () => {
  it("reads the door off the path the app routes", () => {
    expect(doorOf("/")).toBe("page");
    expect(doorOf("/bookings/BK-1?x=1")).toBe("page");
    expect(doorOf("/api/v1/bookings/BK-1")).toBe("rest");
    expect(doorOf("/mcp")).toBe("mcp");
    expect(doorOf("/mcp?x=1")).toBe("mcp");
  });

  it("calls /mcp the page's own tools only when the bridge's header says so", () => {
    expect(doorOf("/mcp", { [DOOR_HEADER]: "webmcp" })).toBe("webmcp");
    expect(doorOf("/mcp", { [DOOR_HEADER]: "something-else" })).toBe("mcp");
    // The header names a tool call's door and nothing else: a page or REST request that carries it stays what it is.
    expect(doorOf("/api/v1/bookings", { [DOOR_HEADER]: "webmcp" })).toBe("rest");
    expect(doorOf("/bookings", { [DOOR_HEADER]: "webmcp" })).toBe("page");
  });

  it("gives no door to what no agent opens: the gateway's own /internal/ and the probes", () => {
    expect(doorOf("/internal/workspaces/ws_0123456789ab/seed")).toBeNull();
    expect(doorOf("/internal/workspaces/ws_0123456789ab/ledger?cursor=3")).toBeNull();
    expect(doorOf("/healthz")).toBeNull();
    expect(doorOf("/readyz")).toBeNull();
  });
});
