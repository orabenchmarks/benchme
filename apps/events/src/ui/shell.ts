import { sessionUser, shell, webmcpScript, type AuthService, type ShellCtx, type ToolRegistry } from "@benchme/site-kit";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { EventsRepo } from "../db/events-repo.js";
import type { OfficesRepo } from "../db/offices-repo.js";
import type { RegistrationsRepo } from "../db/registrations-repo.js";
import type { ToolContext } from "../mcp/tools.js";

export const SESSION_COOKIE = "ev_session";
export const SITE_NAME = "Fennick Events";
const ACCENT = "#5c6b1f";
const NAV = [
  { href: "/", label: "Rooms" },
  { href: "/events", label: "Events" },
  { href: "/events/new", label: "New event" },
  { href: "/people", label: "People" },
  { href: "/registrations", label: "Registrations" },
];

export type UiDeps = { offices: OfficesRepo; events: EventsRepo; registrations: RegistrationsRepo; auth: AuthService; tools: ToolRegistry<ToolContext> };
export type Q = Record<string, string | string[] | undefined>;
export const query = (req: FastifyRequest): Q => (req.query ?? {}) as Q;
export const form = (req: FastifyRequest): Record<string, string | undefined> => (req.body ?? {}) as Record<string, string | undefined>;
export const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
export const flat = (f: Q): Record<string, string | undefined> => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, one(v)]));

/** What every page route needs: the shell context and an HTML reply. A write asks no sign-in here: the site's rules ask it of every door. */
export type UiKit = {
  d: UiDeps;
  ctx: (req: FastifyRequest, flash?: string) => Promise<ShellCtx>;
  /** Renders `body` in the shell, with an optional flash, as the reply. */
  page: (req: FastifyRequest, reply: FastifyReply, title: string, body: (c: ShellCtx) => string | Promise<string>, opts?: { code?: number; flash?: string }) => Promise<FastifyReply>;
};

export function uiKit(d: UiDeps) {
  const user = sessionUser(d.auth, SESSION_COOKIE);
  const ctx = async (req: FastifyRequest, flash?: string): Promise<ShellCtx> => ({
    site: SITE_NAME,
    accent: ACCENT,
    prefix: req.prefix,
    nav: NAV,
    user: await user(req),
    flash,
    scripts: [webmcpScript(d.tools, req.prefix)],
  });
  const authDeps = { auth: d.auth, cookie: SESSION_COOKIE, shellCtx: ctx };
  const kit: UiKit = {
    d,
    ctx,
    async page(req, reply, title, body, opts = {}) {
      const c = await ctx(req, opts.flash);
      return reply.code(opts.code ?? 200).type("text/html; charset=utf-8").send(shell(c, title, await body(c)));
    },
  };
  return { kit, authDeps };
}
