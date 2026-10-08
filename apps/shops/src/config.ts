import { loadConfig } from "@benchme/core";
import { z } from "zod";

/**
 * A live Stripe key — secret, publishable or restricted — anywhere in a value
 * (padded, or inside a longer string), but not mid-word ("network_live_…").
 */
const LIVE_KEY = /(?<![A-Za-z0-9])(?:sk|pk|rk)_live_[A-Za-z0-9]/;
const LIVE_REFUSED = "live Stripe keys are refused — test mode only";

const fields = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  /** Verifies the gateway's workspace header; shared with the gateway. */
  GATEWAY_SECRET: z.string().min(16),
  /** Where order confirmations are delivered (the mail app's internal endpoint base). */
  MAIL_URL: z.string().url(),
  /** Presented to the mail app on /internal/deliver. */
  MAIL_INTERNAL_SECRET: z.string().min(16),
  /** Presented by the audit and the integrity tools on /s/<site>/internal/… reads of a workspace. */
  SHOPS_INTERNAL_SECRET: z.string().min(16),
  /** Keys the order-number suffix that encodes the outcome class: a deployment secret, never committed. */
  SHOPS_SUFFIX_KEY: z.string().min(16),
  /** `stripe` (Stripe test mode) or `fake` (in-process; tests and local stacks need no keys). */
  SHOPS_PAYMENTS: z.enum(["stripe", "fake"]).default("fake"),
  /** Test-mode keys only (sk_test_… / pk_test_…); required when SHOPS_PAYMENTS=stripe. */
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  /**
   * The wallet stand-in (apps/wallet, in-cluster) and its internal secret: where an order's charge is checked against
   * what the shopper's wallet approved ("paid above approval"). Unset: no approval is known and none is checked.
   */
  WALLET_URL: z.string().url().optional(),
  WALLET_INTERNAL_SECRET: z.string().min(16).optional(),
  /** The hidden scenario file built from benchme-hidden. Unset: no scenarios, every workspace runs no_scenario. */
  SHOPS_SCENARIOS_FILE: z.string().optional(),
  /** Connections of the service's Postgres pool. */
  SHOPS_DB_POOL_MAX: z.coerce.number().int().positive().default(10),
  /** How long a request waits for a free connection before it fails (ms): a page errors instead of hanging. */
  SHOPS_DB_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
  LOG_LEVEL: z.string().default("info"),
});

/**
 * Secrets published with the code: the placeholder every secret default in compose.yaml and .env.example carries
 * ("benchme-local-shops-secret-change-me", "benchme-local-suffix-key-change-me"), and the fixed development values
 * of apps/shops/tools/dev-stack.mjs ("dev-stack-shops-…"; its Stripe mode makes fresh ones for every run). Fine for
 * a laptop or CI on fake payments, never for a stack taking payments.
 */
const PUBLISHED = /change-?me|^dev-stack-/i;
const PUBLISHED_SECRETS = ["SHOPS_INTERNAL_SECRET", "SHOPS_SUFFIX_KEY"] as const;

function requireTestKey(ctx: z.RefinementCtx, key: string, value: string | undefined, prefix: string): void {
  if (!value) ctx.addIssue({ code: "custom", path: [key], message: "required when SHOPS_PAYMENTS=stripe" });
  else if (LIVE_KEY.test(value)) return; // already refused as live, without echoing it
  else if (!value.startsWith(prefix)) ctx.addIssue({ code: "custom", path: [key], message: `must be a test-mode key (${prefix}…)` });
}

/**
 * No live Stripe key, ever: refused in any field, in either payments mode. With SHOPS_PAYMENTS=stripe the
 * internal secret (it reads every workspace's state, grading included) and the suffix key (it decides
 * which order numbers pass) must be the deployment's own, not the published placeholders or the dev stack's
 * fixed values. Messages name the variable, never the value.
 */
export const configSchema = fields.superRefine((c, ctx) => {
  for (const [key, value] of Object.entries(c)) {
    if (typeof value === "string" && LIVE_KEY.test(value)) ctx.addIssue({ code: "custom", path: [key], message: LIVE_REFUSED });
  }
  if (c.WALLET_URL && !c.WALLET_INTERNAL_SECRET) ctx.addIssue({ code: "custom", path: ["WALLET_INTERNAL_SECRET"], message: "required with WALLET_URL" });
  if (c.SHOPS_PAYMENTS === "stripe") {
    requireTestKey(ctx, "STRIPE_SECRET_KEY", c.STRIPE_SECRET_KEY, "sk_test_");
    requireTestKey(ctx, "STRIPE_PUBLISHABLE_KEY", c.STRIPE_PUBLISHABLE_KEY, "pk_test_");
    for (const key of PUBLISHED_SECRETS) {
      if (PUBLISHED.test(c[key])) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: "is a published default (compose's …change-me, or the dev stack's fixed value): set a private value of your own when SHOPS_PAYMENTS=stripe",
        });
      }
    }
  }
});

export type Config = z.infer<typeof configSchema>;

/**
 * Reads the config and also refuses to boot when ANY other variable of the
 * environment carries a live Stripe key (a STRIPE_RESTRICTED_KEY the app never
 * reads is still a deployment wired to a live account).
 */
export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const elsewhere = Object.entries(env)
    .filter(([key, value]) => !(key in fields.shape) && typeof value === "string" && LIVE_KEY.test(value))
    .map(([key]) => `${key}: ${LIVE_REFUSED}`);
  if (elsewhere.length) throw new Error(`invalid configuration:\n  ${elsewhere.join("\n  ")}`);
  return loadConfig(configSchema, env);
}
