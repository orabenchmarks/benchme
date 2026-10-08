import { WORKSPACE_HEADER, WORKSPACE_SIG_HEADER, isWorkspaceId, verifyWorkspaceHeader } from "@benchme/core";
import type { FastifyRequest } from "fastify";
import { timingSafeEqual } from "node:crypto";
import type { EventsRepo } from "../db/events-repo.js";
import type { RequestsRepo } from "../db/requests-repo.js";
import type { SavedCardsRepo } from "../db/saved-cards-repo.js";
import type { Session } from "../domain/types.js";
import type { Account } from "../service/account.js";
import type { CardOnFileService } from "../service/card-on-file.js";
import type { DeviceLogin } from "../service/device-login.js";
import type { PaymentCheck } from "../service/payment-check.js";
import type { SpendRequestService } from "../service/spend-requests.js";

declare module "fastify" {
  interface FastifyRequest {
    /** The session of an /api request's bearer token, set by the api scope before any handler runs. */
    walletSession: Session | null;
  }
}

/** What every route module is given. */
export type RouteDeps = {
  login: DeviceLogin;
  spendRequests: SpendRequestService;
  /** The card-on-file door: the saved card a run that pays without Link reads. */
  cardOnFile: CardOnFileService;
  /** What a store reads when it classes a payment (spend requests and the door's card). */
  payments: PaymentCheck;
  requests: RequestsRepo;
  savedCards: SavedCardsRepo;
  events: EventsRepo;
  account: Account;
  internalSecret: string;
  /** The gateway's secret, which signs the workspace of a /w/<id>/wallet/* request; null → no workspace door is served. */
  gatewaySecret: string | null;
  /** The wallet's public base URL (approval and verification links); unset → read off the gateway's forwarded headers. */
  publicUrl: string | null;
  now: () => Date;
};

function first(req: FastifyRequest, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Where a shopper reaches the wallet: the configured public URL, else what the gateway forwards — its public host
 * and scheme, and the prefix it stripped (/wallet) — so links work behind it and on a bare local port alike.
 */
export function publicBase(req: FastifyRequest, configured: string | null): string {
  if (configured) return configured.replace(/\/+$/, "");
  const host = first(req, "x-forwarded-host") ?? req.headers.host ?? "localhost";
  const proto = first(req, "x-forwarded-proto") ?? "http";
  const prefix = (first(req, "x-forwarded-prefix") ?? "").replace(/\/+$/, "");
  return `${proto}://${host}${prefix}`;
}

/** The internal secret, compared in constant time. */
export function hasInternalSecret(req: FastifyRequest, secret: string): boolean {
  const given = Buffer.from(first(req, "x-benchme-internal-secret") ?? "");
  const want = Buffer.from(secret);
  return given.length === want.length && timingSafeEqual(given, want);
}

/** The bearer token of an Authorization header, or null. */
export function bearer(req: FastifyRequest): string | null {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(first(req, "authorization") ?? "");
  return m ? (m[1] as string) : null;
}

/**
 * The workspace a request came through the gateway for (/w/<id>/wallet/* → the gateway's signed header), or null
 * when it carries none or a bad signature — a client never names its own workspace.
 */
export function signedWorkspace(req: FastifyRequest, gatewaySecret: string): string | null {
  const id = first(req, WORKSPACE_HEADER);
  const sig = first(req, WORKSPACE_SIG_HEADER);
  return id && isWorkspaceId(id) && sig && verifyWorkspaceHeader(gatewaySecret, id, sig) ? id : null;
}
