-- sports: how many codes have been tried against a pending sign-up's verification code. After five wrong ones the
-- code no longer works (the site kit, packages/site-kit/src/accounts-schema.ts, holds this text to its own).
ALTER TABLE sports.verification_codes ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;
