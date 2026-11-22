import "@fastify/cookie";
import { VERIFIER_SIG_HEADER, verifyVerifierHeader } from "@benchme/core";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AuthService } from "../auth-service.js";
import { registerLedgerRoute } from "../ledger/ledger-route.js";
import type { Ledger } from "../ledger/ledger.js";
import { ledgered } from "../ledger/ledgered.js";
import type { LedgerRules } from "../ledger/rules.js";
import { header } from "../workspace-scope.js";
import { CallerScope, once, type Caller } from "./caller.js";
import { doorOf, type Door } from "./door.js";

export type DoorsDeps = {
  /** The site's change ledger (its own schema's table: `new PgLedger(pool, "<app>")`). */
  ledger: Ledger;
  auth: AuthService;
  /** The site's session cookie. */
  cookie: string;
  gatewaySecret: string;
};

export type Doors = {
  callers: CallerScope;
  ledger: Ledger;
  /** The site's rules with the ledger kept: see `ledgered`. */
  ledgered<R extends object>(repo: R, rules: LedgerRules<R>): R;
};

/**
 * Gives a site its doors: every request is entered in the caller scope with
 * the door it came through and whoever is signed in, the site's rules are
 * wrapped to keep the ledger, and the verifier gets its route to read it.
 * Call it once, after the workspace scope and before any route is added.
 */
export function registerDoors(app: FastifyInstance, d: DoorsDeps): Doors {
  const callers = new CallerScope();
  const { ledger } = d;

  // A callback hook on purpose: the rest of the request runs inside `done`, so inside the scope.
  app.addHook("preHandler", (req, _reply, done) => {
    const door = doorOf(req.url, req.headers);
    if (!door) return done();
    callers.run(callerOf(req, door, d), done);
  });
  registerLedgerRoute(app, { ledger, gatewaySecret: d.gatewaySecret });

  return { callers, ledger, ledgered: (repo, rules) => ledgered(repo, rules, { ledger, callers }) };
}

/** A request's caller: the door, whether it is the verifier's own read, and who is signed in (an api token first, the session second). */
function callerOf(req: FastifyRequest, door: Door, d: DoorsDeps): Caller {
  const ws = req.workspaceId;
  const bearer = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  return {
    door,
    observer: verifyVerifierHeader(d.gatewaySecret, ws, header(req, VERIFIER_SIG_HEADER) ?? ""),
    actor: once(async () => ((await d.auth.userForApiToken(ws, bearer || undefined)) ?? (await d.auth.userForSession(ws, req.cookies[d.cookie])))?.email ?? null),
  };
}
