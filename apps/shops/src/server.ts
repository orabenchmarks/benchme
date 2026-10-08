import { HttpMailer } from "@benchme/site-kit";
import { buildShops } from "./build-app.js";
import { readConfig, type Config } from "./config.js";
import { shopsPool } from "./db/pool.js";
import { FakePaymentGateway } from "./payments/fake-gateway.js";
import type { PaymentGateway } from "./payments/gateway.js";
import { StripePaymentGateway } from "./payments/stripe-gateway.js";
import { loadScenarioIndex } from "./sites.js";

function paymentsFor(cfg: Config): PaymentGateway {
  if (cfg.SHOPS_PAYMENTS === "fake") return new FakePaymentGateway();
  // readConfig has required both keys and refused any live one; the gateway checks the test prefixes again.
  return new StripePaymentGateway(cfg.STRIPE_SECRET_KEY ?? "", cfg.STRIPE_PUBLISHABLE_KEY ?? "");
}

const cfg = readConfig();
// Before the pool: a missing or invalid scenario file stops the boot.
const scenarios = loadScenarioIndex(cfg.SHOPS_SCENARIOS_FILE);
const payments = paymentsFor(cfg);
// A request that cannot get a connection within the wait limit fails instead of hanging (no payment step holds one
// while it waits on Stripe: db/claims.ts).
const pool = shopsPool(cfg.DATABASE_URL, { max: cfg.SHOPS_DB_POOL_MAX, connectionTimeoutMillis: cfg.SHOPS_DB_CONNECT_TIMEOUT_MS });
const app = await buildShops({
  pool,
  gatewaySecret: cfg.GATEWAY_SECRET,
  internalSecret: cfg.SHOPS_INTERNAL_SECRET,
  suffixKey: cfg.SHOPS_SUFFIX_KEY,
  scenarios,
  payments,
  mailer: new HttpMailer(cfg.MAIL_URL, cfg.MAIL_INTERNAL_SECRET, "orders@shops.example"),
  // Each store's confirmation comes from the store itself.
  mailerFor: (site) => new HttpMailer(cfg.MAIL_URL, cfg.MAIL_INTERNAL_SECRET, `orders@${site}.example`),
  logLevel: cfg.LOG_LEVEL,
});
if (cfg.SHOPS_SCENARIOS_FILE) app.log.info({ file: cfg.SHOPS_SCENARIOS_FILE, scenarios: scenarios.list().length }, "scenarios loaded from SHOPS_SCENARIOS_FILE");
else app.log.info("no SHOPS_SCENARIOS_FILE: no scenarios, every workspace runs no_scenario");
app.log.info({ payments: payments.mode }, payments.mode === "stripe" ? "payments: Stripe test mode" : "payments: in-process fake");

const shutdown = async () => {
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
await app.listen({ port: cfg.PORT, host: "0.0.0.0" });
