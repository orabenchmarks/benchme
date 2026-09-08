import { loadConfig } from "@benchme/core";
import { z } from "zod";

export const configSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  /** Verifies the gateway's workspace header; shared with the gateway. */
  GATEWAY_SECRET: z.string().min(16),
  /** Where verification mail is delivered (the mail app's internal endpoint base). */
  MAIL_URL: z.string().url(),
  /** Presented to the mail app on /internal/deliver. */
  MAIL_INTERNAL_SECRET: z.string().min(16),
  SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(8 * 3600),
  LOG_LEVEL: z.string().default("info"),
});

export type Config = z.infer<typeof configSchema>;

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return loadConfig(configSchema, env);
}
