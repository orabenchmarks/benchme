-- homes: a home listings site — agents, listings, the agents' viewing days and
-- viewing requests. Every tenant table is scoped by workspace_id and cascades
-- from core.workspaces.
CREATE SCHEMA IF NOT EXISTS homes;

CREATE TABLE IF NOT EXISTS homes.users (
  workspace_id   TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  email          TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  display_name   TEXT NOT NULL,
  verified_at    TIMESTAMPTZ,
  api_token      TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, email)
);
CREATE UNIQUE INDEX IF NOT EXISTS hm_users_api_token ON homes.users (workspace_id, api_token) WHERE api_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS homes.verification_codes (
  workspace_id TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  code         TEXT NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (workspace_id, email)
);

CREATE TABLE IF NOT EXISTS homes.sessions (
  workspace_id TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  token        TEXT NOT NULL,
  email        TEXT NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (workspace_id, token)
);

CREATE TABLE IF NOT EXISTS homes.agents (
  workspace_id TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  code         TEXT NOT NULL,
  name         TEXT NOT NULL,
  city         TEXT NOT NULL,
  email        TEXT NOT NULL,
  PRIMARY KEY (workspace_id, code)
);

CREATE TABLE IF NOT EXISTS homes.listings (
  workspace_id       TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  code               TEXT NOT NULL,
  city               TEXT NOT NULL,
  neighbourhood      TEXT NOT NULL,
  address            TEXT NOT NULL,
  type               TEXT NOT NULL CHECK (type IN ('house', 'apartment', 'townhouse')),
  price_cents        INTEGER NOT NULL,
  beds               INTEGER NOT NULL,
  baths              INTEGER NOT NULL,
  area_sqm           INTEGER NOT NULL,
  year_built         INTEGER NOT NULL,
  features           TEXT[] NOT NULL,
  monthly_fee_cents  INTEGER NOT NULL,
  annual_tax_cents   INTEGER NOT NULL,
  status             TEXT NOT NULL CHECK (status IN ('active', 'pending', 'sold')),
  listed_on          DATE NOT NULL,
  agent_code         TEXT NOT NULL,
  description        TEXT NOT NULL,
  PRIMARY KEY (workspace_id, code),
  FOREIGN KEY (workspace_id, agent_code) REFERENCES homes.agents (workspace_id, code) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS hm_listings_city ON homes.listings (workspace_id, lower(city));

CREATE TABLE IF NOT EXISTS homes.agent_days (
  workspace_id TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  agent_code   TEXT NOT NULL,
  work_date    DATE NOT NULL,
  from_time    TEXT NOT NULL,
  until_time   TEXT NOT NULL,
  PRIMARY KEY (workspace_id, agent_code, work_date),
  FOREIGN KEY (workspace_id, agent_code) REFERENCES homes.agents (workspace_id, code) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS homes.viewings (
  workspace_id  TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  viewing_no    TEXT NOT NULL,
  listing_code  TEXT NOT NULL,
  agent_code    TEXT NOT NULL,
  slot_date     DATE NOT NULL,
  slot_time     TEXT NOT NULL,
  viewer_name   TEXT NOT NULL,
  viewer_email  TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('requested', 'cancelled')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_at  TIMESTAMPTZ,
  PRIMARY KEY (workspace_id, viewing_no),
  FOREIGN KEY (workspace_id, listing_code) REFERENCES homes.listings (workspace_id, code) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS hm_viewings_email ON homes.viewings (workspace_id, lower(viewer_email));
CREATE INDEX IF NOT EXISTS hm_viewings_agent ON homes.viewings (workspace_id, agent_code);
-- The rules hold these too; the indexes are the last line: one requested viewing per agent slot, one per viewer per time.
CREATE UNIQUE INDEX IF NOT EXISTS hm_viewings_slot ON homes.viewings (workspace_id, agent_code, slot_date, slot_time) WHERE status = 'requested';
CREATE UNIQUE INDEX IF NOT EXISTS hm_viewings_viewer_time ON homes.viewings (workspace_id, lower(viewer_email), slot_date, slot_time) WHERE status = 'requested';

CREATE TABLE IF NOT EXISTS homes.counters (
  workspace_id TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  value        INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, name)
);
