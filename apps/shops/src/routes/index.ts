import type { Pool } from "@benchme/core";
import type { Mailer } from "@benchme/site-kit";
import type { ScenarioIndex } from "@benchme/storefront";
import type { FastifyInstance } from "fastify";
import type { Repos } from "../db/index.js";
import type { ApprovalSource } from "../payments/approvals.js";
import type { PaymentGateway } from "../payments/gateway.js";
import type { SpendControl } from "../payments/spend-control.js";
import { notFoundPage } from "../render/pages/not-found.js";
import type { SiteId } from "../sites.js";
import { registerAssetRoutes } from "./assets.js";
import { registerCartRoutes } from "./cart.js";
import { registerCheckoutRoutes } from "./checkout.js";
import { registerInternalRoutes } from "./internal.js";
import { registerOrderRoutes } from "./orders.js";
import { registerPayRoutes } from "./pay.js";
import { registerPaylanternRoutes } from "./paylantern.js";
import { registerWalletRoutes } from "./wallet.js";
import { pageCtx, registerCampaignHook, registerStorefrontRoutes, sendHtml, wantsJson } from "./storefront.js";

/**
 * What every route module of the /s/:site scope is given. Its requests arrive
 * decorated by the scope (build-app.ts): `req.site`, `req.store` (null only on
 * paylantern), `req.scenario()`, plus the gateway's `req.workspaceId` / `req.prefix`.
 */
export type RouteDeps = {
  pool: Pool;
  repos: Repos;
  scenarios: ScenarioIndex;
  payments: PaymentGateway;
  /** The sender of a site's mail: an order confirmation comes from its store. */
  mailerFor: (site: SiteId) => Mailer;
  gatewaySecret: string;
  internalSecret: string;
  suffixKey: string;
  /** What the shopper's wallet approved for a store: the amount an order's charge is held against. */
  approvals: ApprovalSource;
  /** Link's spend controls: asked before a store takes an authorized payment (routes/authorization.ts). */
  spendControl: SpendControl;
  now: () => Date;
};

/**
 * The one place route modules are registered, inside the /s/:site scope: their
 * paths are relative to the site ("/cart" serves /s/<site>/cart). The storefront,
 * the cart, the checkout steps, paying, orders, PayLantern and the internal API are
 * each a module here; a new one is added here too, not in build-app.ts.
 *
 * A store's route answers paylantern with `reply.callNotFound()` (and a paylantern
 * route answers a store the same way): the sites share one scope, so a path is
 * one route for all four. Pages render through render/layout.ts with the context
 * from storefront.ts `pageCtx(req, deps)`; send them with `sendHtml(reply, html)`.
 */
export async function registerSiteRoutes(scope: FastifyInstance, deps: RouteDeps): Promise<void> {
  registerInternalRoutes(scope, deps);
  registerWalletRoutes(scope, deps);
  // utm_campaign on any storefront GET, before any handler reads req.scenario().
  registerCampaignHook(scope, deps);
  registerAssetRoutes(scope);
  registerStorefrontRoutes(scope, deps);
  registerCartRoutes(scope, deps);
  registerCheckoutRoutes(scope, deps);
  registerPayRoutes(scope, deps);
  registerOrderRoutes(scope, deps);
  registerPaylanternRoutes(scope, deps);

  // The site's own 404 (once per scope — Fastify refuses a second): branded on a store, plain on
  // paylantern, JSON for a script that asked for JSON. The scope's hook has set req.site/req.store.
  scope.setNotFoundHandler(async (req, reply) => {
    if (wantsJson(req)) return reply.code(404).send({ error: "NOT_FOUND", message: "There is nothing at this address." });
    return sendHtml(reply, notFoundPage(await pageCtx(req, deps)), 404);
  });
}
