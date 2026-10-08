import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import { createApp, type Pool } from "@benchme/core";
import { registerWorkspaceScope, type Mailer } from "@benchme/site-kit";
import type { ScenarioDef, ScenarioIndex, StoreDef, StoreId } from "@benchme/storefront";
import type { FastifyInstance } from "fastify";
import { createRepos, type StateRepo } from "./db/index.js";
import { NoApprovals, type ApprovalSource } from "./payments/approvals.js";
import { NoSpendControl, type SpendControl } from "./payments/spend-control.js";
import type { PaymentGateway } from "./payments/gateway.js";
import { registerSiteRoutes, type RouteDeps } from "./routes/index.js";
import { SITE_IDS, isSiteId, storeFor, type SiteId } from "./sites.js";
import { STORES } from "./stores/index.js";

declare module "fastify" {
  interface FastifyRequest {
    /** The site of an /s/:site request, resolved by the site scope before any handler runs. */
    site: SiteId;
    /** The site's catalogue: never null on a store's site (a store without one 404s), always null on paylantern. */
    store: StoreDef | null;
    /**
     * This workspace's scenario on this store: null without one, and always on paylantern.
     * Read from the store state on first call, then cached for the request — a handler
     * that records a campaign code does so before its first call.
     */
    scenario: () => Promise<ScenarioDef | null>;
  }
}

export type BuildDeps = {
  pool: Pool;
  gatewaySecret: string;
  /** Guards the internal read API (SHOPS_INTERNAL_SECRET). */
  internalSecret: string;
  /** Keys the order-number suffix (SHOPS_SUFFIX_KEY). */
  suffixKey: string;
  scenarios: ScenarioIndex;
  payments: PaymentGateway;
  /** Delivers to the workspace inbox; the sender of every site unless `mailerFor` gives one per site. */
  mailer: Mailer;
  logLevel?: string;
  /** The clock (store-local "today", delivery dates); tests pin it. Default: the real time. */
  now?: () => Date;
  /** A sender per site (server.ts: orders@<site>.example). Default: `mailer` for every site. */
  mailerFor?: (site: SiteId) => Mailer;
  /** The catalogues served. Default: STORES (src/stores/index.ts); tests serve fixture stores. */
  stores?: Partial<Record<StoreId, StoreDef>>;
  /** The wallet's approvals (server.ts: the wallet app, when WALLET_URL is set). Default: none known. */
  approvals?: ApprovalSource;
  /** The wallet's spend controls (server.ts: the wallet app, when WALLET_URL is set). Default: none — every payment is taken. */
  spendControl?: SpendControl;
};

/** Before a site is known there is no brand to render: a plain page, noindex like every other. */
const NOT_FOUND_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Page not found</title>
<style>body{font:16px/1.5 system-ui,sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;color:#1b1b1b;background:#fafafa}main{max-width:28rem;padding:1.5rem;text-align:center}h1{font-size:1.5rem;margin:0 0 .5rem}</style>
</head><body><main><h1>Page not found</h1><p>There is no shop at this address.</p></main></body></html>`;

/** The scenario a workspace's store runs: none on paylantern, none unknown to the scenario file, and never another store's. */
async function scenarioFor(state: StateRepo, scenarios: ScenarioIndex, ws: string, site: SiteId): Promise<ScenarioDef | null> {
  if (site === "paylantern" || !ws) return null;
  const { scenarioId } = await state.get(ws, site);
  const s = scenarioId ? scenarios.byId(scenarioId) : undefined;
  return s && s.store === site ? s : null;
}

/** Composition root: repos → the /s/:site scope (site, store, scenario) → the route modules. */
export async function buildShops(d: BuildDeps): Promise<FastifyInstance> {
  const repos = createRepos(d.pool);
  const stores = d.stores ?? STORES;
  const deps: RouteDeps = {
    pool: d.pool,
    repos,
    scenarios: d.scenarios,
    payments: d.payments,
    mailerFor: d.mailerFor ?? (() => d.mailer),
    gatewaySecret: d.gatewaySecret,
    internalSecret: d.internalSecret,
    suffixKey: d.suffixKey,
    approvals: d.approvals ?? new NoApprovals(),
    spendControl: d.spendControl ?? new NoSpendControl(),
    now: d.now ?? (() => new Date()),
  };

  const app = createApp({ name: "shops", readiness: async () => (await d.pool.query("SELECT 1")).rowCount === 1, ...(d.logLevel ? { logLevel: d.logLevel } : {}) });
  // Fictional stores: nothing they answer — pages, JSON, assets, errors — is for search engines.
  app.addHook("onSend", async (_req, reply, payload) => {
    reply.header("x-robots-tag", "noindex, nofollow");
    return payload;
  });
  await app.register(cookie);
  await app.register(formbody);
  // /s/<site>/internal/ authenticates on its own: the gateway's signature on its seed call, the internal secret on reads.
  registerWorkspaceScope(app, d.gatewaySecret, SITE_IDS.map((s) => `/s/${s}/internal/`));

  await app.register(
    async (scope) => {
      scope.decorateRequest("site");
      scope.decorateRequest("store");
      scope.decorateRequest("scenario");
      scope.addHook("onRequest", async (req, reply) => {
        const raw = (req.params as { site?: string }).site ?? "";
        const site = isSiteId(raw) ? raw : null;
        const store = site ? storeFor(site, stores) : null;
        if (!site || (site !== "paylantern" && !store)) return reply.code(404).type("text/html; charset=utf-8").send(NOT_FOUND_PAGE);
        req.site = site;
        req.store = store;
        let scenario: Promise<ScenarioDef | null> | undefined;
        req.scenario = () => (scenario ??= scenarioFor(repos.state, d.scenarios, req.workspaceId, site));
      });
      await registerSiteRoutes(scope, deps);
    },
    { prefix: "/s/:site" },
  );
  return app;
}
