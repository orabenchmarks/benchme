-- wallet: a stand-in for a Link wallet (apps/wallet). Not workspace-scoped: a
-- run's link-cli logs in once (a session) and its spend requests are bound to a
-- store checkout by what they name (binding), never by a header.
CREATE SCHEMA IF NOT EXISTS wallet;

-- A device login (OAuth device authorization grant, RFC 8628) that the wallet's
-- policy approves itself: no person in the loop. Codes are stored hashed.
CREATE TABLE IF NOT EXISTS wallet.device_codes (
  device_code_hash TEXT PRIMARY KEY,
  user_code        TEXT NOT NULL,
  client_name      TEXT NOT NULL,
  connection_label TEXT,
  scope            TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at       TIMESTAMPTZ NOT NULL,
  session_id       TEXT                      -- set when the code is exchanged (once)
);

-- A connected device: one per login. Its spend requests are its own. Tokens are stored hashed.
CREATE TABLE IF NOT EXISTS wallet.sessions (
  id                TEXT PRIMARY KEY,
  client_name       TEXT NOT NULL,
  connection_label  TEXT,
  scope             TEXT NOT NULL,
  access_hash       TEXT NOT NULL UNIQUE,
  refresh_hash      TEXT NOT NULL UNIQUE,
  access_expires_at TIMESTAMPTZ NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at        TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS wallet.spend_requests (
  id                    TEXT PRIMARY KEY,
  session_id            TEXT NOT NULL REFERENCES wallet.sessions(id) ON DELETE CASCADE,
  status                TEXT NOT NULL,
  credential_type       TEXT NOT NULL DEFAULT 'card',
  payment_details       TEXT NOT NULL,
  amount                INTEGER NOT NULL,
  currency              TEXT NOT NULL,
  merchant_name         TEXT,
  merchant_url          TEXT,
  context               TEXT NOT NULL,
  line_items            JSONB,
  totals                JSONB,
  metadata              JSONB,
  recurring             JSONB,
  test                  BOOLEAN NOT NULL DEFAULT false,
  idempotency_key       TEXT,
  status_details        JSONB,
  -- What the request was bound to when it was decided: { rule: workspace|amount, workspace, store, checkout,
  -- scenarioId, card } or { rule: fallback, reason }.
  binding               JSONB,
  -- The issued test card (kind, number, cvc, expiry): answered only to its own session, never in a record.
  card                  JSONB,
  denial_reason         TEXT,
  approval_requested_at TIMESTAMPTZ,
  decided_at            TIMESTAMPTZ,
  approved_at           TIMESTAMPTZ,
  canceled_at           TIMESTAMPTZ,
  expires_at            TIMESTAMPTZ NOT NULL,   -- the credential's validity: created_at + 12 h
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS spend_requests_idempotency ON wallet.spend_requests (session_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS spend_requests_session ON wallet.spend_requests (session_id, created_at);
CREATE INDEX IF NOT EXISTS spend_requests_bound ON wallet.spend_requests ((binding->>'workspace'), (binding->>'store'));
CREATE INDEX IF NOT EXISTS spend_requests_created ON wallet.spend_requests (created_at);

-- Every request, response and status change, in order: what the audit reads.
CREATE TABLE IF NOT EXISTS wallet.events (
  seq        BIGSERIAL PRIMARY KEY,
  session_id TEXT,
  request_id TEXT,
  kind       TEXT NOT NULL,          -- http | status | observation
  data       JSONB NOT NULL DEFAULT '{}'::jsonb,
  at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS events_request ON wallet.events (request_id, seq);
CREATE INDEX IF NOT EXISTS events_session ON wallet.events (session_id, seq);
