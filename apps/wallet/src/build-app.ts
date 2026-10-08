import formbody from "@fastify/formbody";
import { createApp, type Pool } from "@benchme/core";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { Binder, ExactAmountRule, HostedSessionRule, WorkspacePathRule } from "./binding/binder.js";
import type { CheckoutDirectory } from "./binding/checkout-directory.js";
import { EventsRepo } from "./db/events-repo.js";
import { RequestsRepo } from "./db/requests-repo.js";
import { SavedCardsRepo } from "./db/saved-cards-repo.js";
import { SessionsRepo } from "./db/sessions-repo.js";
import { LINK_TIMING } from "./domain/lifecycle.js";
import { LinkError, OAuthError } from "./domain/link-errors.js";
import type { ApprovalPolicy } from "./policy/approval-policy.js";
import { registerApiRoutes } from "./routes/api.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerCardOnFile } from "./routes/card-on-file.js";
import type { RouteDeps } from "./routes/deps.js";
import { registerInternalRoutes } from "./routes/internal.js";
import { registerPages } from "./routes/pages.js";
import { registerRecorder } from "./routes/recorder.js";
import type { Account } from "./service/account.js";
import { CardOnFileService } from "./service/card-on-file.js";
import { DeviceLogin } from "./service/device-login.js";
import { PaymentCheck } from "./service/payment-check.js";
import { LINK_LIMITS, SpendRequestService, type Limits } from "./service/spend-requests.js";

export type BuildDeps = {
  pool: Pool;
  internalSecret: string;
  /** The gateway's secret (GATEWAY_SECRET): serves the card-on-file door at /w/<id>/wallet/card. Unset → no door. */
  gatewaySecret?: string | null;
  policy: ApprovalPolicy;
  directory: CheckoutDirectory;
  stores: readonly string[];
  account: Account;
  approvalDelayMs: number;
  loginDelayMs: number;
  bindingWindowMinutes: number;
  /** How long a decision waits for stores that cannot be asked before it denies the request, flagged (default 60 s). */
  bindingRetryMs?: number;
  publicUrl?: string | null;
  limits?: Limits;
  /** The clock; tests move it. */
  now?: () => Date;
  logLevel?: string;
};

/** Composition root: repositories → binder, policy and lifecycle → the route modules; Link-shaped errors. */
export async function buildWallet(d: BuildDeps): Promise<FastifyInstance> {
  const now = d.now ?? (() => new Date());
  const sessions = new SessionsRepo(d.pool);
  const requests = new RequestsRepo(d.pool);
  const events = new EventsRepo(d.pool);
  const savedCards = new SavedCardsRepo(d.pool);
  const binder = new Binder([new WorkspacePathRule(d.directory), new HostedSessionRule(d.directory), new ExactAmountRule(d.directory, d.bindingWindowMinutes)], d.stores);
  const spendRequests = new SpendRequestService({
    requests,
    events,
    binder,
    policy: d.policy,
    timing: { ...LINK_TIMING, approvalDelayMs: d.approvalDelayMs },
    limits: d.limits ?? LINK_LIMITS,
    bindingRetryMs: d.bindingRetryMs ?? 60_000,
    claimWindowMs: d.bindingWindowMinutes * 60_000,
    now,
  });
  const cardOnFile = new CardOnFileService({ directory: d.directory, cards: savedCards, events, now });
  const deps: RouteDeps = {
    login: new DeviceLogin({ sessions, now, loginDelayMs: d.loginDelayMs, accessTtlMs: 12 * 3_600_000, codeTtlMs: 15 * 60_000 }),
    spendRequests,
    cardOnFile,
    payments: new PaymentCheck(spendRequests, cardOnFile, events),
    requests,
    savedCards,
    events,
    account: d.account,
    internalSecret: d.internalSecret,
    gatewaySecret: d.gatewaySecret ?? null,
    publicUrl: d.publicUrl ?? null,
    now,
  };

  const app = createApp({ name: "wallet", readiness: async () => (await d.pool.query("SELECT 1")).rowCount === 1, ...(d.logLevel ? { logLevel: d.logLevel } : {}) });
  app.addHook("onSend", async (_req, reply, payload) => {
    reply.header("x-robots-tag", "noindex, nofollow");
    return payload;
  });
  app.decorateRequest("walletSession", null);
  await app.register(formbody);
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof LinkError || err instanceof OAuthError) return reply.code(err.status).send(err.body());
    if (err instanceof ZodError) return reply.code(400).send(new LinkError(400, "invalid_request_error", "parameter_invalid", err.issues[0]?.message ?? "Invalid request.").body());
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) req.log.error({ err }, "unhandled error");
    return reply.code(status).send(new LinkError(status, status >= 500 ? "api_error" : "invalid_request_error", status >= 500 ? "internal_error" : "invalid_request", status >= 500 ? "Something went wrong on our end." : (err as Error).message).body());
  });
  app.setNotFoundHandler(async (_req, reply) => reply.code(404).send(new LinkError(404, "invalid_request_error", "feature_unavailable", "This feature is not available for this account.").body()));

  registerRecorder(app, events);
  registerAuthRoutes(app, deps);
  registerApiRoutes(app, deps);
  registerPages(app, deps);
  registerCardOnFile(app, deps);
  registerInternalRoutes(app, deps);
  return app;
}
