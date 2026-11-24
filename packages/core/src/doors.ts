/**
 * The ways into a site. A request an agent can make comes through exactly one
 * of them: a page, the REST API, the site's MCP server as a client of its own
 * (`mcp`), or the tools a page registers in the browser (`webmcp`). The change
 * ledger names it on every entry.
 */
export const DOORS = ["page", "rest", "mcp", "webmcp"] as const;
export type Door = (typeof DOORS)[number];

export const isDoor = (name: string): name is Door => (DOORS as readonly string[]).includes(name);

export class UnknownDoorError extends Error {
  constructor(readonly door: string) {
    super(`unknown door "${door}": the doors are ${DOORS.join(", ")}`);
    this.name = "UnknownDoorError";
  }
}

/**
 * The doors a workspace is served through. The pages are always among them: a
 * site without its pages is not there at all, so a set can close every other
 * door but never that one, and a list that leaves `page` out still has it.
 */
export class DoorSet {
  /** Every door: what a deployment serves unless it says otherwise, and what an app assumes when no gateway said. */
  static readonly ALL = new DoorSet(DOORS);

  private readonly open: ReadonlySet<Door>;

  private constructor(doors: Iterable<Door>) {
    this.open = new Set<Door>(["page", ...doors]);
  }

  /** The doors named, for a caller who asks for them: a name that is no door is refused. */
  static of(names: Iterable<string>): DoorSet {
    const doors: Door[] = [];
    for (const name of names) {
      if (!isDoor(name)) throw new UnknownDoorError(name);
      doors.push(name);
    }
    return new DoorSet(doors);
  }

  /** A comma list (`page,webmcp`), as BENCHME_DOORS spells it. Strict, like `of`. */
  static parse(list: string): DoorSet {
    return DoorSet.of(splitList(list));
  }

  /**
   * A set read back from where it was kept: a workspace's row, the gateway's
   * signed header. A name this version does not know is a door it does not
   * serve, so it is left out rather than refused.
   */
  static read(names: Iterable<string>): DoorSet {
    return new DoorSet([...names].filter(isDoor));
  }

  has(door: Door): boolean {
    return this.open.has(door);
  }

  /** The open doors, in the order of DOORS. */
  list(): Door[] {
    return DOORS.filter((door) => this.open.has(door));
  }

  /** The comma list the gateway forwards and signs: always in the order of DOORS, so one set has one spelling. */
  toString(): string {
    return this.list().join(",");
  }
}

/** The names in a comma list, trimmed, empty ones dropped. */
export const splitList = (list: string): string[] =>
  list
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
