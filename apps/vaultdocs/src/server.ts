import { createPool, loadConfig } from "@benchme/core";
import { scenarios } from "@benchme/scenarios";
import { buildRanker, defaultRankerRegistry, rankerEnvSchema } from "@benchme/site-kit";
import { z } from "zod";
import { buildVaultdocs } from "./build-app.js";

const configSchema = z
  .object({ PORT: z.coerce.number().int().positive().default(3000), DATABASE_URL: z.string().min(1), GATEWAY_SECRET: z.string().min(16), LOG_LEVEL: z.string().default("info") })
  .merge(rankerEnvSchema);
const cfg = loadConfig(configSchema);
const pool = createPool(cfg.DATABASE_URL);
// Same registry buildRanker uses, kept alive so an X-Ask-Ranker override can
// resolve any OTHER kind on demand — see ASK_RANKER_OVERRIDE in the README.
const rankerRegistry = defaultRankerRegistry();
const app = await buildVaultdocs({
  pool,
  scenarios,
  gatewaySecret: cfg.GATEWAY_SECRET,
  logLevel: cfg.LOG_LEVEL,
  ranker: buildRanker(process.env),
  // Eval-only per-request ranker override (tools/ask-eval.mjs); OFF unless the
  // deployment opts in. rankerFor returns undefined (→ 422 UNKNOWN_RANKER) for
  // a kind that's unregistered or missing its credentials, never throws.
  allowRankerOverride: process.env.ASK_RANKER_OVERRIDE === "1",
  rankerFor: (kind) => {
    try {
      return rankerRegistry.build(kind, process.env);
    } catch {
      return undefined;
    }
  },
});
const shutdown = async () => {
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
await app.listen({ port: cfg.PORT, host: "0.0.0.0" });
