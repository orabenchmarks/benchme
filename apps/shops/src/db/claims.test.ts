import { createPool, migrate, newWorkspaceId, type Pool } from "@benchme/core";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CheckoutsRepo } from "./checkouts-repo.js";
import { ClaimBusyError, PaymentClaims } from "./claims.js";

/**
 * A checkout's payment steps (finding an intent, opening a session) call the processor, which can be slow. They take
 * turns on a claim held in a row — taken and given back by single statements — never by holding a connection of the
 * pool while the processor answers.
 */

const DB = process.env.DATABASE_URL;
const here = dirname(fileURLToPath(import.meta.url));
const CORE_SQL = join(here, "..", "..", "..", "gateway", "migrations");
const SHOPS_SQL = join(here, "..", "..", "migrations");

let pool: Pool;
let checkouts: CheckoutsRepo;

async function newCheckout(): Promise<{ ws: string; token: string }> {
  const ws = newWorkspaceId();
  await pool.query("INSERT INTO core.workspaces (id, scenario, seed, expires_at) VALUES ($1, 'shops-v1', 1, now() + interval '1 hour')", [ws]);
  return { ws, token: (await checkouts.create(ws, "halden", { addOns: [] })).token };
}

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const claimOf = async (ws: string, token: string) => (await checkouts.get(ws, token))?.flags.paymentClaim;

beforeAll(async () => {
  if (!DB) return;
  // Two connections: a step that held one while it waited would leave the rest of the tests none.
  pool = createPool(DB, 2);
  await migrate(pool, "core", CORE_SQL);
  await migrate(pool, "shops", SHOPS_SQL);
  checkouts = new CheckoutsRepo(pool);
});
afterAll(async () => {
  await pool?.end();
});

describe.skipIf(!DB)("PaymentClaims (real Postgres)", () => {
  it("runs one step of a checkout's payments at a time, holding no connection while a step waits on the processor", async () => {
    const claims = new PaymentClaims(pool);
    const { ws, token } = await newCheckout();
    const order: string[] = [];
    const slow = deferred();
    const a = claims.run(ws, token, async () => {
      order.push("a start");
      await slow.promise;
      order.push("a end");
      return "a";
    });
    const b = claims.run(ws, token, async () => {
      order.push("b");
      return "b";
    });
    await sleep(50);
    expect(order).toEqual(["a start"]);
    expect(await claimOf(ws, token)).toMatchObject({ owner: expect.any(String), until: expect.any(String) });
    // Every connection of the pool is free for other work meanwhile: none is checked out.
    expect(pool.totalCount - pool.idleCount).toBe(0);
    const t0 = Date.now();
    await Promise.all(Array.from({ length: 6 }, () => pool.query("SELECT pg_sleep(0.01)")));
    expect(Date.now() - t0).toBeLessThan(2_000);
    slow.resolve();
    expect(await Promise.all([a, b])).toEqual(["a", "b"]);
    expect(order).toEqual(["a start", "a end", "b"]);
    expect(await claimOf(ws, token)).toBeUndefined();
    // Another checkout never waits for this one's.
    const other = await newCheckout();
    const held = deferred();
    const busy = claims.run(ws, token, () => held.promise);
    expect(await claims.run(other.ws, other.token, async () => "free")).toBe("free");
    held.resolve();
    await busy;
  });

  it("makes another process wait for the claim, and hands it over when the holder is done or its lease lapsed", async () => {
    const { ws, token } = await newCheckout();
    const here1 = new PaymentClaims(pool, { pollMs: 20 });
    const there = new PaymentClaims(pool, { pollMs: 20 });
    const order: string[] = [];
    const slow = deferred();
    const a = here1.run(ws, token, async () => {
      order.push("here");
      await slow.promise;
    });
    await sleep(30);
    const b = there.run(ws, token, async () => {
      order.push("there");
    });
    await sleep(150);
    expect(order).toEqual(["here"]);
    slow.resolve();
    await Promise.all([a, b]);
    expect(order).toEqual(["here", "there"]);
    // A holder that died: its lease lapses and the next step goes ahead at once.
    await pool.query("UPDATE shops.checkouts SET flags = flags || jsonb_build_object('paymentClaim', jsonb_build_object('owner', 'gone', 'until', now() - interval '1 second')) WHERE workspace_id = $1 AND token = $2", [ws, token]);
    const t0 = Date.now();
    expect(await there.run(ws, token, async () => "after")).toBe("after");
    expect(Date.now() - t0).toBeLessThan(500);
  });

  it("keeps its lease while a step outlasts it, so no other process steps in", async () => {
    const { ws, token } = await newCheckout();
    const holder = new PaymentClaims(pool, { leaseMs: 300, pollMs: 20 });
    const other = new PaymentClaims(pool, { leaseMs: 300, pollMs: 20, waitMs: 3_000 });
    const order: string[] = [];
    const a = holder.run(ws, token, async () => {
      order.push("long start");
      await sleep(900);
      order.push("long end");
    });
    await sleep(400); // past the first lease
    const b = other.run(ws, token, async () => {
      order.push("next");
    });
    await Promise.all([a, b]);
    expect(order).toEqual(["long start", "long end", "next"]);
  });

  it("stops waiting after waitMs with ClaimBusyError, gives the claim back when a step throws, and refuses an unknown checkout at once", async () => {
    const { ws, token } = await newCheckout();
    const holder = new PaymentClaims(pool, { pollMs: 20 });
    const impatient = new PaymentClaims(pool, { pollMs: 20, waitMs: 150 });
    const held = deferred();
    const a = holder.run(ws, token, () => held.promise);
    await sleep(30);
    await expect(impatient.run(ws, token, async () => "never")).rejects.toBeInstanceOf(ClaimBusyError);
    held.resolve();
    await a;
    await expect(holder.run(ws, token, async () => Promise.reject(new Error("the processor said no")))).rejects.toThrow("the processor said no");
    expect(await claimOf(ws, token)).toBeUndefined();
    expect(await impatient.run(ws, token, async () => "free again")).toBe("free again");
    const t0 = Date.now();
    await expect(impatient.run(ws, "000000000000000000000000", async () => "never")).rejects.toThrow(/no checkout/);
    expect(Date.now() - t0).toBeLessThan(100);
  });
});
