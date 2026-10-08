import type { FastifyRequest } from "fastify";
import { timingSafeEqual } from "node:crypto";
import type { EventsRepo } from "../db/events-repo.js";
import type { RequestsRepo } from "../db/requests-repo.js";
import type { Session } from "../domain/types.js";
import type { Account } from "../service/account.js";
import type { DeviceLogin } from "../service/device-login.js";
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
  requests: RequestsRepo;
  events: EventsRepo;
  account: Account;
  internalSecret: string;
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
