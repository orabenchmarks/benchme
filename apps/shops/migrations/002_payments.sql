-- shops 002: what each payment of a checkout pays for, and what an order was charged.
--
-- A payment is a PaymentIntent (the card surfaces) or a hosted Checkout Session. Its row holds a
-- snapshot of the checkout as it stood when the payment's amount was set — an intent's on every
-- attempt (created, or brought in line with the checkout), a session's when it is created — and an
-- order is built from the snapshot of the payment that went through, never from the live cart: a
-- session paid from browser history after the cart or the add-ons changed is recorded, and graded,
-- as what it charged for.
--
-- status: open (it may still go through), paid (its order exists; paid_ref is the order's payment
-- ref, a session's PaymentIntent), expired (a session superseded by a newer one of its checkout,
-- which the processor no longer takes).
CREATE TABLE IF NOT EXISTS shops.payments (
  workspace_id   TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  payment_ref    TEXT NOT NULL,                  -- the processor's id: pi_… (intent) or cs_… (session)
  checkout_token TEXT NOT NULL,
  store          TEXT NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('intent', 'session')),
  amount_cents   INTEGER NOT NULL,
  snapshot       JSONB NOT NULL,                 -- { lines, addOns, shippingId, promo, marketing, newsletter, delivery, totals, informationDate }
  status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid', 'expired')),
  paid_ref       TEXT,
  client_secret  TEXT,                           -- an intent's, handed to the next attempt of its checkout; never served elsewhere
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, payment_ref)
);
-- What every payment start reads first: the store's payments that may have gone through unseen.
CREATE INDEX IF NOT EXISTS payments_open ON shops.payments (workspace_id, store, created_at) WHERE status = 'open';

-- What the processor charged for the order (the snapshot's total, unless the two ever disagree).
ALTER TABLE shops.orders ADD COLUMN IF NOT EXISTS charged_cents INTEGER;
