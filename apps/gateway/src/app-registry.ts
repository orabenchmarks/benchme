/**
 * The apps the gateway fronts. Registry, not a switch: an app is data from
 * config (APP_TARGETS), and the proxy + workspace URLs derive from it.
 */
export type AppTarget = { name: string; baseUrl: string; seeded: boolean; mcp: boolean };

export class AppRegistry {
  private readonly byName = new Map<string, AppTarget>();

  constructor(targets: Record<string, string>, seededApps: readonly string[], mcpApps: readonly string[] = ["warehouse"]) {
    for (const [name, baseUrl] of Object.entries(targets)) {
      this.byName.set(name, { name, baseUrl: baseUrl.replace(/\/+$/, ""), seeded: seededApps.includes(name), mcp: mcpApps.includes(name) });
    }
    for (const s of seededApps) {
      if (!this.byName.has(s)) throw new Error(`SEEDED_APPS names "${s}" which is not in APP_TARGETS`);
    }
    for (const m of mcpApps) {
      if (!this.byName.has(m)) throw new Error(`MCP_APPS names "${m}" which is not in APP_TARGETS`);
    }
  }

  get(name: string): AppTarget | undefined {
    return this.byName.get(name);
  }

  list(): AppTarget[] {
    return [...this.byName.values()];
  }

  seeded(): AppTarget[] {
    return this.list().filter((a) => a.seeded);
  }

  /** Apps that expose an MCP server at /w/:id/<app>/mcp. */
  mcp(): AppTarget[] {
    return this.list().filter((a) => a.mcp);
  }
}
