-- dining: a restaurant reservation site — restaurants, their seating by area,
-- reservations. Every tenant table is scoped by workspace_id and cascades
-- from core.workspaces.
CREATE SCHEMA IF NOT EXISTS dining;

CREATE TABLE IF NOT EXISTS dining.users (
  workspace_id   TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  email          TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  display_name   TEXT NOT NULL,
  verified_at    TIMESTAMPTZ,
  api_token      TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, email)
);
CREATE UNIQUE INDEX IF NOT EXISTS dn_users_api_token ON dining.users (workspace_id, api_token) WHERE api_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS dining.verification_codes (
  workspace_id TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  code         TEXT NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (workspace_id, email)
);

CREATE TABLE IF NOT EXISTS dining.sessions (
  workspace_id TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  token        TEXT NOT NULL,
  email        TEXT NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (workspace_id, token)
);

CREATE TABLE IF NOT EXISTS dining.restaurants (
  workspace_id             TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  code                     TEXT NOT NULL,
  name                     TEXT NOT NULL,
  city                     TEXT NOT NULL,
  cuisine                  TEXT NOT NULL,
  price_level              INTEGER NOT NULL CHECK (price_level BETWEEN 1 AND 4),
  description              TEXT NOT NULL,
  menus                    TEXT[] NOT NULL,
  closed_day               TEXT NOT NULL,
  -- {"monday": {"opens": "HH:MM", "closes": "HH:MM"} | null, …}
  hours                    JSONB NOT NULL,
  deposit_per_guest_cents  INTEGER NOT NULL,
  private_room_fee_cents   INTEGER,
  PRIMARY KEY (workspace_id, code)
);
CREATE INDEX IF NOT EXISTS dn_restaurants_city ON dining.restaurants (workspace_id, lower(city));

CREATE TABLE IF NOT EXISTS dining.seating (
  workspace_id     TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  restaurant_code  TEXT NOT NULL,
  area             TEXT NOT NULL CHECK (area IN ('indoor', 'terrace', 'bar', 'private')),
  seats            INTEGER NOT NULL,
  table_count      INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, restaurant_code, area),
  FOREIGN KEY (workspace_id, restaurant_code) REFERENCES dining.restaurants (workspace_id, code) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS dining.reservations (
  workspace_id     TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  reservation_no   TEXT NOT NULL,
  restaurant_code  TEXT NOT NULL,
  area             TEXT NOT NULL,
  res_date         DATE NOT NULL,
  res_time         TEXT NOT NULL,
  party_size       INTEGER NOT NULL,
  guest_name       TEXT NOT NULL,
  guest_email      TEXT NOT NULL,
  guest_phone      TEXT NOT NULL,
  note             TEXT NOT NULL DEFAULT '',
  status           TEXT NOT NULL CHECK (status IN ('confirmed', 'cancelled')),
  deposit_cents    INTEGER NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_at     TIMESTAMPTZ,
  PRIMARY KEY (workspace_id, reservation_no),
  FOREIGN KEY (workspace_id, restaurant_code, area) REFERENCES dining.seating (workspace_id, restaurant_code, area) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS dn_reservations_guest ON dining.reservations (workspace_id, lower(guest_email));
CREATE INDEX IF NOT EXISTS dn_reservations_day ON dining.reservations (workspace_id, restaurant_code, res_date);

CREATE TABLE IF NOT EXISTS dining.counters (
  workspace_id TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  value        INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, name)
);
