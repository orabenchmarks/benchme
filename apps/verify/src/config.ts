import { loadConfig } from "@benchme/core";
import { z } from "zod";

export const configSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  GATEWAY_SECRET: z.string().min(16),
  RECEIPT_SECRET: z.string().min(16),
  /** Directory of hidden task specs (<taskId>.json), baked from benchme-hidden. */
  SPECS_DIR: z.string().default("/specs"),
  MAX_ATTEMPTS_PER_TASK: z.coerce.number().int().positive().default(20),
  MAX_ARTIFACT_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
  /** Where runner Jobs are created (this namespace) and the SA/label they get. */
  RUNNER_NAMESPACE: z.string().default("benchme"),
  RUNNER_SERVICE_ACCOUNT: z.string().default("benchme-runner"),
  RUNNER_LABEL: z.string().default("runner"),
  RUNNER_CPU: z.string().default("2"),
  RUNNER_MEMORY: z.string().default("2Gi"),
  /** JSON: nodeSelector map / tolerations array applied to runner pods (the dedicated benchme pool). */
  RUNNER_NODE_SELECTOR: z.string().default("{}"),
  RUNNER_TOLERATIONS: z.string().default("[]"),
  LOG_LEVEL: z.string().default("info"),
});
export type Config = z.infer<typeof configSchema>;
export const readConfig = (env: NodeJS.ProcessEnv = process.env): Config => loadConfig(configSchema, env);
