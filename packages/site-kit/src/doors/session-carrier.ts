import { DomainError } from "../domain-error.js";

export type Session = { token: string; expiresAt: Date };

/**
 * How a sign-in made through a tool stays with the caller. A browser keeps a
 * cookie; an MCP client keeps nothing but its session id, so its session is
 * stored under that. The sign-in tools hand the carrier the two things only
 * the site can do (check a password and open a session, close one) and never
 * know which kind of caller they are talking to.
 */
export interface SessionCarrier {
  /** The token of the session this request carries, if it carries one. */
  readonly token: string | undefined;
  /** Opens a session with `login` and makes the caller's later requests carry it. `login` takes the token to store it under, when the carrier has one of its own. */
  signIn(login: (bindTo?: string) => Promise<Session>): Promise<void>;
  /** Closes the session the request carries, with `logout`, and stops carrying it. */
  signOut(logout: (token: string) => Promise<void>): Promise<void>;
}

/** A browser on the site's pages: the session cookie the pages themselves set, sent again by the page's WebMCP bridge. */
export class CookieCarrier implements SessionCarrier {
  constructor(
    readonly token: string | undefined,
    private readonly setCookie: (token: string, expires: Date) => void,
  ) {}

  async signIn(login: (bindTo?: string) => Promise<Session>): Promise<void> {
    const session = await login();
    this.setCookie(session.token, session.expiresAt);
  }

  async signOut(logout: (token: string) => Promise<void>): Promise<void> {
    if (this.token) await logout(this.token);
    this.setCookie("", new Date(0));
  }
}

/** An MCP client: it repeats the Mcp-Session-Id it was given when it initialized, and its session is stored under that. */
export class McpSessionCarrier implements SessionCarrier {
  constructor(readonly token: string) {}

  async signIn(login: (bindTo?: string) => Promise<Session>): Promise<void> {
    await login(this.token);
  }

  async signOut(logout: (token: string) => Promise<void>): Promise<void> {
    await logout(this.token);
  }
}

/** A request with nowhere to keep a session: a tool call sent without initializing, from no page. It is told so before any password is checked. */
export class NoCarrier implements SessionCarrier {
  readonly token = undefined;

  async signIn(): Promise<never> {
    throw new DomainError("NO_SESSION", "this connection has nothing to stay signed in with: send `initialize` first and repeat the Mcp-Session-Id header it answers with on every call (or connect with Authorization: Bearer <api token>)", 400);
  }

  async signOut(): Promise<void> {}
}

const MCP_SESSION_ID = /^mcp-[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

/** A session id as `newMcpSessionId` makes them; anything else a client sends under that header is not one. */
export const isMcpSessionId = (value: string | undefined): value is string => value !== undefined && MCP_SESSION_ID.test(value);
