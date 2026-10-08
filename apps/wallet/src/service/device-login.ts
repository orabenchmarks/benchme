import { randomBytes, randomInt } from "node:crypto";
import type { SessionsRepo } from "../db/sessions-repo.js";
import { OAuthError } from "../domain/link-errors.js";
import type { Session } from "../domain/types.js";

/**
 * link-cli's login: the OAuth 2.0 device authorization grant (RFC 8628) at LINK_AUTH_BASE_URL — `/device/code`,
 * then `/device/token` polled until approved, refresh at `/device/token`, `/device/revoke`. The wallet approves a
 * device itself `loginDelayMs` after it asks (DESIGN §4.2: login completes without a human), and each approval is a
 * new session: a run's requests are its own.
 */
export type DeviceLoginDeps = {
  sessions: SessionsRepo;
  now: () => Date;
  loginDelayMs: number;
  /** How long an access token lives before link-cli refreshes it. */
  accessTtlMs: number;
  /** How long a device code may be polled. */
  codeTtlMs: number;
};

const WORDS = ["amber", "birch", "cedar", "delta", "ember", "fjord", "grove", "harbor", "indigo", "juniper", "kelp", "lumen", "meadow", "nectar", "orchid", "pebble", "quartz", "river", "sable", "tidal", "umber", "violet", "willow", "zephyr"];
const phrase = () => Array.from({ length: 3 }, () => WORDS[randomInt(WORDS.length)]).join("-");
const token = (prefix: string) => `${prefix}_${randomBytes(24).toString("base64url")}`;

export type Tokens = { access_token: string; refresh_token: string; token_type: "Bearer"; expires_in: number; scope: string };

export class DeviceLogin {
  constructor(private readonly d: DeviceLoginDeps) {}

  /** POST /device/code. `verificationUri`: the wallet's own page where the phrase would be entered. */
  async start(form: Record<string, unknown>, verificationUri: string): Promise<Record<string, unknown>> {
    const deviceCode = token("ldc");
    const userCode = phrase();
    const clientName = typeof form.client_hint === "string" && form.client_hint ? form.client_hint : "Link CLI";
    await this.d.sessions.createDeviceCode(deviceCode, {
      userCode,
      clientName,
      connectionLabel: typeof form.connection_label === "string" ? form.connection_label : null,
      scope: typeof form.scope === "string" && form.scope.trim() ? form.scope.trim() : "userinfo:read payment_methods.agentic",
      expiresAt: new Date(this.d.now().getTime() + this.d.codeTtlMs),
    });
    return {
      device_code: deviceCode,
      user_code: userCode,
      verification_uri: verificationUri,
      verification_uri_complete: `${verificationUri}?code=${encodeURIComponent(userCode)}`,
      expires_in: Math.floor(this.d.codeTtlMs / 1000),
      interval: 2,
    };
  }

  /** POST /device/token: the device-code grant (once approved) or a refresh. Answers OAuth errors as RFC 8628 says. */
  async token(form: Record<string, unknown>): Promise<{ tokens: Tokens; session: Session }> {
    const grant = form.grant_type;
    if (grant === "refresh_token") return this.refresh(String(form.refresh_token ?? ""));
    if (grant !== "urn:ietf:params:oauth:grant-type:device_code") throw new OAuthError("unsupported_grant_type");
    const deviceCode = String(form.device_code ?? "");
    const code = deviceCode ? await this.d.sessions.deviceCode(deviceCode) : null;
    if (!code) throw new OAuthError("invalid_grant", "Unknown device code.");
    if (code.sessionId) throw new OAuthError("invalid_grant", "This device code was already used.");
    const now = this.d.now();
    if (now >= code.expiresAt) throw new OAuthError("expired_token");
    if (now.getTime() < code.createdAt.getTime() + this.d.loginDelayMs) throw new OAuthError("authorization_pending");
    const tokens = this.mint(code.scope);
    const session: Session = { id: `lwses_${randomBytes(12).toString("hex")}`, clientName: code.clientName, connectionLabel: code.connectionLabel, scope: code.scope, createdAt: now };
    const won = await this.d.sessions.exchange(deviceCode, { id: session.id, accessToken: tokens.access_token, refreshToken: tokens.refresh_token, accessExpiresAt: this.accessExpiry() }, code);
    if (!won) throw new OAuthError("invalid_grant", "This device code was already used.");
    return { tokens, session };
  }

  async revoke(form: Record<string, unknown>): Promise<void> {
    const t = String(form.token ?? "");
    if (t) await this.d.sessions.revoke(t);
  }

  authenticate(accessToken: string): Promise<Session | null> {
    return this.d.sessions.byAccessToken(accessToken, this.d.now());
  }

  private async refresh(refreshToken: string): Promise<{ tokens: Tokens; session: Session }> {
    if (!refreshToken) throw new OAuthError("invalid_request", "refresh_token is required.");
    const tokens = this.mint("");
    const session = await this.d.sessions.rotate(refreshToken, { accessToken: tokens.access_token, refreshToken: tokens.refresh_token, accessExpiresAt: this.accessExpiry() });
    if (!session) throw new OAuthError("invalid_grant", "The refresh token is unknown or was revoked.");
    return { tokens: { ...tokens, scope: session.scope }, session };
  }

  private mint(scope: string): Tokens {
    return { access_token: token("lat"), refresh_token: token("lrt"), token_type: "Bearer", expires_in: Math.floor(this.d.accessTtlMs / 1000), scope };
  }

  private accessExpiry(): Date {
    return new Date(this.d.now().getTime() + this.d.accessTtlMs);
  }
}
