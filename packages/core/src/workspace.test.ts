import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newWorkspaceId } from "./ids.js";
import type { Pool } from "./pg.js";
import { testPool } from "./testing.js";
import { PgWorkspaceRepo } from "./workspace.js";

let pool: Pool | null = null;
beforeAll(async () => {
  pool = await testPool();
});
afterAll(async () => {
  await pool?.end();
});

describe.skipIf(!process.env.DATABASE_URL)("PgWorkspaceRepo (real Postgres)", () => {
  it("creates, reads, finalizes once, lists expired, deletes", async () => {
    const repo = new PgWorkspaceRepo(pool as Pool);
    const id = newWorkspaceId();
    // Expired before any other workspace a shared test database holds, so the oldest expired ones, which is what
    // listExpired answers with, include it however many other tests' workspaces have expired since.
    const past = new Date("2001-01-01T00:00:00Z");
    const created = await repo.create({ id, scenario: "acme-v1", seed: 4242, expiresAt: past });
    expect(created).toMatchObject({ id, scenario: "acme-v1", seed: 4242, finalizedAt: null });

    const t1 = new Date("2026-01-01T00:00:00Z");
    const t2 = new Date("2026-02-01T00:00:00Z");
    expect((await repo.finalize(id, t1))?.finalizedAt).toEqual(t1);
    expect((await repo.finalize(id, t2))?.finalizedAt).toEqual(t1); // first finalize wins

    expect(await repo.listExpired(new Date(), 100)).toContain(id);
    expect(await repo.delete(id)).toBe(true);
    expect(await repo.get(id)).toBeNull();
    expect(await repo.delete(id)).toBe(false);
  });

  it("keeps the doors a workspace was created with, and none for one that named none", async () => {
    const repo = new PgWorkspaceRepo(pool as Pool);
    const expiresAt = new Date(Date.now() + 3_600_000);
    const named = await repo.create({ id: newWorkspaceId(), scenario: "acme-v1", seed: 1, expiresAt, doors: ["page", "webmcp"] });
    const unnamed = await repo.create({ id: newWorkspaceId(), scenario: "acme-v1", seed: 1, expiresAt });
    expect([named.doors, unnamed.doors]).toEqual([["page", "webmcp"], null]);
    expect([(await repo.get(named.id))?.doors, (await repo.get(unnamed.id))?.doors]).toEqual([["page", "webmcp"], null]);
    // Left to expire, not deleted: a delete cascades into every app schema's tables, which other test files create and drop meanwhile.
  });
});
