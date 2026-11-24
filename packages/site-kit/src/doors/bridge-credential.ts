import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * The cookie a page's WebMCP bridge proves itself with. One name for every
 * site: each site sets it on its own path, so a browser sends each site only
 * its own.
 */
export const BRIDGE_COOKIE = "benchme_bridge";
/** The header the bridge sends its token in, on every tool call it makes. */
export const BRIDGE_TOKEN_HEADER = "x-benchme-bridge";

/** What a bridge cookie looks like as a site mints one: 128 random bits in hex. Anything else a request carries under the name is not one. */
const COOKIE_VALUE = /^[0-9a-f]{32}$/;

/** The token a page embeds for the bridge cookie `cookie`: an HMAC with the gateway secret over the workspace and the cookie. */
export function bridgeToken(secret: string, workspaceId: string, cookie: string): string {
  return createHmac("sha256", secret).update(`bridge:${workspaceId}:${cookie}`).digest("hex");
}

/**
 * One request's bridge credential: the bridge cookie it carries, and the
 * token a page embeds for that cookie.
 *
 * A page the site renders with the WebMCP door open embeds a token for the
 * browser's bridge cookie (minting the cookie when the request carried none,
 * so that several tabs share one), and the page's bridge sends that token back
 * on every call to /mcp. A call is the page's bridge only when its token is
 * the one for the cookie the same request carries. The cookie is HttpOnly, so
 * neither a page's scripts nor whoever reads the page's HTML can read it:
 * a token copied out of a page, or a header copied from the bridge, proves
 * nothing without the cookie jar the page was served to.
 */
export class BridgeCredential {
  private minted: string | undefined;

  private constructor(
    private readonly secret: string,
    private readonly workspaceId: string,
    private readonly carried: string | undefined,
  ) {}

  /** The credential of a request for `workspaceId`, read from its Cookie header. */
  static of(secret: string, workspaceId: string, cookieHeader: string | undefined): BridgeCredential {
    const value = cookieValue(cookieHeader, BRIDGE_COOKIE);
    return new BridgeCredential(secret, workspaceId, value !== undefined && COOKIE_VALUE.test(value) ? value : undefined);
  }

  /** Whether `token` is the one a page embedded for the bridge cookie this request carries (compared in constant time). */
  proves(token: string | undefined): boolean {
    if (this.carried === undefined || !token) return false;
    const expected = Buffer.from(bridgeToken(this.secret, this.workspaceId, this.carried));
    const given = Buffer.from(token);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  /** The token for a page rendered on this request: the carried cookie's, or that of a cookie minted for it (once per request). */
  issue(): string {
    const cookie = this.carried ?? (this.minted ??= randomBytes(16).toString("hex"));
    return bridgeToken(this.secret, this.workspaceId, cookie);
  }

  /** The cookie this request minted, for its response to set; undefined when it carried one (or rendered no bridge). */
  get mintedCookie(): string | undefined {
    return this.minted;
  }
}

/**
 * The Set-Cookie for a minted bridge cookie: the site's own pages only
 * (`path`, the site's prefix and a slash), never readable by a page's scripts,
 * never sent with a request another site starts. A session cookie: it lasts as
 * long as the browser does.
 */
export function bridgeSetCookie(value: string, path: string): string {
  return `${BRIDGE_COOKIE}=${value}; Path=${path}; HttpOnly; SameSite=Strict`;
}

/** The value of cookie `name` in a Cookie header (the first, as a browser lists the most specific path first), or undefined. */
export function cookieValue(header: string | undefined, name: string): string | undefined {
  for (const pair of (header ?? "").split(";")) {
    const at = pair.indexOf("=");
    if (at > 0 && pair.slice(0, at).trim() === name) return pair.slice(at + 1).trim();
  }
  return undefined;
}
