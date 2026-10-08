import { createPool, migrate } from "@benchme/core";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Applies the wallet schema. It references nothing of core's: it can run in any order after the gateway's. */
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const pool = createPool(url, 2);
const applied = await migrate(pool, "wallet", join(dirname(fileURLToPath(import.meta.url)), "..", "migrations"));
console.log(JSON.stringify({ app: "wallet", applied }));
await pool.end();
