import "@fastify/cookie";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AuthError, type AuthService } from "./auth-service.js";
import { authPages, shell, type ShellCtx } from "./html.js";

export type SessionUser = { email: string; displayName: string };

export type AuthRoutesDeps = {
  auth: AuthService;
  /** Cookie name — one per site so two sites in one browser never share a session. */
  cookie: string;
  /** Build the page shell context for a request (site name, nav, user). */
  shellCtx: (req: FastifyRequest, flash?: string) => Promise<ShellCtx>;
};

type Q = Record<string, string | undefined>;
const form = (req: FastifyRequest): Q => (req.body ?? {}) as Q;
const q = (req: FastifyRequest): Q => (req.query ?? {}) as Q;

/** Reads the session cookie into a user, or null. */
export function sessionUser(auth: AuthService, cookie: string) {
  return async (req: FastifyRequest): Promise<SessionUser | null> => {
    const u = await auth.userForSession(req.workspaceId, req.cookies[cookie]);
    return u ? { email: u.email, displayName: u.displayName } : null;
  };
}

/** Redirects to /login when no session; returns the shell ctx otherwise. */
export function requireSession(d: AuthRoutesDeps) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<ShellCtx | null> => {
    const c = await d.shellCtx(req);
    if (!c.user) {
      reply.redirect(`${req.prefix}/login`, 302);
      return null;
    }
    return c;
  };
}

/** Resolve a caller for the REST surface: bearer api token first, session cookie second. */
export function apiUser(auth: AuthService, cookie: string) {
  return async (req: FastifyRequest) => {
    const bearer = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    return (await auth.userForApiToken(req.workspaceId, bearer || undefined)) ?? (await auth.userForSession(req.workspaceId, req.cookies[cookie]));
  };
}

/** /signup /verify /login /logout /account /account/token — identical on every site. */
export function registerAuthRoutes(app: FastifyInstance, d: AuthRoutesDeps): void {
  const html = (reply: FastifyReply, body: string) => reply.type("text/html; charset=utf-8").send(body);
  const cookieOpts = (req: FastifyRequest, expires: Date) => ({ path: `${req.prefix || ""}/`, httpOnly: true, sameSite: "lax" as const, expires });
  const authErr = async (req: FastifyRequest, reply: FastifyReply, err: unknown, title: string, page: string) => {
    if (err instanceof AuthError) return reply.code(err.status).type("text/html").send(shell(await d.shellCtx(req), title, page));
    throw err;
  };

  app.get("/signup", async (req, reply) => html(reply, shell(await d.shellCtx(req), "Sign up", authPages.signup(req.prefix))));
  app.post("/signup", async (req, reply) => {
    const f = form(req);
    try {
      await d.auth.signup(req.workspaceId, f.email ?? "", f.password ?? "", f.name ?? "");
      return html(reply, shell(await d.shellCtx(req), "Verify", authPages.verify(req.prefix, (f.email ?? "").trim().toLowerCase())));
    } catch (err) {
      return authErr(req, reply, err, "Sign up", authPages.signup(req.prefix, (err as Error).message));
    }
  });
  app.get("/verify", async (req, reply) => html(reply, shell(await d.shellCtx(req), "Verify", authPages.verify(req.prefix, q(req).email ?? ""))));
  app.post("/verify", async (req, reply) => {
    const f = form(req);
    try {
      await d.auth.verify(req.workspaceId, f.email ?? "", f.code ?? "");
      return html(reply, shell(await d.shellCtx(req, "Email verified. You can sign in now."), "Sign in", authPages.login(req.prefix)));
    } catch (err) {
      return authErr(req, reply, err, "Verify", authPages.verify(req.prefix, f.email ?? "", (err as Error).message));
    }
  });
  app.get("/login", async (req, reply) => html(reply, shell(await d.shellCtx(req), "Sign in", authPages.login(req.prefix))));
  app.post("/login", async (req, reply) => {
    const f = form(req);
    try {
      const s = await d.auth.login(req.workspaceId, f.email ?? "", f.password ?? "");
      reply.setCookie(d.cookie, s.token, cookieOpts(req, s.expiresAt));
      return reply.redirect(`${req.prefix}/`, 303);
    } catch (err) {
      return authErr(req, reply, err, "Sign in", authPages.login(req.prefix, (err as Error).message));
    }
  });
  app.post("/logout", async (req, reply) => {
    const token = req.cookies[d.cookie];
    if (token) await d.auth.logout(req.workspaceId, token);
    reply.clearCookie(d.cookie, { path: `${req.prefix || ""}/` });
    return reply.redirect(`${req.prefix}/`, 303);
  });
  const guard = requireSession(d);
  app.get("/account", async (req, reply) => {
    const c = await guard(req, reply);
    if (!c || !c.user) return;
    const full = await d.auth.userForSession(req.workspaceId, req.cookies[d.cookie]);
    return html(reply, shell(c, "Account", authPages.account(req.prefix, { email: c.user.email, displayName: c.user.displayName, apiToken: full?.apiToken ?? null })));
  });
  app.post("/account/token", async (req, reply) => {
    const c = await guard(req, reply);
    if (!c || !c.user) return;
    await d.auth.issueApiToken(req.workspaceId, c.user.email);
    return reply.redirect(`${req.prefix}/account`, 303);
  });
}
