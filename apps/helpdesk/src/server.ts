import { createPool } from "@benchme/core";
import { scenarios } from "@benchme/scenarios";
import { HttpMailer, buildRanker, defaultRankerRegistry } from "@benchme/site-kit";
import { buildHelpdesk } from "./build-app.js";
import { readConfig } from "./config.js";

const cfg = readConfig();
const pool = createPool(cfg.DATABASE_URL);
// Same registry buildRanker uses, kept alive so an X-Ask-Ranker override can
// resolve any OTHER kind on demand — see ASK_RANKER_OVERRIDE in the README.
const rankerRegistry = defaultRankerRegistry();
const app = await buildHelpdesk({
  pool,
  scenarios,
  mailer: new HttpMailer(cfg.MAIL_URL, cfg.MAIL_INTERNAL_SECRET, "no-reply@helpdesk.benchme"),
  gatewaySecret: cfg.GATEWAY_SECRET,
  sessionTtlSeconds: cfg.SESSION_TTL_SECONDS,
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
