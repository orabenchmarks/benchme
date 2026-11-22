import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ledgerTableSql } from "./schema.js";

const APPS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "apps");

/** The apps whose composition root keeps a ledger, and the ledger migration each one has (or none). */
const sites = readdirSync(APPS)
  .filter((app) => existsSync(join(APPS, app, "src", "build-app.ts")) && readFileSync(join(APPS, app, "src", "build-app.ts"), "utf8").includes("registerDoors("))
  .map((app) => {
    const dir = join(APPS, app, "migrations");
    const file = readdirSync(dir).find((f) => /_ledger\.sql$/.test(f));
    return { app, sql: file ? readFileSync(join(dir, file), "utf8") : null };
  });

// Each app owns its schema, so each carries its own copy of the ledger's table (as of the users and sessions
// tables). A copy that drifted would be a site whose ledger the kit cannot write or the verifier cannot read.
describe("the sites' ledger migrations", () => {
  it("cover the nine sites", () => {
    expect(sites.map((s) => s.app).sort()).toEqual(["cinema", "clinic", "dining", "events", "flights", "homes", "hotels", "pizza", "sports"]);
  });

  it.each(sites)("$app: a site that keeps a ledger has the kit's table, for its own schema, in a migration", ({ app, sql }) => {
    expect(sql, `apps/${app}/migrations has no *_ledger.sql`).not.toBeNull();
    expect(sql).toContain(ledgerTableSql(app));
  });
});
