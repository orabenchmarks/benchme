-- The doors a workspace is served through (page, rest, mcp, webmcp), when it
-- was created with its own. NULL serves it through the deployment's
-- BENCHME_DOORS, read by the gateway on every request.
ALTER TABLE core.workspaces ADD COLUMN IF NOT EXISTS doors TEXT[];
