import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";

export type AppOptions = {
  name: string;
  /** Called by /readyz; false or a throw renders 503. Default: always ready. */
  readiness?: () => Promise<boolean>;
  logLevel?: string;
};

/** A Fastify app with the platform's fixed conventions: /healthz, /readyz, zod-aware errors, pino. */
export function createApp(opts: AppOptions): FastifyInstance {
  const app = Fastify({
    logger: { name: opts.name, level: opts.logLevel ?? process.env.LOG_LEVEL ?? "info" },
    trustProxy: true,
  });

  app.get("/healthz", async () => ({ ok: true }));
  app.get("/readyz", async (_req, reply) => {
    try {
      const ready = opts.readiness ? await opts.readiness() : true;
      if (!ready) return reply.code(503).send({ ok: false });
      return { ok: true };
    } catch (err) {
      app.log.warn({ err }, "readiness check failed");
      return reply.code(503).send({ ok: false });
    }
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: "VALIDATION", issues: err.issues });
    }
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) app.log.error({ err }, "unhandled error");
    return reply.code(status).send({ error: status >= 500 ? "INTERNAL" : (err as Error).message });
  });

  return app;
}
