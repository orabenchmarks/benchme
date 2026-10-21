-- guide: the buyer's guide keeps no content in the database — every page is a function of the workspace's
-- edition — only a record of every page each workspace was served, which a study reads to know what each run saw.
CREATE SCHEMA IF NOT EXISTS guide;

-- No foreign key to core.workspaces, deliberately: the records must outlive a workspace's TTL (the audit that reads
-- them may run after the reaper has deleted the workspace), as the wallet's records do.
CREATE TABLE IF NOT EXISTS guide.page_views (
  seq          BIGSERIAL PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  method       TEXT NOT NULL,
  -- The path under the guide ("/", "/products/plotwise", "/journal/six-months-in"), query removed.
  path         TEXT NOT NULL,
  query        TEXT,
  status       INTEGER NOT NULL,
  -- What was served: home | product | journal | not_found | no_edition.
  page         TEXT NOT NULL,
  product      TEXT,
  -- For a journal page: {"slug","stance","index","product"}.
  article      JSONB,
  -- The workspace's edition as served: {"seed","category","arm","target"}; null when it has none.
  edition      JSONB,
  user_agent   TEXT,
  referer      TEXT
);
CREATE INDEX IF NOT EXISTS page_views_workspace ON guide.page_views (workspace_id, seq);
