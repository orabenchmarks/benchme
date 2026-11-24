import { doorsAt, type Door } from "@benchme/core";

export { DOORS, DoorSet, type Door } from "@benchme/core";

/**
 * The door a request came through: what its path leads to (`doorsAt`), and,
 * at the MCP server, which of its two doors. A call that proves it is a
 * page's WebMCP bridge (`viaBridge`: its token is the one for the bridge
 * cookie it carries) is `webmcp`; any other call to /mcp is a direct MCP
 * client's. Nothing a client can write into a request without the page's
 * cookie says otherwise. The paths that are no door at all (the gateway's own
 * /internal/, the probes) have none.
 */
export function doorOf(path: string, viaBridge = false): Door | null {
  const doors = doorsAt(path);
  if (viaBridge && doors.includes("webmcp")) return "webmcp";
  return doors.find((door) => door !== "webmcp") ?? null;
}
