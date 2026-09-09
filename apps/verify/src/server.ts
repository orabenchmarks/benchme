import { HmacReceiptSigner, createPool } from "@benchme/core";
import { buildVerify } from "./build-app.js";
import { readConfig } from "./config.js";
import { createRunner } from "./oracles/runner-factory.js";
import { FsSpecRegistry } from "./specs/spec.js";

const cfg = readConfig();
const pool = createPool(cfg.DATABASE_URL);
const specs = new FsSpecRegistry(cfg.SPECS_DIR);
const { app } = await buildVerify({
  pool,
  specs,
  receipts: new HmacReceiptSigner(cfg.RECEIPT_SECRET),
  runner: createRunner(cfg),
  gatewaySecret: cfg.GATEWAY_SECRET,
  maxAttemptsPerTask: cfg.MAX_ATTEMPTS_PER_TASK,
  maxArtifactBytes: cfg.MAX_ARTIFACT_BYTES,
  logLevel: cfg.LOG_LEVEL,
});
app.log.info({ specs: await specs.count(), dir: cfg.SPECS_DIR, runner: cfg.RUNNER_KIND }, "task specs loaded");
const shutdown = async () => {
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
await app.listen({ port: cfg.PORT, host: "0.0.0.0" });
