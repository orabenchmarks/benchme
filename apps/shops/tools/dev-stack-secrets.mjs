/**
 * The secrets dev-stack.mjs runs its stack with.
 *
 * Fake mode runs on fixed development values (DEV, below): they are published with this file, and nothing they
 * protect is real. Stripe mode takes test payments, and then the shops service refuses published secrets
 * (src/config.ts): its internal secret (it reads every workspace's state, grading included) and its suffix key (it
 * decides which order numbers pass) are made fresh for every run, and the stack prints them in its JSON line.
 */
import { randomBytes } from "node:crypto";

/** Fixed development secrets (≥ 32 characters): nothing here protects anything real. */
export const DEV = Object.freeze({
  GATEWAY_SECRET: "dev-stack-gateway-secret-0123456789abcdef",
  OPERATOR_KEY: "dev-stack-operator-key-0123456789abcdef",
  RECEIPT_SECRET: "dev-stack-receipt-secret-0123456789abcdef",
  MAIL_INTERNAL_SECRET: "dev-stack-mail-internal-secret-0123456789",
  SHOPS_INTERNAL_SECRET: "dev-stack-shops-internal-secret-012345678",
  SHOPS_SUFFIX_KEY: "dev-stack-shops-suffix-key-0123456789abcdef",
});

/** A secret of 32 base64url characters (192 random bits). */
export const freshSecret = () => randomBytes(24).toString("base64url");

/**
 * The secrets of one run of the stack: DEV in fake mode; in Stripe mode DEV with a fresh SHOPS_INTERNAL_SECRET and
 * SHOPS_SUFFIX_KEY of its own.
 */
export function stackSecrets(payments, fresh = freshSecret) {
  return payments === "stripe" ? { ...DEV, SHOPS_INTERNAL_SECRET: fresh(), SHOPS_SUFFIX_KEY: fresh() } : { ...DEV };
}
