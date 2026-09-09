import { HmacReceiptSigner, newWorkspaceId, type Pool, type ReceiptSigner, type Workspace, type WorkspaceRepo } from "@benchme/core";
import { randomBytes } from "node:crypto";
import type { ScenarioRegistry } from "@benchme/scenarios";
import type { AppRegistry } from "./app-registry.js";
import type { WorkspaceSeeder } from "./seeder.js";

export type WorkspaceUrls = {
  portal: string;
  apps: Record<string, string>;
  mcp: Record<string, string>;
};

export type CreateInput = { scenario: string; seed?: number; ttlSeconds?: number };

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
  now?: () => Date;
};

/** The workspace lifecycle: create (seed everywhere or nothing), read, finalize (receipt), urls. */
export class WorkspaceService {
  private readonly now: () => Date;
  constructor(private readonly d: WorkspaceServiceDeps) {
    this.now = d.now ?? (() => new Date());
  }

  static receipts(secret: string): ReceiptSigner {
    return new HmacReceiptSigner(secret);
  }

  urls(id: string, base = this.d.publicBaseUrl): WorkspaceUrls {
    const root = base.replace(/\/+$/, "");
    const apps: Record<string, string> = {};
    const mcp: Record<string, string> = {};
    for (const app of this.d.apps.list()) {
      apps[app.name] = `${root}/w/${id}/${app.name}`;
      if (app.mcp) mcp[app.name] = `${root}/w/${id}/${app.name}/mcp`;
    }
    return { portal: `${root}/w/${id}`, apps, mcp };
  }

  /** Semantic validation, separate from create so a caller can reject BEFORE spending a rate-limit unit. */
  validate(input: CreateInput): { ttl: number } {
    if (!this.d.scenarios.has(input.scenario)) throw new WorkspaceError(422, "UNKNOWN_SCENARIO", `unknown scenario "${input.scenario}"`);
    const ttl = input.ttlSeconds ?? this.d.defaultTtlSeconds;
    if (ttl <= 0 || ttl > this.d.maxTtlSeconds) throw new WorkspaceError(422, "BAD_TTL", `ttlSeconds must be 1..${this.d.maxTtlSeconds}`);
    return { ttl };
  }

  async create(input: CreateInput): Promise<Workspace> {
    const { ttl } = this.validate(input);
    const seed = input.seed ?? Math.floor(Math.random() * 2_000_000_000) + 1;
    const created = await this.d.repo.create({
      id: newWorkspaceId(),
      scenario: input.scenario,
      seed,
      expiresAt: new Date(this.now().getTime() + ttl * 1000),
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

  /** Whether requests may still be proxied into the workspace (exists and not expired). */
  async isServable(id: string): Promise<boolean> {
    const w = await this.d.repo.get(id);
    return !!w && w.expiresAt.getTime() > this.now().getTime();
  }

  /**
   * A SHARED workspace: `shared-<scenario>-<seed>` resolves to one long-lived
   * workspace created on first use, so a benchmark can attach an MCP server at
   * a fixed URL without minting anything per run. Only for READ-ONLY tasks —
   * concurrent writers would see each other. Never expires on its own.
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
