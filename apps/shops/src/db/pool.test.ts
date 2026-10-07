import { describe, expect, it } from "vitest";
import { readConfig } from "../config.js";
import { shopsPool } from "./pool.js";

/**
 * The shops service's pool fails fast: a request that cannot get a connection within the wait limit answers an
 * error instead of hanging behind work that holds them all.
 */

const DB = process.env.DATABASE_URL;
const env = {
  DATABASE_URL: "postgres://benchme:benchme@localhost:5432/benchme",
  GATEWAY_SECRET: "g".repeat(16),
  MAIL_URL: "http://mail:3000",
  MAIL_INTERNAL_SECRET: "m".repeat(16),
  SHOPS_INTERNAL_SECRET: "s".repeat(16),
  SHOPS_SUFFIX_KEY: "k".repeat(32),
};

describe("the pool's size and wait limit", () => {
  it("come from the config, with defaults: ten connections, and five seconds to wait for one", () => {
    expect(readConfig(env)).toMatchObject({ SHOPS_DB_POOL_MAX: 10, SHOPS_DB_CONNECT_TIMEOUT_MS: 5_000 });
    expect(readConfig({ ...env, SHOPS_DB_POOL_MAX: "4", SHOPS_DB_CONNECT_TIMEOUT_MS: "2500" })).toMatchObject({ SHOPS_DB_POOL_MAX: 4, SHOPS_DB_CONNECT_TIMEOUT_MS: 2_500 });
    // Waiting forever (0) is not a wait limit.
    expect(() => readConfig({ ...env, SHOPS_DB_CONNECT_TIMEOUT_MS: "0" })).toThrow(/SHOPS_DB_CONNECT_TIMEOUT_MS/);
    expect(() => readConfig({ ...env, SHOPS_DB_POOL_MAX: "0" })).toThrow(/SHOPS_DB_POOL_MAX/);
  });
});

describe.skipIf(!DB)("shopsPool (real Postgres)", () => {
  it("answers a query that cannot get a connection within the limit with an error, and serves the next once one is free", async () => {
    const pool = shopsPool(DB as string, { max: 1, connectionTimeoutMillis: 150 });
    try {
      const held = await pool.connect();
      const t0 = Date.now();
      await expect(pool.query("SELECT 1")).rejects.toThrow(/timeout/i);
      expect(Date.now() - t0).toBeLessThan(1_500);
      held.release();
      expect((await pool.query("SELECT 1 AS one")).rows).toEqual([{ one: 1 }]);
      expect(pool.options.max).toBe(1);
    } finally {
      await pool.end();
    }
  });
});
