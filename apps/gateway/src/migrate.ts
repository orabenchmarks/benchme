import { createPool, migrate } from "@benchme/core";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Applies the core schema. Run by the chart's migrate Job before any app starts. */
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const pool = createPool(url, 2);
const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const applied = await migrate(pool, "core", dir);
console.log(JSON.stringify({ app: "core", applied }));
await pool.end();
