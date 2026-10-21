import type { WorkspaceRepo } from "@benchme/core";
import { CATEGORIES } from "../content/catalog.js";
import { EDITION_ROWS } from "./edition-table.js";
import { EditionTable, type Edition } from "./editions.js";

/** The scenario whose workspaces are guide editions (packages/scenarios guide-v1). */
export const GUIDE_SCENARIO = "guide-v1";

/** Which edition a workspace's guide shows, if any. */
export interface EditionResolver {
  forWorkspace(workspaceId: string): Promise<Edition | null>;
}

/** The shipped table: every row of edition-table.ts over every published category. */
export const defaultEditionTable = (): EditionTable => new EditionTable(EDITION_ROWS, CATEGORIES);

/**
 * Reads the workspace's scenario and seed from core.workspaces (shared by every app) and looks the seed up in the
 * table. A workspace never changes scenario or seed, so an answer is cached for the life of the process; a workspace
 * that does not exist (yet) is never cached.
 */
export class WorkspaceEditionResolver implements EditionResolver {
  private readonly cache = new Map<string, Edition | null>();

  constructor(
    private readonly workspaces: Pick<WorkspaceRepo, "get">,
    private readonly table: EditionTable,
    private readonly maxCached = 10_000,
  ) {}

  async forWorkspace(workspaceId: string): Promise<Edition | null> {
    if (this.cache.has(workspaceId)) return this.cache.get(workspaceId) ?? null;
    const w = await this.workspaces.get(workspaceId);
    if (!w) return null;
    const edition = w.scenario === GUIDE_SCENARIO ? (this.table.bySeed(w.seed) ?? null) : null;
    if (this.cache.size >= this.maxCached) this.cache.clear();
    this.cache.set(workspaceId, edition);
    return edition;
  }
}
