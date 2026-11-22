const SCHEMA = /^[a-z_][a-z0-9_]*$/;
const checked = (schema: string): string => {
  if (!SCHEMA.test(schema)) throw new Error(`invalid schema name: ${schema}`);
  return schema;
};

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
  checked(schema);
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

/**
 * The ledger's second migration: what a request was about (`subject`), so a refused create, which has no entity
 * id, still names the order, showtime or event it was for. Every site's `*_ledger_subject.sql` carries this text.
 */
export function ledgerSubjectSql(schema: string): string {
  const s = checked(schema);
  return `ALTER TABLE ${s}.ledger ADD COLUMN IF NOT EXISTS subject_type TEXT;
ALTER TABLE ${s}.ledger ADD COLUMN IF NOT EXISTS subject_id TEXT;
DO $$ BEGIN
  ALTER TABLE ${s}.ledger ADD CONSTRAINT ledger_subject_whole CHECK ((subject_type IS NULL) = (subject_id IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
`;
}

/** The ledger's migrations, in order: the file suffix each site names one with, and its text for that site's schema. */
export const LEDGER_MIGRATIONS: readonly { suffix: string; sql: (schema: string) => string }[] = [
  { suffix: "ledger", sql: ledgerTableSql },
  { suffix: "ledger_subject", sql: ledgerSubjectSql },
];

/** Every ledger migration for one schema, as one script: what a test that builds a ledger table of its own runs. */
export const ledgerSql = (schema: string): string => LEDGER_MIGRATIONS.map((m) => m.sql(schema)).join("\n");
