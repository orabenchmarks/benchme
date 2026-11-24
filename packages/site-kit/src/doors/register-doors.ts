import "@fastify/cookie";
import type { Transactions } from "@benchme/core";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AuthService } from "../auth-service.js";
import { AUTH_LEDGER } from "../ledger/auth-rules.js";
import { registerLedgerRoute } from "../ledger/ledger-route.js";
import type { Ledger } from "../ledger/ledger.js";
import { ledgered } from "../ledger/ledgered.js";
import type { LedgerRules } from "../ledger/rules.js";
import type { ToolRegistry } from "../tool-registry.js";
import { header } from "../request-header.js";
import { CallerScope, once, type Caller } from "./caller.js";
import type { Door } from "./door.js";
import { isObserver } from "./request-door.js";
import { CookieCarrier, McpSessionCarrier, NoCarrier, isMcpSessionId, type SessionCarrier } from "./session-carrier.js";
import { registerSignInTools } from "./sign-in-tools.js";
import { SignInRequired } from "./sign-in.js";

/** The header an MCP client repeats the session id in (the protocol's own). */
export const MCP_SESSION_HEADER = "mcp-session-id";

export type DoorsDeps = {
  /** The site's change ledger (its own schema's table: `new PgLedger(db, "<app>")`). */
  ledger: Ledger;
  /**
   * The site's `transactions(pool)`. Its pool is the one the site's repositories and accounts are built with, so a
   * write and its ledger entry are one transaction (`untransacted` for a site whose rows are not in Postgres).
   */
  transactions: Pick<Transactions, "run">;
  auth: AuthService;
  /** The site's session cookie. */
  cookie: string;
  gatewaySecret: string;
};

export type Doors = {
  callers: CallerScope;
  ledger: Ledger;
  /** The site's sign-up and sign-in with the ledger kept: hand this one to the routes. */
  auth: AuthService;
  /** The site's rules with the ledger kept, and a sign-in asked of every write: see `ledgered`. */
  ledgered<R extends object>(repo: R, rules: LedgerRules<R>): R;
  /** Adds the sign-in tools to the site's own, so its MCP server and its pages' WebMCP bridge both carry them. */
  withSignIn<C extends { workspaceId: string }>(tools: ToolRegistry<C>): ToolRegistry<C>;
};

/**
 * Gives a site its doors. Every request is entered in the caller scope with
 * the door it came through and whoever is signed in; the site's rules are
 * wrapped to keep the ledger and to ask a sign-in of every write; a write by
 * nobody is answered by the door it came through; and the verifier gets its
 * route to read the ledger. Call it once, after the workspace scope and
 * before any route is added.
 */
export function registerDoors(app: FastifyInstance, d: DoorsDeps): Doors {
  const callers = new CallerScope();
  const { ledger } = d;
  const units = { ledger, callers, transactions: d.transactions };
  const auth = ledgered(d.auth, AUTH_LEDGER, units);

  // A callback hook on purpose: the rest of the request runs inside `done`, so inside the scope. The door is the one the
  // workspace scope read off the request (its route, and at /mcp the page's bridge credential).
  app.addHook("preHandler", (req, reply, done) => {
    const door = req.door;
    if (!door) return done();
    callers.run(callerOf(app, req, reply, door, d), done);
  });

  // The rules refuse a write by nobody (SignInRequired); each door says so its own way. A tool's refusal never
  // gets here: the MCP server turns it into the tool's result.
  app.addHook("onRoute", (route) => {
    const inherited = route.errorHandler;
    route.errorHandler = function (err, req, reply) {
      if (!(err instanceof SignInRequired)) return (inherited ?? app.errorHandler).call(this, err, req, reply);
      if (err.door === "page") return reply.redirect(`${req.prefix}/login`, 302);
      return reply.code(err.status).send({ error: err.code, message: err.message });
    };
  });
  registerLedgerRoute(app, { ledger, gatewaySecret: d.gatewaySecret });

  return {
    callers,
    ledger,
    auth,
    ledgered: (repo, rules) => ledgered(repo, rules, units),
    withSignIn: (tools) => registerSignInTools(tools, { auth, callers }),
  };
}

/**
 * A request's caller: the door, whether it is the verifier's own read, and who
 * is signed in. Every door is asked the same three things, in one order: an
 * api token (`Authorization: Bearer`), the site's session cookie, the MCP
 * session a sign-in tool signed in.
 */
function callerOf(app: FastifyInstance, req: FastifyRequest, reply: FastifyReply, door: Door, d: DoorsDeps): Caller {
  const ws = req.workspaceId;
  const bearer = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  const session = carrierOf(app, req, reply, door, d.cookie);
  return {
    door,
    observer: isObserver(req, d.gatewaySecret),
    session,
    actor: once(async () => {
      const user = (await d.auth.userForApiToken(ws, bearer || undefined)) ?? (await d.auth.userForSession(ws, req.cookies[d.cookie])) ?? (await d.auth.userForSession(ws, session.token));
      return user?.email ?? null;
    }),
  };
}

/**
 * Where a sign-in made on this request would be kept. An MCP client has its
 * session id. A page's bridge has the browser's cookie jar: the answer to its
 * call is written straight to the socket (the MCP transport owns it), so the
 * cookie goes on the raw response, in the words the pages' own sign-in uses.
 * A page or REST request signs in on the sign-in page, never through a tool.
 */
function carrierOf(app: FastifyInstance, req: FastifyRequest, reply: FastifyReply, door: Door, cookie: string): SessionCarrier {
  const mcpSession = header(req, MCP_SESSION_HEADER);
  if (door === "mcp" && isMcpSessionId(mcpSession)) return new McpSessionCarrier(mcpSession);
  if (door !== "webmcp") return new NoCarrier();
  return new CookieCarrier(req.cookies[cookie], (token, expires) => {
    reply.raw.setHeader("set-cookie", app.serializeCookie(cookie, token, { path: `${req.prefix || ""}/`, httpOnly: true, sameSite: "lax", expires }));
  });
}
