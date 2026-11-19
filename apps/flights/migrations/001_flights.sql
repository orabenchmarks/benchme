-- flights: a flight search and booking site — airports, carriers, daily flights,
-- their cabins, bookings. Every tenant table is scoped by workspace_id and
-- cascades from core.workspaces.
CREATE SCHEMA IF NOT EXISTS flights;

CREATE TABLE IF NOT EXISTS flights.users (
  workspace_id   TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  email          TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  display_name   TEXT NOT NULL,
  verified_at    TIMESTAMPTZ,
  api_token      TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, email)
);
CREATE UNIQUE INDEX IF NOT EXISTS fl_users_api_token ON flights.users (workspace_id, api_token) WHERE api_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS flights.verification_codes (
  workspace_id TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  code         TEXT NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (workspace_id, email)
);

CREATE TABLE IF NOT EXISTS flights.sessions (
  workspace_id TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  token        TEXT NOT NULL,
  email        TEXT NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (workspace_id, token)
);

CREATE TABLE IF NOT EXISTS flights.airports (
  workspace_id TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  code         TEXT NOT NULL,
  name         TEXT NOT NULL,
  city         TEXT NOT NULL,
  hub          BOOLEAN NOT NULL,
  PRIMARY KEY (workspace_id, code)
);

CREATE TABLE IF NOT EXISTS flights.carriers (
  workspace_id   TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  code           TEXT NOT NULL,
  name           TEXT NOT NULL,
  bag_fee_cents  INTEGER NOT NULL,
  max_bags       INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, code)
);

CREATE TABLE IF NOT EXISTS flights.flights (
  workspace_id      TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  flight_no         TEXT NOT NULL,
  carrier_code      TEXT NOT NULL,
  origin            TEXT NOT NULL,
  destination       TEXT NOT NULL,
  via               TEXT,
  stops             INTEGER NOT NULL CHECK ((via IS NULL) = (stops = 0)),
  departs           TEXT NOT NULL,
  arrives           TEXT NOT NULL,
  arrives_next_day  BOOLEAN NOT NULL,
  duration_minutes  INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, flight_no),
  FOREIGN KEY (workspace_id, carrier_code) REFERENCES flights.carriers (workspace_id, code) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, origin) REFERENCES flights.airports (workspace_id, code) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, destination) REFERENCES flights.airports (workspace_id, code) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, via) REFERENCES flights.airports (workspace_id, code) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS fl_flights_route ON flights.flights (workspace_id, origin, destination);

CREATE TABLE IF NOT EXISTS flights.cabins (
  workspace_id  TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  flight_no     TEXT NOT NULL,
  cabin         TEXT NOT NULL CHECK (cabin IN ('economy', 'premium', 'business')),
  price_cents   INTEGER NOT NULL,
  seats         INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, flight_no, cabin),
  FOREIGN KEY (workspace_id, flight_no) REFERENCES flights.flights (workspace_id, flight_no) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS flights.bookings (
  workspace_id   TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  booking_no     TEXT NOT NULL,
  flight_no      TEXT NOT NULL,
  flight_date    DATE NOT NULL,
  cabin          TEXT NOT NULL,
  passengers     TEXT[] NOT NULL,
  bags           INTEGER NOT NULL,
  contact_email  TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('confirmed', 'cancelled')),
  total_cents    INTEGER NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_at   TIMESTAMPTZ,
  PRIMARY KEY (workspace_id, booking_no),
  FOREIGN KEY (workspace_id, flight_no, cabin) REFERENCES flights.cabins (workspace_id, flight_no, cabin) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS fl_bookings_contact ON flights.bookings (workspace_id, lower(contact_email));
CREATE INDEX IF NOT EXISTS fl_bookings_departure ON flights.bookings (workspace_id, flight_no, flight_date);

CREATE TABLE IF NOT EXISTS flights.counters (
  workspace_id TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  value        INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, name)
);
