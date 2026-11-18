-- pizza: a pizza ordering site — sizes, toppings, the menu, branches, the
-- toppings a branch has run out of, and orders with their lines. Every tenant
-- table is scoped by workspace_id and cascades from core.workspaces. Crusts,
-- sauces and cheeses are fixed options in code (@benchme/scenarios).
CREATE SCHEMA IF NOT EXISTS pizza;

CREATE TABLE IF NOT EXISTS pizza.users (
  workspace_id   TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  email          TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  display_name   TEXT NOT NULL,
  verified_at    TIMESTAMPTZ,
  api_token      TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, email)
);
CREATE UNIQUE INDEX IF NOT EXISTS pz_users_api_token ON pizza.users (workspace_id, api_token) WHERE api_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS pizza.verification_codes (
  workspace_id TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  code         TEXT NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (workspace_id, email)
);

CREATE TABLE IF NOT EXISTS pizza.sessions (
  workspace_id TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  token        TEXT NOT NULL,
  email        TEXT NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (workspace_id, token)
);

CREATE TABLE IF NOT EXISTS pizza.sizes (
  workspace_id TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  key          TEXT NOT NULL,
  name         TEXT NOT NULL,
  inches       INTEGER NOT NULL,
  serves       INTEGER NOT NULL,
  base_cents   INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, key)
);

CREATE TABLE IF NOT EXISTS pizza.toppings (
  workspace_id  TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  key           TEXT NOT NULL,
  name          TEXT NOT NULL,
  vegetarian    BOOLEAN NOT NULL,
  vegan         BOOLEAN NOT NULL,
  allergens     TEXT[] NOT NULL,
  small_cents   INTEGER NOT NULL,
  medium_cents  INTEGER NOT NULL,
  large_cents   INTEGER NOT NULL,
  xlarge_cents  INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, key)
);

CREATE TABLE IF NOT EXISTS pizza.pizzas (
  workspace_id TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  code         TEXT NOT NULL,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL,
  crust        TEXT NOT NULL,
  sauce        TEXT NOT NULL,
  cheese       TEXT NOT NULL,
  toppings     TEXT[] NOT NULL,
  PRIMARY KEY (workspace_id, code)
);

CREATE TABLE IF NOT EXISTS pizza.branches (
  workspace_id              TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  code                      TEXT NOT NULL,
  name                      TEXT NOT NULL,
  city                      TEXT NOT NULL,
  address                   TEXT NOT NULL,
  delivers                  BOOLEAN NOT NULL,
  delivery_fee_cents        INTEGER,
  free_delivery_from_cents  INTEGER,
  slot_capacity             INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, code)
);
CREATE INDEX IF NOT EXISTS pz_branches_city ON pizza.branches (workspace_id, lower(city));

CREATE TABLE IF NOT EXISTS pizza.stockouts (
  workspace_id TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  branch_code  TEXT NOT NULL,
  topping_key  TEXT NOT NULL,
  PRIMARY KEY (workspace_id, branch_code, topping_key),
  FOREIGN KEY (workspace_id, branch_code) REFERENCES pizza.branches (workspace_id, code) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, topping_key) REFERENCES pizza.toppings (workspace_id, key) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pizza.orders (
  workspace_id        TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  order_no            TEXT NOT NULL,
  branch_code         TEXT NOT NULL,
  customer_name       TEXT NOT NULL,
  customer_email      TEXT NOT NULL,
  fulfilment          TEXT NOT NULL CHECK (fulfilment IN ('pickup', 'delivery')),
  address             TEXT,
  slot_date           DATE NOT NULL,
  slot_time           TEXT NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('received', 'preparing', 'out_for_delivery', 'delivered', 'cancelled')),
  subtotal_cents      INTEGER NOT NULL,
  delivery_fee_cents  INTEGER NOT NULL,
  total_cents         INTEGER NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ,
  cancelled_at        TIMESTAMPTZ,
  PRIMARY KEY (workspace_id, order_no),
  FOREIGN KEY (workspace_id, branch_code) REFERENCES pizza.branches (workspace_id, code) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS pz_orders_customer ON pizza.orders (workspace_id, lower(customer_email));
CREATE INDEX IF NOT EXISTS pz_orders_slot ON pizza.orders (workspace_id, branch_code, slot_date);

CREATE TABLE IF NOT EXISTS pizza.order_lines (
  workspace_id TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  order_no     TEXT NOT NULL,
  line         INTEGER NOT NULL,
  pizza_code   TEXT,
  size         TEXT NOT NULL,
  crust        TEXT NOT NULL,
  sauce        TEXT NOT NULL,
  cheese       TEXT NOT NULL,
  toppings     TEXT[] NOT NULL,
  quantity     INTEGER NOT NULL,
  unit_cents   INTEGER NOT NULL,
  line_cents   INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, order_no, line),
  FOREIGN KEY (workspace_id, order_no) REFERENCES pizza.orders (workspace_id, order_no) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pizza.counters (
  workspace_id TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  value        INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, name)
);
