import type { ShellCtx } from "@benchme/site-kit";
import type { FastifyReply, FastifyRequest } from "fastify";

/** What every page route shares: the shell context and an HTML reply. A write asks no sign-in here: the site's rules ask it of every door. */
export type PageKit = {
  ctx: (req: FastifyRequest, flash?: string) => Promise<ShellCtx>;
  html: (reply: FastifyReply, body: string, code?: number) => FastifyReply;
};

type Q = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
/** A query string or form as single strings, blanks dropped. */
export const flat = (f: unknown): Record<string, string | undefined> =>
  Object.fromEntries(Object.entries((f ?? {}) as Q).map(([k, v]) => [k, one(v)]).filter(([, v]) => v !== "" && v !== undefined));
