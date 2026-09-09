-- helpdesk: tickets, comments, SLAs, assignment. Every tenant table is scoped
-- by workspace_id and cascades from core.workspaces.
CREATE SCHEMA IF NOT EXISTS helpdesk;

CREATE TABLE IF NOT EXISTS helpdesk.users (
  workspace_id   TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  email          TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  display_name   TEXT NOT NULL,
  verified_at    TIMESTAMPTZ,
  api_token      TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, email)
);
CREATE UNIQUE INDEX IF NOT EXISTS hd_users_api_token ON helpdesk.users (workspace_id, api_token) WHERE api_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS helpdesk.verification_codes (
  workspace_id TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  code         TEXT NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (workspace_id, email)
);

CREATE TABLE IF NOT EXISTS helpdesk.sessions (
  workspace_id TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  token        TEXT NOT NULL,
  email        TEXT NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (workspace_id, token)
);

-- Support agents (assignees) are seed data, distinct from signed-up users.
CREATE TABLE IF NOT EXISTS helpdesk.agents (
  workspace_id TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  code         TEXT NOT NULL,
  name         TEXT NOT NULL,
  team         TEXT NOT NULL,
  PRIMARY KEY (workspace_id, code)
);

CREATE TABLE IF NOT EXISTS helpdesk.tickets (
  workspace_id   TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  ticket_no      TEXT NOT NULL,
  subject        TEXT NOT NULL,
  body           TEXT NOT NULL,
  requester      TEXT NOT NULL,
  priority       TEXT NOT NULL CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status         TEXT NOT NULL CHECK (status IN ('open', 'pending', 'resolved', 'closed')),
  assignee_code  TEXT,
  opened_at      TIMESTAMPTZ NOT NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at    TIMESTAMPTZ,
  PRIMARY KEY (workspace_id, ticket_no),
  FOREIGN KEY (workspace_id, assignee_code) REFERENCES helpdesk.agents (workspace_id, code) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS hd_tickets_status ON helpdesk.tickets (workspace_id, status);
CREATE INDEX IF NOT EXISTS hd_tickets_assignee ON helpdesk.tickets (workspace_id, assignee_code);

CREATE TABLE IF NOT EXISTS helpdesk.comments (
  workspace_id TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  ticket_no    TEXT NOT NULL,
  seq          INTEGER NOT NULL,
  author       TEXT NOT NULL,
  body         TEXT NOT NULL,
  internal     BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, ticket_no, seq),
  FOREIGN KEY (workspace_id, ticket_no) REFERENCES helpdesk.tickets (workspace_id, ticket_no) ON DELETE CASCADE
);

-- SLA policy per priority: hours to first response / resolution.
CREATE TABLE IF NOT EXISTS helpdesk.sla_policies (
  workspace_id     TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  priority         TEXT NOT NULL,
  respond_hours    INTEGER NOT NULL,
  resolve_hours    INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, priority)
);

CREATE TABLE IF NOT EXISTS helpdesk.counters (
  workspace_id TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  value        INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, name)
);
