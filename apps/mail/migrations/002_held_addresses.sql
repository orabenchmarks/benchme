-- mail: the addresses a workspace's rows already hold, when its scenario's
-- mailboxes are private (Scenario.mailboxes): each has a mailbox of its own,
-- so the inbox never shows mail to them (src/mailboxes/visibility.ts). Written
-- by the seed hook, trimmed and lower-cased; a workspace of a scenario whose
-- mailboxes are shared holds none, and its inbox shows every message, as before.
CREATE TABLE IF NOT EXISTS mail.held_addresses (
  workspace_id TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  address      TEXT NOT NULL,
  PRIMARY KEY (workspace_id, address)
);
