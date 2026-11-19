-- cinema: a cinema ticket booking site — cinemas, screens, films, prices,
-- showtimes, bookings. Every tenant table is scoped by workspace_id and
-- cascades from core.workspaces.
CREATE SCHEMA IF NOT EXISTS cinema;

CREATE TABLE IF NOT EXISTS cinema.users (
  workspace_id   TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  email          TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  display_name   TEXT NOT NULL,
  verified_at    TIMESTAMPTZ,
  api_token      TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, email)
);
CREATE UNIQUE INDEX IF NOT EXISTS cn_users_api_token ON cinema.users (workspace_id, api_token) WHERE api_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS cinema.verification_codes (
  workspace_id TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  code         TEXT NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (workspace_id, email)
);

CREATE TABLE IF NOT EXISTS cinema.sessions (
  workspace_id TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  token        TEXT NOT NULL,
  email        TEXT NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (workspace_id, token)
);

CREATE TABLE IF NOT EXISTS cinema.cinemas (
  workspace_id             TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  code                     TEXT NOT NULL,
  name                     TEXT NOT NULL,
  city                     TEXT NOT NULL,
  address                  TEXT NOT NULL,
  booking_fee_cents        INTEGER NOT NULL,
  premium_surcharge_cents  INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, code)
);
CREATE INDEX IF NOT EXISTS cn_cinemas_city ON cinema.cinemas (workspace_id, lower(city));

CREATE TABLE IF NOT EXISTS cinema.screens (
  workspace_id   TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  code           TEXT NOT NULL,
  cinema_code    TEXT NOT NULL,
  name           TEXT NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('standard', 'large')),
  seat_rows      INTEGER NOT NULL CHECK (seat_rows BETWEEN 1 AND 8),
  seats_per_row  INTEGER NOT NULL CHECK (seats_per_row BETWEEN 1 AND 99),
  premium_rows   TEXT[] NOT NULL,
  PRIMARY KEY (workspace_id, code),
  FOREIGN KEY (workspace_id, cinema_code) REFERENCES cinema.cinemas (workspace_id, code) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS cinema.films (
  workspace_id     TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  code             TEXT NOT NULL,
  title            TEXT NOT NULL,
  genre            TEXT NOT NULL,
  rating           TEXT NOT NULL,
  runtime_minutes  INTEGER NOT NULL,
  language         TEXT NOT NULL,
  synopsis         TEXT NOT NULL,
  formats          TEXT[] NOT NULL,
  PRIMARY KEY (workspace_id, code)
);

CREATE TABLE IF NOT EXISTS cinema.prices (
  workspace_id  TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  cinema_code   TEXT NOT NULL,
  format        TEXT NOT NULL CHECK (format IN ('2d', '3d', 'large')),
  ticket_type   TEXT NOT NULL CHECK (ticket_type IN ('adult', 'child', 'senior', 'student')),
  price_cents   INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, cinema_code, format, ticket_type),
  FOREIGN KEY (workspace_id, cinema_code) REFERENCES cinema.cinemas (workspace_id, code) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS cinema.showtimes (
  workspace_id  TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  code          TEXT NOT NULL,
  cinema_code   TEXT NOT NULL,
  screen_code   TEXT NOT NULL,
  film_code     TEXT NOT NULL,
  show_date     DATE NOT NULL,
  start_time    TEXT NOT NULL,
  format        TEXT NOT NULL CHECK (format IN ('2d', '3d', 'large')),
  PRIMARY KEY (workspace_id, code),
  FOREIGN KEY (workspace_id, screen_code) REFERENCES cinema.screens (workspace_id, code) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, film_code) REFERENCES cinema.films (workspace_id, code) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS cn_showtimes_day ON cinema.showtimes (workspace_id, show_date, cinema_code);

-- A booking's seats and ticket types live in `tickets` ([{seat, ticketType, priceCents}], in seat order);
-- the write path locks the showtime row, so two bookings can never take one seat.
CREATE TABLE IF NOT EXISTS cinema.bookings (
  workspace_id    TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  booking_no      TEXT NOT NULL,
  showtime_code   TEXT NOT NULL,
  customer_name   TEXT NOT NULL,
  customer_email  TEXT NOT NULL,
  tickets         JSONB NOT NULL,
  fees_cents      INTEGER NOT NULL,
  total_cents     INTEGER NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('confirmed', 'cancelled')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_at    TIMESTAMPTZ,
  PRIMARY KEY (workspace_id, booking_no),
  FOREIGN KEY (workspace_id, showtime_code) REFERENCES cinema.showtimes (workspace_id, code) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS cn_bookings_customer ON cinema.bookings (workspace_id, lower(customer_email));
CREATE INDEX IF NOT EXISTS cn_bookings_showtime ON cinema.bookings (workspace_id, showtime_code);

CREATE TABLE IF NOT EXISTS cinema.counters (
  workspace_id TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  value        INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, name)
);
