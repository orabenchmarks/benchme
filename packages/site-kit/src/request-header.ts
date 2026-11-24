import type { FastifyRequest } from "fastify";

/** A request header's value: the first, when a client sent it more than once. */
export function header(req: FastifyRequest, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}
