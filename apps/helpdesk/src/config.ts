import { loadConfig } from "@benchme/core";
import { z } from "zod";

export const configSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  GATEWAY_SECRET: z.string().min(16),
  MAIL_URL: z.string().url(),
  MAIL_INTERNAL_SECRET: z.string().min(16),
  SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(8 * 3600),
  LOG_LEVEL: z.string().default("info"),
});
export type Config = z.infer<typeof configSchema>;
export const readConfig = (env: NodeJS.ProcessEnv = process.env): Config => loadConfig(configSchema, env);
