/** A way into an app besides its pages, which every app has: its REST API, its MCP server, its pages' WebMCP tools. */
export type AppDoor = "rest" | "mcp" | "webmcp";

/** What a person calls an app the scenarios' workspaces serve, and the ways into it its code has besides its pages. */
export type AppInfo = { readonly name: string; readonly doors: readonly AppDoor[] };

const EVERY_DOOR: readonly AppDoor[] = ["rest", "mcp", "webmcp"];

/**
 * The apps by their key (the gateway's APP_TARGETS, `Scenario.apps`), for whoever presents a scenario to a person
 * choosing one: the deployment's front page names a scenario's sites from here, and says which doors they have. A
 * name is the one the app gives itself (a test holds the branded ones to the app's own source). `doors` are what the
 * app's code serves: NLWeb's `/ask` counts as REST and its `/ask/mcp` as MCP. A deployment may close any of them.
 */
export const APP_INFO: Readonly<Record<string, AppInfo>> = {
  warehouse: { name: "Warehouse", doors: EVERY_DOOR },
  helpdesk: { name: "Helpdesk", doors: EVERY_DOOR },
  vaultdocs: { name: "Document vault", doors: EVERY_DOOR },
  data: { name: "Company site", doors: [] },
  mail: { name: "Workspace inbox", doors: EVERY_DOOR },
  hotels: { name: "Larchmere Stays", doors: EVERY_DOOR },
  flights: { name: "Tallowmere Flights", doors: EVERY_DOOR },
  dining: { name: "Thistlecombe Tables", doors: EVERY_DOOR },
  pizza: { name: "Marlivo Pizza", doors: EVERY_DOOR },
  cinema: { name: "Orrowen Cinemas", doors: EVERY_DOOR },
  sports: { name: "Brackenford Sports", doors: EVERY_DOOR },
  homes: { name: "Corvane Homes", doors: EVERY_DOOR },
  clinic: { name: "Calvenor Clinics", doors: EVERY_DOOR },
  events: { name: "Fennick Events", doors: EVERY_DOOR },
  wrenfield: { name: "Wrenfield Flowers", doors: [] },
  halden: { name: "Halden Audio", doors: [] },
  quillfeather: { name: "Quillfeather Coffee", doors: [] },
  guide: { name: "Shortlist", doors: [] },
  web: { name: "Site network", doors: [] },
  verify: { name: "Verifier", doors: [] },
};

/** What is known of the app with `key`: its entry, or its key for a name and pages alone for an app the catalog does not know. */
export const appInfo = (key: string): AppInfo => (Object.hasOwn(APP_INFO, key) ? (APP_INFO[key] as AppInfo) : { name: key, doors: [] });
