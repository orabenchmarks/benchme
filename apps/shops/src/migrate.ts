import { createPool, migrate } from "@benchme/core";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Applies the shops schema. Runs after the core migrations (apps/gateway), which create core.workspaces. */
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const pool = createPool(url, 2);
const applied = await migrate(pool, "shops", join(dirname(fileURLToPath(import.meta.url)), "..", "migrations"));
console.log(JSON.stringify({ app: "shops", applied }));
await pool.end();
