/**
 * Errors in the shape Link's API answers them (Stripe's error object), which link-cli reads as
 * `error.message` (then `error.code`): `{ "error": { "type", "code", "message", "param"? } }`.
 * The device-login endpoints answer OAuth's own shape instead (`{ "error": "authorization_pending" }`):
 * see OAuthError.
 */
export type LinkErrorType = "invalid_request_error" | "authentication_error" | "rate_limit_error" | "api_error";

export class LinkError extends Error {
  constructor(
    readonly status: number,
    readonly type: LinkErrorType,
    readonly code: string,
    message: string,
    readonly param?: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "LinkError";
  }

  body(): { error: Record<string, unknown> } {
    return { error: { type: this.type, code: this.code, message: this.message, ...(this.param ? { param: this.param } : {}), ...this.extra } };
  }
}

export const invalid = (code: string, message: string, param?: string) => new LinkError(400, "invalid_request_error", code, message, param);

export const notFound = (what: string, id: string) => new LinkError(404, "invalid_request_error", "resource_missing", `No such ${what}: '${id}'`);

export const unauthenticated = () =>
  new LinkError(401, "authentication_error", "invalid_access_token", "Your access token is missing, expired or revoked. Run `link-cli auth login`.");

export const rateLimited = (message: string) => new LinkError(429, "rate_limit_error", "spend_request_rate_limited", message);

/** An OAuth 2.0 error (RFC 6749 §5.2 / RFC 8628 §3.5): `{ "error": "<code>", "error_description"? }`, 400 unless stated. */
export class OAuthError extends Error {
  constructor(
    readonly code: "authorization_pending" | "slow_down" | "expired_token" | "access_denied" | "invalid_grant" | "invalid_request" | "unsupported_grant_type",
    readonly description?: string,
    readonly status = 400,
  ) {
    super(description ?? code);
    this.name = "OAuthError";
  }

  body(): Record<string, string> {
    return { error: this.code, ...(this.description ? { error_description: this.description } : {}) };
  }
}
