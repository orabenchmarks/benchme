-- The wallet stand-in binds a spend request made on a hosted payment page by that page's Checkout Session
-- (GET …/internal/wallet-matches?session=cs_…): a payment found by its processor id alone, across workspaces.
CREATE INDEX IF NOT EXISTS payments_ref ON shops.payments (payment_ref);
