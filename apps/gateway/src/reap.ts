import { PgWorkspaceRepo, createPool } from "@benchme/core";

/** Deletes expired workspaces (every app's rows cascade). Run by the reaper CronJob. */
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const limit = Number(process.env.REAP_LIMIT ?? 200);
const pool = createPool(url, 2);
const repo = new PgWorkspaceRepo(pool);
const ids = await repo.listExpired(new Date(), limit);
let deleted = 0;
for (const id of ids) if (await repo.delete(id)) deleted++;
console.log(JSON.stringify({ expired: ids.length, deleted }));
await pool.end();
