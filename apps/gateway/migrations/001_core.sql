-- core: the workspace parent every app schema references (ON DELETE CASCADE),
-- so deleting a workspace row removes every tenant row in every app.
CREATE SCHEMA IF NOT EXISTS core;

CREATE TABLE IF NOT EXISTS core.workspaces (
  id            TEXT PRIMARY KEY,
  scenario      TEXT NOT NULL,
  seed          INTEGER NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL,
  finalized_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS workspaces_expires_at ON core.workspaces (expires_at);

-- Receipts issued by any oracle (finalize today, the verifier later): the log
-- an offline audit joins graded responses against. A receipt absent here was
-- never issued — a fabrication.
CREATE TABLE IF NOT EXISTS core.receipts (
  receipt       TEXT PRIMARY KEY,
  workspace_id  TEXT REFERENCES core.workspaces(id) ON DELETE SET NULL,
  scope         TEXT NOT NULL,
  verdict       TEXT NOT NULL CHECK (verdict IN ('OK', 'FAIL')),
  nonce         TEXT NOT NULL,
  ts            BIGINT NOT NULL,
  details       JSONB NOT NULL DEFAULT '[]'::jsonb,
  issued_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS receipts_workspace ON core.receipts (workspace_id);
