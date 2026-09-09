-- verify: every submission (attempt) with its artifact, verdict and receipt.
-- The offline audit joins graded responses to core.receipts; this table is
-- the per-task attempt log (an efficiency signal) and the artifact store.
CREATE SCHEMA IF NOT EXISTS verify;

CREATE TABLE IF NOT EXISTS verify.attempts (
  workspace_id TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  id           TEXT NOT NULL,
  task_id      TEXT NOT NULL,
  kind         TEXT NOT NULL,
  verdict      TEXT NOT NULL CHECK (verdict IN ('OK', 'FAIL')),
  receipt      TEXT NOT NULL,
  details      JSONB NOT NULL DEFAULT '[]'::jsonb,
  artifact     BYTEA NOT NULL,
  artifact_size INTEGER NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id)
);
CREATE INDEX IF NOT EXISTS attempts_task ON verify.attempts (workspace_id, task_id, created_at);
