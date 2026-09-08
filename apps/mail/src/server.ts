import { createPool } from "@benchme/core";
import { buildMail } from "./build-app.js";
import { readConfig } from "./config.js";

const cfg = readConfig();
const pool = createPool(cfg.DATABASE_URL);
const app = await buildMail({ pool, gatewaySecret: cfg.GATEWAY_SECRET, internalSecret: cfg.MAIL_INTERNAL_SECRET, logLevel: cfg.LOG_LEVEL });
const shutdown = async () => {
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
await app.listen({ port: cfg.PORT, host: "0.0.0.0" });
