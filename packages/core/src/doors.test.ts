import { describe, expect, it } from "vitest";
import { admits, doorsAt } from "./door-paths.js";
import { DOORS, DoorSet, UnknownDoorError } from "./doors.js";

describe("DoorSet", () => {
  it.each([
    ["page,rest,mcp,webmcp", ["page", "rest", "mcp", "webmcp"]],
    ["webmcp,page", ["page", "webmcp"]],
    // page is always served: a list may leave it out, and an empty one is the pages alone.
    ["webmcp", ["page", "webmcp"]],
    ["", ["page"]],
    [" rest , ,mcp,rest ", ["page", "rest", "mcp"]],
  ])("reads %j as %j, in the order of DOORS", (list, doors) => {
    expect(DoorSet.parse(list).list()).toEqual(doors);
    expect(DoorSet.parse(list).toString()).toBe(doors.join(","));
  });

  it("refuses a name that is no door when a caller asks for it, naming the doors there are", () => {
    expect(() => DoorSet.of(["page", "ftp"])).toThrow(UnknownDoorError);
    expect(() => DoorSet.parse("page,MCP")).toThrow(/unknown door "MCP": the doors are page, rest, mcp, webmcp/);
  });

  it("leaves out, when reading back what was kept, a name this version does not know", () => {
    expect(DoorSet.read(["webmcp", "payments"]).list()).toEqual(["page", "webmcp"]);
  });

  it("has every door in ALL, and answers has() for each", () => {
    expect(DoorSet.ALL.list()).toEqual([...DOORS]);
    const two = DoorSet.of(["webmcp"]);
    expect(DOORS.map((door) => two.has(door))).toEqual([true, false, false, true]);
  });
});

describe("doorsAt: the doors a path is reached through", () => {
  it.each([
    ["/", ["page"]],
    ["/bookings/BK-1?x=1", ["page"]],
    ["/schema/feed.jsonl", ["page"]],
    ["/api/v1/bookings/BK-1", ["rest"]],
    ["/api", ["rest"]],
    ["/ask", ["rest"]],
    ["/ask?q=x", ["rest"]],
    ["/ask/", ["rest"]],
    ["/ask/mcp", ["mcp"]],
    ["/mcp", ["mcp", "webmcp"]],
    ["/mcp?x=1", ["mcp", "webmcp"]],
    ["/mcp/", ["mcp", "webmcp"]],
    // Only these spellings: what an app routes elsewhere is a page.
    ["/apis/v1", ["page"]],
    ["/mcpx", ["page"]],
    ["/asking", ["page"]],
    // What no agent opens: the gateway's own calls and the probes.
    ["/internal/workspaces/ws_0123456789ab/seed", []],
    ["/internal/workspaces/ws_0123456789ab/ledger?cursor=3", []],
    ["/healthz", []],
    ["/readyz", []],
  ])("%s → %j", (path, doors) => {
    expect(doorsAt(path)).toEqual(doors);
  });

  it("admits a path when one of its doors is open, and always a path that is no door", () => {
    const pagesAndBridge = DoorSet.of(["webmcp"]);
    expect(["/", "/api/v1/x", "/ask", "/ask/mcp", "/mcp", "/internal/records", "/healthz"].map((p) => admits(pagesAndBridge, p))).toEqual([true, false, false, false, true, true, true]);
    const pages = DoorSet.of([]);
    expect(["/", "/api/v1/x", "/ask/mcp", "/mcp"].map((p) => admits(pages, p))).toEqual([true, false, false, false]);
  });
});
