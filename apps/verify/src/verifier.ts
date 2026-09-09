import type { Pool, ReceiptSigner } from "@benchme/core";
import { DomainError } from "@benchme/site-kit";
import { randomBytes } from "node:crypto";
import type { AttemptsRepo } from "./attempts-repo.js";
import { detailsFor, type OracleRegistry } from "./oracles/oracle.js";
import type { SpecRegistry } from "./specs/spec.js";

export type SubmitResult = { verdict: "OK" | "FAIL"; receipt: string; details: unknown[]; attempt: number };

export type VerifierDeps = {
  specs: SpecRegistry;
  oracles: OracleRegistry;
  receipts: ReceiptSigner;
  attempts: AttemptsRepo;
  pool: Pool;
  maxAttemptsPerTask: number;
  now?: () => Date;
};

/**
 * The submit pipeline: spec lookup → oracle → receipt (signed, logged in
 * core.receipts AND verify.attempts with the artifact). Blind specs get counts
 * only. Every attempt is logged even when it fails.
 */
export class Verifier {
  private readonly now: () => Date;
  constructor(private readonly d: VerifierDeps) {
    this.now = d.now ?? (() => new Date());
  }

  async submit(workspaceId: string, taskId: string, artifact: Buffer): Promise<SubmitResult> {
    const spec = await this.d.specs.get(taskId);
    if (!spec) throw new DomainError("UNKNOWN_TASK", `no task ${taskId}`, 404);
    const prior = await this.d.attempts.countForTask(workspaceId, taskId);
    if (prior >= this.d.maxAttemptsPerTask) throw new DomainError("TOO_MANY_ATTEMPTS", `task ${taskId} allows ${this.d.maxAttemptsPerTask} submissions per workspace`, 429);

    const result = await this.d.oracles.for(spec).check(artifact, spec.oracle, { workspaceId, taskId });
    const nonce = randomBytes(8).toString("hex");
    const ts = this.now().getTime();
    const scope = `${taskId}`;
    const receipt = this.d.receipts.sign(scope, result.verdict, nonce, ts);
    const details = detailsFor(spec, result);
    await this.d.pool.query(
      `INSERT INTO core.receipts (receipt, workspace_id, scope, verdict, nonce, ts, details) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb) ON CONFLICT (receipt) DO NOTHING`,
      [receipt, workspaceId, scope, result.verdict, nonce, ts, JSON.stringify(details)],
    );
    await this.d.attempts.record(workspaceId, { taskId, kind: spec.oracle.kind, verdict: result.verdict, receipt, details, artifact });
    return { verdict: result.verdict, receipt, details, attempt: prior + 1 };
  }
}
