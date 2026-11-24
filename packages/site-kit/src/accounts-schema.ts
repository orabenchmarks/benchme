import { checked } from "./ledger/schema.js";

/**
 * How many verification codes one pending sign-up may try. After that many wrong ones its code stops working, so a
 * six-digit code cannot be guessed: only a new code (a sign-up again) gives it more tries.
 */
export const CODE_ATTEMPTS = 5;

/**
 * The account tables' first change since every site created them (users, verification_codes, sessions: each app's
 * 001 migration): how many codes have been tried against a pending sign-up's code. Every app with sign-ups carries a
 * copy of this text for its own schema (`apps/<app>/migrations/*_verification_attempts.sql`), and a test holds every
 * copy to it, as the ledger's are.
 */
export function verificationAttemptsSql(schema: string): string {
  return `ALTER TABLE ${checked(schema)}.verification_codes ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;
`;
}

/** The account tables' migrations, in order: the file suffix each app names one with, and its text for that app's schema. */
export const ACCOUNT_MIGRATIONS: readonly { suffix: string; sql: (schema: string) => string }[] = [{ suffix: "verification_attempts", sql: verificationAttemptsSql }];
