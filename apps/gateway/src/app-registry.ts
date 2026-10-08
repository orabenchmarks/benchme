/**
 * The apps the gateway fronts. Registry, not a switch: an app is data from
 * config (APP_TARGETS), and the proxy + workspace URLs derive from it. A
 * target may carry a path ("http://shops:3000/s/halden"): /w/:id/<app>/x then
 * lands on that path + /x. An UNLISTED app is routed and seeded like any other
 * but never advertised — see listed().
 */
export type AppTarget = { name: string; baseUrl: string; seeded: boolean; mcp: boolean; ask: boolean; webmcp: boolean; listed: boolean };

export class AppRegistry {
  private readonly byName = new Map<string, AppTarget>();

  constructor(
    targets: Record<string, string>,
    seededApps: readonly string[],
    mcpApps: readonly string[] = ["warehouse"],
    askApps: readonly string[] = [],
    webmcpApps: readonly string[] = [],
    unlistedApps: readonly string[] = [],
  ) {
    for (const [name, baseUrl] of Object.entries(targets)) {
      this.byName.set(name, {
        name,
        baseUrl: baseUrl.replace(/\/+$/, ""),
        seeded: seededApps.includes(name),
        mcp: mcpApps.includes(name),
        ask: askApps.includes(name),
        webmcp: webmcpApps.includes(name),
        listed: !unlistedApps.includes(name),
      });
    }
    for (const s of seededApps) {
      if (!this.byName.has(s)) throw new Error(`SEEDED_APPS names "${s}" which is not in APP_TARGETS`);
    }
    for (const m of mcpApps) {
      if (!this.byName.has(m)) throw new Error(`MCP_APPS names "${m}" which is not in APP_TARGETS`);
    }
    for (const a of askApps) {
      if (!this.byName.has(a)) throw new Error(`ASK_APPS names "${a}" which is not in APP_TARGETS`);
    }
    for (const w of webmcpApps) {
      if (!this.byName.has(w)) throw new Error(`WEBMCP_APPS names "${w}" which is not in APP_TARGETS`);
    }
    for (const u of unlistedApps) {
      if (!this.byName.has(u)) throw new Error(`UNLISTED_APPS names "${u}" which is not in APP_TARGETS`);
    }
  }

  get(name: string): AppTarget | undefined {
    return this.byName.get(name);
  }

  /** Every app the proxy routes to, unlisted ones included. */
  list(): AppTarget[] {
    return [...this.byName.values()];
  }

  /** The apps a workspace advertises: its urls, the portal, the registry page, robots.txt. */
  listed(): AppTarget[] {
    return this.list().filter((a) => a.listed);
  }

  seeded(): AppTarget[] {
    return this.list().filter((a) => a.seeded);
  }

  /** Apps that expose an MCP server at /w/:id/<app>/mcp. */
  mcp(): AppTarget[] {
    return this.list().filter((a) => a.mcp);
  }

  /** Apps that expose an NLWeb /ask endpoint at /w/:id/<app>/ask. */
  ask(): AppTarget[] {
    return this.list().filter((a) => a.ask);
  }

  /** Apps that expose their own WebMCP tools on their pages at /w/:id/<app>/. */
  webmcp(): AppTarget[] {
    return this.list().filter((a) => a.webmcp);
  }
}
