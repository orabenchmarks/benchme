import type { z } from "zod";
import type { patchSpec } from "../specs/spec.js";
import { verdictOf, type CheckResult, type Oracle, type OracleContext, type OracleResult } from "./oracle.js";

type Spec = z.infer<typeof patchSpec>;

/** What a runner prints as its last stdout line: a JSON object of this shape. */
export type RunnerReport = {
  applied: boolean;
  tests: { id: string; ok: boolean }[];
  lint?: boolean;
  typecheck?: boolean;
  error?: string;
};

/**
 * Runs one patch against one seed repo in isolation and returns the report.
 * The Kubernetes implementation creates a Job from the spec's runner image;
 * tests use an in-memory stand-in. Both honour the same contract.
 */
export interface JobRunner {
  run(input: { spec: Spec; patch: Buffer; ctx: OracleContext }): Promise<RunnerReport>;
}

const MAX_PATCH_BYTES = 1_000_000;

export class PatchOracle implements Oracle<Spec> {
  readonly kind = "patch" as const;
  constructor(private readonly runner: JobRunner) {}

  async check(artifact: Buffer, spec: Spec, ctx: OracleContext): Promise<OracleResult> {
    if (artifact.length > MAX_PATCH_BYTES) return { verdict: "FAIL", checks: [{ name: "size", ok: false, note: `patch exceeds ${MAX_PATCH_BYTES} bytes` }] };
    const text = artifact.toString("utf8");
    if (!/^(diff --git|--- |Index: |From )/m.test(text)) return { verdict: "FAIL", checks: [{ name: "format", ok: false, note: "not a unified diff" }] };
    let report: RunnerReport;
    try {
      report = await this.runner.run({ spec, patch: artifact, ctx });
    } catch (err) {
      return { verdict: "FAIL", checks: [{ name: "runner", ok: false, note: `runner failed: ${(err as Error).message}` }] };
    }
    const checks: CheckResult[] = [{ name: "applied", ok: report.applied, note: report.applied ? undefined : (report.error ?? "patch did not apply") }];
    if (!report.applied) return { verdict: "FAIL", checks };
    const byId = new Map(report.tests.map((t) => [t.id, t.ok]));
    const required = spec.requiredTests.length ? spec.requiredTests : report.tests.map((t) => t.id);
    for (const id of required) {
      const ok = byId.get(id) === true;
      checks.push({ name: `test:${id}`, ok, note: ok ? undefined : byId.has(id) ? "failed" : "not run" });
    }
    if (spec.lint) checks.push({ name: "lint", ok: report.lint === true });
    if (spec.typecheck) checks.push({ name: "typecheck", ok: report.typecheck === true });
    return { verdict: verdictOf(checks), checks };
  }
}
