import type { FastifyInstance } from "fastify";
import { publicBase, type RouteDeps } from "./deps.js";

const form = (body: unknown): Record<string, unknown> => (body && typeof body === "object" ? (body as Record<string, unknown>) : {});

/**
 * LINK_AUTH_BASE_URL = <wallet>/auth: the device login link-cli runs (`auth login`, `auth status`, the refresh
 * every command does on a 401, `auth logout`). Form-encoded in, JSON out, OAuth errors in OAuth's shape.
 */
export function registerAuthRoutes(app: FastifyInstance, d: RouteDeps): void {
  app.post("/auth/device/code", async (req) => d.login.start(form(req.body), `${publicBase(req, d.publicUrl)}/device`));

  app.post("/auth/device/token", async (req, reply) => {
    const { tokens, session } = await d.login.token(form(req.body));
    req.walletSession = session;
    return reply.header("cache-control", "no-store").send(tokens);
  });

  app.post("/auth/device/revoke", async (req) => {
    await d.login.revoke(form(req.body));
    return {};
  });
}
