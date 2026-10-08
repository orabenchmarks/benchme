import { loadConfig } from "@benchme/core";
import { z } from "zod";
import { POLICIES } from "./policy/approval-policy.js";

const list = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

const origins = z.string().transform((s, ctx) =>
  list(s).map((o) => {
    try {
      return new URL(o).origin;
    } catch {
      ctx.addIssue({ code: "custom", message: `"${o}" is not a URL` });
      return z.NEVER;
    }
  }),
);

export const configSchema = z
  .object({
    PORT: z.coerce.number().int().positive().default(3000),
    DATABASE_URL: z.string().min(1),
    /** Guards /internal/* (the records, the approvals the stores read, the status control). */
    WALLET_INTERNAL_SECRET: z.string().min(16),
    /**
     * The gateway's secret (shared with every app): a request to the card-on-file door (<public>/w/<id>/wallet/card,
     * the gateway's unlisted `wallet` app) carries its workspace signed with it. Unset → the door is not served.
     */
    GATEWAY_SECRET: z.string().min(16).optional(),
    /** The approval policy (policy/approval-policy.ts POLICIES): lab | decline-all. */
    WALLET_POLICY: z.string().default("lab"),
    /** The stores' origins (comma list): a request paying anywhere else is declined under the lab policy. */
    WALLET_MERCHANT_ORIGINS: origins.default(""),
    /**
     * The hosted payment pages the stores send a shopper to (comma list): a request naming one is approved only when
     * its Checkout Session binds it to a store checkout.
     */
    WALLET_HOSTED_CHECKOUT_ORIGINS: origins.default("https://checkout.stripe.com"),
    /** The wallet's public URL (…/wallet); unset → derived from the gateway's forwarded headers. */
    WALLET_PUBLIC_URL: z.string().url().optional(),
    /** The shops app (in-cluster) and its internal secret: where a request's checkout is looked up. Unset → every request falls back. */
    SHOPS_URL: z.string().url().optional(),
    SHOPS_INTERNAL_SECRET: z.string().min(16).optional(),
    /** The store ids a merchant name or URL may name. */
    WALLET_STORES: z.string().default("wrenfield,halden,quillfeather").transform(list),
    /** How long after an approval request the policy answers (a person answering a push a moment later). */
    WALLET_APPROVAL_DELAY_MS: z.coerce.number().int().nonnegative().default(2000),
    /** How long after `auth login` the device counts as approved. */
    WALLET_LOGIN_DELAY_MS: z.coerce.number().int().nonnegative().default(0),
    /** Rule 2 of binding: open checkouts started within this many minutes. */
    WALLET_BINDING_WINDOW_MINUTES: z.coerce.number().int().positive().default(60),
    /** The wallet holder every issued card is billed to (fictional; Stripe test mode checks none of it). */
    WALLET_HOLDER_NAME: z.string().min(1).default("Morgan Avery"),
    WALLET_HOLDER_LINE1: z.string().min(1).default("500 Third St"),
    WALLET_HOLDER_CITY: z.string().min(1).default("San Francisco"),
    WALLET_HOLDER_STATE: z.string().min(1).default("CA"),
    WALLET_HOLDER_POSTAL_CODE: z.string().min(1).default("94107"),
    WALLET_HOLDER_COUNTRY: z.string().length(2).default("US"),
    /** The last four of the holder's saved (funding) card — never a card the wallet issues. */
    WALLET_FUNDING_LAST4: z.string().regex(/^\d{4}$/).default("8431"),
    LOG_LEVEL: z.string().default("info"),
  })
  .superRefine((c, ctx) => {
    if (!(c.WALLET_POLICY in POLICIES)) ctx.addIssue({ code: "custom", path: ["WALLET_POLICY"], message: `must be one of ${Object.keys(POLICIES).join(", ")}` });
    if (c.SHOPS_URL && !c.SHOPS_INTERNAL_SECRET) ctx.addIssue({ code: "custom", path: ["SHOPS_INTERNAL_SECRET"], message: "required with SHOPS_URL" });
  });

export type Config = z.infer<typeof configSchema>;

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return loadConfig(configSchema, env);
}
