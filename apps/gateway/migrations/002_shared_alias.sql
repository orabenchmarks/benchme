-- Shared workspaces: an alias ("shared-<scenario>-<seed>") resolves to ONE
-- long-lived workspace created on first use, for read-only tasks that need a
-- fixed URL (an MCP server attached at run creation).
ALTER TABLE core.workspaces ADD COLUMN IF NOT EXISTS alias TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS workspaces_alias ON core.workspaces (alias) WHERE alias IS NOT NULL;
