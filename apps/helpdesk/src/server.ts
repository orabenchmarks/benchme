import { createPool } from "@benchme/core";
import { scenarios } from "@benchme/scenarios";
import { HttpMailer } from "@benchme/site-kit";
import { buildHelpdesk } from "./build-app.js";
import { readConfig } from "./config.js";

const cfg = readConfig();
const pool = createPool(cfg.DATABASE_URL);
const app = await buildHelpdesk({
  pool,
  scenarios,
  mailer: new HttpMailer(cfg.MAIL_URL, cfg.MAIL_INTERNAL_SECRET, "no-reply@helpdesk.benchme"),
  gatewaySecret: cfg.GATEWAY_SECRET,
  sessionTtlSeconds: cfg.SESSION_TTL_SECONDS,
  logLevel: cfg.LOG_LEVEL,
});
const shutdown = async () => {
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
await app.listen({ port: cfg.PORT, host: "0.0.0.0" });
