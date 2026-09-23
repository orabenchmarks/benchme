import { createPool, loadConfig } from "@benchme/core";
import { scenarios } from "@benchme/scenarios";
import { buildRanker, rankerEnvSchema } from "@benchme/site-kit";
import { z } from "zod";
import { buildVaultdocs } from "./build-app.js";

const configSchema = z
  .object({ PORT: z.coerce.number().int().positive().default(3000), DATABASE_URL: z.string().min(1), GATEWAY_SECRET: z.string().min(16), LOG_LEVEL: z.string().default("info") })
  .merge(rankerEnvSchema);
const cfg = loadConfig(configSchema);
const pool = createPool(cfg.DATABASE_URL);
const app = await buildVaultdocs({ pool, scenarios, gatewaySecret: cfg.GATEWAY_SECRET, logLevel: cfg.LOG_LEVEL, ranker: buildRanker(process.env) });
const shutdown = async () => {
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
await app.listen({ port: cfg.PORT, host: "0.0.0.0" });
