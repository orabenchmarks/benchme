import type { ShellCtx } from "@benchme/site-kit";
import type { FastifyReply, FastifyRequest } from "fastify";

/** What every page route shares: the shell context, an HTML reply, and the sign-in guard for writes. */
export type PageKit = {
  ctx: (req: FastifyRequest, flash?: string) => Promise<ShellCtx>;
  html: (reply: FastifyReply, body: string, code?: number) => FastifyReply;
  requireUser: (req: FastifyRequest, reply: FastifyReply) => Promise<ShellCtx | null>;
};

type Q = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
/** A query string or form as single strings, blanks dropped. */
export const flat = (f: unknown): Record<string, string | undefined> =>
  Object.fromEntries(Object.entries((f ?? {}) as Q).map(([k, v]) => [k, one(v)]).filter(([, v]) => v !== "" && v !== undefined));
