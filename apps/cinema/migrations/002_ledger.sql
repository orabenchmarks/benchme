-- cinema: the change ledger. One line for every read of one entity, every write (made or refused, with the
-- reason code) and every sign-up step, with the door it came through and who was signed in. Kept by the site kit
-- (packages/site-kit/src/ledger), which holds this table to its own text; read by the verifier alone.
CREATE TABLE IF NOT EXISTS cinema.ledger (
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
