import { loadConfig } from "@benchme/core";
import { z } from "zod";

const appTargets = z.record(z.string().min(1), z.string().url());

export const configSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  /** Signs the workspace header apps trust; shared with every app. */
  GATEWAY_SECRET: z.string().min(16),
  /** Lifts creation limits for the platform's own runs. */
  OPERATOR_KEY: z.string().min(16),
  /** Signs receipts (finalize, and later the verifier). */
  RECEIPT_SECRET: z.string().min(16),
  /** How the outside reaches this gateway; used to build the urls a workspace returns. */
  PUBLIC_BASE_URL: z.string().url(),
  /** In-cluster base URL harness pods use (defaults to PUBLIC_BASE_URL). */
  INTERNAL_BASE_URL: z.string().url().optional(),
  /** JSON: { warehouse: "http://warehouse:3000", mail: "http://mail:3000", data: "http://data:3000" } */
  APP_TARGETS: z.string().transform((s, ctx) => {
    try {
      return appTargets.parse(JSON.parse(s));
    } catch (e) {
      ctx.addIssue({ code: "custom", message: `APP_TARGETS must be a JSON object of app → url (${(e as Error).message})` });
      return z.NEVER;
    }
  }),
  /** Apps that receive a seed call on workspace creation (subset of APP_TARGETS keys). */
  SEEDED_APPS: z.string().default("warehouse,mail").transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean)),
  WORKSPACE_TTL_SECONDS: z.coerce.number().int().positive().default(86_400),
  WORKSPACE_MAX_TTL_SECONDS: z.coerce.number().int().positive().default(7 * 86_400),
  RATE_CREATE_PER_HOUR: z.coerce.number().int().positive().default(10),
  LOG_LEVEL: z.string().default("info"),
});

export type Config = z.infer<typeof configSchema>;

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return loadConfig(configSchema, env);
}
