-- events: an office events site — offices, meeting rooms, a staff directory,
-- events booked into rooms with invited guests, and registrations for the
-- events open to them. Every tenant table is scoped by workspace_id and
-- cascades from core.workspaces.
CREATE SCHEMA IF NOT EXISTS events;

CREATE TABLE IF NOT EXISTS events.users (
  workspace_id   TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  email          TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  display_name   TEXT NOT NULL,
  verified_at    TIMESTAMPTZ,
  api_token      TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, email)
);
CREATE UNIQUE INDEX IF NOT EXISTS ev_users_api_token ON events.users (workspace_id, api_token) WHERE api_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS events.verification_codes (
  workspace_id TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  code         TEXT NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (workspace_id, email)
);

CREATE TABLE IF NOT EXISTS events.sessions (
  workspace_id TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  token        TEXT NOT NULL,
  email        TEXT NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (workspace_id, token)
);

CREATE TABLE IF NOT EXISTS events.offices (
  workspace_id TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  code         TEXT NOT NULL,
  name         TEXT NOT NULL,
  city         TEXT NOT NULL,
  address      TEXT NOT NULL,
  opens_at     TEXT NOT NULL,
  closes_at    TEXT NOT NULL,
  open_days    TEXT[] NOT NULL,
  PRIMARY KEY (workspace_id, code)
);

CREATE TABLE IF NOT EXISTS events.rooms (
  workspace_id TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  code         TEXT NOT NULL,
  office_code  TEXT NOT NULL,
  name         TEXT NOT NULL,
  floor        INTEGER NOT NULL,
  capacity     INTEGER NOT NULL,
  equipment    TEXT[] NOT NULL,
  accessible   BOOLEAN NOT NULL,
  PRIMARY KEY (workspace_id, code),
  FOREIGN KEY (workspace_id, office_code) REFERENCES events.offices (workspace_id, code) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS events.people (
  workspace_id TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  name         TEXT NOT NULL,
  office_code  TEXT NOT NULL,
  team         TEXT NOT NULL,
  PRIMARY KEY (workspace_id, email),
  FOREIGN KEY (workspace_id, office_code) REFERENCES events.offices (workspace_id, code) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS events.events (
  workspace_id     TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  code             TEXT NOT NULL,
  title            TEXT NOT NULL,
  description      TEXT NOT NULL,
  date             DATE NOT NULL,
  start_time       TEXT NOT NULL,
  end_time         TEXT NOT NULL,
  office_code      TEXT NOT NULL,
  room_code        TEXT NOT NULL,
  organiser_email  TEXT NOT NULL,
  registration     TEXT NOT NULL CHECK (registration IN ('invite-only', 'open')),
  places           INTEGER,
  status           TEXT NOT NULL CHECK (status IN ('scheduled', 'cancelled')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ,
  cancelled_at     TIMESTAMPTZ,
  PRIMARY KEY (workspace_id, code),
  FOREIGN KEY (workspace_id, room_code) REFERENCES events.rooms (workspace_id, code) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ev_events_room_day ON events.events (workspace_id, room_code, date);
CREATE INDEX IF NOT EXISTS ev_events_organiser ON events.events (workspace_id, organiser_email);

-- Invited guests: one row per (event, email), the junction an event's guest list is read from.
CREATE TABLE IF NOT EXISTS events.event_guests (
  workspace_id TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  event_code   TEXT NOT NULL,
  email        TEXT NOT NULL,
  PRIMARY KEY (workspace_id, event_code, email),
  FOREIGN KEY (workspace_id, event_code) REFERENCES events.events (workspace_id, code) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ev_guests_email ON events.event_guests (workspace_id, email);

CREATE TABLE IF NOT EXISTS events.registrations (
  workspace_id TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  reg_no       TEXT NOT NULL,
  event_code   TEXT NOT NULL,
  name         TEXT NOT NULL,
  email        TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('registered', 'cancelled')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_at TIMESTAMPTZ,
  PRIMARY KEY (workspace_id, reg_no),
  FOREIGN KEY (workspace_id, event_code) REFERENCES events.events (workspace_id, code) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ev_registrations_event ON events.registrations (workspace_id, event_code);
CREATE INDEX IF NOT EXISTS ev_registrations_email ON events.registrations (workspace_id, email);

CREATE TABLE IF NOT EXISTS events.counters (
  workspace_id TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  value        INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, name)
);
