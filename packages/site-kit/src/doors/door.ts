/**
 * The ways into a site. A request an agent can make comes through exactly one
 * of them, and the change ledger names it on every entry.
 */
export const DOORS = ["page", "rest", "mcp", "webmcp"] as const;
export type Door = (typeof DOORS)[number];

/**
 * Sent by the page's WebMCP bridge on every tool call it makes. A call to
 * /mcp that carries it came through a tool the page registered (`webmcp`); any
 * other call to /mcp is a direct MCP client (`mcp`). It is a label, never a
 * credential: both doors ask the same of a caller.
 */
export const DOOR_HEADER = "x-benchme-door";
export const WEBMCP_DOOR_VALUE = "webmcp";

type Headers = Record<string, string | string[] | undefined>;

/**
 * The door a request came through, read off the path as the app routes it and
 * the bridge's header: /mcp is the MCP server (the page's bridge or a client),
 * /api/ is REST, and anything else an agent can open is a page. The paths that
 * are no door at all (the gateway's own /internal/, the probes) have none.
 */
export function doorOf(url: string, headers: Headers = {}): Door | null {
  const path = url.split("?")[0] ?? "";
  if (path === "/healthz" || path === "/readyz" || path.startsWith("/internal/")) return null;
  if (path === "/mcp") {
    const marker = headers[DOOR_HEADER];
    return (Array.isArray(marker) ? marker[0] : marker) === WEBMCP_DOOR_VALUE ? "webmcp" : "mcp";
  }
  return path.startsWith("/api/") ? "rest" : "page";
}
