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
    const past = new Date(Date.now() - 1000);
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
});
