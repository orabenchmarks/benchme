-- vaultdocs: the document vault, read-only for agents (no signups here).
CREATE SCHEMA IF NOT EXISTS vaultdocs;

CREATE TABLE IF NOT EXISTS vaultdocs.documents (
  workspace_id TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  id           TEXT NOT NULL,
  title        TEXT NOT NULL,
  kind         TEXT NOT NULL,
  body         TEXT NOT NULL,
  tags         TEXT[] NOT NULL DEFAULT '{}',
  updated_at   TIMESTAMPTZ NOT NULL,
  search       TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', title || ' ' || body)) STORED,
  PRIMARY KEY (workspace_id, id)
);
CREATE INDEX IF NOT EXISTS vaultdocs_search ON vaultdocs.documents USING GIN (search);
CREATE INDEX IF NOT EXISTS vaultdocs_kind ON vaultdocs.documents (workspace_id, kind);
