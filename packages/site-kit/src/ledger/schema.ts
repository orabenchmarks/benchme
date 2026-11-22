const SCHEMA = /^[a-z_][a-z0-9_]*$/;

/**
 * The ledger's table, for one app schema. Every site's own migration
 * (`apps/<app>/migrations/*_ledger.sql`) carries exactly this text for its
 * schema, as each carries the users and sessions tables: the apps own their
 * schemas, and a test holds every copy to this one.
 *
 * `at` is `clock_timestamp()`, the wall clock at the insert and not the
 * transaction's start, and the database's clock is the one clock every site
 * shares, so entries of two sites can be put in order.
 */
export function ledgerTableSql(schema: string): string {
  if (!SCHEMA.test(schema)) throw new Error(`invalid schema name: ${schema}`);
  return `CREATE TABLE IF NOT EXISTS ${schema}.ledger (
  workspace_id TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  seq          BIGINT GENERATED ALWAYS AS IDENTITY,
  at           TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  kind         TEXT NOT NULL CHECK (kind IN ('read', 'write', 'auth')),
  entity_type  TEXT NOT NULL,
  entity_id    TEXT,
  action       TEXT NOT NULL,
  door         TEXT NOT NULL CHECK (door IN ('page', 'rest', 'mcp', 'webmcp')),
  actor        TEXT,
  outcome      TEXT NOT NULL CHECK (outcome IN ('ok', 'refused')),
  code         TEXT,
  PRIMARY KEY (workspace_id, seq)
);
`;
}
