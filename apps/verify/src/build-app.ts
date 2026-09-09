import { createApp, type Pool, type ReceiptSigner } from "@benchme/core";
import { DomainError, registerWorkspaceScope } from "@benchme/site-kit";
import type { FastifyInstance } from "fastify";
import { PgAttemptsRepo } from "./attempts-repo.js";
import { DocxOracle } from "./oracles/docx-oracle.js";
import { JsonOracle } from "./oracles/json-oracle.js";
import { OracleRegistry } from "./oracles/oracle.js";
import { PatchOracle, type JobRunner } from "./oracles/patch-oracle.js";
import { XlsxOracle } from "./oracles/xlsx-oracle.js";
import type { SpecRegistry } from "./specs/spec.js";
import { Verifier } from "./verifier.js";

export type BuildDeps = {
  pool: Pool;
  specs: SpecRegistry;
  receipts: ReceiptSigner;
  runner: JobRunner;
  gatewaySecret: string;
  maxAttemptsPerTask: number;
  maxArtifactBytes: number;
  logLevel?: string;
};

/** Composition root: the four oracles registered, the verifier, the routes. */
export async function buildVerify(d: BuildDeps): Promise<{ app: FastifyInstance; verifier: Verifier }> {
  const oracles = new OracleRegistry().register(new JsonOracle()).register(new XlsxOracle()).register(new DocxOracle()).register(new PatchOracle(d.runner));
  const attempts = new PgAttemptsRepo(d.pool);
  const verifier = new Verifier({ specs: d.specs, oracles, receipts: d.receipts, attempts, pool: d.pool, maxAttemptsPerTask: d.maxAttemptsPerTask });

  const app = createApp({ name: "verify", readiness: async () => (await d.pool.query("SELECT 1")).rowCount === 1, ...(d.logLevel ? { logLevel: d.logLevel } : {}) });
  // Artifacts arrive as raw bytes of any content type (patch, xlsx, docx, json).
  app.removeAllContentTypeParsers();
  app.addContentTypeParser("*", { parseAs: "buffer", bodyLimit: d.maxArtifactBytes }, (_req, body, done) => done(null, body));
  registerWorkspaceScope(app, d.gatewaySecret);

  // Gateway calls every seeded app on workspace creation; the verifier keeps no per-workspace seed state.
  app.post<{ Params: { id: string } }>("/internal/workspaces/:id/seed", async (req, reply) => {
    if (req.params.id !== req.workspaceId) return reply.code(400).send({ error: "WORKSPACE_MISMATCH" });
    return reply.code(201).send({ ok: true });
  });

  app.get("/", async (req) => ({
    verifier: "benchme",
    submit: `${req.prefix}/v1/submit/<taskId>`,
    note: "POST the artifact (patch, xlsx, docx or json) as the raw request body. The response carries a receipt to quote in your final answer.",
    kinds: oracles.kinds(),
  }));

  app.post<{ Params: { taskId: string } }>("/v1/submit/:taskId", async (req, reply) => {
    const body = req.body as Buffer | undefined;
    if (!body || body.length === 0) return reply.code(400).send({ error: "EMPTY", message: "send the artifact as the request body" });
    try {
      const r = await verifier.submit(req.workspaceId, req.params.taskId, body);
      return reply.code(200).send(r);
    } catch (err) {
      if (err instanceof DomainError) return reply.code(err.status).send({ error: err.code, message: err.message });
      throw err;
    }
  });

  app.get<{ Params: { taskId: string } }>("/v1/attempts/:taskId", async (req) => attempts.listForTask(req.workspaceId, req.params.taskId));
  return { app, verifier };
}
