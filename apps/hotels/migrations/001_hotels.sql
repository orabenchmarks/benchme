-- hotels: a hotel booking site — hotels, room types, bookings. Every tenant
-- table is scoped by workspace_id and cascades from core.workspaces.
CREATE SCHEMA IF NOT EXISTS hotels;

CREATE TABLE IF NOT EXISTS hotels.users (
  workspace_id   TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  email          TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  display_name   TEXT NOT NULL,
  verified_at    TIMESTAMPTZ,
  api_token      TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, email)
);
CREATE UNIQUE INDEX IF NOT EXISTS ht_users_api_token ON hotels.users (workspace_id, api_token) WHERE api_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS hotels.verification_codes (
  workspace_id TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  code         TEXT NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (workspace_id, email)
);

CREATE TABLE IF NOT EXISTS hotels.sessions (
  workspace_id TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  token        TEXT NOT NULL,
  email        TEXT NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (workspace_id, token)
);

CREATE TABLE IF NOT EXISTS hotels.hotels (
  workspace_id             TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  code                     TEXT NOT NULL,
  name                     TEXT NOT NULL,
  city                     TEXT NOT NULL,
  rating                   NUMERIC(2, 1) NOT NULL,
  description              TEXT NOT NULL,
  amenities                TEXT[] NOT NULL,
  pets_allowed             BOOLEAN NOT NULL,
  pet_fee_cents            INTEGER,
  late_checkout_until      TEXT,
  late_checkout_fee_cents  INTEGER,
  PRIMARY KEY (workspace_id, code)
);
CREATE INDEX IF NOT EXISTS ht_hotels_city ON hotels.hotels (workspace_id, lower(city));

CREATE TABLE IF NOT EXISTS hotels.room_types (
  workspace_id   TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  code           TEXT NOT NULL,
  hotel_code     TEXT NOT NULL,
  name           TEXT NOT NULL,
  max_adults     INTEGER NOT NULL,
  max_kids       INTEGER NOT NULL,
  nightly_cents  INTEGER NOT NULL,
  rooms          INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, code),
  FOREIGN KEY (workspace_id, hotel_code) REFERENCES hotels.hotels (workspace_id, code) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS hotels.bookings (
  workspace_id   TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  booking_no     TEXT NOT NULL,
  hotel_code     TEXT NOT NULL,
  room_code      TEXT NOT NULL,
  guest_name     TEXT NOT NULL,
  guest_email    TEXT NOT NULL,
  check_in       DATE NOT NULL,
  nights         INTEGER NOT NULL,
  adults         INTEGER NOT NULL,
  kids           INTEGER NOT NULL,
  pets           INTEGER NOT NULL,
  late_checkout  BOOLEAN NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('confirmed', 'cancelled')),
  total_cents    INTEGER NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_at   TIMESTAMPTZ,
  PRIMARY KEY (workspace_id, booking_no),
  FOREIGN KEY (workspace_id, room_code) REFERENCES hotels.room_types (workspace_id, code) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ht_bookings_guest ON hotels.bookings (workspace_id, lower(guest_email));
CREATE INDEX IF NOT EXISTS ht_bookings_room ON hotels.bookings (workspace_id, room_code);

CREATE TABLE IF NOT EXISTS hotels.counters (
  workspace_id TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  value        INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, name)
);
