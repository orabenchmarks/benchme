import { loadConfig } from "@benchme/core";
import { z } from "zod";

export const configSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  /** The gateway's secret: a page request carries its workspace signed with it. */
  GATEWAY_SECRET: z.string().min(16),
  /** Guards /internal/* (the page records and the edition corpus): the gateway's operator key. */
  GUIDE_OPERATOR_KEY: z.string().min(16),
  LOG_LEVEL: z.string().default("info"),
});
export type Config = z.infer<typeof configSchema>;
export const readConfig = (env: NodeJS.ProcessEnv = process.env): Config => loadConfig(configSchema, env);
