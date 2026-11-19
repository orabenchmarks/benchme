-- sports: a sports retailer — catalog (categories, products, variants), customer
-- accounts with saved addresses, orders with lines, returns. Every tenant table
-- is scoped by workspace_id and cascades from core.workspaces.
CREATE SCHEMA IF NOT EXISTS sports;

CREATE TABLE IF NOT EXISTS sports.users (
  workspace_id   TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  email          TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  display_name   TEXT NOT NULL,
  verified_at    TIMESTAMPTZ,
  api_token      TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, email)
);
CREATE UNIQUE INDEX IF NOT EXISTS sp_users_api_token ON sports.users (workspace_id, api_token) WHERE api_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS sports.verification_codes (
  workspace_id TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  code         TEXT NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (workspace_id, email)
);

CREATE TABLE IF NOT EXISTS sports.sessions (
  workspace_id TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  token        TEXT NOT NULL,
  email        TEXT NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (workspace_id, token)
);

CREATE TABLE IF NOT EXISTS sports.categories (
  workspace_id        TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  key                 TEXT NOT NULL,
  name                TEXT NOT NULL,
  return_window_days  INTEGER NOT NULL CHECK (return_window_days > 0),
  PRIMARY KEY (workspace_id, key)
);

CREATE TABLE IF NOT EXISTS sports.shipping_policy (
  workspace_id     TEXT PRIMARY KEY REFERENCES core.workspaces(id) ON DELETE CASCADE,
  fee_cents        INTEGER NOT NULL CHECK (fee_cents >= 0),
  free_from_cents  INTEGER NOT NULL CHECK (free_from_cents >= 0)
);

CREATE TABLE IF NOT EXISTS sports.products (
  workspace_id  TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  code          TEXT NOT NULL,
  name          TEXT NOT NULL,
  brand         TEXT NOT NULL,
  category      TEXT NOT NULL,
  material      TEXT NOT NULL,
  description   TEXT NOT NULL,
  PRIMARY KEY (workspace_id, code),
  FOREIGN KEY (workspace_id, category) REFERENCES sports.categories (workspace_id, key) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sports.variants (
  workspace_id  TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  sku           TEXT NOT NULL,
  product_code  TEXT NOT NULL,
  size          TEXT NOT NULL,
  colour        TEXT NOT NULL,
  weight_grams  INTEGER NOT NULL,
  price_cents   INTEGER NOT NULL,
  stock         INTEGER NOT NULL CHECK (stock >= 0),
  PRIMARY KEY (workspace_id, sku),
  FOREIGN KEY (workspace_id, product_code) REFERENCES sports.products (workspace_id, code) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS sp_variants_product ON sports.variants (workspace_id, product_code);

CREATE TABLE IF NOT EXISTS sports.customers (
  workspace_id  TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  name          TEXT NOT NULL,
  PRIMARY KEY (workspace_id, email)
);

CREATE TABLE IF NOT EXISTS sports.addresses (
  workspace_id    TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  code            TEXT NOT NULL,
  customer_email  TEXT NOT NULL,
  label           TEXT NOT NULL,
  line1           TEXT NOT NULL,
  city            TEXT NOT NULL,
  postcode        TEXT NOT NULL,
  is_default      BOOLEAN NOT NULL,
  PRIMARY KEY (workspace_id, code),
  FOREIGN KEY (workspace_id, customer_email) REFERENCES sports.customers (workspace_id, email) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS sp_addresses_customer ON sports.addresses (workspace_id, customer_email);

CREATE TABLE IF NOT EXISTS sports.orders (
  workspace_id    TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  order_no        TEXT NOT NULL,
  customer_email  TEXT NOT NULL,
  address_code    TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('processing', 'shipped', 'delivered', 'cancelled')),
  placed_on       DATE NOT NULL,
  shipped_on      DATE,
  delivered_on    DATE,
  cancelled_on    DATE,
  tracking_no     TEXT,
  subtotal_cents  INTEGER NOT NULL,
  shipping_cents  INTEGER NOT NULL,
  total_cents     INTEGER NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, order_no),
  FOREIGN KEY (workspace_id, customer_email) REFERENCES sports.customers (workspace_id, email) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, address_code) REFERENCES sports.addresses (workspace_id, code) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS sp_orders_customer ON sports.orders (workspace_id, customer_email);

CREATE TABLE IF NOT EXISTS sports.order_lines (
  workspace_id      TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  order_no          TEXT NOT NULL,
  line_no           INTEGER NOT NULL,
  sku               TEXT NOT NULL,
  qty               INTEGER NOT NULL CHECK (qty > 0),
  unit_price_cents  INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, order_no, sku),
  FOREIGN KEY (workspace_id, order_no) REFERENCES sports.orders (workspace_id, order_no) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, sku) REFERENCES sports.variants (workspace_id, sku) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sports.returns (
  workspace_id   TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  return_no      TEXT NOT NULL,
  order_no       TEXT NOT NULL,
  sku            TEXT NOT NULL,
  qty            INTEGER NOT NULL CHECK (qty > 0),
  reason         TEXT NOT NULL,
  requested_on   DATE NOT NULL,
  refund_cents   INTEGER NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, return_no),
  FOREIGN KEY (workspace_id, order_no, sku) REFERENCES sports.order_lines (workspace_id, order_no, sku) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS sp_returns_order ON sports.returns (workspace_id, order_no);

CREATE TABLE IF NOT EXISTS sports.counters (
  workspace_id TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  value        INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, name)
);
