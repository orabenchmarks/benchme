import type { Door, DoorSet } from "@benchme/core";
import type { AppTarget } from "./app-registry.js";

/** The keys of a workspace's `urls` beside `apps`, one per way in that is not a page. */
export type CapabilityKey = "mcp" | "ask" | "askMcp" | "webmcp";

/**
 * Something an app serves beside its pages, and the door it is behind. A
 * workspace's urls and the registry page are both rendered from this list,
 * each entry only where its door is open: so nothing advertises a door the
 * workspace (or the deployment) does not serve, and a new endpoint is one
 * entry here.
 */
export type Capability = {
  key: CapabilityKey;
  /** The registry's column for it. */
  label: string;
  /** The door a request to it comes through (see doorsAt in @benchme/core). */
  door: Door;
  /** Whether the app has it (its flag in MCP_APPS, ASK_APPS, WEBMCP_APPS). */
  has: (app: AppTarget) => boolean;
  /** Where it is under the app's /w/<id>/<app>/. */
  path: string;
};

export const CAPABILITIES: readonly Capability[] = [
  { key: "mcp", label: "MCP endpoint", door: "mcp", has: (a) => a.mcp, path: "mcp" },
  { key: "ask", label: "NLWeb /ask", door: "rest", has: (a) => a.ask, path: "ask" },
  { key: "askMcp", label: "ask MCP", door: "mcp", has: (a) => a.ask, path: "ask/mcp" },
  { key: "webmcp", label: "WebMCP", door: "webmcp", has: (a) => a.webmcp, path: "" },
];

/** The capabilities behind the open `doors`, in the list's order. */
export const openCapabilities = (doors: DoorSet): Capability[] => CAPABILITIES.filter((c) => doors.has(c.door));
