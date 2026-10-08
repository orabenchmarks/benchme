import { createPool } from "@benchme/core";
import { HttpCheckoutDirectory, NoCheckoutDirectory, type CheckoutDirectory } from "./binding/checkout-directory.js";
import { buildWallet } from "./build-app.js";
import { readConfig, type Config } from "./config.js";
import { policyFor } from "./policy/approval-policy.js";

function directoryFor(cfg: Config): CheckoutDirectory {
  return cfg.SHOPS_URL ? new HttpCheckoutDirectory(cfg.SHOPS_URL, cfg.SHOPS_INTERNAL_SECRET ?? "") : new NoCheckoutDirectory();
}

const cfg = readConfig();
const pool = createPool(cfg.DATABASE_URL);
const app = await buildWallet({
  pool,
  internalSecret: cfg.WALLET_INTERNAL_SECRET,
  policy: policyFor(cfg.WALLET_POLICY, { merchantOrigins: cfg.WALLET_MERCHANT_ORIGINS }),
  directory: directoryFor(cfg),
  stores: cfg.WALLET_STORES,
  account: {
    holder: {
      name: cfg.WALLET_HOLDER_NAME,
      line1: cfg.WALLET_HOLDER_LINE1,
      city: cfg.WALLET_HOLDER_CITY,
      state: cfg.WALLET_HOLDER_STATE,
      postalCode: cfg.WALLET_HOLDER_POSTAL_CODE,
      country: cfg.WALLET_HOLDER_COUNTRY,
    },
    fundingLast4: cfg.WALLET_FUNDING_LAST4,
  },
  approvalDelayMs: cfg.WALLET_APPROVAL_DELAY_MS,
  loginDelayMs: cfg.WALLET_LOGIN_DELAY_MS,
  bindingWindowMinutes: cfg.WALLET_BINDING_WINDOW_MINUTES,
  publicUrl: cfg.WALLET_PUBLIC_URL ?? null,
  logLevel: cfg.LOG_LEVEL,
});
app.log.info(
  { policy: cfg.WALLET_POLICY, merchantOrigins: cfg.WALLET_MERCHANT_ORIGINS, shops: cfg.SHOPS_URL ?? null, approvalDelayMs: cfg.WALLET_APPROVAL_DELAY_MS },
  cfg.SHOPS_URL ? "wallet: binding requests to the stores' checkouts" : "wallet: no SHOPS_URL — every request falls back to the plain success card",
);

const shutdown = async () => {
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
await app.listen({ port: cfg.PORT, host: "0.0.0.0" });
