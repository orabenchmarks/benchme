-- warehouse: every tenant table is scoped by workspace_id (first column of every
-- key) and cascades from core.workspaces, so a reaped workspace leaves nothing.
CREATE SCHEMA IF NOT EXISTS warehouse;

CREATE TABLE IF NOT EXISTS warehouse.users (
  workspace_id   TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  email          TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  display_name   TEXT NOT NULL,
  verified_at    TIMESTAMPTZ,
  api_token      TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, email)
);
CREATE UNIQUE INDEX IF NOT EXISTS users_api_token ON warehouse.users (workspace_id, api_token) WHERE api_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS warehouse.verification_codes (
  workspace_id   TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  email          TEXT NOT NULL,
  code           TEXT NOT NULL,
  expires_at     TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (workspace_id, email)
);

CREATE TABLE IF NOT EXISTS warehouse.sessions (
  workspace_id   TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  token          TEXT NOT NULL,
  email          TEXT NOT NULL,
  expires_at     TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (workspace_id, token)
);

CREATE TABLE IF NOT EXISTS warehouse.products (
  workspace_id     TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  sku              TEXT NOT NULL,
  name             TEXT NOT NULL,
  category         TEXT NOT NULL,
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  PRIMARY KEY (workspace_id, sku)
);
CREATE INDEX IF NOT EXISTS products_category ON warehouse.products (workspace_id, category);

CREATE TABLE IF NOT EXISTS warehouse.locations (
  workspace_id TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  code         TEXT NOT NULL,
  name         TEXT NOT NULL,
  city         TEXT NOT NULL,
  PRIMARY KEY (workspace_id, code)
);

CREATE TABLE IF NOT EXISTS warehouse.stock (
  workspace_id  TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  sku           TEXT NOT NULL,
  location_code TEXT NOT NULL,
  qty           INTEGER NOT NULL CHECK (qty >= 0),
  PRIMARY KEY (workspace_id, sku, location_code),
  FOREIGN KEY (workspace_id, sku) REFERENCES warehouse.products (workspace_id, sku) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, location_code) REFERENCES warehouse.locations (workspace_id, code) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS warehouse.customers (
  workspace_id TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  code         TEXT NOT NULL,
  name         TEXT NOT NULL,
  tier         TEXT NOT NULL CHECK (tier IN ('standard', 'gold', 'platinum')),
  city         TEXT NOT NULL,
  PRIMARY KEY (workspace_id, code)
);

CREATE TABLE IF NOT EXISTS warehouse.orders (
  workspace_id  TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  order_no      TEXT NOT NULL,
  customer_code TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('open', 'shipped', 'cancelled')),
  placed_at     TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (workspace_id, order_no),
  FOREIGN KEY (workspace_id, customer_code) REFERENCES warehouse.customers (workspace_id, code) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS orders_customer ON warehouse.orders (workspace_id, customer_code);
CREATE INDEX IF NOT EXISTS orders_status ON warehouse.orders (workspace_id, status);

CREATE TABLE IF NOT EXISTS warehouse.order_lines (
  workspace_id TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  order_no     TEXT NOT NULL,
  sku          TEXT NOT NULL,
  qty          INTEGER NOT NULL CHECK (qty > 0),
  PRIMARY KEY (workspace_id, order_no, sku),
  FOREIGN KEY (workspace_id, order_no) REFERENCES warehouse.orders (workspace_id, order_no) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, sku) REFERENCES warehouse.products (workspace_id, sku) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS warehouse.transfers (
  workspace_id TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  transfer_no  TEXT NOT NULL,
  sku          TEXT NOT NULL,
  from_code    TEXT NOT NULL,
  to_code      TEXT NOT NULL,
  qty          INTEGER NOT NULL CHECK (qty > 0),
  status       TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'cancelled')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, transfer_no),
  FOREIGN KEY (workspace_id, sku) REFERENCES warehouse.products (workspace_id, sku) ON DELETE CASCADE
);

-- Per-workspace counters for numbers the app allocates (orders, transfers).
CREATE TABLE IF NOT EXISTS warehouse.counters (
  workspace_id TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  value        INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, name)
);
