-- mail: one inbox per workspace. Apps deliver here instead of sending real mail,
-- so a signup's verification code is readable by the agent like a user would.
CREATE SCHEMA IF NOT EXISTS mail;

CREATE TABLE IF NOT EXISTS mail.messages (
  workspace_id TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  id           TEXT NOT NULL,
  from_addr    TEXT NOT NULL,
  to_addr      TEXT NOT NULL,
  subject      TEXT NOT NULL,
  body         TEXT NOT NULL,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at      TIMESTAMPTZ,
  PRIMARY KEY (workspace_id, id)
);
CREATE INDEX IF NOT EXISTS messages_to ON mail.messages (workspace_id, to_addr, received_at DESC);
