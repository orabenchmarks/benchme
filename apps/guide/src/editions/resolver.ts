import type { WorkspaceRepo } from "@benchme/core";
import { CATEGORIES } from "../content/catalog.js";
import { EDITION_ROWS } from "./edition-table.js";
import { EditionTable, type Edition } from "./editions.js";

export { GUIDE_SCENARIO } from "./editions.js";

/** Which edition a workspace shows, if any. */
export interface EditionResolver<E = Edition> {
  forWorkspace(workspaceId: string): Promise<E | null>;
}

/** The shipped table: every row of edition-table.ts over every published category. */
export const defaultEditionTable = (): EditionTable => new EditionTable(EDITION_ROWS, CATEGORIES);

/**
 * Reads the workspace's scenario and seed from core.workspaces (shared by every app) and, for a workspace of
 * `scenario`, looks the seed up in the table. A workspace never changes scenario or seed, so an answer is cached for
 * the life of the process; a workspace that does not exist (yet) is never cached.
 */
export class WorkspaceEditionResolver<E = Edition> implements EditionResolver<E> {
  private readonly cache = new Map<string, E | null>();

  constructor(
    private readonly workspaces: Pick<WorkspaceRepo, "get">,
    private readonly scenario: string,
    private readonly table: { bySeed(seed: number): E | undefined },
    private readonly maxCached = 10_000,
  ) {}

  async forWorkspace(workspaceId: string): Promise<E | null> {
    if (this.cache.has(workspaceId)) return this.cache.get(workspaceId) ?? null;
    const w = await this.workspaces.get(workspaceId);
    if (!w) return null;
    const edition = w.scenario === this.scenario ? (this.table.bySeed(w.seed) ?? null) : null;
    if (this.cache.size >= this.maxCached) this.cache.clear();
    this.cache.set(workspaceId, edition);
    return edition;
  }
}
