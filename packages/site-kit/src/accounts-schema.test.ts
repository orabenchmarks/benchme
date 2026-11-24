import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ACCOUNT_MIGRATIONS } from "./accounts-schema.js";

const APPS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "apps");

/** The apps whose composition root keeps sign-ups in Postgres, and the account migration each one has (or none). */
const sites = readdirSync(APPS)
  .filter((app) => existsSync(join(APPS, app, "src", "build-app.ts")) && readFileSync(join(APPS, app, "src", "build-app.ts"), "utf8").includes("new PgUsersRepo("))
  .map((app) => {
    const dir = join(APPS, app, "migrations");
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    const found = ACCOUNT_MIGRATIONS.map((m) => files.find((f) => f.replace(/^\d+_/, "") === `${m.suffix}.sql`) ?? null);
    return { app, files: found, sql: found.map((f) => (f ? readFileSync(join(dir, f), "utf8") : null)) };
  });

// Each app owns its schema, so each carries its own copy of the account tables' changes. A copy that drifted, or one
// left out, would be a site whose sign-ups the kit cannot verify (no column to count tries in).
describe("the sites' account migrations", () => {
  it("cover every app with sign-ups", () => {
    expect(sites.map((s) => s.app).sort()).toEqual(["cinema", "clinic", "dining", "events", "flights", "helpdesk", "homes", "hotels", "pizza", "sports", "warehouse"]);
  });

  it.each(sites)("$app has every one of the kit's account migrations, for its own schema, in order", ({ app, files, sql }) => {
    for (const [i, m] of ACCOUNT_MIGRATIONS.entries()) {
      expect(files[i], `apps/${app}/migrations has no NNN_${m.suffix}.sql`).not.toBeNull();
      expect(sql[i]).toContain(m.sql(app));
    }
    expect([...files].sort()).toEqual(files);
  });
});
