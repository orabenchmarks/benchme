import type { Verdict } from "@benchme/core";
import { DomainError } from "@benchme/site-kit";
import type { CheckResult, OracleContext, OracleRegistry, OracleResult } from "./oracles/oracle.js";
import type { OracleSpec, TaskSpec } from "./specs/spec.js";

/** One check of a step, as the answer names it: `at` is when what satisfied it happened, when something did. */
export type StepCheck = { name: string; passed: boolean; at?: string };
/**
 * One state step's result. `step` counts from 1, the task's own prompt. A
 * blind task's steps carry counts where the others carry their checks' names.
 */
export type StepResult = { step: number; verdict: Verdict; checks: StepCheck[] } | { step: number; verdict: Verdict; passed: number; failed: number };

/** What a submission came to: the verdict, every check that was judged (for the receipt's details), and, for a task that declares steps, each state step's result. */
export type Judged = { verdict: Verdict; checks: CheckResult[]; steps?: StepResult[] };

const stepResult = (spec: TaskSpec, step: number, result: OracleResult): StepResult => {
  if (spec.blind) {
    const failed = result.checks.filter((c) => !c.ok).length;
    return { step, verdict: result.verdict, passed: result.checks.length - failed, failed };
  }
  return { step, verdict: result.verdict, checks: result.checks.map((c) => ({ name: c.name, passed: c.ok, ...(c.at ? { at: c.at } : {}) })) };
};

/**
 * Judges one submission against a task's spec.
 *
 * A spec that declares no `steps` is judged as it always was: its one oracle,
 * over the artifact.
 *
 * A spec that declares `steps` is answered step by step. Its STATE steps are
 * checked, in order, each standing on the ones before, and each is listed
 * with its checks. A step whose oracle is `json` is not listed: its answer is
 * a reply, which whoever holds the conversation grades against the key. The
 * verifier judges a json oracle only where it always did, on a task of one
 * step, whose reply is the artifact. So the verdict of a task of several
 * steps is OK only when every state step is OK, and such a task with no state
 * step at all has nothing here to verify and is refused.
 */
export async function judgeTask(spec: TaskSpec, artifact: Buffer, oracles: OracleRegistry, ctx: OracleContext): Promise<Judged> {
  if (spec.steps === undefined) {
    const result = await oracles.for(spec).check(artifact, spec.oracle, ctx);
    return { verdict: result.verdict, checks: result.checks };
  }
  const plan: OracleSpec[] = [spec.oracle, ...spec.steps.map((s) => s.oracle)];
  if (plan.length === 1) {
    const result = await oracles.for(spec).check(artifact, spec.oracle, ctx);
    return { verdict: result.verdict, checks: result.checks, steps: spec.oracle.kind === "state" ? [stepResult(spec, 1, result)] : [] };
  }
  if (!plan.some((oracle) => oracle.kind === "state")) {
    throw new DomainError("NO_STATE_STEP", `every step of task ${spec.id} is answered in a reply: there is no state for the verifier to check; grade the replies against the key`, 422);
  }
  // One submission for every step: the state oracle reads each ledger once, and a later step's check may come `after` an earlier step's.
  const stepCtx: OracleContext = { ...ctx, submission: {} };
  const steps: StepResult[] = [];
  const checks: CheckResult[] = [];
  let verdict: Verdict = "OK";
  for (const [i, oracle] of plan.entries()) {
    if (oracle.kind !== "state") continue;
    const result = await oracles.forKind(oracle.kind).check(artifact, oracle, stepCtx);
    steps.push(stepResult(spec, i + 1, result));
    checks.push(...result.checks);
    if (result.verdict !== "OK") verdict = "FAIL";
  }
  return { verdict, checks, steps };
}
