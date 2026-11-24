import { DoorSet, HmacReceiptSigner, UnknownDoorError, newWorkspaceId, type Pool, type ReceiptSigner, type Workspace, type WorkspaceRepo } from "@benchme/core";
import { randomBytes } from "node:crypto";
import type { ScenarioRegistry } from "@benchme/scenarios";
import type { AppRegistry, AppTarget } from "./app-registry.js";
import { openCapabilities, type CapabilityKey } from "./capabilities.js";
import type { WorkspaceSeeder } from "./seeder.js";

export type WorkspaceUrls = { portal: string; apps: Record<string, string> } & Record<CapabilityKey, Record<string, string>>;

export type CreateInput = {
  scenario: string;
  seed?: number;
  ttlSeconds?: number;
  /** The doors the workspace is served through, instead of the deployment's: names from DOORS; pages are always served. */
  doors?: readonly string[];
};

export class WorkspaceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "WorkspaceError";
  }
}

export type WorkspaceServiceDeps = {
  repo: WorkspaceRepo;
  pool: Pool;
  scenarios: ScenarioRegistry;
  apps: AppRegistry;
  seeder: WorkspaceSeeder;
  receipts: ReceiptSigner;
  publicBaseUrl: string;
  internalBaseUrl: string;
  defaultTtlSeconds: number;
  maxTtlSeconds: number;
  /** The doors a workspace is served through unless it was created with its own (BENCHME_DOORS); default every door. */
  doors?: DoorSet;
  now?: () => Date;
};

/** The workspace lifecycle: create (seed everywhere or nothing), read, finalize (receipt), urls. */
export class WorkspaceService {
  private readonly now: () => Date;
  /** The deployment's doors: every workspace's that was created without its own, the shared ones included. */
  readonly defaultDoors: DoorSet;
  constructor(private readonly d: WorkspaceServiceDeps) {
    this.now = d.now ?? (() => new Date());
    this.defaultDoors = d.doors ?? DoorSet.ALL;
  }

  static receipts(secret: string): ReceiptSigner {
    return new HmacReceiptSigner(secret);
  }

  /** The doors a workspace is served through: the ones it was created with, else the deployment's. */
  doorsOf(w: Pick<Workspace, "doors">): DoorSet {
    return w.doors ? DoorSet.read(w.doors) : this.defaultDoors;
  }

  /**
   * What a workspace advertises: the apps its scenario names (`Scenario.apps`, an unlisted one included), else every
   * listed app. An app it does not advertise is still served at /w/<id>/<app>/, just never named here. Beside an
   * app's pages, only what is behind a door the workspace is served through: each map is empty for a closed one.
   */
  urls(w: Pick<Workspace, "id" | "scenario" | "doors">, base = this.d.publicBaseUrl): WorkspaceUrls {
    const { id } = w;
    const root = base.replace(/\/+$/, "");
    const urls: WorkspaceUrls = { portal: `${root}/w/${id}`, apps: {}, mcp: {}, ask: {}, askMcp: {}, webmcp: {} };
    const open = openCapabilities(this.doorsOf(w));
    for (const app of this.advertised(w.scenario)) {
      urls.apps[app.name] = `${root}/w/${id}/${app.name}`;
      for (const c of open) if (c.has(app)) urls[c.key][app.name] = `${root}/w/${id}/${app.name}/${c.path}`;
    }
    return urls;
  }

  /** The apps a workspace of `scenario` advertises, in order: the scenario's own list, else every listed app. */
  advertised(scenario: string): AppTarget[] {
    const named = this.d.scenarios.has(scenario) ? this.d.scenarios.get(scenario).apps : undefined;
    if (!named) return this.d.apps.listed();
    return named.map((name) => this.d.apps.get(name)).filter((app): app is AppTarget => app !== undefined);
  }

  /** Semantic validation, separate from create so a caller can reject BEFORE spending a rate-limit unit. */
  validate(input: CreateInput): { ttl: number; doors: DoorSet | null } {
    if (!this.d.scenarios.has(input.scenario)) throw new WorkspaceError(422, "UNKNOWN_SCENARIO", `unknown scenario "${input.scenario}"`);
    const missing = (this.d.scenarios.get(input.scenario).apps ?? []).filter((name) => !this.d.apps.get(name));
    if (missing.length > 0) {
      throw new WorkspaceError(422, "SCENARIO_UNAVAILABLE", `scenario "${input.scenario}" needs ${missing.join(", ")}, which this deployment does not serve`);
    }
    const ttl = input.ttlSeconds ?? this.d.defaultTtlSeconds;
    if (ttl <= 0 || ttl > this.d.maxTtlSeconds) throw new WorkspaceError(422, "BAD_TTL", `ttlSeconds must be 1..${this.d.maxTtlSeconds}`);
    return { ttl, doors: input.doors ? doorsAsked(input.doors) : null };
  }

  async create(input: CreateInput): Promise<Workspace> {
    const { ttl, doors } = this.validate(input);
    const seed = input.seed ?? Math.floor(Math.random() * 2_000_000_000) + 1;
    const created = await this.d.repo.create({
      id: newWorkspaceId(),
      scenario: input.scenario,
      seed,
      expiresAt: new Date(this.now().getTime() + ttl * 1000),
      // Kept as asked: a workspace created with its own doors keeps them whatever the deployment's become.
      doors: doors?.list() ?? null,
    });
    try {
      await this.d.seeder.seed(created);
    } catch (err) {
      await this.d.repo.delete(created.id);
      throw new WorkspaceError(502, "SEED_FAILED", (err as Error).message);
    }
    return created;
  }

  async get(id: string): Promise<Workspace> {
    const w = await this.d.repo.get(id);
    if (!w) throw new WorkspaceError(404, "NOT_FOUND", `workspace ${id} not found`);
    return w;
  }

  /** Marks the workspace finalized (first call wins) and issues a receipt logged in core.receipts. */
  async finalize(id: string): Promise<{ workspace: Workspace; receipt: string }> {
    const at = this.now();
    const w = await this.d.repo.finalize(id, at);
    if (!w) throw new WorkspaceError(404, "NOT_FOUND", `workspace ${id} not found`);
    const nonce = randomBytes(8).toString("hex");
    const ts = at.getTime();
    const receipt = this.d.receipts.sign(`ws-${id}`, "OK", nonce, ts);
    await this.d.pool.query(
      `INSERT INTO core.receipts (receipt, workspace_id, scope, verdict, nonce, ts, details)
       VALUES ($1, $2, $3, 'OK', $4, $5, '[]'::jsonb) ON CONFLICT (receipt) DO NOTHING`,
      [receipt, id, `ws-${id}`, nonce, ts],
    );
    return { workspace: w, receipt };
  }

  /** The workspace, while requests may still be proxied into it (it exists and has not expired); null otherwise. */
  async servable(id: string): Promise<Workspace | null> {
    const w = await this.d.repo.get(id);
    return w && w.expiresAt.getTime() > this.now().getTime() ? w : null;
  }

  /**
   * A SHARED workspace: `shared-<scenario>-<seed>` resolves to one long-lived
   * workspace created on first use, so a benchmark can attach an MCP server at
   * a fixed URL without minting anything per run. Only for READ-ONLY tasks —
   * concurrent writers would see each other. Never expires on its own. It is served through the deployment's doors.
   */
  async resolveShared(alias: string): Promise<string | null> {
    const m = /^shared-([a-z0-9][a-z0-9-]*)-(\d{1,10})$/.exec(alias);
    if (!m) return null;
    const scenario = m[1] as string;
    const seed = Number(m[2]);
    if (!this.d.scenarios.has(scenario) || seed < 1 || seed > 2_147_483_646) return null;
    const existing = await this.d.repo.getByAlias(alias);
    if (existing && existing.expiresAt.getTime() > this.now().getTime()) return existing.id;
    const created = await this.d.repo.create({ id: newWorkspaceId(), scenario, seed, expiresAt: new Date(this.now().getTime() + 10 * 365 * 86_400_000), alias });
    try {
      await this.d.seeder.seed(created);
    } catch (err) {
      await this.d.repo.delete(created.id);
      throw new WorkspaceError(502, "SEED_FAILED", (err as Error).message);
    }
    return created.id;
  }

  async reap(limit = 100): Promise<string[]> {
    const ids = await this.d.repo.listExpired(this.now(), limit);
    for (const id of ids) await this.d.repo.delete(id);
    return ids;
  }
}

/** The doors a caller asked for, refusing a name that is no door. */
function doorsAsked(names: readonly string[]): DoorSet {
  try {
    return DoorSet.of(names);
  } catch (err) {
    if (err instanceof UnknownDoorError) throw new WorkspaceError(422, "UNKNOWN_DOOR", err.message);
    throw err;
  }
}
