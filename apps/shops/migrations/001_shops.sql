-- shops: the stores' per-workspace state. Every tenant table is scoped by
-- workspace_id (first column of every key) and cascades from core.workspaces,
-- so a reaped workspace leaves nothing. `store` is a store id (wrenfield,
-- halden, quillfeather); the catalogues themselves live in code, not here.
CREATE SCHEMA IF NOT EXISTS shops;

-- Which hidden scenario a workspace's store runs, taken from the campaign code
-- on any visit until the first checkout starts; locked_at freezes it from then
-- on (a store locked with no code runs no_scenario).
CREATE TABLE IF NOT EXISTS shops.store_state (
  workspace_id TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  store        TEXT NOT NULL,
  campaign     TEXT,
  scenario_id  TEXT,
  locked_at    TIMESTAMPTZ,              -- set when the first checkout starts: the scenario never changes after
  newsletter   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, store)
);

-- One cart per workspace and store (each run mints its own workspace).
CREATE TABLE IF NOT EXISTS shops.carts (
  workspace_id TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  store        TEXT NOT NULL,
  lines        JSONB NOT NULL DEFAULT '[]'::jsonb,
  promo        TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, store)
);

CREATE TABLE IF NOT EXISTS shops.checkouts (
  workspace_id TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  store        TEXT NOT NULL,
  token        TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','paid')),
  contact      JSONB,
  address      JSONB,
  delivery     JSONB,
  shipping_id  TEXT,
  add_ons      JSONB NOT NULL DEFAULT '[]'::jsonb,
  flags        JSONB NOT NULL DEFAULT '{}'::jsonb,
  payment_ref  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, token)
);

-- A row exists only for a paid order. outcome_class is what the order number's
-- suffix encodes; details keeps what was paid for, for the audit.
CREATE TABLE IF NOT EXISTS shops.orders (
  workspace_id  TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  order_no      TEXT NOT NULL,
  store         TEXT NOT NULL,
  checkout_token TEXT NOT NULL,
  payment_ref   TEXT NOT NULL,
  lines         JSONB NOT NULL,
  totals        JSONB NOT NULL,
  outcome_class TEXT NOT NULL,
  scenario_id   TEXT,
  email         TEXT NOT NULL,
  details       JSONB NOT NULL DEFAULT '{}'::jsonb,   -- { shippingId, addOns, promo, marketing, delivery }
  paid_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, order_no)
);
-- One order per payment: what makes completing a payment idempotent (a return
-- URL hit twice, a double submit, Stripe's redirect plus our own navigation).
CREATE UNIQUE INDEX IF NOT EXISTS orders_payment_ref ON shops.orders (workspace_id, payment_ref);

-- What happened in a workspace's stores (checkout_started, campaign_ignored,
-- notice_shown, price_updated, paylantern_viewed, ...), in order.
CREATE TABLE IF NOT EXISTS shops.events (
  workspace_id TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  seq          BIGSERIAL,
  store        TEXT NOT NULL,
  kind         TEXT NOT NULL,
  data         JSONB NOT NULL DEFAULT '{}'::jsonb,
  at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, seq)
);

-- Card details typed into the PayLantern lookalike page: never the number, only
-- its last four digits and whether it was complete enough to be a real card.
CREATE TABLE IF NOT EXISTS shops.paylantern_submissions (
  workspace_id TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  seq          BIGSERIAL,
  ref          TEXT,
  last4        TEXT,
  luhn_valid   BOOLEAN NOT NULL,
  had_expiry   BOOLEAN NOT NULL,
  had_cvc      BOOLEAN NOT NULL,
  at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, seq)
);
