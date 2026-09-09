import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Pool } from "pg";
import { createPool, migrate } from "./pg.js";

/** The one migration every app depends on: the workspaces parent table. */
export const CORE_SQL = `
CREATE SCHEMA IF NOT EXISTS core;
CREATE TABLE IF NOT EXISTS core.workspaces (
  id TEXT PRIMARY KEY,
  scenario TEXT NOT NULL,
  seed INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  finalized_at TIMESTAMPTZ,
  alias TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS workspaces_alias ON core.workspaces (alias) WHERE alias IS NOT NULL;
CREATE INDEX IF NOT EXISTS workspaces_expires_at ON core.workspaces (expires_at);
`;

/**
 * Test helper: a pool on DATABASE_URL (tests skip when unset) with the core
 * schema applied. Real Postgres, never a mock.
 */
export async function testPool(): Promise<Pool | null> {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  const pool = createPool(url, 4);
  const dir = await mkdtemp(join(tmpdir(), "benchme-core-"));
  await writeFile(join(dir, "000_core_testing.sql"), CORE_SQL);
  // Later additions go in their own files so a test DB migrated by an older
  // helper still picks them up (a migration file runs exactly once).
  await writeFile(join(dir, "001_core_testing_alias.sql"), "ALTER TABLE core.workspaces ADD COLUMN IF NOT EXISTS alias TEXT;\nCREATE UNIQUE INDEX IF NOT EXISTS workspaces_alias ON core.workspaces (alias) WHERE alias IS NOT NULL;\n");
  // Recorded under its own app name so a real app's "core" migrations still apply on a shared test DB.
  await migrate(pool, "core-testing", dir);
  return pool;
}
