import { HmacReceiptSigner, createPool, createRedis } from "@benchme/core";
import { scenarios } from "@benchme/scenarios";
import { AppRegistry } from "./app-registry.js";
import { buildGateway } from "./build-app.js";
import { readConfig } from "./config.js";
import { RedisRateLimiter } from "./rate-limit.js";
import { HttpWorkspaceSeeder } from "./seeder.js";

const cfg = readConfig();
const pool = createPool(cfg.DATABASE_URL);
const redis = createRedis(cfg.REDIS_URL);
const apps = new AppRegistry(cfg.APP_TARGETS, cfg.SEEDED_APPS, cfg.MCP_APPS);

const { app } = await buildGateway({
  pool,
  scenarios,
  apps,
  seeder: new HttpWorkspaceSeeder(apps.seeded(), cfg.GATEWAY_SECRET),
  receipts: new HmacReceiptSigner(cfg.RECEIPT_SECRET),
  limiter: new RedisRateLimiter(redis, cfg.RATE_CREATE_PER_HOUR, 3600),
  gatewaySecret: cfg.GATEWAY_SECRET,
  operatorKey: cfg.OPERATOR_KEY,
  publicBaseUrl: cfg.PUBLIC_BASE_URL,
  internalBaseUrl: cfg.INTERNAL_BASE_URL ?? cfg.PUBLIC_BASE_URL,
  defaultTtlSeconds: cfg.WORKSPACE_TTL_SECONDS,
  maxTtlSeconds: cfg.WORKSPACE_MAX_TTL_SECONDS,
  logLevel: cfg.LOG_LEVEL,
});

const shutdown = async () => {
  await app.close();
  await pool.end();
  redis.disconnect();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

await app.listen({ port: cfg.PORT, host: "0.0.0.0" });
