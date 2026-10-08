-- Link's spend controls (apps/wallet service/payment-check.ts): a spend request's card pays once, and never above
-- its approved amount. used_by is the processor's id of the payment its card was accepted for, and used_at is when.
-- A second payment with the card is declined, and so is one above the approval.
ALTER TABLE wallet.spend_requests ADD COLUMN IF NOT EXISTS used_by TEXT;
ALTER TABLE wallet.spend_requests ADD COLUMN IF NOT EXISTS used_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS spend_requests_used_by ON wallet.spend_requests (used_by) WHERE used_by IS NOT NULL;
-- The approvals a payment may claim, and the expiries recently issued (a new card takes one no other has).
CREATE INDEX IF NOT EXISTS spend_requests_approved ON wallet.spend_requests (approved_at) WHERE approved_at IS NOT NULL;
