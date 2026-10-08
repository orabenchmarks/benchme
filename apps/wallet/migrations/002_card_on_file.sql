-- The card-on-file door (apps/wallet routes/card-on-file.ts): a run that pays without Link reads the buyer's saved
-- card at <public>/w/<workspaceId>/wallet/card. The card is the one the workspace's store scenario calls for, issued
-- the first time the door shows it and the same on every later read; a store's payment with it is a wallet card.

-- One card per workspace and kind (success | 3ds | decline): its number, CVC and expiry. Never in a record.
CREATE TABLE IF NOT EXISTS wallet.saved_cards (
  workspace_id TEXT NOT NULL,
  kind         TEXT NOT NULL,
  card         JSONB NOT NULL,
  issued_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, kind)
);

-- The stores of the workspace the door showed that card for (a store's payment with it counts as the wallet's).
CREATE TABLE IF NOT EXISTS wallet.saved_card_stores (
  workspace_id TEXT NOT NULL,
  kind         TEXT NOT NULL,
  store        TEXT NOT NULL,
  scenario_id  TEXT,
  shown_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, kind, store),
  FOREIGN KEY (workspace_id, kind) REFERENCES wallet.saved_cards (workspace_id, kind) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS saved_card_stores_store ON wallet.saved_card_stores (workspace_id, store);

-- Events about a workspace rather than a session or a request: every read of the door (kind card_on_file).
ALTER TABLE wallet.events ADD COLUMN IF NOT EXISTS workspace_id TEXT;
CREATE INDEX IF NOT EXISTS events_workspace ON wallet.events (workspace_id, seq) WHERE workspace_id IS NOT NULL;
