import { createPool, type Pool } from "@benchme/core";

/**
 * The shops service's pool: core's, with a wait limit. A query that cannot get a connection within
 * `connectionTimeoutMillis` fails (pg: "timeout exceeded when trying to connect") — the page answers an error
 * instead of hanging behind whatever holds every connection. (No payment step holds one while it waits on the
 * processor: see claims.ts.) node-postgres reads the limit from the pool's options on every connect.
 */
export function shopsPool(url: string, o: { max: number; connectionTimeoutMillis: number }): Pool {
  const pool = createPool(url, o.max);
  pool.options.connectionTimeoutMillis = o.connectionTimeoutMillis;
  return pool;
}
