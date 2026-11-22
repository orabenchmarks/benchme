import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LEDGER_MIGRATIONS } from "./schema.js";

const APPS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "apps");

/** The apps whose composition root keeps a ledger, and the ledger migration each one has (or none). */
const sites = readdirSync(APPS)
  .filter((app) => existsSync(join(APPS, app, "src", "build-app.ts")) && readFileSync(join(APPS, app, "src", "build-app.ts"), "utf8").includes("registerDoors("))
  .map((app) => {
    const dir = join(APPS, app, "migrations");
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    // Each ledger migration's file, by its suffix (NNN_<suffix>.sql), in the order the site applies them.
    const found = LEDGER_MIGRATIONS.map((m) => files.find((f) => f.replace(/^\d+_/, "") === `${m.suffix}.sql`) ?? null);
    return { app, files: found, sql: found.map((f) => (f ? readFileSync(join(dir, f), "utf8") : null)) };
  });

// Each app owns its schema, so each carries its own copy of the ledger's table (as of the users and sessions
// tables). A copy that drifted would be a site whose ledger the kit cannot write or the verifier cannot read.
describe("the sites' ledger migrations", () => {
  it("cover the nine sites", () => {
    expect(sites.map((s) => s.app).sort()).toEqual(["cinema", "clinic", "dining", "events", "flights", "homes", "hotels", "pizza", "sports"]);
  });

  it.each(sites)("$app: a site that keeps a ledger has every one of the kit's ledger migrations, for its own schema, in order", ({ app, files, sql }) => {
    for (const [i, m] of LEDGER_MIGRATIONS.entries()) {
      expect(files[i], `apps/${app}/migrations has no NNN_${m.suffix}.sql`).not.toBeNull();
      expect(sql[i]).toContain(m.sql(app));
    }
    // Applied in the kit's order: each one after the one before it.
    expect([...files].sort()).toEqual(files);
  });
});
