import type { Door, DoorSet } from "./doors.js";

type DoorRule = { readonly matches: (path: string) => boolean; readonly doors: readonly Door[] };

/** `path` is `root` itself or a path beneath it. */
const under = (path: string, root: string): boolean => path === root || path.startsWith(`${root}/`);

/**
 * Where each door is, read off a path as an app routes it (the part after the
 * gateway's /w/<id>/<app>). The first rule that matches names the doors a
 * request to that path can have come through. A new kind of endpoint is a new
 * rule here, and the gateway and every app read it from this one list.
 *
 * - The probes and the gateway's own /internal/ calls are no door: no agent opens them.
 * - /mcp is the site's MCP server, and two doors: a direct MCP client's, and
 *   a page's WebMCP bridge's. Only the request itself can tell them apart (a
 *   bridge proves it is one: site-kit's bridge credential), so the path names both.
 * - /ask/mcp is NLWeb's own MCP server, for MCP clients only: no page's bridge calls it.
 * - /ask is NLWeb's question endpoint: JSON or an event stream for a program,
 *   not a page for a person, so it is behind the REST door with /api/.
 * - Anything else is a page.
 */
const RULES: readonly DoorRule[] = [
  { matches: (p) => p === "/healthz" || p === "/readyz" || under(p, "/internal"), doors: [] },
  { matches: (p) => p === "/mcp", doors: ["mcp", "webmcp"] },
  { matches: (p) => p === "/ask/mcp", doors: ["mcp"] },
  { matches: (p) => p === "/ask" || under(p, "/api"), doors: ["rest"] },
  { matches: () => true, doors: ["page"] },
];

/** The doors a request to `path` can have come through: none for a path that is no door. Query and fragment are ignored, and so is one trailing slash. */
export function doorsAt(path: string): readonly Door[] {
  const bare = path.split(/[?#]/)[0] ?? "";
  const p = bare.length > 1 && bare.endsWith("/") ? bare.slice(0, -1) : bare;
  return RULES.find((rule) => rule.matches(p))?.doors ?? [];
}

/** Whether a request to `path` can come through one of the open `doors`. A path that is no door always can. */
export function admits(doors: DoorSet, path: string): boolean {
  const at = doorsAt(path);
  return at.length === 0 || at.some((door) => doors.has(door));
}
